/**
 * The one replacement that turns `before` into `after`: everything between their common
 * start and their common end. Not a diff and nothing of sir — two string scans — but it
 * is what keeps an applied patch a small edit in the editor: the cursor, the folds and
 * the markers outside it stay where they were, and Undo takes back just that.
 *
 * Offsets are in UTF-16 code units, as `TextDocument.positionAt` counts. Neither end
 * splits a `\r\n` or a surrogate pair: the editor has no position between their halves.
 *
 * Pure, so it is tested without an editor.
 */
export interface MinimalEdit {
  readonly start: number;
  /** in `before` */
  readonly end: number;
  readonly text: string;
}

/** Undefined when the two are equal. */
export function minimalEdit(before: string, after: string): MinimalEdit | undefined {
  if (before === after) return undefined;
  const limit = Math.min(before.length, after.length);

  let start = 0;
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  if (start > 0 && splits(before, start)) start--;

  let tail = 0;
  while (tail < limit - start && before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)) tail++;
  if (tail > 0 && splits(before, before.length - tail)) tail--;

  return { start, end: before.length - tail, text: after.slice(start, after.length - tail) };
}

/** Whether `at` falls between the two halves of a `\r\n` or of a surrogate pair. */
function splits(text: string, at: number): boolean {
  if (at <= 0 || at >= text.length) return false;
  const prev = text.charCodeAt(at - 1);
  const next = text.charCodeAt(at);
  if (prev === 0x0d && next === 0x0a) return true;
  return prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}
