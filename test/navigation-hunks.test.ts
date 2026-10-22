import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HunkLink } from '../src/service/protocol.ts';

import {
  hunkAtMdLine,
  hunkAtOffset,
  placedCount,
  stillMatches,
  translateByLines,
  trimmed,
} from '../src/navigation/hunks.ts';

function hunk(index: number, over: Partial<HunkLink> = {}): HunkLink {
  return { index, status: 'ok', dependsOnEarlier: false, ...over };
}

const TABLE: readonly HunkLink[] = [
  hunk(0, { mdSpan: [3, 8], base: { start: 10, end: 20 }, final: { start: 10, end: 25 } }),
  hunk(1, { mdSpan: [12, 18], base: { start: 60, end: 60 }, final: { start: 65, end: 80 } }),
];

test('a line inside a hunk finds it exactly', () => {
  const hit = hunkAtMdLine(TABLE, 5);
  assert.equal(hit.kind, 'exact');
  assert.equal(hit.kind === 'exact' && hit.hunk.index, 0);
});

test('prose between hunks resolves downward, and says it is approximate', () => {
  const hit = hunkAtMdLine(TABLE, 10);
  assert.equal(hit.kind, 'nearest');
  assert.equal(hit.kind === 'nearest' && hit.hunk.index, 1);
});

test('past the last hunk the nearest is the last, never a silent miss', () => {
  const hit = hunkAtMdLine(TABLE, 400);
  assert.equal(hit.kind, 'nearest');
  assert.equal(hit.kind === 'nearest' && hit.hunk.index, 1);
});

test('a table with nothing placed yields none rather than a guess', () => {
  assert.equal(hunkAtMdLine([hunk(0)], 5).kind, 'none');
  assert.equal(hunkAtOffset([hunk(0)], 5, 'final').kind, 'none');
});

test('an offset inside a hunk finds it on the side asked for', () => {
  assert.equal(hunkAtOffset(TABLE, 70, 'final').kind, 'exact');
  // 70 is inside hunk 1 on the final side, but past both base spans
  const onBase = hunkAtOffset(TABLE, 70, 'base');
  assert.equal(onBase.kind, 'nearest');
  assert.equal(onBase.kind === 'nearest' && onBase.hunk.index, 1);
});

test('an insertion is found at its own point, where start equals end', () => {
  const hit = hunkAtOffset(TABLE, 60, 'base');
  assert.equal(hit.kind, 'exact');
  assert.equal(hit.kind === 'exact' && hit.hunk.index, 1);
});

test('an offset covered by nothing resolves upward: the edit just walked past', () => {
  const hit = hunkAtOffset(TABLE, 40, 'final');
  assert.equal(hit.kind, 'nearest');
  assert.equal(hit.kind === 'nearest' && hit.hunk.index, 0);
});

test('an offset before every hunk still lands, on the first one', () => {
  const hit = hunkAtOffset(TABLE, 0, 'final');
  assert.equal(hit.kind, 'nearest');
  assert.equal(hit.kind === 'nearest' && hit.hunk.index, 0);
});

test('the edges of an inserted line are pulled in past the newline that made it', () => {
  const text = 'void a() {\n  one();\n  two();\n}\n';
  const span = { start: text.indexOf('\n  two'), end: text.indexOf('\n}') };
  const tight = trimmed(text, span);
  assert.equal(text.slice(tight.start, tight.end), 'two();');
});

test('trimming an all-whitespace span collapses instead of inverting', () => {
  const tight = trimmed('a   \n  b', { start: 1, end: 7 });
  assert.equal(tight.start, tight.end);
});

test('a span reaching past the end of the text is clamped', () => {
  const tight = trimmed('abc', { start: 0, end: 99 });
  assert.deepEqual(tight, { start: 0, end: 3 });
});

test('a hunk still matching the buffer is recognised, a drifted one is not', () => {
  const text = 'void a() {\n  two();\n}\n';
  const live = hunk(0, { final: { start: 11, end: 19 }, finalText: '  two();' });
  assert.equal(stillMatches(live, text), true);
  assert.equal(stillMatches(live, 'void a() {\n  three();\n}\n'), false);
});

test('a hunk the core could not place never counts as matching', () => {
  assert.equal(stillMatches(hunk(0, { status: 'no-match' }), 'anything'), false);
});

test('only a hunk that resolved counts as placed: not one that matched nowhere, nor in several places', () => {
  const table = [hunk(0), hunk(1, { status: 'no-match' }), hunk(2, { status: 'ambiguous' }), hunk(3, { status: 'error' }), hunk(4)];
  assert.equal(placedCount(table), 2);
});

