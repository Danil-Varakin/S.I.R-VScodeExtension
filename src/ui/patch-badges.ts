import * as vscode from 'vscode';
import type { PatchIndexCache } from '../navigation/patch-index.ts';
import type { PatchState } from '../feedback/applied.ts';
import { PATCH_STATE_VIEW, patchStateOf } from '../feedback/applied.ts';
import { PATCHES_GLOB } from '../patch-files.ts';

// Whether each patch is in its code, on the patch's name: in the Explorer and on its tab,
// before it is opened. A patch with a problem gets nothing here — Problems already paints
// its name red with a count, and a second badge beside that would only argue with it.

/** What is known of one patch: the last word about it, from the editor or Check All. */
export interface PatchFinding {
  readonly state: PatchState | undefined;
  /** a hunk lands nowhere, or the patch could not be read at all */
  readonly broken: boolean;
}

const COLOR: Readonly<Record<PatchState, string | undefined>> = {
  applied: 'sir.appliedPatchForeground',
  'not-applied': 'sir.notAppliedPatchForeground',
  changed: 'sir.changedPatchForeground',
  'nothing-to-check': undefined,
};

export interface PatchBadges extends vscode.Disposable {
  /** Check All's word on one patch; a patch on screen is the editor's to say. */
  checked(mdUri: vscode.Uri, finding: PatchFinding): void;
  /** For the end-to-end tests. */
  stateOf(mdUri: vscode.Uri): PatchState | undefined;
}

/**
 * Like Problems, what was said stays said after the tab closes, until a newer word
 * replaces it — the editor's once the patch is open again, or Check All's — or the patch
 * goes away.
 */
export function createPatchBadges(cache: PatchIndexCache, isShown: (uri: vscode.Uri) => boolean): PatchBadges {
  const known = new Map<string, PatchFinding>();
  const changed = new vscode.EventEmitter<vscode.Uri>();

  const set = (mdUri: vscode.Uri, finding: PatchFinding | undefined): void => {
    const key = mdUri.toString();
    const before = known.get(key);
    if (finding === undefined) known.delete(key);
    else known.set(key, finding);
    if (before?.state !== finding?.state || before?.broken !== finding?.broken) changed.fire(mdUri);
  };

  const provider: vscode.FileDecorationProvider = {
    onDidChangeFileDecorations: changed.event,
    provideFileDecoration: (uri) => {
      const finding = known.get(uri.toString());
      if (finding === undefined || finding.broken || finding.state === undefined) return undefined;
      const { badge, hover } = PATCH_STATE_VIEW[finding.state];
      const color = COLOR[finding.state];
      if (badge === undefined) return undefined;
      return new vscode.FileDecoration(badge, `sir: ${hover}`, color === undefined ? undefined : new vscode.ThemeColor(color));
    },
  };

  const subscription = cache.onDidChange(({ mdUri, state }) => {
    if (state === undefined) return;
    if (state.kind !== 'ready') set(mdUri, { state: undefined, broken: true });
    else {
      const { hunks } = state.index;
      set(mdUri, { state: patchStateOf(hunks, state.index), broken: hunks.some((h) => h.status !== 'ok') });
    }
  });
  const watcher = vscode.workspace.createFileSystemWatcher(PATCHES_GLOB, true, true, false);
  const deleted = watcher.onDidDelete((uri) => set(uri, undefined));

  const registration = vscode.window.registerFileDecorationProvider(provider);
  return {
    checked: (mdUri, finding) => {
      if (!isShown(mdUri)) set(mdUri, finding);
    },
    stateOf: (mdUri) => known.get(mdUri.toString())?.state,
    dispose: () => vscode.Disposable.from(registration, subscription, deleted, watcher, changed).dispose(),
  };
}
