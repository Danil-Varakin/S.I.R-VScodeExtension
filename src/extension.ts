import * as vscode from 'vscode';
import { SirService, serviceEntry } from './service/client.ts';
import { COMMANDS } from './commands/ids.ts';
import { showBase } from './commands/base.ts';
import { initConfig } from './commands/config.ts';
import { continueGenerate, generateAgainstFile, generatePatch } from './commands/generate.ts';
import { goToBaseline, patchPointOf, toggle } from './commands/navigate.ts';
import { newPatch } from './commands/new-patch.ts';
import { PatchDrafts } from './ui/drafts.ts';
import type { SirDeps } from './deps.ts';
import { BaselineDocuments } from './baseline/documents.ts';
import { PatchResults } from './navigation/results.ts';
import { HunkFocus } from './ui/hunk-focus.ts';
import { previewPatch, showEditsNotInPatch } from './commands/preview.ts';
import { IndexBuilder } from './navigation/index-builder.ts';
import { PatchIndexCache } from './navigation/patch-index.ts';
import { createPatchLenses } from './ui/code-lens.ts';
import { createPatchSymbols } from './ui/symbols.ts';
import { PatchPanel } from './ui/patch-tree.ts';
import { createRepairActions } from './ui/code-actions.ts';
import { repair } from './commands/repair.ts';
import { applyAll, applyPatch } from './commands/apply.ts';
import type { ApplyAllOptions } from './commands/apply.ts';
import type { ApplyCounts } from './feedback/apply-decision.ts';
import type { PatchVerdict, Revision } from './ui/patch-tree.ts';
import { createDiagnostics } from './ui/diagnostics.ts';
import { createPatchBadges } from './ui/patch-badges.ts';
import { createHighlights } from './ui/highlight.ts';
import { createLog } from './ui/log.ts';
import { openColumnOf } from './ui/reveal.ts';
import { createStatusBar } from './ui/status-bar.ts';
import { Project } from './project/project.ts';
import { Gate } from './project/gate.ts';
import { extensionsOf } from './project/languages.ts';
import { errorMessage } from './errors.ts';

/** What the end-to-end tests read; nothing else uses the extension's exports. */
export interface SirTestApi {
  /** cores started so far */
  spawns(): number;
  gateOpen(): boolean;
  /** the status bar item's text while shown */
  status(): string | undefined;
  /** the table of a patch, built fresh: its state, and each hunk's lines in the patch */
  table(uri: vscode.Uri): Promise<{ readonly kind: string; readonly spans: readonly (readonly number[])[] }>;
  store(uri: vscode.Uri): string;
  /** whether the patch is in its code, as its badge and its header say it */
  patchState(uri: vscode.Uri): string | undefined;
  /** runs the Sir Patches check without asking, and answers its report */
  checkPatches(revision: Revision): Promise<string>;
  /** Apply All over these patches, with no Refactor Preview and no summary to confirm */
  applyPatches(patches: readonly vscode.Uri[], previewLimit?: number): Promise<ApplyCounts | undefined>;
  /** the hunk Go to What the Hunk Replaces marked in the open diff (B10) */
  focused(): ReturnType<HunkFocus['marked']>;
}

