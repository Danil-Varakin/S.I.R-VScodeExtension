import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PATCHES_EXCLUDE, PATCHES_GLOB, PATCH_LANGUAGE, isPatchPath } from '../src/patch-files.ts';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  contributes: { languages: Array<{ id: string; extensions: string[] }> };
};

// README: "Patches are `.sirp` files"; the core refuses any other name.

test('a patch is a path ending in .sirp, wherever .sirp appears otherwise', () => {
  assert.equal(isPatchPath('/w/src/a.cc.sirp'), true);
  assert.equal(isPatchPath('/w/src/a.cc'), false);
  assert.equal(isPatchPath('.sirp/a.cc'), false, 'a folder named .sirp holds no patch by its name');
});

test('every patch of the workspace is found by one glob', () => {
  assert.equal(PATCHES_GLOB, '**/*.sirp');
});

test('the language of a patch is the one the manifest contributes for .sirp (the one other copy)', () => {
  const language = manifest.contributes.languages.find((l) => l.extensions.includes('.sirp'));
  assert.equal(language?.id, PATCH_LANGUAGE);
});

test('a search for every patch leaves the dependencies out', () => {
  assert.equal(PATCHES_EXCLUDE, '**/node_modules/**');
});
