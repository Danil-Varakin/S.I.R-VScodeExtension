import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import {
  answerMessages,
  api,
  closeAll,
  edited,
  file,
  generated,
  open,
  setText,
  waitForLenses,
} from './helpers.ts';

// Apply: the patch laid on its clean git base and put in place of the code — by the
// table of docs/07-proposals.md (A1), one patch into the buffer and Apply All (A7).

const OLD_CC = 'int f() {\n  return 1;\n}\n\nint g() {\n  return 10;\n}\n';
const NEW_CC = edited(OLD_CC);

async function onDisk(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

/** A patch for `code`, and the code back to its base: the state of every fresh checkout. */
async function notApplied(code: vscode.Uri): Promise<{ editor: vscode.TextEditor; patch: vscode.Uri }> {
  const { editor, patch } = await generated(code);
  await setText(editor.document, OLD_CC);
  return { editor, patch };
}

suite('Apply', () => {
  teardown(closeAll);

  test('code that is its base gets the patch, unsaved; a second Apply finds it there', async () => {
    const code = file('repo', 'src', 'apply.cc');
    const { editor, patch } = await notApplied(code);
    await open(patch, vscode.ViewColumn.Two);
    await waitForLenses(patch, (t) => t.some((x) => x.startsWith('▶ Apply to ')), 'the Apply lens');

    const messages = answerMessages();
    try {
      await vscode.commands.executeCommand('sir.apply', patch);
      assert.equal(editor.document.getText(), NEW_CC);
      assert.ok(editor.document.isDirty, 'Apply leaves saving to the user');
      assert.equal(await onDisk(code), OLD_CC);

      await vscode.commands.executeCommand('sir.apply', code);
      assert.ok(messages.shown.some((m) => /is already in apply\.cc/.test(m.message)), JSON.stringify(messages.shown));
      assert.equal(editor.document.getText(), NEW_CC, 'nothing is written twice');
    } finally {
      messages.restore();
    }
  });

  test('edits the patch does not have are kept unless Overwrite is chosen', async () => {
    const code = file('repo', 'src', 'apply-edits.cc');
    const { editor, patch } = await notApplied(code);
    const mine = `${OLD_CC}// mine\n`;
    await setText(editor.document, mine);

    let messages = answerMessages();
    try {
      await vscode.commands.executeCommand('sir.apply', patch);
      const asked = messages.shown.find((m) => /has edits that are not in apply-edits\.cc\.sirp/.test(m.message));
      assert.ok(asked, JSON.stringify(messages.shown));
      assert.deepEqual(asked.items, ['Generate Patch', 'Overwrite', 'Show Edits Not in Patch']);
      assert.equal(editor.document.getText(), mine, 'dismissed: nothing written');
    } finally {
      messages.restore();
    }

    messages = answerMessages((m) => (m.items.includes('Overwrite') ? 'Overwrite' : undefined));
    try {
      await vscode.commands.executeCommand('sir.apply', patch);
      assert.equal(editor.document.getText(), NEW_CC);
    } finally {
      messages.restore();
    }
  });

  test('a hunk that does not land: nothing is written', async () => {
    const code = file('repo', 'src', 'apply-broken.cc');
    const { editor, patch } = await notApplied(code);
    const patchEditor = await open(patch, vscode.ViewColumn.Two);
    await setText(patchEditor.document, patchEditor.document.getText().replace(/int f\(\) \{/g, 'int nowhere() {'));

    const messages = answerMessages();
    try {
      await vscode.commands.executeCommand('sir.apply', patch);
      assert.ok(messages.shown.some((m) => /0 of 1 hunks of apply-broken\.cc\.sirp land/.test(m.message)), JSON.stringify(messages.shown));
      assert.equal(editor.document.getText(), OLD_CC);
    } finally {
      messages.restore();
    }
  });

  test('with the saved file as base Apply refuses: the file is its own base', async () => {
    const code = file('saved', 'apply.cc');
    const { editor, patch } = await notApplied(code);
    const messages = answerMessages();
    try {
      await vscode.commands.executeCommand('sir.apply', patch);
      assert.ok(messages.shown.some((m) => m.kind === 'error' && /needs a git base/.test(m.message)), JSON.stringify(messages.shown));
      assert.equal(editor.document.getText(), OLD_CC);
    } finally {
      messages.restore();
    }
  });

  test('Apply All writes what is its base and leaves the rest, through the editor and on disk', async () => {
    const sir = await api();
    const one = file('repo', 'src', 'apply-all-1.cc');
    const two = file('repo', 'src', 'apply-all-2.cc');
    const first = await notApplied(one);
    const second = await notApplied(two);
    await setText(second.editor.document, `${OLD_CC}// mine\n`);

    const messages = answerMessages();
    try {
      const counts = await sir.applyPatches([first.patch, second.patch]);
      assert.equal(counts?.write, 1);
      assert.equal(counts?.['local-edits'], 1);
      assert.equal(first.editor.document.getText(), NEW_CC);
      assert.equal(second.editor.document.getText(), `${OLD_CC}// mine\n`, 'edits not in the patch are left alone');
    } finally {
      messages.restore();
    }

    // above the preview limit, closed files are written on disk
    await closeAll();
    await vscode.workspace.fs.writeFile(one, new TextEncoder().encode(OLD_CC));
    const silenced = answerMessages();
    try {
      const counts = await sir.applyPatches([first.patch], 0);
      assert.equal(counts?.write, 1);
      assert.equal(await onDisk(one), NEW_CC);
      const again = await sir.applyPatches([first.patch], 0);
      assert.equal(again?.applied, 1, 'already there: not written again');
    } finally {
      silenced.restore();
    }
  });
});
