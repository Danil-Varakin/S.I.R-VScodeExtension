import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as vscode from 'vscode';
// the lens glyphs by name, so a change of them is one change, not a hunt through the tests
import { GLYPH } from '../../src/feedback/verdict.ts';
import {
  answerMessages,
  api,
  closeAll,
  exists,
  file,
  generated,
  open,
  setText,
  waitFor,
  waitForActive,
  waitForLenses,
  waitForStatus,
  writeFile,
} from './helpers.ts';

// What README promises and no other suite checked (docs/15-test-plan.md, stage 5): Init
// Config, the Check All → Copy Patch Report → Open Failed Patches round, the status bar
// after a commit, the lenses of an ambiguous and of a dependent hunk with the bulb's jump,
// one Undo after Apply, and Show Log.

const read = async (uri: vscode.Uri): Promise<string> => new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));

/** A `.sirp` by hand, in the current format: a four-space gutter and `# end`. */
function sirMd(target: string, hunks: ReadonlyArray<{ match: string; patch: string }>): string {
  const block = (heading: string, body: string): string => [heading, ...body.split('\n').map((l) => (l === '' ? '' : `    ${l}`)), '# end'].join('\n');
  return `Sir: 2\nTarget: ${target}\n\n${hunks.map((h) => `${block('# match cpp', h.match)}\n${block('# patch', h.patch)}`).join('\n\n')}\n`;
}

async function actionsAt(uri: vscode.Uri, line: number): Promise<vscode.CodeAction[]> {
  const range = new vscode.Range(line, 0, line, 0);
  return (await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', uri, range)) ?? [];
}

const tabOpen = (uri: vscode.Uri): boolean =>
  vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri.toString()));

