import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { api, file, open, sleep } from './helpers.ts';

// The `quiet` workspace: a file of code and nothing of sir (C1). Run alone, in its own host.

suite('quiet without sir', () => {
  test('a file of code in a workspace without sir starts no core and shows nothing', async function () {
    if (!vscode.workspace.workspaceFolders?.[0]?.uri.fsPath.endsWith('quiet')) this.skip();
    const sir = await api();
    await open(file('x.cc'));
    await sleep(1_500);
    assert.equal(sir.gateOpen(), false);
    assert.equal(sir.spawns(), 0, 'no core for a workspace without sir');
    assert.equal(sir.status(), undefined, 'the status bar stays empty');
  });

  test('a Sir command opens the gate: what it asks of the core, the user asked for', async function () {
    if (!vscode.workspace.workspaceFolders?.[0]?.uri.fsPath.endsWith('quiet')) this.skip();
    const sir = await api();
    await vscode.commands.executeCommand('sir.showBase');
    assert.equal(sir.gateOpen(), true);
  });
});
