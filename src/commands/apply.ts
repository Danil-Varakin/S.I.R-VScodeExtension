import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { SirDeps } from '../deps.ts';
import type { IndexBuilder } from '../navigation/index-builder.ts';
import type { PatchIndex } from '../navigation/patch-index.ts';
import type { PatchVerdict } from '../ui/patch-tree.ts';
import type { ApplyCounts, ApplyDecision, ApplyOutcome } from '../feedback/apply-decision.ts';
import { PREVIEW_LIMIT, SKIP_REASON, applyDecisionOf, countsOf, describeCounts } from '../feedback/apply-decision.ts';
import { viewOf } from '../feedback/state.ts';
import { summarise } from '../navigation/failure.ts';
import { CODE_COLUMN } from '../navigation/show.ts';
import { minimalEdit } from '../minimal-edit.ts';
import { PATCHES_EXCLUDE, PATCHES_GLOB } from '../patch-files.ts';
import { errorMessage } from '../errors.ts';
import { readText, workspacePath, writeText } from '../workspace-fs.ts';
import { reveal } from '../ui/reveal.ts';
import { offer, reportError } from '../ui/notify.ts';
import { indexFrom } from './preview.ts';
import { ACTIONS, COMMANDS } from './ids.ts';

// Apply: the patch laid on its clean base out of git, and the result put in place of the
// code — never the patch laid on the code itself (feedback/apply-decision.ts says why).
// The text is the core's `apply`; here only the decision whether to write it, and the
// writing. One patch goes into the editor's buffer, unsaved, one Undo away (A1-a); Apply
// All goes through the Refactor Preview up to PREVIEW_LIMIT files and straight to disk
// above it, after a summary (A7-c).

/** Sir: Apply Patch — from the patch or from its code. */
export async function applyPatch(deps: SirDeps, uri?: vscode.Uri): Promise<void> {
  try {
    const index = await indexFrom(deps, uri, 'apply');
    if (index !== undefined) await applyIndex(deps, index);
  } catch (e) {
    await reportError(e, deps.log);
  }
}

