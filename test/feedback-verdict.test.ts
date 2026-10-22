import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HunkLink } from '../src/service/protocol.ts';

import { DRIFTED_MESSAGE, GLYPH, isNothingToCheck, lensTitle, problemsOf, unresolvedProblems, verdictOf } from '../src/feedback/verdict.ts';

const BASE = 'void a() {\n  one();\n}\n';
const APPLIED = 'void a() {\n  one();\n  two();\n}\n';
const INSERTED = { start: 20, end: 29 };

function hunk(over: Partial<HunkLink> = {}): HunkLink {
  return {
    index: 0,
    status: 'ok',
    dependsOnEarlier: false,
    mdSpan: [3, 9],
    base: { start: 20, end: 20 },
    final: INSERTED,
    finalText: APPLIED.slice(INSERTED.start, INSERTED.end),
    ...over,
  };
}

const APPLIED_TEXTS = { targetText: APPLIED, baselineText: BASE };

test('a hunk whose text is in the code is placed on the line it wrote', () => {
  const verdict = verdictOf(hunk(), APPLIED_TEXTS);
  assert.deepEqual(verdict, { kind: 'placed', line: 3 });
  assert.equal(lensTitle(hunk(), verdict, 'src/a.cc'), `${GLYPH.lands} src/a.cc:3`);
});

test('a dependent hunk says so next to its target', () => {
  const dependent = hunk({ dependsOnEarlier: true });
  assert.equal(
    lensTitle(dependent, verdictOf(dependent, APPLIED_TEXTS), 'a.cc'),
    `${GLYPH.lands} a.cc:3 · depends on an earlier hunk`,
  );
});

test('code equal to its baseline is not applied, and the dot still says it lands, in the baseline', () => {
  const verdict = verdictOf(hunk(), { targetText: BASE, baselineText: BASE });
  assert.deepEqual(verdict, { kind: 'unapplied', line: 3 });
  // not applied is said once, after the header; the hunk says only where it lands
  assert.equal(lensTitle(hunk(), verdict, 'a.cc'), `${GLYPH.lands} a.cc:3`);
});

test('code that moved away from the hunk is drift: a warning, not an error', () => {
  const texts = { targetText: APPLIED.replace('two', 'three'), baselineText: BASE };
  assert.deepEqual(verdictOf(hunk(), texts), { kind: 'drifted' });
  assert.deepEqual(problemsOf([hunk()], texts), [
    { line: 3, message: DRIFTED_MESSAGE, severity: 'warning' },
  ]);
});

test('a broken anchor is counted in steps and squiggled on its own line', () => {
  const broken = hunk({
    status: 'no-match',
    failure: { kind: 'no-match', message: 'no match', mdLine: 6, failedStepIndex: 2, totalSteps: 5 },
  });
  assert.equal(lensTitle(broken, verdictOf(broken, APPLIED_TEXTS), 'a.cc'), `${GLYPH.unresolved} anchor 3 of 5 not found`);

  const [problem] = problemsOf([broken], APPLIED_TEXTS);
  assert.equal(problem?.line, 6);
  assert.equal(problem?.severity, 'error');
});

test('a pattern that ran out before the code did is not called a missing anchor', () => {
  const overrun = hunk({
    status: 'no-match',
    failure: { kind: 'no-match', message: 'no match', failedStepIndex: 5, totalSteps: 5 },
  });
  assert.equal(
    lensTitle(overrun, verdictOf(overrun, APPLIED_TEXTS), 'a.cc'),
    `${GLYPH.unresolved} the pattern ended, the code did not`,
  );
});

test('an ambiguous hunk counts its places and is flagged on its first line', () => {
  const ambiguous = hunk({
    status: 'ambiguous',
    failure: { kind: 'ambiguous', message: 'ambiguous', mdLine: 7, candidates: [1, 40, 90, 120] },
  });
  assert.equal(lensTitle(ambiguous, verdictOf(ambiguous, APPLIED_TEXTS), 'a.cc'), `${GLYPH.unresolved} fits 4 places`);
  assert.equal(problemsOf([ambiguous], APPLIED_TEXTS)[0]?.line, 3);
});

test('healthy hunks raise no problems at all', () => {
  assert.deepEqual(problemsOf([hunk()], APPLIED_TEXTS), []);
});

test('with the saved file as base, code equal to it is nothing to check, not unapplied (Q1)', () => {
  const saved = { targetText: APPLIED, baselineText: APPLIED, base: { kind: 'saved' } };
  const verdict = verdictOf(hunk(), saved);
  assert.deepEqual(verdict, { kind: 'nothing-to-check', line: 3 });
  assert.equal(lensTitle(hunk(), verdict, 'a.cc'), `${GLYPH.lands} a.cc:3`);
  assert.deepEqual(problemsOf([hunk()], saved), [], 'no squiggle: nothing is wrong');
});

