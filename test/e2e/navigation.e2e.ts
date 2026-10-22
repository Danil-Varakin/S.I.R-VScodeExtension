import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
// the lens glyphs by name, so a change of them is one change, not a hunt through the tests
import { GLYPH } from '../../src/feedback/verdict.ts';
import {
  api,
  closeAll,
  cursorOn,
  file,
  generated,
  open,
  setText,
  waitFor,
  waitForActive,
  waitForLenses,
  waitForStatus,
} from './helpers.ts';

// alt+O, the diffs (B1) and the patch guard (B4).

const visible = (scheme: string): vscode.TextEditor | undefined =>
  vscode.window.visibleTextEditors.find((e) => e.document.uri.scheme === scheme);

suite('navigation, diffs and the guard', () => {
  teardown(closeAll);

  test('alt+O goes from the hunk to the line it writes, and back', async () => {
    const code = file('repo', 'src', 'nav.cc');
    const { patch } = await generated(code);
    await waitForLenses(patch, (t) => t.some((x) => x.startsWith(`${GLYPH.lands} `)), 'a placed lens');

    const patchEditor = await open(patch, vscode.ViewColumn.Two);
    cursorOn(patchEditor, '# match');
    await vscode.commands.executeCommand('sir.toggle');
    await waitForActive(code, 'the code');
    const at = vscode.window.activeTextEditor!;
    assert.match(at.document.lineAt(at.selection.active.line).text, /return 2;/);

    await vscode.commands.executeCommand('sir.toggle');
    await waitForActive(patch, 'the patch');
  });

  test('alt+B opens «base ↔ base + patch» with the hunk selected on both sides (B1)', async () => {
    const code = file('repo', 'src', 'nav.cc');
    const patch = code.with({ path: `${code.path}.sirp` });
    const editor = await open(patch, vscode.ViewColumn.Two);
    cursorOn(editor, '# match');
    await vscode.commands.executeCommand('sir.goToBaseline');

    const left = await waitFor('the base half', () => visible('sir-baseline'));
    const right = await waitFor('the result half', () => visible('sir-result'));
    assert.match(left.document.getText(), /return 1;/);
    assert.match(right.document.getText(), /return 2;/);
    assert.match(right.document.lineAt(right.selection.start.line).text, /return 2;/, 'final selected on the right');
    assert.match(left.document.lineAt(left.selection.start.line).text, /return 1;|int f/, 'base selected on the left');

    // B10: marked, not merely selected — a block on both sides, each with its label
    const marked = (await api()).focused();
    assert.deepEqual(
      marked.map((m) => [m.uri, m.kind]),
      [
        [left.document.uri.toString(), 'block'],
        [right.document.uri.toString(), 'block'],
      ],
    );
    assert.match(marked[0]!.label, /hunk 1 of \d+ replaces this/);

    // an edit of the patch moves what the mark was measured in: it goes
    await setText(editor.document, editor.document.getText().replace('return 2;', 'return 8;'));
    await waitFor('the mark cleared', async () => (await api()).focused().length === 0);
  });

  test('a hunk that only inserts is a line between lines in the base, not its neighbour (B10)', async () => {
    const code = file('repo', 'src', 'focus.cc');
    const patch = code.with({ path: `${code.path}.sirp` });
    const editor = await open(code);
    await setText(editor.document, editor.document.getText().replace('  return 10;\n', '  return 10;\n  h();\n'));
    await vscode.commands.executeCommand('sir.generate', code);
    const patchEditor = await waitFor('the patch open', () =>
      vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === patch.toString()),
    );
    cursorOn(patchEditor, '# match');
    await vscode.commands.executeCommand('sir.goToBaseline');

    const marked = await waitFor('the hunk marked', async () => {
      const m = (await api()).focused();
      return m.length === 2 ? m : undefined;
    });
    assert.deepEqual(
      marked.map((m) => m.kind),
      ['gap', 'block'],
    );
    assert.match(marked[0]!.label, /inserts here/);
  });

  test('Preview Patch from the code opens the same diff, and the right half follows an edit of the patch', async () => {
    const code = file('repo', 'src', 'nav.cc');
    const patch = code.with({ path: `${code.path}.sirp` });
    await open(code);
    await vscode.commands.executeCommand('sir.previewPatch');
    const right = await waitFor('the result half', () => visible('sir-result'));
    assert.match(right.document.getText(), /return 2;/);

    const patchEditor = await open(patch, vscode.ViewColumn.Three);
    await setText(patchEditor.document, patchEditor.document.getText().replace('return 2;', 'return 7;'));
    await waitFor('the right half updated', () => visible('sir-result')?.document.getText().includes('return 7;'));
    await vscode.commands.executeCommand('workbench.action.files.revert');
  });

  test('the guard says whether the file is base + patch (B4)', async () => {
    const sir = await api();
    const { editor } = await generated(file('repo', 'src', 'guard.cc'));
    const code = editor.document.uri;
    await open(code);
    await waitForActive(code, 'the code');
    await waitForStatus(sir, /matches its patch/);

    await setText(editor.document, editor.document.getText().replace('return 10;', 'return 99;'));
    await waitForStatus(sir, /edits not in the patch/);

    await vscode.commands.executeCommand('sir.showEditsNotInPatch');
    const left = await waitFor('base + patch on the left', () => visible('sir-result'));
    assert.match(left.document.getText(), /return 10;/);

    await open(code);
    await waitForActive(code, 'the code');
    await setText(editor.document, editor.document.getText().replace('return 2;', 'return 1;').replace('return 99;', 'return 10;'));
    await waitForStatus(sir, /patch not applied/);
  });

  test('a file of code without a patch shows its base in the status bar', async () => {
    const sir = await api();
    await open(file('repo', 'src', 'b.py'));
    await waitForStatus(sir, /base HEAD:src\/b\.py @ [0-9a-f]{7}/);
    await open(file('saved', 's.cc'));
    await waitForStatus(sir, /saved file|matches its patch|nothing to check/);
  });
});
