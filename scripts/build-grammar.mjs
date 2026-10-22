// Writes syntaxes/sir.tmLanguage.json from the core this extension is built with.
import { writeFile } from 'node:fs/promises';
import { adapterForLanguage, supportedLanguages } from 'sir';
import { grammarFor } from './sir-grammar.mjs';

export function coreAliases() {
  const aliases = {};
  for (const alias of supportedLanguages) {
    const name = adapterForLanguage(alias).name;
    (aliases[name] ??= []).push(alias);
  }
  return aliases;
}

export function grammarText() {
  return `${JSON.stringify(grammarFor(coreAliases()), null, 2)}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await writeFile(new URL('../syntaxes/sir.tmLanguage.json', import.meta.url), grammarText());
  console.log('wrote syntaxes/sir.tmLanguage.json');
}
