import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { HunkLink, Span } from '../service/protocol.ts';
import type { PatchResults } from './results.ts';
import type { BaselineDocuments } from '../baseline/documents.ts';
import type { PatchIndex } from './patch-index.ts';
import { reveal } from '../ui/reveal.ts';
import { focusMark } from './focus.ts';
import type { FocusSide, HunkFocus } from '../ui/hunk-focus.ts';
import { LineMap } from './text.ts';

/**
 * Where source code lands when it is not open anywhere yet. Patches open Beside, so
 * pinning code to the first column settles the pair into two stable columns instead
 * of letting each jump push a new one onto the end.
 */
export const CODE_COLUMN = vscode.ViewColumn.One;

export async function showMdLine(mdUri: vscode.Uri, line: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(mdUri);
  const zeroBased = Math.min(Math.max(0, line - 1), Math.max(0, document.lineCount - 1));
  const at = new vscode.Position(zeroBased, 0);
  // a patch belongs next to the code it patches, but only when it is not open yet
  await reveal(document, vscode.ViewColumn.Beside, new vscode.Range(at, at));
}

export async function showRange(
  document: vscode.TextDocument,
  span: Span,
  whenClosed: vscode.ViewColumn,
): Promise<void> {
  const range = new vscode.Range(document.positionAt(span.start), document.positionAt(span.end));
  await reveal(document, whenClosed, range);
}

/**
 * A place in the baseline. The position is computed from the baseline TEXT the offsets
 * were measured in, and the document is handed that same text first — whatever the
 * document held before, or whether it was held at all.
 */
export async function showBaselineOffset(
  baselines: BaselineDocuments,
  index: PatchIndex,
  offset: number,
): Promise<void> {
  baselines.hold(index.baselineUri, index.baselineText);
  const document = await vscode.workspace.openTextDocument(index.baselineUri);
  const at = positionIn(new LineMap(index.baselineText), offset);
  await reveal(document, vscode.ViewColumn.Beside, new vscode.Range(at, at));
}

/**
 * The diff «base ↔ base + patch» (B1): the left half is the base the index was resolved
 * against, the right half the core's `apply` of the patch to it — what `sir-apply` would
 * write. With a hunk, it is marked on both sides (B10): its `base` on the left, its `final`
 * on the right, each in its own editor — `vscode.diff` takes one selection, for the right
 * side only. A hunk that depends on an earlier one has no place in the base, only on the
 * right. Without a hunk, a mark left by an earlier diff goes.
 */
export async function openPatchDiff(
  baselines: BaselineDocuments,
  results: PatchResults,
  focus: HunkFocus,
  index: PatchIndex,
  hunk?: HunkLink,
): Promise<void> {
  baselines.hold(index.baselineUri, index.baselineText);
  const result = await results.prepare(index);
  const resultText = await results.textOf(index);
  const name = basename(index.targetUri.fsPath);
  const base = index.base.kind === 'git' ? index.base.spec : 'saved';

  await vscode.commands.executeCommand(
    'vscode.diff',
    index.baselineUri,
    result,
    `${name} (${base}) ↔ ${name} (+ ${basename(index.mdUri.fsPath)})`,
    { preview: false },
  );
  if (hunk === undefined) {
    focus.clear();
    return;
  }

  const which = `hunk ${hunk.index + 1} of ${index.hunks.length}`;
  const sides: FocusSide[] = [];
  if (hunk.base !== undefined && !hunk.dependsOnEarlier) {
    const mark = focusMark(index.baselineText, hunk.base);
    sides.push({ uri: index.baselineUri, mark, label: `◀ ${which} ${mark.kind === 'block' ? 'replaces this' : 'inserts here'}` });
  }
  if (hunk.final !== undefined) {
    const mark = focusMark(resultText, hunk.final);
    sides.push({ uri: result, mark, label: `◀ ${which}${mark.kind === 'block' ? '' : ' removed text here'}` });
  }
  focus.show(index.baselineUri, result, sides);
  for (const side of sides) placeCursor(side);
}

/** One side of an open diff: its editor is found by its document, as the diff opened it. */
function placeCursor({ uri, mark }: FocusSide): void {
  const key = uri.toString();
  const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === key);
  if (editor === undefined) return;
  const at = new vscode.Position(mark.cursor.line, mark.cursor.character);
  editor.selection = new vscode.Selection(at, at);
  const shown = mark.kind === 'block' ? new vscode.Range(mark.first, 0, mark.last, 0) : new vscode.Range(at, at);
  editor.revealRange(shown, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function positionIn(lines: LineMap, offset: number): vscode.Position {
  const { line, character } = lines.positionOf(offset);
  return new vscode.Position(line, character);
}
