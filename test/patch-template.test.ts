import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeSnippet, matchLanguage, newPatchSnippet, patchHeader } from '../src/patch-template.ts';

// New S.I.R Patch (N2): the word of `# match` and the text of a patch started by hand.
// The language (N3) and the header (N5) are the core's from protocol 5; before, the
// extension's best guess and the two fields it can vouch for.

const settings = (language: string | null = null) => ({ target: 'src/a.cc', settings: { language } });
const FULL =
  'Sir: 2\nTarget: src/a.cc\nBase-Blob: 047e78a9b295e4328405cbe617c67aa5f06a620f\nSir-Version: 0.5.0\nGrammar: tree-sitter-cpp@0.23.4\n\n';

test('protocol 5: the core names the language, and its word is used as it is', () => {
  assert.equal(matchLanguage({ ...settings(), language: 'cpp' }, 5, '/w/src/a.cc'), 'cpp');
  assert.equal(matchLanguage({ ...settings('c++'), language: 'cpp' }, 6, '/w/src/a.mm'), 'cpp');
});

test('protocol 5: a null from the core stays null, never the extension in its place', () => {
  // `cobol` in the config: generate would refuse it, so there is nothing to guess
  assert.equal(matchLanguage({ ...settings('cobol'), language: null }, 5, '/w/src/a.cc'), null);
});

test('protocol 4: the configured language, else the extension, lower-cased', () => {
  assert.equal(matchLanguage({ ...settings('python'), language: 'ignored' }, 4, '/w/a.cc'), 'python');
  assert.equal(matchLanguage(settings(), 4, '/w/src/A.CC'), 'cc');
  assert.equal(matchLanguage(settings(''), 4, '/w/src/a.py'), 'py');
  assert.equal(matchLanguage(settings(), 4, '/w/Makefile'), null);
});

test('protocol 5 without the field (a core before N3): as protocol 4', () => {
  assert.equal(matchLanguage(settings(), 5, '/w/src/a.cc'), 'cc');
});

test('protocol 5: the header is the core\'s text, as it comes', () => {
  assert.equal(patchHeader({ ...settings(), header: FULL }, 5), FULL);
  // a field the extension has never heard of goes through all the same
  const newer = 'Sir: 2\nTarget: src/a.cc\nSomething-New: x\n\n';
  assert.equal(patchHeader({ ...settings(), header: newer }, 6), newer);
});

test('protocol 4, or no header from the core: Sir and Target', () => {
  assert.equal(patchHeader({ ...settings(), header: FULL }, 4), 'Sir: 2\nTarget: src/a.cc\n\n');
  assert.equal(patchHeader(settings(), 5), 'Sir: 2\nTarget: src/a.cc\n\n');
  assert.equal(patchHeader({ ...settings(), header: null }, 5), 'Sir: 2\nTarget: src/a.cc\n\n');
  assert.equal(patchHeader({ ...settings(), target: null }, 4), 'Sir: 2\n\n');
});

test('the header, then one hunk to fill', () => {
  assert.equal(
    newPatchSnippet({ header: FULL, language: 'cpp' }),
    [
      'Sir: 2',
      'Target: src/a.cc',
      'Base-Blob: 047e78a9b295e4328405cbe617c67aa5f06a620f',
      'Sir-Version: 0.5.0',
      'Grammar: tree-sitter-cpp@0.23.4',
      '',
      '# match cpp',
      '    ...',
      '    ${1:anchor before the change}',
      '    >>>',
      '    ${2:anchor after the change}',
      '    ...',
      '# end',
      '# patch',
      '    $0',
      '# end',
      '',
    ].join('\n'),
  );
});

test('no language: it is the first tab stop, the anchors come after it', () => {
  const text = newPatchSnippet({ header: 'Sir: 2\n\n', language: null });
  assert.match(text, /^# match \$\{1:language\}$/m);
  assert.match(text, /\$\{2:anchor before the change\}/);
  assert.match(text, /\$\{3:anchor after the change\}/);
});

test('what the snippet would read as syntax is escaped', () => {
  assert.equal(escapeSnippet('src/$x/{a}\\b.cc'), 'src/\\$x/{a\\}\\\\b.cc');
  assert.match(newPatchSnippet({ header: 'Sir: 2\nTarget: src/$HOME.cc\n\n', language: 'cpp' }), /^Target: src\/\\\$HOME\.cc$/m);
});