export function activate(context: vscode.ExtensionContext): SirTestApi {
  const log = createLog();
  const service = new SirService(
    serviceEntry(context.extensionPath),
    // the grammars ship inside the core's package: nothing to point it at
    undefined,
    log,
  );
  const project = new Project(service, log);
  const baselines = new BaselineDocuments();
  const isShown = (uri: vscode.Uri): boolean => openColumnOf(uri) !== undefined;
  const builder = new IndexBuilder({ service, project, baselines, log });
  const cache = new PatchIndexCache(builder, isShown);
  const results = new PatchResults(service, cache);
  const drafts = new PatchDrafts();
  const focus = new HunkFocus();
  const deps: SirDeps = { service, project, cache, baselines, results, focus, log, drafts };
  const gate = new Gate();
  const statusBar = createStatusBar(project, cache, results, gate);
  const diagnostics = createDiagnostics(cache, isShown);
  const badges = createPatchBadges(cache, isShown);
  const publish = (uri: vscode.Uri, { problems, state, broken }: PatchVerdict): void => {
    diagnostics.checked(uri, problems);
    badges.checked(uri, { state, broken });
  };
  const panel = new PatchPanel(service, log, publish);
  const runApplyAll = (options?: ApplyAllOptions): Promise<ApplyCounts | undefined> => applyAll(deps, builder, publish, options);

  // the core is asked what it can patch only once there is sir here (C1, D3)
  const publishLanguages = (): void => {
    service.version().then(
      ({ languages }) => vscode.commands.executeCommand('setContext', 'sir.extensions', extensionsOf(languages)),
      (e: unknown) => log.error(`languages: ${errorMessage(e)}`),
    );
  };
  if (gate.isOpen) publishLanguages();
  gate.onDidOpen(publishLanguages);

  /** Every command opens the gate first: what it asks of the core, the user asked for. */
  const command = (id: string, run: (...args: unknown[]) => unknown): vscode.Disposable =>
    vscode.commands.registerCommand(id, (...args: unknown[]) => {
      gate.commandRan();
      return run(...args);
    });

  context.subscriptions.push(
    service,
    log,
    project,
    drafts,
    baselines,
    results,
    focus,
    cache,
    gate,
    statusBar,
    panel,
    diagnostics,
    badges,
    createHighlights(cache),
    createPatchLenses(cache, project),
    createPatchSymbols(cache),
    createRepairActions(cache),
    // a config, HEAD or a ref moved: every table was resolved against what they said
    project.onDidChange(() => cache.invalidateAll()),
  );

  context.subscriptions.push(
    // the patch written is picked up by the cache as any edit is: through the editor or the disk
    command(COMMANDS.generate, (target?: unknown) => generatePatch(deps, asUri(target))),
    command(COMMANDS.generateAgainstFile, (target?: unknown) => generateAgainstFile(deps, asUri(target))),
    command(COMMANDS.showBase, () => showBase(deps)),
    command(COMMANDS.toggle, (uri?: unknown, line?: unknown) => toggle(deps, patchPointOf(uri, line))),
    command(COMMANDS.goToBaseline, () => goToBaseline(deps)),
    command(COMMANDS.repair, (uri?: unknown, hunk?: unknown, what?: unknown) => repair(deps, uri, hunk, what)),
    command(COMMANDS.apply, (target?: unknown) => applyPatch(deps, asUri(target))),
    command(COMMANDS.applyAll, () => runApplyAll()),
    command(COMMANDS.checkAll, () => panel.checkAll()),
    command(COMMANDS.copyReport, () => panel.copyReport()),
    command(COMMANDS.openFailed, () => panel.openFailed()),
    command(COMMANDS.previewPatch, (patch?: unknown) => previewPatch(deps, asUri(patch))),
    command(COMMANDS.showEditsNotInPatch, (code?: unknown) => showEditsNotInPatch(deps, asUri(code))),
    command(COMMANDS.newPatch, (code?: unknown) => newPatch(deps, asUri(code))),
    command(COMMANDS.continueGenerate, (draft?: unknown) => continueGenerate(deps, asUri(draft))),
    vscode.commands.registerCommand(COMMANDS.showLog, () => log.show()),
    command(COMMANDS.initConfig, async () => {
      await initConfig(deps);
      // a new config changes every answer the core gave about this project
      project.invalidate();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      // the editor settings go to the core as overrides, so they are part of every answer
      if (e.affectsConfiguration('sir')) project.invalidate();
    }),
    // trust lets the workspace's own sir.out count
    vscode.workspace.onDidGrantWorkspaceTrust(() => project.invalidate()),
  );

  log.info('extension activated');
  return {
    spawns: () => service.spawns,
    gateOpen: () => gate.isOpen,
    status: statusBar.shown,
    store: (uri) => cache.describe(uri),
    patchState: (uri) => badges.stateOf(uri),
    applyPatches: (patches, previewLimit) =>
      runApplyAll({ patches, confirm: false, ...(previewLimit === undefined ? {} : { previewLimit }) }),
    checkPatches: async (revision) => {
      await panel.run(revision);
      return panel.report();
    },
    focused: () => focus.marked(),
    table: async (uri) => {
      const state = await cache.get(uri);
      const spans = state.kind === 'ready' ? state.index.hunks.map((h) => [...(h.noteSpan ?? []), ...(h.mdSpan ?? [])]) : [];
      return { kind: state.kind, spans };
    },
  };
}

export function deactivate(): void {}

/** A command's file: a URI, or an item of the Sir Patches panel, which carries one. */
function asUri(value: unknown): vscode.Uri | undefined {
  if (value instanceof vscode.Uri) return value;
  const uri: unknown = value !== null && typeof value === 'object' && 'uri' in value ? value.uri : undefined;
  return uri instanceof vscode.Uri ? uri : undefined;
}
