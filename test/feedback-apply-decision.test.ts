import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HunkLink } from '../src/service/protocol.ts';

import type { ApplyInput } from '../src/feedback/apply-decision.ts';
import { SKIP_REASON, applyDecisionOf, countsOf, describeCounts } from '../src/feedback/apply-decision.ts';

// The table Apply decides by (docs/07-proposals.md, A1): the patch is laid on its clean
// git base, and the code decides whether the result is written.

const BASE = 'void a() {\n  one();\n}\n';
const RESULT = 'void a() {\n  one();\n  two();\n}\n';

function hunk(over: Partial<HunkLink> = {}): HunkLink {
  return { index: 0, status: 'ok', dependsOnEarlier: false, ...over };
}

function input(over: Partial<ApplyInput> = {}): ApplyInput {
  return { base: 'git', hunks: [hunk()], baseText: BASE, result: RESULT, code: BASE, ...over };
}

test('the code is its base: the result is written', () => {
  assert.deepEqual(applyDecisionOf(input()), { kind: 'write' });
});

test('the code is already the result: nothing to write', () => {
  assert.deepEqual(applyDecisionOf(input({ code: RESULT })), { kind: 'applied' });
});

test('the code is neither: it has edits the patch does not, and writing would drop them', () => {
  assert.deepEqual(applyDecisionOf(input({ code: `${BASE}// mine\n` })), { kind: 'local-edits' });
  // the patch in it, plus more: still edits the patch does not have
  assert.deepEqual(applyDecisionOf(input({ code: `${RESULT}// mine\n` })), { kind: 'local-edits' });
});

test('a hunk that does not land refuses, whatever the code is — the result would be part of the patch', () => {
  const failing = hunk({ index: 1, status: 'no-match' });
  for (const code of [BASE, RESULT, 'other']) {
    assert.deepEqual(applyDecisionOf(input({ code, hunks: [hunk(), failing] })), {
      kind: 'does-not-land',
      landed: 1,
      total: 2,
      first: failing,
    });
  }
});

test('the saved file as base refuses first: laid on a file that holds the patch, it doubles', () => {
  assert.deepEqual(applyDecisionOf(input({ base: 'saved', code: RESULT })), { kind: 'saved-base' });
  assert.deepEqual(applyDecisionOf(input({ base: 'saved', hunks: [hunk({ status: 'no-match' })] })), { kind: 'saved-base' });
});

test('the core is asked for the result only when the decision needs it', () => {
  assert.equal(applyDecisionOf(input({ result: undefined })), undefined);
  // the refusals are decided without it
  assert.equal(applyDecisionOf(input({ result: undefined, base: 'saved' }))?.kind, 'saved-base');
  assert.equal(applyDecisionOf(input({ result: undefined, hunks: [hunk({ status: 'ambiguous' })] }))?.kind, 'does-not-land');
});

test('the summary of Apply All names only what there is, writes first', () => {
  const counts = countsOf(['does-not-land', 'write', 'applied', 'write', 'local-edits']);
  assert.equal(describeCounts(counts), '2 to apply · 1 already applied · 1 with edits not in their patch · 1 do not land');
  assert.equal(describeCounts(countsOf([])), 'no patches');
});

// ---- what mutation testing found unchecked (docs/15-test-plan.md, stage 4c) ----

test('the summary names every outcome, in its order, the ones needing a hand last', () => {
  const counts = countsOf(['failed', 'saved-base', 'does-not-land', 'local-edits', 'applied', 'write']);
  assert.equal(
    describeCounts(counts),
    '1 to apply · 1 already applied · 1 with edits not in their patch · 1 do not land · 1 have no git base · 1 could not be read',
  );
});

test('every patch left alone is told why, each in its own words', () => {
  const reasons = Object.values(SKIP_REASON);
  assert.equal(reasons.length, 4);
  assert.ok(reasons.every((reason) => reason.length > 20));
  assert.equal(new Set(reasons).size, reasons.length);
  assert.match(SKIP_REASON['saved-base'], /git base/, 'README: Apply requires a git base');
  assert.match(SKIP_REASON['local-edits'], /generate the patch again/);
});
