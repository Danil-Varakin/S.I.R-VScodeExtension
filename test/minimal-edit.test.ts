import { test } from 'node:test';
import assert from 'node:assert/strict';

import { minimalEdit } from '../src/minimal-edit.ts';

function applied(before: string, after: string): string {
  const edit = minimalEdit(before, after);
  if (edit === undefined) return before;
  return before.slice(0, edit.start) + edit.text + before.slice(edit.end);
}

test('equal texts need no edit', () => {
  assert.equal(minimalEdit('abc', 'abc'), undefined);
});

test('an inserted line is the only thing replaced', () => {
  const before = 'void a() {\n  one();\n}\n';
  const after = 'void a() {\n  one();\n  two();\n}\n';
  assert.deepEqual(minimalEdit(before, after), { start: 20, end: 20, text: '  two();\n' });
  assert.equal(applied(before, after), after);
});

test('a change, a deletion, an insertion at either end', () => {
  for (const [before, after] of [
    ['return 1;', 'return 2;'],
    ['a\nb\nc\n', 'a\nc\n'],
    ['x\n', 'header\nx\n'],
    ['x\n', 'x\nfooter\n'],
    ['', 'all new\n'],
    ['all gone\n', ''],
    ['aaaa', 'aa'],
  ] as const) {
    assert.equal(applied(before, after), after, JSON.stringify([before, after]));
  }
});

test('the common start and end do not overlap when the text repeats', () => {
  const edit = minimalEdit('aaa', 'aaaa')!;
  assert.ok(edit.start <= edit.end);
  assert.equal(applied('aaa', 'aaaa'), 'aaaa');
});

test('an edit never starts or ends inside a \\r\\n', () => {
  const before = 'a\r\nb\r\n';
  const after = 'a\r\nx\r\nb\r\n';
  const edit = minimalEdit(before, after)!;
  for (const at of [edit.start, edit.end]) {
    assert.ok(!(before[at - 1] === '\r' && before[at] === '\n'), `splits at ${at}`);
  }
  assert.equal(applied(before, after), after);
  // the line ending itself changed
  assert.equal(applied('a\nb\n', 'a\r\nb\n'), 'a\r\nb\n');
});

test('nor ends inside a \\r\\n when only the \\n is common to both texts', () => {
  const before = 'x\r\n';
  const after = 'y\n';
  assert.deepEqual(minimalEdit(before, after), { start: 0, end: 3, text: 'y\n' });
  assert.equal(applied(before, after), after);
});

test('an edit never splits a surrogate pair', () => {
  const before = 'x😀y';
  const after = 'x😃y';
  const edit = minimalEdit(before, after)!;
  assert.equal(edit.start, 1);
  assert.equal(edit.end, 3);
  assert.equal(applied(before, after), after);
});

// ---- the edges, exactly (mutation testing, docs/15-test-plan.md, stage 4b) ----
// Each row: the edit must be the smallest one, and step back only over a real pair.

test('an edit is as small as it can be, and steps back only over a whole \\r\\n or surrogate pair', () => {
  const rows: Array<[string, string, string, number, number]> = [
    // what, before, after, start, end
    ['appended at the very end', 'ab', 'abc', 2, 2],
    ['prepended at the very start', 'b', 'ab', 0, 0],
    ['before a \\n with no \\r', 'a\n', 'ab', 1, 2],
    ['after a \\r with no \\n', 'a\rb', 'a\rc', 2, 3],
    ['a pair whose high half is the first one', 'x\u{10000}y', 'x\u{10001}y', 1, 3],
    ['a pair whose high half is the last one', 'x\u{10FC00}y', 'x\u{10FC01}y', 1, 3],
    ['a pair whose low half is the last one', 'x\u{103FF}', 'x\u{103FE}', 1, 3],
    ['a lone low half after a letter', 'xa\udc00', 'xa\udc01', 2, 3],
    ['a lone high half before a letter', 'x\ud800a', 'x\ud800b', 2, 3],
    ['a lone high half before a wide letter', 'x\ud800Ａ', 'x\ud800Ｂ', 2, 3],
    ['a wide letter before a lone low half', 'xＡ\udc00', 'xＡ\udc01', 2, 3],
    ['after a wide letter', 'ＡB', 'ＡC', 1, 2],
  ];
  for (const [what, before, after, start, end] of rows) {
    const edit = minimalEdit(before, after)!;
    assert.deepEqual([edit.start, edit.end], [start, end], what);
    assert.equal(applied(before, after), after, what);
  }
});
