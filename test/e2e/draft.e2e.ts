import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import { answerMessages, closeAll, exists, file, open, setText, waitFor } from './helpers.ts';

// Write by Hand (N4): a change synthesis cannot anchor hands over a draft; finished by
// hand and sent back with Continue Generate, it becomes the patch. Needs a core of
// protocol 5 — with an older one the error offers no draft, and the test is skipped.

/** the second `work();` of the two identical blocks, changed */
const changed = (text: string): string => {
  const at = text.lastIndexOf('work();');
  return `${text.slice(0, at)}work(2);${text.slice(at + 'work();'.length)}`;
};

const HAND_HUNK = [
  '# match cpp',
  '    ...',
  '    if (cond) {',
  '    ...',
  '    }',
  '    ...',
  '    if (cond) {',
  '    ...',
  '    >>>',
  '    work();',
  '    <<<',
  '    ...',
  '# end',
  '# patch',
  '    work(2);',
  '# end',
  '',
].join('\n');

suite('write by hand', () => {
  teardown(closeAll);

  test('a change no pattern anchors: Write by Hand, finish the hunk, Continue Generate writes the patch', async function () {
    const code = file('repo', 'src', 'twins.cc');
    const patch = file('repo', 'src', 'twins.cc.sirp');
    const messages = answerMessages((m) => (m.items.includes('Write by Hand') ? 'Write by Hand' : undefined));
    try {
      const editor = await open(code);
      await setText(editor.document, changed(editor.document.getText()));
      await vscode.commands.executeCommand('sir.generate');
      const refusal = await waitFor('the refusal', () => messages.shown.find((m) => m.kind === 'error'));
      if (!refusal.items.includes('Write by Hand')) this.skip();
      assert.deepEqual(refusal.items, ['Write by Hand', 'Show the Line']);

      const draftUri = patch.with({ scheme: 'untitled' }).toString();
      const draft = await waitFor('the draft', () =>
        vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === draftUri && e.document.getText() !== ''),
      );
      const start = draft.selection.active.line;
      assert.equal(draft.document.lineAt(start).text, '# match cpp', 'the cursor is on the starting hunk');
      assert.match(draft.document.getText(), /^Sir: 2\nTarget: src\/twins\.cc\n/);
      assert.equal(await exists(patch), false, 'nothing is written before Continue Generate');

      // the starting hunk, replaced by one that tells the two blocks apart
      const kept = draft.document.getText(new vscode.Range(0, 0, start, 0));
      await draft.edit((edit) => edit.replace(new vscode.Range(start, 0, draft.document.lineCount, 0), HAND_HUNK));
      await vscode.commands.executeCommand('sir.continueGenerate', draft.document.uri);

      const text = await waitFor('the patch on disk', async () => ((await exists(patch)) ? readFile(patch.fsPath, 'utf8') : undefined));
      assert.ok(text.includes(HAND_HUNK.trimEnd()), 'the hunk written by hand is in the patch byte for byte');
      assert.match(text, /^Sir: 2\nTarget: src\/twins\.cc\n/);
      assert.ok(kept.startsWith('Sir: 2'));
      await waitFor('the draft closed', () => !vscode.workspace.textDocuments.some((d) => d.uri.toString() === draftUri));
    } finally {
      messages.restore();
    }
  });

  test('a hand-written hunk that does not land is marked on its line in the draft', async function () {
    const code = file('repo', 'src', 'twins-bad.cc');
    const patch = file('repo', 'src', 'twins-bad.cc.sirp');
    const messages = answerMessages((m) => (m.items.includes('Write by Hand') ? 'Write by Hand' : undefined));
    try {
      const editor = await open(code);
      await setText(editor.document, changed(editor.document.getText()));
      await vscode.commands.executeCommand('sir.generate');
      const refusal = await waitFor('the refusal', () => messages.shown.find((m) => m.kind === 'error'));
      if (!refusal.items.includes('Write by Hand')) this.skip();

      const draftUri = patch.with({ scheme: 'untitled' }).toString();
      const draft = await waitFor('the draft', () =>
        vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === draftUri && e.document.getText() !== ''),
      );
      const start = draft.selection.active.line;
      await draft.edit((edit) =>
        edit.replace(new vscode.Range(start, 0, draft.document.lineCount, 0), HAND_HUNK.replace('    if (cond) {\n    ...\n    >>>', '    if (nothere) {\n    ...\n    >>>')),
      );
      await vscode.commands.executeCommand('sir.continueGenerate', draft.document.uri);

      const marked = await waitFor('the mark in the draft', () => {
        const found = vscode.languages.getDiagnostics(draft.document.uri);
        return found.length > 0 ? found : undefined;
      });
      assert.ok(marked[0]!.range.start.line >= start, 'on a line of the hand-written hunk');
      assert.match(marked[0]!.message, /does not land/);
      assert.equal(await exists(patch), false);
    } finally {
      messages.restore();
    }
  });
});
