import { test } from 'node:test';
import assert from 'node:assert/strict';

import { focusMark } from '../src/navigation/focus.ts';

// B10: the hunk chosen in «base ↔ base + patch», marked on each side.

const BASE = [
  'def delete_note(note_id):', // 0
  '    storage.remove(note_id)', // 1
  '    return {"ok": True}', // 2
  '',
].join('\n');

const at = (text: string, needle: string, past = 0): number => text.indexOf(needle) + past;

test('text the hunk covers is a block of its lines, the cursor at its first character', () => {
  const start = at(BASE, 'storage');
  const end = at(BASE, 'True}') + 'True}'.length;
  assert.deepEqual(focusMark(BASE, { start, end }), {
    kind: 'block',
    first: 1,
    last: 2,
    cursor: { line: 1, character: 4 },
  });
});

test('the surrounding whitespace of a block is not its lines', () => {
  const start = at(BASE, 'storage') - 5; // the newline and the indent before it
  const end = at(BASE, 'note_id)\n', 'note_id)\n    '.length);
  assert.deepEqual(focusMark(BASE, { start, end }), {
    kind: 'block',
    first: 1,
    last: 1,
    cursor: { line: 1, character: 4 },
  });
});

test('an insertion at the end of a line is a line under it, not the line itself', () => {
  const end = at(BASE, '(note_id)\n', '(note_id)'.length);
  assert.deepEqual(focusMark(BASE, { start: end, end }), {
    kind: 'gap',
    line: 1,
    edge: 'below',
    cursor: { line: 1, character: 27 },
  });
});

test('an insertion at the start of a line is a line over it', () => {
  const start = at(BASE, '    return');
  assert.deepEqual(focusMark(BASE, { start, end: start }), {
    kind: 'gap',
    line: 2,
    edge: 'above',
    cursor: { line: 2, character: 0 },
  });
});

test('an insertion inside the indent is still over the line', () => {
  const start = at(BASE, 'return');
  assert.equal(focusMark(BASE, { start, end: start }).kind, 'gap');
});

test('a span of whitespace alone is where it collapses to', () => {
  const start = at(BASE, '(note_id)\n', '(note_id)'.length);
  assert.deepEqual(focusMark(BASE, { start, end: start + 1 }), {
    kind: 'gap',
    line: 2,
    edge: 'above',
    cursor: { line: 2, character: 0 },
  });
});

test('an insertion inside a line is a point', () => {
  const start = at(BASE, 'remove');
  assert.deepEqual(focusMark(BASE, { start, end: start }), { kind: 'point', cursor: { line: 1, character: 12 } });
});

test('a CRLF line ends before its \\r', () => {
  const crlf = BASE.replaceAll('\n', '\r\n');
  const end = at(crlf, '(note_id)\r\n', '(note_id)'.length);
  assert.deepEqual(focusMark(crlf, { start: end, end }), {
    kind: 'gap',
    line: 1,
    edge: 'below',
    cursor: { line: 1, character: 27 },
  });
});

// ---- what mutation testing found unchecked (docs/15-test-plan.md, stage 4c) ----

test('a point followed by nothing but spaces is a line under it', () => {
  const text = 'a();   \nb();\n';
  const end = 'a();'.length;
  assert.equal(focusMark(text, { start: end, end }).kind, 'gap');
});
