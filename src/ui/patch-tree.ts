import * as vscode from 'vscode';
import type { ResolveParams } from '../service/protocol.ts';
import type { SirService } from '../service/client.ts';
import type { Log } from './log.ts';
import { EDITOR_EOL } from '../settings.ts';
import { errorMessage } from '../errors.ts';
import { formatMs } from '../duration.ts';
import { readLiveText, workspacePath } from '../workspace-fs.ts';
import type { PatchCheck } from '../feedback/patch-report.ts';
import { ICON, checkOf, describeCheck, describeTotals, failedCheck, reportOf, sorted, totalsOf } from '../feedback/patch-report.ts';
import { PATCHES_EXCLUDE, PATCHES_GLOB } from '../patch-files.ts';
import type { Problem } from '../feedback/verdict.ts';
import { unresolvedProblems } from '../feedback/verdict.ts';
import type { PatchState } from '../feedback/applied.ts';
import { patchStateOf } from '../feedback/applied.ts';
import type { ResolveResultMessage } from '../service/protocol.ts';

/** What a run against the project base found of one patch, for Problems and the badges. */
export interface PatchVerdict {
  readonly problems: readonly Problem[];
  readonly state: PatchState | undefined;
  readonly broken: boolean;
}

// The Sir Patches panel (R2): every `.sirp` of the workspace, checked against one revision
// of its base. The command checks against the project's own; a branch, tag or commit — the
// way one checks a set of patches against a new upstream before moving to it — is reached
// only through `run` for now (docs/14-backlog.md, BL1). Every answer is the core's
// `resolve` of the patch by its own path; nothing is written.

export const VIEW_ID = 'sir.patches';

/** Which old version the run checks against. */
export type Revision =
  | { readonly kind: 'project' }
  | { readonly kind: 'branch'; readonly name: string }
  | { readonly kind: 'commit'; readonly name: string };

export function describeRevision(revision: Revision): string {
  return revision.kind === 'project' ? 'the project base' : revision.name;
}

function baseParams(revision: Revision): Partial<ResolveParams> {
  switch (revision.kind) {
    case 'project':
      return {}; // the patch's own config names it (generate.base)
    case 'branch':
      return { baseGit: { branch: revision.name, eol: EDITOR_EOL } };
    case 'commit':
      return { baseGit: { commit: revision.name, eol: EDITOR_EOL } };
  }
}

interface Item {
  readonly check: PatchCheck;
  readonly uri: vscode.Uri;
}

export class PatchPanel implements vscode.TreeDataProvider<Item>, vscode.Disposable {
  private items: Item[] = [];
  private revision: Revision | undefined;
  private readonly changed = new vscode.EventEmitter<Item | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly view: vscode.TreeView<Item>;

