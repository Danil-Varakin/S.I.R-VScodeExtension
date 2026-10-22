import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { closeAll, exists, file, generated, lf, waitFor } from './helpers.ts';

// New S.I.R Patch (N2): from the Explorer's context menu the command gets the file's URI,
// as here. The patch opens unsaved at the place the core names, and reaches the disk on
// the first save; a patch already there is opened instead.

/** The editor of the patch started at `patch`, once it shows. */
function draftOf(patch: vscode.Uri): Promise<vscode.TextEditor> {
  const draft = patch.with({ scheme: 'untitled' }).toString();
  return waitFor(`the draft of ${patch.fsPath}`, () =>
    vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === draft && e.document.getText() !== ''),
  );
}

suite('new patch', () => {
  teardown(closeAll);

  test('a file without a patch: the header and one hunk, unsaved at its place, on disk once saved', async () => {
    const code = file('repo', 'src', 'fresh.cc');
    const patch = file('repo', 'src', 'fresh.cc.sirp');
    await vscode.commands.executeCommand('sir.newPatch', code);

    const editor = await draftOf(patch);
    // a new document takes the line endings of the platform: CRLF on Windows
    const text = lf(editor.document.getText());
    // protocol 5: the core's whole header (the base is git: Base-Blob too); protocol 4: Sir and Target
    assert.match(
      text,
      /^Sir: 2\nTarget: src\/fresh\.cc\n(?:Base-Blob: [0-9a-f]{40}\nSir-Version: \S+\nGrammar: \S+\n)?\n# match (?:cc|cpp)\n/,
    );
    assert.match(text, /\n# patch\n {4}\n# end\n$/);
    assert.equal(editor.document.languageId, 'sir');
    // the first tab stop is selected: the anchor before the change
    assert.equal(editor.document.getText(editor.selection), 'anchor before the change');
    assert.equal(await exists(patch), false, 'nothing is written before the save');

    try {
      assert.equal(await editor.document.save(), true);
      await waitFor('the patch on disk', () => exists(patch));
    } finally {
      if (await exists(patch)) await vscode.workspace.fs.delete(patch);
    }
  });

  test('run twice before saving: the one draft again, not a second hunk', async () => {
    const code = file('repo', 'src', 'fresh-twice.cc');
    const patch = file('repo', 'src', 'fresh-twice.cc.sirp');
    await vscode.commands.executeCommand('sir.newPatch', code);
    const first = (await draftOf(patch)).document.getText();
    await vscode.commands.executeCommand('sir.newPatch', code);
    const again = await draftOf(patch);
    assert.equal(again.document.getText(), first);
    assert.equal((first.match(/^# match /gm) ?? []).length, 1);
  });

  test('a file with a patch: that patch is opened, nothing is started', async () => {
    const code = file('repo', 'src', 'started.cc');
    const { patch, text } = await generated(code);
    await closeAll();

    await vscode.commands.executeCommand('sir.newPatch', code);
    const shown = await waitFor('the patch open', () =>
      vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === patch.toString()),
    );
    assert.equal(shown.document.getText(), text);
    assert.equal(
      vscode.workspace.textDocuments.some((d) => d.uri.scheme === 'untitled'),
      false,
      'no draft beside the existing patch',
    );
  });

  test('a project over an upstream: the patch tree, Target from the upstream root', async () => {
    await vscode.commands.executeCommand('sir.newPatch', file('proj', 'up', 'src', 'd.cc'));
    const editor = await draftOf(file('proj', 'patches', 'src', 'd.cc.sirp'));
    assert.match(lf(editor.document.getText()), /^Sir: 2\nTarget: src\/d\.cc\n/);
  });
});
