import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extensionsOf, isSupportedFile, unsupportedMessage } from '../src/project/languages.ts';

test('the core\'s language names become the extensions the Generate button shows on (D3)', () => {
  assert.deepEqual(extensionsOf(['cpp', 'cc', 'PY']), ['.cpp', '.cc', '.py']);
});

test('a file is supported by its extension, case aside; none is not supported', () => {
  const languages = ['cpp', 'cc', 'h', 'python', 'py'];
  assert.equal(isSupportedFile('/w/src/a.CC', languages), true);
  assert.equal(isSupportedFile('/w/BUILD.gn', languages), false);
  assert.equal(isSupportedFile('/w/Makefile', languages), false);
});

test('the refusal names the extension and what the core does know', () => {
  assert.match(unsupportedMessage('/w/BUILD.gn', '0.4.0', ['cpp', 'c']), /^sir 0\.4\.0 has no grammar for \.gn files \(it knows cpp, c\)/);
  assert.match(unsupportedMessage('/w/Makefile', '0.4.0', ['cpp']), /files without an extension/);
});

// ---- what mutation testing found unchecked (docs/15-test-plan.md, stage 4c) ----

test('the refusal lists up to twelve languages, and says when there are more', () => {
  const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `l${i}`);
  const twelve = unsupportedMessage('/w/x.gn', '0.4.0', names(12));
  assert.match(twelve, /\(it knows l0, .*, l11\);/);
  const thirteen = unsupportedMessage('/w/x.gn', '0.4.0', names(13));
  assert.match(thirteen, /\(it knows l0, .*, l11, …\);/);
  assert.doesNotMatch(thirteen, /l12/);
});
