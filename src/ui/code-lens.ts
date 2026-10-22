import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { IndexState, PatchIndex, PatchIndexCache } from '../navigation/patch-index.ts';
import { COMMANDS } from '../commands/ids.ts';
import { viewOf } from '../feedback/state.ts';
import { GLYPH, isNothingToCheck, lensTitle, verdictOf } from '../feedback/verdict.ts';
import { summarise } from '../navigation/failure.ts';
import { isPatch } from '../navigation/place.ts';
import type { Project } from '../project/project.ts';
import { workspacePath } from '../workspace-fs.ts';
import { PATCHES_GLOB } from '../patch-files.ts';
import { patchStateOf } from '../feedback/applied.ts';
import { keyLabel } from '../keys.ts';

const PATCHES: vscode.DocumentSelector = { scheme: 'file', pattern: PATCHES_GLOB };

export function createPatchLenses(cache: PatchIndexCache, project: Project): vscode.Disposable {
  const changed = new vscode.EventEmitter<void>();

  const provider: vscode.CodeLensProvider = {
    onDidChangeCodeLenses: changed.event,
    provideCodeLenses: async (document, token) => {
      if (!(await isPatch(document, project)) || token.isCancellationRequested) return [];
      return lensesFor(document.uri, await cache.view(document.uri));
    },
  };

  return vscode.Disposable.from(
    vscode.languages.registerCodeLensProvider(PATCHES, provider),
    cache.onDidChange(() => changed.fire()),
    project.onDidChange(() => changed.fire()),
    changed,
  );
}

function lensesFor(mdUri: vscode.Uri, state: IndexState): vscode.CodeLens[] {
  if (state.kind === 'ready') return hunkLenses(state.index);
  // a parse error already has its squiggle; the other failures have nowhere else to show
  if (state.kind === 'parse-error') return [];
  const headline = `${GLYPH.unresolved} ${viewOf(state, basename(mdUri.fsPath)).message}`;
  return [lens(mdUri, 1, headline, headline)];
}

function hunkLenses(index: PatchIndex): vscode.CodeLens[] {
  // whether the patch is in the code is said once, after the header (ui/highlight.ts);
  // with nothing to check that is all there is to say: the base is the very file, and a
  // dot per hunk — green or, as often, red for an anchor the saved file has lost — would
  // say something about it that cannot be told
  if (isNothingToCheck(index)) return [];
  const target = workspacePath(index.targetUri);
  const out: vscode.CodeLens[] = applyLenses(index, target);
  for (const hunk of index.hunks) {
    const line = hunk.mdSpan?.[0];
    if (line === undefined) continue;
    const title = lensTitle(hunk, verdictOf(hunk, index), target);
    out.push(lens(index.mdUri, line, title, summarise(hunk)));
  }
  return out;
}

/**
 * «▶ Apply to a.cc · 2 hunks | Preview» above the header — only when Apply would just
 * write: the code is its git base and every hunk lands. Anything else Apply would have to
 * ask about, and a lens that opens with a question is not the shortcut it looks like.
 */
function applyLenses(index: PatchIndex, target: string): vscode.CodeLens[] {
  if (index.base.kind !== 'git' || patchStateOf(index.hunks, index) !== 'not-applied') return [];
  if (index.hunks.length === 0 || index.hunks.some((h) => h.status !== 'ok')) return [];
  const top = new vscode.Range(0, 0, 0, 0);
  const count = index.hunks.length === 1 ? '1 hunk' : `${index.hunks.length} hunks`;
  return [
    new vscode.CodeLens(top, {
      title: `▶ Apply to ${target} · ${count}`,
      tooltip: `Lay the patch on its base and put the result in ${target}, unsaved (${keyLabel('apply')})`,
      command: COMMANDS.apply,
      arguments: [index.mdUri],
    }),
    new vscode.CodeLens(top, {
      title: 'Preview',
      tooltip: 'The base beside the base with the patch',
      command: COMMANDS.previewPatch,
      arguments: [index.mdUri],
    }),
  ];
}

function lens(mdUri: vscode.Uri, line: number, title: string, tooltip: string): vscode.CodeLens {
  const at = Math.max(0, line - 1);
  return new vscode.CodeLens(new vscode.Range(at, 0, at, 0), {
    title,
    tooltip,
    command: COMMANDS.toggle,
    arguments: [mdUri, line],
  });
}
