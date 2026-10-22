import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HunkLink } from '../src/service/protocol.ts';

import { checkOf, describeCheck, describeTotals, failedCheck, reportOf, sorted, totalsOf } from '../src/feedback/patch-report.ts';

const hunk = (index: number, status: HunkLink['status'], message?: string): HunkLink =>
  ({ index, status, dependsOnEarlier: false, ...(message === undefined ? {} : { failure: { kind: 'MatchError', message } }) }) as HunkLink;

test('a patch is ok, ambiguous or broken by its hunks, and names the first that is not ok (R2)', () => {
  assert.equal(checkOf('a.cc.sirp', [hunk(0, 'ok'), hunk(1, 'ok')]).status, 'ok');
  const ambiguous = checkOf('b.cc.sirp', [hunk(0, 'ok'), hunk(1, 'ambiguous', 'fits 2 places')]);
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.reason, 'hunk 2: fits 2 places');
  const broken = checkOf('c.cc.sirp', [hunk(0, 'ambiguous'), hunk(1, 'no-match', 'anchor 3 of 5 not found')]);
  assert.equal(broken.status, 'broken', 'one hunk that lands nowhere breaks the patch');
  assert.equal(broken.placed, 0);
});

test('the worst come first, the totals count broken and failed together', () => {
  const checks = [
    checkOf('z.cc.sirp', [hunk(0, 'ok')]),
    checkOf('b.cc.sirp', [hunk(0, 'no-match')]),
    failedCheck('a.cc.sirp', 'a.cc is not in origin/main'),
    checkOf('m.cc.sirp', [hunk(0, 'ambiguous')]),
  ];
  assert.deepEqual(sorted(checks).map((c) => c.patch), ['a.cc.sirp', 'b.cc.sirp', 'm.cc.sirp', 'z.cc.sirp']);
  assert.equal(describeTotals(totalsOf(checks)), '✓ 1 · ⚠ 1 · ✗ 2');
});

test('the report lists what needs a look, or says every patch applies', () => {
  const report = reportOf('origin/main', [checkOf('a.cc.sirp', [hunk(0, 'ok')]), failedCheck('b.cc.sirp', 'not in origin/main')]);
  assert.match(report, /^# S.I.R patches against origin\/main\n\n✓ 1 · ⚠ 0 · ✗ 1\n\n- ✗ `b\.cc\.sirp` — not in origin\/main\n$/);
  assert.match(reportOf('HEAD', [checkOf('a.cc.sirp', [hunk(0, 'ok')])]), /Every patch applies\./);
});

// the status and the reason must name the same hunk: a report that says `broken` and then
// explains an ambiguity sends the reader to a hunk that is not the problem

test('a patch both ambiguous and broken is broken, and the reason is the broken hunk', () => {
  const check = checkOf('a.cc.sirp', [
    { index: 0, status: 'ambiguous', dependsOnEarlier: false, failure: { kind: 'AmbiguityError', message: 'fits 3 places' } },
    { index: 1, status: 'ok', dependsOnEarlier: false },
    { index: 5, status: 'no-match', dependsOnEarlier: false, failure: { kind: 'MatchError', message: 'anchor 2 not found' } },
  ] as HunkLink[]);
  assert.equal(check.status, 'broken');
  assert.equal(check.reason, 'hunk 6: anchor 2 not found');
  assert.equal(check.placed, 1);
});

test('a patch that is only ambiguous still reports its first ambiguous hunk', () => {
  const check = checkOf('a.cc.sirp', [
    { index: 0, status: 'ok', dependsOnEarlier: false },
    { index: 1, status: 'ambiguous', dependsOnEarlier: false, failure: { kind: 'AmbiguityError', message: 'fits 3 places' } },
  ] as HunkLink[]);
  assert.equal(check.status, 'ambiguous');
  assert.equal(check.reason, 'hunk 2: fits 3 places');
});

// ---- what mutation testing found unchecked (docs/15-test-plan.md, stage 4c) ----

test('the worst come first even when their names come last', () => {
  const checks = [
    checkOf('a.cc.sirp', [hunk(0, 'ok')]),
    checkOf('b.cc.sirp', [hunk(0, 'ambiguous')]),
    checkOf('c.cc.sirp', [hunk(0, 'no-match')]),
    failedCheck('d.cc.sirp', 'gone'),
  ];
  assert.deepEqual(sorted(checks).map((c) => c.patch), ['d.cc.sirp', 'c.cc.sirp', 'b.cc.sirp', 'a.cc.sirp']);
});

test('each patch in the report is marked by its state', () => {
  const report = reportOf('HEAD', [
    checkOf('a.cc.sirp', [hunk(0, 'ambiguous', 'fits 2 places')]),
    checkOf('b.cc.sirp', [hunk(0, 'no-match', 'anchor 1 not found')]),
    failedCheck('c.cc.sirp', 'gone'),
  ]);
  assert.match(report, /^- ✗ `c\.cc\.sirp` — gone$/m);
  assert.match(report, /^- ✗ `b\.cc\.sirp` — 0\/1 hunks — hunk 1: anchor 1 not found$/m);
  assert.match(report, /^- ⚠ `a\.cc\.sirp` — 0\/1 hunks — hunk 1: fits 2 places$/m);
});

test('a check reads as its count, its reason after it, or why it could not be checked', () => {
  assert.equal(describeCheck(checkOf('a.cc.sirp', [hunk(0, 'ok'), hunk(1, 'ok')])), '2/2 hunks');
  assert.equal(describeCheck({ patch: 'a.cc.sirp', status: 'failed', placed: 0, hunks: 0, reason: undefined }), 'could not be checked');
});
