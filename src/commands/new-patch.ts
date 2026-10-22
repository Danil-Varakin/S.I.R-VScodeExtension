import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { SirDeps } from '../deps.ts';
import { activeFile } from '../active-file.ts';
import { errorMessage } from '../errors.ts';
import { describePairReason } from '../feedback/pair-reason.ts';
import { destinationOf, questionFor } from '../feedback/destination.ts';
import { PATCH_LANGUAGE, isPatchPath } from '../patch-files.ts';
import { matchLanguage, newPatchSnippet, patchHeader } from '../patch-template.ts';
import { reveal } from '../ui/reveal.ts';
import { fileExists } from '../workspace-fs.ts';

/**
 * New S.I.R Patch (N2): a patch to write by hand for a file of code, at the place the
 * core gives it (`pair`), with the header and one hunk to fill in. One file, one patch: a
 * patch already there is opened, never a second one started.
 *
 * Nothing is written. The patch opens unsaved, already bound to its path, and goes to disk
 * on the first save: a header without a hunk does not parse, and on disk it would be a
 * broken patch in the panel and in Problems until the hunk is filled in.
 */
export async function newPatch(
  { service, project, log }: Pick<SirDeps, 'service' | 'project' | 'log'>,
  target?: vscode.Uri,
): Promise<void> {
  try {
    const code = target ?? activeCode();
    if (code === undefined) return;
    if (isPatchPath(code.fsPath)) {
      void vscode.window.showErrorMessage(`sir: ${basename(code.fsPath)} is a patch; pick the file it is for`);
      return;
    }

    const pair = await project.pair(code);
    if (pair.kind !== 'code' || pair.patchPath === null) {
      void vscode.window.showErrorMessage(`sir: ${describePairReason(pair.reason)}`);
      return;
    }
    const patchUri = vscode.Uri.file(pair.patchPath);
    // the place is the config's and stays cached with it; whether a file is there is the
    // disk's, and a patch generated since the answer was kept would be missed
    if (await fileExists(patchUri)) {
      log.info(`${patchUri.fsPath} already exists, opened`);
      await reveal(await vscode.workspace.openTextDocument(patchUri), vscode.ViewColumn.Beside);
      return;
    }
    // started already and not saved yet: that one, not a second hunk into it
    const draft = patchUri.with({ scheme: 'untitled' });
    const started = vscode.workspace.textDocuments.find((d) => d.uri.toString() === draft.toString());
    if (started !== undefined) {
      await reveal(started, vscode.ViewColumn.Beside);
      return;
    }
    if (!(await mayWrite(patchUri, code))) return;

    const [{ protocol }, config] = await Promise.all([service.ensureCompatible(), project.config(code)]);
    const language = matchLanguage(config, protocol, code.fsPath);
    const header = patchHeader(config, protocol);
    const document = await vscode.workspace.openTextDocument(draft);
    if (document.languageId !== PATCH_LANGUAGE) await vscode.languages.setTextDocumentLanguage(document, PATCH_LANGUAGE);
    const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: false });
    await editor.insertSnippet(new vscode.SnippetString(newPatchSnippet({ header, language })));
    log.info(`started ${patchUri.fsPath}: header ${JSON.stringify(header.trimEnd())}, language ${language ?? 'to be named'}`);
  } catch (e) {
    const message = errorMessage(e);
    log.error(message);
    void vscode.window.showErrorMessage(`sir: ${message}`);
  }
}

/** The active file of code, or undefined after saying why there is none. */
function activeCode(): vscode.Uri | undefined {
  const active = activeFile();
  if (active.kind === 'ok') return active.document.uri;
  void vscode.window.showErrorMessage('sir: open or pick a file of code to start its patch');
  return undefined;
}

/** The trust question of generate, for a place with nothing at it yet. */
async function mayWrite(patchUri: vscode.Uri, code: vscode.Uri): Promise<boolean> {
  const question = questionFor({
    patchPath: patchUri.fsPath,
    codeName: basename(code.fsPath),
    exists: false,
    outTarget: null,
    ownTarget: null,
    notes: null,
    allowed: vscode.workspace.isTrusted || vscode.workspace.getWorkspaceFolder(patchUri) !== undefined,
  });
  if (question === undefined) return true;
  const choice = await vscode.window.showWarningMessage(
    question.title,
    { modal: true, ...(question.detail !== undefined ? { detail: question.detail } : {}) },
    ...question.buttons,
  );
  return destinationOf(choice) === 'write';
}
