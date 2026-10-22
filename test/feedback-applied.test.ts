import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HunkLink } from '../src/service/protocol.ts';

import { PATCH_STATE_VIEW, patchStateOf } from '../src/feedback/applied.ts';

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

const broken = hunk({ index: 1, status: 'no-match', mdSpan: [11, 14] });

test('code that holds every hunk is applied', () => {
  assert.equal(patchStateOf([hunk()], { targetText: APPLIED, baselineText: BASE }), 'applied');
});

test('code equal to a git base is not applied — every fresh checkout reads so', () => {
  assert.equal(patchStateOf([hunk()], { targetText: BASE, baselineText: BASE, base: { kind: 'git' } }), 'not-applied');
});

test('one hunk the code moved away from makes the whole patch changed', () => {
  const twice = [hunk(), hunk({ index: 1, final: { start: 0, end: 4 }, finalText: 'gone' })];
  assert.equal(patchStateOf(twice, { targetText: APPLIED, baselineText: BASE }), 'changed');
  assert.equal(patchStateOf([...twice].reverse(), { targetText: APPLIED, baselineText: BASE }), 'changed', 'in any order');
});

test('with the saved file as base and the code that file, there is nothing to check (Q1)', () => {
  assert.equal(
    patchStateOf([hunk()], { targetText: APPLIED, baselineText: APPLIED, base: { kind: 'saved' } }),
    'nothing-to-check',
  );
});

test('a broken hunk does not hide whether the rest is in the code', () => {
  assert.equal(patchStateOf([broken, hunk()], { targetText: APPLIED, baselineText: BASE }), 'applied');
  assert.equal(patchStateOf([broken, hunk()], { targetText: BASE, baselineText: BASE }), 'not-applied');
});

test('with no hunk that lands there is nothing to say', () => {
  assert.equal(patchStateOf([broken], { targetText: APPLIED, baselineText: BASE }), undefined);
  assert.equal(patchStateOf([], { targetText: APPLIED, baselineText: BASE }), undefined);
});

test('badges are one or two characters, and never git letters', () => {
  for (const [state, { badge }] of Object.entries(PATCH_STATE_VIEW)) {
    if (badge === undefined) continue;
    assert.ok([...badge].length <= 2, `${state}: ${badge}`);
    assert.ok(!/^[AMDURC]$/.test(badge), `${state}: ${badge} is a git letter`);
  }
});

// ---- the words, as README "Whether the patch is in its code" lists them (stage 4b) ----

test('each state of a patch reads and is badged as README lists it', () => {
  const said = Object.fromEntries(Object.entries(PATCH_STATE_VIEW).map(([state, view]) => [state, [view.label, view.badge]]));
  assert.deepEqual(said, {
    applied: ['✓ applied', '✓'],
    'not-applied': ['○ not applied — the code is its base', '○'],
    changed: ['⚠ the code changed since the patch', '≠'],
    'nothing-to-check': ['◌ nothing to check — the base is the saved file', undefined],
  });
});

test('each state has a hover of its own', () => {
  const hovers = Object.values(PATCH_STATE_VIEW).map((view) => view.hover);
  assert.ok(hovers.every((hover) => hover.length > 20), 'a sentence, not a word');
  assert.equal(new Set(hovers).size, hovers.length);
});
