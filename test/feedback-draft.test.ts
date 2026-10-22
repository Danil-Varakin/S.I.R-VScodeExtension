import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeChange, draftOf, keepProblemOf } from '../src/feedback/draft.ts';

// Write by Hand (N4): what a `SynthesisError` hands over, and where a `keep` that does not
// stand went wrong — read from the error's `detail`, as protocol 5 names it.

const DETAIL = {
  reason: 'ambiguous',
  newLine: 12,
  draft: 'Sir: 2\nTarget: src/a.cc\n\n# match cpp\n    ...\n# end\n# patch\n    x\n# end\n',
  draftHunk: 1,
  draftLine: 4,
  change: { line: 11, removed: ['    work();'], added: ['    work(2);'] },
};

test('protocol 5: the draft, its starting hunk and the change', () => {
  assert.deepEqual(draftOf(DETAIL, 5), {
    text: DETAIL.draft,
    hunk: 1,
    line: 4,
    change: { line: 11, removed: ['    work();'], added: ['    work(2);'] },
  });
});

test('a core before protocol 5, or no draft in the error: nothing to write by hand', () => {
  assert.equal(draftOf(DETAIL, 4), undefined);
  assert.equal(draftOf({ reason: 'ambiguous', newLine: 12 }, 5), undefined);
  assert.equal(draftOf(undefined, 5), undefined);
  assert.equal(draftOf({ ...DETAIL, draftLine: '4' }, 5), undefined);
});

test('a change of an unexpected shape is left out, the draft is not', () => {
  assert.equal(draftOf({ ...DETAIL, change: { line: 11, removed: 'x', added: [] } }, 5)?.change, undefined);
  assert.equal(draftOf({ ...DETAIL, change: undefined }, 5)?.text, DETAIL.draft);
});

test('a keep that does not stand: the line, and the hunk when the core names one', () => {
  assert.deepEqual(keepProblemOf({ hunk: 2, mdLine: 17, failedStepIndex: 3 }), { line: 17, hunk: 2 });
  assert.deepEqual(keepProblemOf({ mdLine: 5 }), { line: 5, hunk: undefined });
  assert.equal(keepProblemOf({ failedStepIndex: 3 }), undefined);
  assert.equal(keepProblemOf(undefined), undefined);
});

test('the change as a hover shows it', () => {
  assert.equal(describeChange(DETAIL.change), '-     work();\n+     work(2);');
});

// ---- what mutation testing found unchecked (docs/15-test-plan.md, stage 4c) ----

test('a draft is taken only with all three of its parts, each of its type', () => {
  const { draft: _draft, ...withoutText } = DETAIL;
  assert.equal(draftOf(withoutText, 5), undefined, 'no text');
  assert.equal(draftOf({ ...DETAIL, draftHunk: '1' }, 5), undefined, 'a hunk that is not a number');
});

test('a change that is not an object, or has the wrong kinds inside, is left out', () => {
  assert.equal(draftOf({ ...DETAIL, change: null }, 5)?.change, undefined);
  assert.equal(draftOf({ ...DETAIL, change: { line: 11, removed: ['a', 1], added: [] } }, 5)?.change, undefined, 'one line not text');
  assert.equal(draftOf({ ...DETAIL, change: { line: 11, removed: [1], added: [] } }, 5)?.change, undefined);
  assert.equal(draftOf({ ...DETAIL, change: { line: '11', removed: [], added: [] } }, 5)?.change, undefined, 'a line not a number');
});

test('a hunk named as text is no hunk', () => {
  assert.deepEqual(keepProblemOf({ mdLine: 5, hunk: '2' }), { line: 5, hunk: undefined });
});