test('a drifted position is carried over by finding its line again', () => {
  const applied = 'a\nb\ntarget()\nc\n';
  const buffer = 'header\nheader\na\nb\ntarget()\nc\n';
  const at = applied.indexOf('target()') + 2;
  const moved = translateByLines(applied, buffer, at)!;
  assert.equal(buffer.slice(moved - 2, moved + 6), 'target()');
});

test('a line that no longer exists translates to nothing, not to a guess', () => {
  assert.equal(translateByLines('a\ngone()\n', 'a\nb\n', 3), undefined);
});

test('a blank line identifies nothing and refuses to translate', () => {
  assert.equal(translateByLines('a\n\nb\n', 'a\n\nb\n', 2), undefined);
});

test('the nearest hunk is found by its place, whatever order the table lists them in', () => {
  const reversed = [...TABLE].reverse();
  const past = hunkAtMdLine(reversed, 400);
  assert.equal(past.kind === 'nearest' && past.hunk.index, 1, 'past the last: the one that ends lowest');
  const after = hunkAtOffset(reversed, 200, 'final');
  assert.equal(after.kind === 'nearest' && after.hunk.index, 1, 'below every hunk: the one just above');
  const before = hunkAtOffset(reversed, 0, 'final');
  assert.equal(before.kind === 'nearest' && before.hunk.index, 0, 'above every hunk: the first');
});

// ---- what mutation testing found unchecked (docs/15-test-plan.md, stage 2) ----

test('between hunks the nearest below is the next one, not the last', () => {
  const three = [...TABLE, hunk(2, { mdSpan: [25, 30] })];
  const hit = hunkAtMdLine(three, 10);
  assert.equal(hit.kind === 'nearest' && hit.hunk.index, 1);
  const listedLastFirst = hunkAtMdLine([...three].reverse(), 10);
  assert.equal(listedLastFirst.kind === 'nearest' && listedLastFirst.hunk.index, 1, 'whatever the order of the table');
});

test('two hunks starting on the same line: the one listed first is taken', () => {
  const tied = [hunk(0, { mdSpan: [12, 18] }), hunk(1, { mdSpan: [12, 15] })];
  const below = hunkAtMdLine(tied, 10);
  assert.equal(below.kind === 'nearest' && below.hunk.index, 0, 'below the line');
  const past = hunkAtMdLine(tied, 400);
  assert.equal(past.kind === 'nearest' && past.hunk.index, 0, 'past the last');
});

test('a hunk with a final span but no final text, or the other way round, does not match', () => {
  const text = 'void a() {\n  two();\n}\n';
  assert.equal(stillMatches(hunk(0, { final: { start: 11, end: 19 } }), text), false);
  assert.equal(stillMatches(hunk(0, { finalText: '  two();' }), text), false);
});

test('an offset is translated from the very start up to the very end of the text, and not one past', () => {
  const applied = 'a\nxb';
  const buffer = 'h\na\nxb';
  assert.equal(translateByLines(applied, buffer, -1), undefined);
  assert.equal(translateByLines(applied, buffer, applied.length + 1), undefined);
  assert.equal(translateByLines(applied, buffer, 0), buffer.indexOf('a'));
  assert.equal(translateByLines(applied, buffer, applied.length), buffer.length);
});

test('a line of spaces identifies nothing either', () => {
  assert.equal(translateByLines('a\n   \nb\n', 'a\n   \nb\n', 3), undefined);
});

test('of two copies of the line, the one nearer to where it was is taken', () => {
  const applied = 'x\nx\nx\nx\ntarget\n';
  const buffer = 'target\nx\nx\nx\nx\ntarget\n';
  assert.equal(translateByLines(applied, buffer, applied.indexOf('target')), buffer.lastIndexOf('target'));
});

test('a copy just above wins over one farther below', () => {
  const applied = 'a\nb\nc\ntarget\n';
  const buffer = 'a\nb\ntarget\nc\nd\ntarget\n';
  assert.equal(translateByLines(applied, buffer, applied.indexOf('target')), buffer.indexOf('target'));
});

test('of two copies as near as each other, the upper one is taken', () => {
  const applied = 'x\ntarget\nx\n';
  const buffer = 'target\nx\ntarget\n';
  assert.equal(translateByLines(applied, buffer, applied.indexOf('target')), 0);
});

test('the last line of the buffer is searched too', () => {
  assert.equal(translateByLines('a\ntarget', 'b\nc\ntarget', 2), 'b\nc\n'.length);
});

test('tabs and carriage returns are trimmed like spaces and newlines', () => {
  const text = '\t x \r\n';
  const tight = trimmed(text, { start: 0, end: text.length });
  assert.equal(text.slice(tight.start, tight.end), 'x');
});