async function applyIndex(deps: SirDeps, index: PatchIndex): Promise<void> {
  const name = basename(index.targetUri.fsPath);
  const patchName = basename(index.mdUri.fsPath);
  const document = await vscode.workspace.openTextDocument(index.targetUri);
  const version = document.version;
  const { decision, result } = await decide(deps, index, document.getText());

  switch (decision.kind) {
    case 'saved-base':
      void vscode.window.showErrorMessage(
        `sir: Apply needs a git base. The base of ${name} is the saved file — the file itself — and a patch laid on a file that already holds it is written twice. Name one in generate.base of sir.config.json, or set sir.base.head.`,
      );
      return;
    case 'does-not-land': {
      const message = `sir: ${decision.landed} of ${decision.total} hunks of ${patchName} land on ${baseLabel(index)} — ${summarise(decision.first)}. Nothing was applied.`;
      if (await offer('warning', message, ACTIONS.previewPatch)) {
        await vscode.commands.executeCommand(COMMANDS.previewPatch, index.mdUri);
      }
      return;
    }
    case 'applied':
      void vscode.window.showInformationMessage(`sir: ${patchName} is already in ${name}`);
      return;
    case 'local-edits': {
      const picked = await vscode.window.showWarningMessage(
        `sir: ${name} has edits that are not in ${patchName}`,
        {
          modal: true,
          detail: `Apply lays the patch on its clean base (${baseLabel(index)}) and puts the result in place of the file: those edits would be lost. Generate the patch again to keep them in it.`,
        },
        ACTIONS.generate,
        ACTIONS.overwrite,
        ACTIONS.showEditsNotInPatch,
      );
      if (picked === ACTIONS.generate) await vscode.commands.executeCommand(COMMANDS.generate, index.targetUri);
      if (picked === ACTIONS.showEditsNotInPatch) await vscode.commands.executeCommand(COMMANDS.showEditsNotInPatch, index.targetUri);
      if (picked !== ACTIONS.overwrite) return;
      break;
    }
    case 'write':
      break;
  }

  // the dialog above waits on a human: the code may have moved meanwhile
  if (document.version !== version) {
    void vscode.window.showWarningMessage(`sir: ${name} changed while Apply was running; nothing was written — run it again`);
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  replaceIn(edit, document, result!);
  if (!(await vscode.workspace.applyEdit(edit))) throw new Error(`the editor refused to update ${index.targetUri.fsPath}`);
  await reveal(document, CODE_COLUMN);
  deps.log.info(`applied ${index.mdUri.fsPath} to ${index.targetUri.fsPath} (${baseLabel(index)})`);
  void offer('info', `sir: applied ${patchName} to ${name} — ${hunks(index.hunks.length)}, not saved yet`, ACTIONS.save).then(
    (save) => (save ? document.save() : undefined),
  );
}

// ---- Apply All ----

export interface ApplyAllOptions {
  /** the patches to lay; every patch of the workspace when left out */
  readonly patches?: readonly vscode.Uri[];
  /** false for the end-to-end tests: no Refactor Preview, no summary to confirm */
  readonly confirm?: boolean;
  readonly previewLimit?: number;
}

interface Examined {
  readonly patch: vscode.Uri;
  readonly outcome: ApplyOutcome;
  /** why it was left alone, for the list of skipped ones */
  readonly why?: string;
  readonly target?: vscode.Uri;
  /** the code it was decided on, and what goes in its place */
  readonly code?: string;
  readonly result?: string;
}

type Publish = (patch: vscode.Uri, verdict: PatchVerdict) => void;

/** Sir: Apply All Patches. Undefined when stopped before anything was written. */
export async function applyAll(
  deps: SirDeps,
  builder: IndexBuilder,
  publish: Publish,
  options: ApplyAllOptions = {},
): Promise<ApplyCounts | undefined> {
  try {
    const patches =
      options.patches ??
      (await vscode.workspace.findFiles(PATCHES_GLOB, PATCHES_EXCLUDE)).sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    const examined: Examined[] = [];
    const finished = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `S.I.R: laying ${patches.length} patches on their bases`,
        cancellable: true,
      },
      async (progress, token) => {
        for (const [i, patch] of patches.entries()) {
          if (token.isCancellationRequested) return false;
          progress.report({ message: `${i + 1}/${patches.length}`, increment: 100 / Math.max(1, patches.length) });
          examined.push(await examine(deps, builder, patch));
        }
        return true;
      },
    );
    if (!finished) {
      void vscode.window.showInformationMessage('sir: Apply All stopped; nothing was written');
      return undefined;
    }

    const counts = countsOf(examined.map((e) => e.outcome));
    const writes = examined.filter((e) => e.outcome === 'write');
    const skipped = examined.filter((e) => e.why !== undefined);
    for (const s of skipped) deps.log.info(`apply all: skipped ${s.patch.fsPath}: ${s.why}`);

    if (writes.length > 0) {
      const confirm = options.confirm ?? true;
      if (writes.length <= (options.previewLimit ?? PREVIEW_LIMIT)) {
        await throughEditor(writes, confirm);
      } else {
        if (confirm && !(await confirmed(writes.length, counts))) return undefined;
        await toDisk(writes, deps);
      }
    }

    // what is in place now, and not what was meant: the Refactor Preview lets a file be unticked
    let written = 0;
    for (const w of writes) {
      if ((await codeText(w.target!).catch(() => undefined)) !== w.result) continue;
      written++;
      publish(w.patch, { problems: [], state: 'applied', broken: false });
    }
    deps.log.info(`apply all: ${written} of ${patches.length} patches written — ${describeCounts(counts)}`);
    const message = `sir: applied ${written} of ${patches.length} patches — ${describeCounts(counts)}`;
    if (skipped.length === 0) void vscode.window.showInformationMessage(message);
    else void offer('info', message, ACTIONS.showSkipped).then((show) => (show ? showSkipped(skipped) : undefined));
    return counts;
  } catch (e) {
    await reportError(e, deps.log);
    return undefined;
  }
}

async function examine(deps: SirDeps, builder: IndexBuilder, patch: vscode.Uri): Promise<Examined> {
  try {
    const state = await builder.build(patch, undefined);
    if (state.kind !== 'ready') {
      return { patch, outcome: 'failed', why: viewOf(state, basename(patch.fsPath)).message };
    }
    const { index } = state;
    const code = await codeText(index.targetUri);
    const { decision, result } = await decide(deps, index, code);
    if (decision.kind === 'write') return { patch, outcome: 'write', target: index.targetUri, code, result: result! };
    if (decision.kind === 'applied') return { patch, outcome: 'applied' };
    const why = decision.kind === 'does-not-land' ? `${SKIP_REASON[decision.kind]}: ${summarise(decision.first)}` : SKIP_REASON[decision.kind];
    return { patch, outcome: decision.kind, why };
  } catch (e) {
    return { patch, outcome: 'failed', why: errorMessage(e) };
  }
}

