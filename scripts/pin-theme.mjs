// The theme of the test window, written into its profile before every run
// (.vscode-test.mjs), so neither a new profile nor a new VS Code brings another: from 1.140
// the default dark theme is «Dark 2026», and the colours of sir were made against
// «Dark Modern».
//
//   node scripts/pin-theme.mjs <profile directory>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const THEME = {
  'workbench.colorTheme': 'Dark Modern',
  'workbench.preferredDarkColorTheme': 'Dark Modern',
};

export function pinTheme(profile) {
  const file = join(profile, 'User', 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // none yet, or not plain JSON: the theme is all it needs
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...settings, ...THEME }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const profile = process.argv[2];
  if (profile === undefined) {
    console.error('usage: node scripts/pin-theme.mjs <profile directory>');
    process.exit(2);
  }
  pinTheme(resolve(profile));
}