test('with the saved file as base, edited code still has something to check: the lenses and the status bar stay', () => {
  // code-lens.ts and status-bar.ts ask this directly, not only after the texts were found equal
  assert.equal(isNothingToCheck({ targetText: APPLIED, baselineText: BASE, base: { kind: 'saved' } }), false);
  assert.equal(isNothingToCheck({ targetText: APPLIED, baselineText: APPLIED, base: { kind: 'saved' } }), true);
  assert.equal(isNothingToCheck({ targetText: BASE, baselineText: BASE, base: { kind: 'git' } }), false);
});

test('with a git base, code equal to it is still not applied', () => {
  const git = { targetText: BASE, baselineText: BASE, base: { kind: 'git' } };
  assert.equal(verdictOf(hunk(), git).kind, 'unapplied');
});

test('Check All says every hunk that does not land, and leaves drift to the editor', () => {
  const broken = hunk({
    index: 1,
    status: 'no-match',
    failure: { kind: 'no-match', message: 'no match', mdLine: 6, failedStepIndex: 2, totalSteps: 5 },
  });
  const lineless = hunk({ index: 2, status: 'error', mdSpan: [12, 14] });
  const problems = unresolvedProblems([hunk(), broken, lineless]);
  assert.deepEqual(problems.map((p) => [p.line, p.severity]), [[6, 'error'], [12, 'error']]);
});

test('a hunk with no line at all is said on the header', () => {
  const nowhere = hunk({ status: 'error' });
  delete (nowhere as { mdSpan?: unknown }).mdSpan;
  assert.equal(unresolvedProblems([nowhere])[0]?.line, 1);
});

// ---- what mutation testing found unchecked (docs/15-test-plan.md, stage 4c) ----

const unresolved = (over: Partial<HunkLink>): string => {
  const h = hunk(over);
  return lensTitle(h, verdictOf(h, APPLIED_TEXTS), 'a.cc');
};

test('a drifted hunk reads as README lists it, and its problem says what to do', () => {
  const texts = { targetText: APPLIED.replace('two', 'three'), baselineText: BASE };
  assert.equal(lensTitle(hunk(), verdictOf(hunk(), texts), 'a.cc'), '🟡 differs from the code — regenerate?');
  assert.match(DRIFTED_MESSAGE, /regenerate/);
});

test('a drifted hunk with no line in the patch raises no problem rather than one on no line', () => {
  const lineless = hunk();
  delete (lineless as { mdSpan?: unknown }).mdSpan;
  assert.deepEqual(problemsOf([lineless], { targetText: APPLIED.replace('two', 'three'), baselineText: BASE }), []);
});

test('an anchor counted without a total is still counted from 1', () => {
  assert.equal(unresolved({ status: 'no-match', failure: { kind: 'no-match', message: 'm', failedStepIndex: 2 } }), '🔴 anchor 3 not found');
});

test('a step on a hunk that failed otherwise is no missing anchor: the core\'s words are shown', () => {
  assert.equal(unresolved({ status: 'error', failure: { kind: 'Internal', message: 'boom', failedStepIndex: 2, totalSteps: 5 } }), '🔴 boom');
  assert.equal(unresolved({ status: 'error' }), '🔴 error', 'nothing said: the status');
  assert.equal(unresolved({ status: 'no-match' }), '🔴 no-match');
});

test('an ambiguous hunk without its places is called ambiguous', () => {
  assert.equal(unresolved({ status: 'ambiguous' }), '🔴 ambiguous');
  assert.equal(unresolved({ status: 'ambiguous', failure: { kind: 'ambiguous', message: 'm' } }), '🔴 ambiguous');
});

test('a hunk with no place of its own in the base is named by its file alone', () => {
  const nowhere = hunk();
  delete (nowhere as { base?: unknown }).base;
  const verdict = verdictOf(nowhere, { targetText: BASE, baselineText: BASE });
  assert.equal(lensTitle(nowhere, verdict, 'a.cc'), `${GLYPH.lands} a.cc`);
});

test('a broken hunk is told by what the core said, on the line and on the header alike', () => {
  const broken = hunk({ status: 'no-match', failure: { kind: 'no-match', message: 'no match', mdLine: 6, failedStepIndex: 2, totalSteps: 5 } });
  const [onLine] = problemsOf([broken], APPLIED_TEXTS);
  assert.notEqual(onLine?.message, 'no-match', 'the failure, not the bare status');
  const lineless = hunk({ status: 'no-match', failure: { kind: 'no-match', message: 'no match', failedStepIndex: 2, totalSteps: 5 } });
  delete (lineless as { mdSpan?: unknown }).mdSpan;
  const [onHeader] = unresolvedProblems([lineless]);
  assert.deepEqual([onHeader?.line, onHeader?.severity], [1, 'error']);
  assert.equal(onHeader?.message, onLine?.message);
});