/** One edit for all of them: the Refactor Preview lists each file, and one Undo takes all back. */
async function throughEditor(writes: readonly Examined[], confirm: boolean): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  for (const w of writes) {
    const document = await vscode.workspace.openTextDocument(w.target!);
    if (document.getText() !== w.code) continue; // moved since it was examined
    replaceIn(edit, document, w.result!, {
      needsConfirmation: confirm,
      label: `Apply ${basename(w.patch.fsPath)}`,
      description: workspacePath(w.patch),
    });
  }
  // a refactoring, as a rename is: whether the files are saved is files.refactoring.autoSave
  await vscode.workspace.applyEdit(edit, { isRefactoring: true });
}

/**
 * Too many for the Refactor Preview: on disk, the editor reloading what it holds. Only a
 * buffer with unsaved edits is edited in place — written behind its back, it would clash
 * with the disk on save. Not every document the editor knows is open: it keeps closed
 * ones for minutes, and an edit there would leave an unsaved buffer nobody sees.
 */
async function toDisk(writes: readonly Examined[], deps: SirDeps): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  for (const w of writes) {
    const key = w.target!.toString();
    const dirty = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key && d.isDirty);
    if (dirty !== undefined) {
      if (dirty.getText() === w.code) replaceIn(edit, dirty, w.result!);
      continue;
    }
    if ((await readText(w.target!)) !== w.code) continue; // moved since it was examined
    await writeText(w.target!, w.result!);
  }
  if (edit.size > 0 && !(await vscode.workspace.applyEdit(edit))) deps.log.warn('apply all: the editor refused to update the open files');
}

async function confirmed(count: number, counts: ApplyCounts): Promise<boolean> {
  const action = `Apply ${count}`;
  const picked = await vscode.window.showWarningMessage(
    `sir: apply ${count} patches?`,
    {
      modal: true,
      detail: `${describeCounts(counts)}.\n\nThat is more than the Refactor Preview shows well (${PREVIEW_LIMIT}): the files are written on disk straight away, and git is the way back. Only files that are still their base are written.`,
    },
    action,
  );
  return picked === action;
}

async function showSkipped(skipped: readonly Examined[]): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    skipped.map((s) => ({ label: workspacePath(s.patch), detail: s.why ?? '', patch: s.patch })),
    { title: 'S.I.R: patches Apply All left alone', matchOnDetail: true },
  );
  if (picked !== undefined) await vscode.window.showTextDocument(picked.patch, { preview: false });
}

// ---- shared ----

/** The decision, with the core's result when it needed one. */
async function decide(deps: SirDeps, index: PatchIndex, code: string): Promise<{ decision: ApplyDecision; result: string | undefined }> {
  const input = { base: index.base.kind, hunks: index.hunks, baseText: index.baselineText, code };
  const early = applyDecisionOf({ ...input, result: undefined });
  if (early !== undefined) return { decision: early, result: undefined };
  const result = await deps.results.textOf(index);
  return { decision: applyDecisionOf({ ...input, result })!, result };
}

/**
 * The code as it is now: a buffer with unsaved edits, or else the disk. Not `readLiveText`:
 * the editor keeps closed documents for minutes and reloads them from disk only some time
 * after a write, so a run right after another would decide on the text from before it.
 */
async function codeText(uri: vscode.Uri): Promise<string> {
  const key = uri.toString();
  return vscode.workspace.textDocuments.find((d) => d.uri.toString() === key && d.isDirty)?.getText() ?? readText(uri);
}

function replaceIn(edit: vscode.WorkspaceEdit, document: vscode.TextDocument, text: string, metadata?: vscode.WorkspaceEditEntryMetadata): void {
  const change = minimalEdit(document.getText(), text);
  if (change === undefined) return;
  const range = new vscode.Range(document.positionAt(change.start), document.positionAt(change.end));
  if (metadata === undefined) edit.replace(document.uri, range, change.text);
  else edit.replace(document.uri, range, change.text, metadata);
}

function baseLabel(index: PatchIndex): string {
  return index.base.kind === 'git' ? `${index.base.spec} @ ${index.base.sha.slice(0, 7)}` : 'the saved file';
}

function hunks(n: number): string {
  return n === 1 ? '1 hunk' : `${n} hunks`;
}
