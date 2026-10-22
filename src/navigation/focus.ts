import type { Span } from '../service/protocol.ts';
import { trimmed } from './hunks.ts';
import { LineMap } from './text.ts';
import type { TextPosition } from './text.ts';

/**
 * How one hunk is marked on one side of «base ↔ base + patch» (B10). Text the hunk covers
 * there is a block of whole lines. A side where it covers nothing — the base of a pure
 * insertion, the result of a pure deletion — is a line BETWEEN two lines, or a point in
 * one: never the neighbouring line painted as if it were what the hunk replaces.
 *
 * Lines and columns are 0-based. `cursor` is where the editor's cursor goes, so Go to the
 * Other Side from the diff starts from the hunk.
 */
export type FocusMark =
  | { readonly kind: 'block'; readonly first: number; readonly last: number; readonly cursor: TextPosition }
  | { readonly kind: 'gap'; readonly line: number; readonly edge: 'above' | 'below'; readonly cursor: TextPosition }
  | { readonly kind: 'point'; readonly cursor: TextPosition };

export function focusMark(text: string, span: Span): FocusMark {
  const lines = new LineMap(text);
  const t = trimmed(text, span);
  const start = lines.positionOf(t.start);
  if (t.start < t.end) {
    return { kind: 'block', first: start.line, last: lines.positionOf(t.end).line, cursor: start };
  }

  // nothing but whitespace: where it stands in its line decides the mark
  const line = lines.lineText(start.line);
  const before = line.slice(0, start.character).trim();
  const after = line.slice(start.character).trim();
  if (after === '') return { kind: 'gap', line: start.line, edge: 'below', cursor: start };
  if (before === '') return { kind: 'gap', line: start.line, edge: 'above', cursor: start };
  return { kind: 'point', cursor: start };
}
