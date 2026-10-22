import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { IndexState, PatchIndexCache } from '../navigation/patch-index.ts';
import type { Problem } from '../feedback/verdict.ts';
import { problemsOf } from '../feedback/verdict.ts';
import { viewOf } from '../feedback/state.ts';
import { PATCHES_GLOB } from '../patch-files.ts';

/** The `source` of every squiggle this extension publishes, and what the light bulb
 *  filters the editor's diagnostics by to find its own. */
export const DIAGNOSTIC_SOURCE = 'sir';

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
} as const;

export interface PatchDiagnostics extends vscode.Disposable {
  /** Check All's verdict on one patch; a patch on screen is the editor's to say. */
  checked(mdUri: vscode.Uri, problems: readonly Problem[]): void;
}

/**
 * Problems, and through them the red and yellow of the Explorer. What was said of a patch
 * stays said after its tab closes or the cache lets it go — a patch that does not apply
 * still does not apply — until a newer answer replaces it: the editor's, once it is open
 * again, or Check All's. Only the patch going away takes its problems with it.
 */
export function createDiagnostics(cache: PatchIndexCache, isShown: (uri: vscode.Uri) => boolean): PatchDiagnostics {
  const collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  const set = (mdUri: vscode.Uri, problems: readonly Problem[]): void => collection.set(mdUri, problems.map(toDiagnostic));

  const subscription = cache.onDidChange(({ mdUri, state }) => {
    if (state !== undefined) set(mdUri, problemsIn(state, basename(mdUri.fsPath)));
  });
  // a rename is a delete of the old path to the watcher: its problems go with the name
  const watcher = vscode.workspace.createFileSystemWatcher(PATCHES_GLOB, true, true, false);
  const deleted = watcher.onDidDelete((uri) => collection.delete(uri));

  return {
    checked: (mdUri, problems) => {
      if (!isShown(mdUri)) set(mdUri, problems);
    },
    dispose: () => vscode.Disposable.from(subscription, deleted, watcher, collection).dispose(),
  };
}

/** Exported for the tests: what Problems lists for one patch. */
export function problemsIn(state: IndexState, patchName: string): readonly Problem[] {
  switch (state.kind) {
    case 'ready':
      return [
        ...problemsOf(state.index.hunks, state.index),
        ...state.index.warnings.map((w) => ({ line: w.mdLine, message: w.message, severity: 'warning' as const })),
      ];
    case 'parse-error':
      return [{ line: state.mdLine ?? 1, message: state.message, severity: 'error' }];
    default: {
      // the patch as a whole is broken: said on its first line, the header, in the lens's words
      const view = viewOf(state, patchName);
      const severity = view.icon === 'error' ? ('error' as const) : ('warning' as const);
      return [{ line: 1, message: view.message, severity, code: state.kind }];
    }
  }
}

function toDiagnostic(problem: Problem): vscode.Diagnostic {
  const line = Math.max(0, problem.line - 1);
  const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
  const diagnostic = new vscode.Diagnostic(range, problem.message, SEVERITY[problem.severity]);
  diagnostic.source = DIAGNOSTIC_SOURCE;
  if (problem.code !== undefined) diagnostic.code = problem.code;
  return diagnostic;
}
