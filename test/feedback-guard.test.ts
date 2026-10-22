import { test } from 'node:test';
import assert from 'node:assert/strict';

import { guardOf, guardViews } from '../src/feedback/guard.ts';

const BASE = 'a\n';
const RESULT = 'a\nb\n';

test('the guard tells the four states of a file with a patch apart (B4)', () => {
  assert.equal(guardOf({ buffer: RESULT, result: RESULT, baseline: BASE, savedBase: false }), 'matches');
  assert.equal(guardOf({ buffer: 'a\nb\nc\n', result: RESULT, baseline: BASE, savedBase: false }), 'edits-not-in-patch');
  assert.equal(guardOf({ buffer: BASE, result: RESULT, baseline: BASE, savedBase: false }), 'not-applied');
  assert.equal(guardOf({ buffer: BASE, result: RESULT, baseline: BASE, savedBase: true }), 'nothing-to-check');
});

// ---- the words, as README "The status bar" lists them (stage 4b) ----

test('the guard reads in the status bar as README lists it', () => {
  const views = guardViews(false);
  assert.equal(views.matches.text, 'matches its patch');
  assert.equal(views['edits-not-in-patch'].text, 'edits not in the patch');
  assert.equal(views['not-applied'].text, 'patch not applied');
  assert.equal(views['nothing-to-check'].text, 'nothing to check');
});

test('every guard has an icon and a tooltip of its own', () => {
  const views = Object.values(guardViews(false));
  assert.ok(views.every((view) => view.icon !== '' && view.tooltip.length > 20));
  assert.equal(new Set(views.map((view) => view.tooltip)).size, views.length);
});
