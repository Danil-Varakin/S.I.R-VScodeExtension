import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// A theme colour the code names and package.json does not declare draws nothing, silently.

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

test('every sir.* colour the code names is declared in package.json, and every declared one is used', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { contributes: { colors: { id: string }[] } };
  const declared = new Set(pkg.contributes.colors.map((c) => c.id));
  const used = new Set<string>();
  for (const file of sources('src')) {
    for (const [, id] of readFileSync(file, 'utf8').matchAll(/'(sir\.\w+(?:Foreground|Background))'/g)) used.add(id!);
  }
  assert.deepEqual([...used].filter((id) => !declared.has(id)), [], 'used, not declared');
  assert.deepEqual([...declared].filter((id) => !used.has(id)), [], 'declared, never used');
});