  constructor(
    private readonly service: SirService,
    private readonly log: Log,
    /** where a run against the project base says what it found, as the editor does */
    private readonly publish: (uri: vscode.Uri, verdict: PatchVerdict) => void,
  ) {
    this.view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: this, showCollapseAll: false });
  }

  getTreeItem({ check, uri }: Item): vscode.TreeItem {
    const item = new vscode.TreeItem(`${ICON[check.status]} ${check.patch}`, vscode.TreeItemCollapsibleState.None);
    item.description = describeCheck(check);
    item.tooltip = `${check.patch}\n${describeCheck(check)}`;
    item.resourceUri = uri;
    item.contextValue = check.status;
    item.command = { command: 'vscode.open', title: 'Open Patch', arguments: [uri] };
    return item;
  }

  getChildren(element?: Item): Item[] {
    return element === undefined ? this.items : [];
  }

  /** Sir: Check All Patches — every patch against the project base, with progress. */
  async checkAll(): Promise<void> {
    await this.run({ kind: 'project' });
  }

  /** A run against any revision: what the end-to-end tests drive. */
  async run(revision: Revision): Promise<readonly PatchCheck[]> {
    this.revision = revision;
    const patches = (await vscode.workspace.findFiles(PATCHES_GLOB, PATCHES_EXCLUDE)).sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    const label = describeRevision(revision);
    const started = Date.now();
    const checked: Item[] = [];

    // Notification, not the view: only that location shows a cancel button and discrete
    // progress (API reference, `withProgress`). Under `{ viewId }` the button was never
    // drawn, so `cancellable` was a promise the editor could not keep — and a run of
    // hundreds of `resolve` calls, each holding the one core process, could not be
    // stopped at all.
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `S.I.R: checking ${patches.length} patches against ${label}`,
        cancellable: true,
      },
      async (progress, token) => {
        for (const [i, uri] of patches.entries()) {
          if (token.isCancellationRequested) break;
          progress.report({ message: `${i + 1}/${patches.length}`, increment: 100 / Math.max(1, patches.length) });
          checked.push({ uri, check: await this.checkOne(uri, revision) });
        }
      },
    );

    const checks = checked.map((item) => item.check);
    const order = new Map(sorted(checks).map((check, i) => [check, i]));
    this.items = checked.sort((a, b) => order.get(a.check)! - order.get(b.check)!);
    const totals = totalsOf(checks);
    this.view.description = `${describeTotals(totals)} · ${label}`;
    this.view.badge = totals.failing > 0 ? { value: totals.failing, tooltip: `${totals.failing} patches do not apply` } : undefined;
    // '' and not undefined: `message?: string` does not take undefined under
    // exactOptionalPropertyTypes, and the editor removes the message for either
    this.view.message = checked.length < patches.length ? `Stopped after ${checked.length} of ${patches.length} patches.` : '';
    this.changed.fire(undefined);
    this.log.info(`checked ${checked.length} patches against ${label} in ${formatMs(Date.now() - started)}: ${describeTotals(totals)}`);
    return checks;
  }

  /** Sir: Copy Patch Report — Markdown, for an issue or a chat. */
  async copyReport(): Promise<void> {
    if (this.revision === undefined) {
      void vscode.window.showInformationMessage('sir: check the patches first (S.I.R: Check All Patches)');
      return;
    }
    await vscode.env.clipboard.writeText(this.report());
    void vscode.window.showInformationMessage('sir: the patch report is on the clipboard');
  }

  report(): string {
    return reportOf(describeRevision(this.revision ?? { kind: 'project' }), this.items.map((i) => i.check));
  }

  /** Sir: Open Failed Patches — every patch that does not apply, each in its tab. */
  async openFailed(): Promise<void> {
    const failing = this.items.filter((i) => i.check.status === 'broken' || i.check.status === 'failed');
    if (failing.length === 0) {
      void vscode.window.showInformationMessage('sir: no patch failed the last check');
      return;
    }
    for (const { uri } of failing) {
      await vscode.window.showTextDocument(uri, { preview: false, preserveFocus: true });
    }
  }

  dispose(): void {
    this.view.dispose();
    this.changed.dispose();
  }

  private async checkOne(uri: vscode.Uri, revision: Revision): Promise<PatchCheck> {
    const name = workspacePath(uri);
    try {
      // the editor's text when the patch is open with edits: what the user sees is checked
      const patch = await readLiveText(uri);
      const answer = await this.service.request('resolve', { path: uri.fsPath, patch, ...baseParams(revision) });
      // only a run against the project base: it is the base the editor checks against, so
      // its answer and the editor's are the same answer. One against a branch would mark a
      // patch that applies where it lives as broken, and nothing would take that back.
      if (revision.kind === 'project') {
        this.publish(uri, {
          problems: unresolvedProblems(answer.hunks),
          state: await stateOf(answer),
          broken: answer.hunks.some((h) => h.status !== 'ok'),
        });
      }
      return checkOf(name, answer.hunks);
    } catch (e) {
      if (revision.kind === 'project') {
        this.publish(uri, { problems: [{ line: 1, message: errorMessage(e), severity: 'error' }], state: undefined, broken: true });
      }
      return failedCheck(name, errorMessage(e));
    }
  }
}

/**
 * Whether the patch is in its code, from `resolve` alone: the code as the editor holds it
 * against the base the core read. With no `baseText` the base was the saved file, which
 * the code on disk is.
 */
async function stateOf(answer: ResolveResultMessage): Promise<PatchState | undefined> {
  if (answer.code === null) return undefined;
  const targetText = await readLiveText(vscode.Uri.file(answer.code)).catch(() => undefined);
  if (targetText === undefined) return undefined;
  const git = answer.baseText !== undefined;
  return patchStateOf(answer.hunks, {
    targetText,
    baselineText: answer.baseText ?? targetText,
    base: { kind: git ? 'git' : 'saved' },
  });
}