suite('what README promises', () => {
  teardown(closeAll);

  test('Init Config writes $schema and version where there is no config, and opens one that is there untouched', async () => {
    await api();
    const fresh = file('bare', 'sir.config.json');
    await open(file('bare', 'x.cc'));
    await vscode.commands.executeCommand('sir.initConfig');
    await waitFor('the new config on disk', () => exists(fresh));
    const written = JSON.parse(await read(fresh)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(written).sort(), ['$schema', 'version']);
    assert.equal(typeof written['version'], 'number');
    await waitForActive(fresh);

    const existing = file('repo', 'sir.config.json');
    const before = await read(existing);
    await open(file('repo', 'src', 'a.cc'));
    await vscode.commands.executeCommand('sir.initConfig');
    await waitForActive(existing);
    assert.equal(await read(existing), before, 'opened, not rewritten');
  });

  test('Check All, then Copy Patch Report gives Markdown, and Open Failed Patches opens just the ones that fail', async () => {
    const { patch: good } = await generated(file('repo', 'src', 'report-ok.cc'));
    const { patch: bad, text } = await generated(file('repo', 'src', 'report-bad.cc'));
    // through the editor and saved: the check reads what the editor holds, and the file
    // written behind an open document would be checked as it was before
    const badEditor = await open(bad, vscode.ViewColumn.Two);
    await setText(badEditor.document, text.replace(/int f\(\) \{/g, 'int nowhere() {'));
    await badEditor.document.save();
    await closeAll();

    const messages = answerMessages();
    try {
      await vscode.commands.executeCommand('sir.checkAll');
      await vscode.commands.executeCommand('sir.copyReport');
      const report = await vscode.env.clipboard.readText();
      assert.match(report, /^# S.I.R patches against the project base\n\n✓ \d+ · ⚠ \d+ · ✗ \d+\n/);
      assert.match(report, /^- ✗ `repo\/src\/report-bad\.cc\.sirp` — 0\/1 hunks — hunk 1: /m);
      assert.doesNotMatch(report, /report-ok\.cc\.sirp/, 'a patch that applies is not listed');

      await vscode.commands.executeCommand('sir.openFailed');
      await waitFor('the failing patch open', () => tabOpen(bad));
      assert.equal(tabOpen(good), false, 'a patch that applies is not opened');
    } finally {
      messages.restore();
    }
  });

  test('the status bar names the new commit once one is made', async () => {
    const sir = await api();
    await open(file('repo', 'src', 'commit.cc'));
    const before = await waitForStatus(sir, /@ [0-9a-f]{7}/);
    const sha = /@ ([0-9a-f]{7})/.exec(before)![1]!;
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'moved on'], {
      cwd: file('repo').fsPath,
    });
    const after = await waitForStatus(sir, new RegExp(`@ (?!${sha})[0-9a-f]{7}`));
    assert.notEqual(after, before);
  });

  test('a pattern that fits twice reads fits 2 places', async () => {
    const patch = file('repo', 'src', 'many.cc.sirp');
    await writeFile(patch, sirMd('src/many.cc', [{ match: '... one(); >>> ...', patch: 'X();' }]));
    await open(patch);
    await waitForLenses(patch, (t) => t.includes(`${GLYPH.unresolved} fits 2 places`), 'the ambiguous lens');
  });

  test('a hunk that leans on an earlier one says so, and once broken its bulb goes to that hunk', async () => {
    const code = file('repo', 'src', 'chain.cc');
    const patch = file('repo', 'src', 'chain.cc.sirp');
    await writeFile(
      patch,
      sirMd('src/chain.cc', [
        { match: '... one(); >>> ...', patch: 'two();' },
        { match: '... two(); >>> ...', patch: 'three();' },
      ]),
    );
    const editor = await open(patch);
    await waitForLenses(patch, (t) => t.some((x) => x.startsWith(`${GLYPH.lands} `) && x.endsWith(' · depends on an earlier hunk')), 'the dependent lens');

    // the code moves away from both hunks: the second is drifted, and its bulb offers the jump
    const codeEditor = await open(code, vscode.ViewColumn.Two);
    await setText(codeEditor.document, `${codeEditor.document.getText()}// moved\n`);
    await waitForLenses(patch, (t) => t.filter((x) => x.startsWith(`${GLYPH.drifted} `)).length === 2, 'both hunks drifted');

    const lines = editor.document.getText().split('\n');
    const first = lines.findIndex((l) => l.startsWith('# match'));
    const second = lines.findIndex((l, i) => i > first && l.startsWith('# match'));
    const jump = await waitFor('the jump in the bulb', async () =>
      (await actionsAt(patch, second)).find((a) => a.command?.command === 'sir.repair' && a.title === 'Go to Hunk 1'),
    );
    const command = jump.command!;
    await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
    await waitFor('the cursor on the first hunk', () => {
      const active = vscode.window.activeTextEditor;
      return active?.document.uri.toString() === patch.toString() && active.selection.active.line === first;
    });
  });

  test('after Apply one Undo gives back the code as it was', async () => {
    const code = file('repo', 'src', 'undo.cc');
    const { editor, patch } = await generated(code);
    const base = await read(code);
    await setText(editor.document, base);
    await waitForLenses(patch, (t) => t.some((x) => x.startsWith('▶ Apply to ')), 'the Apply lens');

    const messages = answerMessages();
    try {
      await vscode.commands.executeCommand('sir.apply', patch);
      assert.notEqual(editor.document.getText(), base, 'the patch is in');
      await open(code);
      await waitForActive(code);
      await vscode.commands.executeCommand('undo');
      assert.equal(editor.document.getText(), base);
    } finally {
      messages.restore();
    }
  });

  test('Show Log opens the S.I.R output channel', async () => {
    await api();
    await vscode.commands.executeCommand('sir.showLog');
    await waitFor('the S.I.R channel shown', () =>
      vscode.workspace.textDocuments.some((d) => d.uri.scheme === 'output' && /S\.I\.R/.test(decodeURIComponent(d.uri.toString()))),
    );
  });
});
