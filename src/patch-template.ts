import { extname } from 'node:path';
import { PATCH_FORMAT } from './patch-files.ts';
import type { ConfigResultV5 } from './service/protocol.ts';

/**
 * What New S.I.R Patch puts in a patch nobody has written yet (N2): the header, then one
 * hunk to fill in, as a snippet — the anchors are tab stops. Only what the core told: the
 * place, the header and the language are its answers (`pair`, `config`). Pure, so it is
 * tested alone.
 */

/** `config` as this module reads it: `language` (N3) and `header` (N5) are protocol 5,
 *  absent before. */
export type ConfigAnswer = Pick<ConfigResultV5, 'language' | 'header' | 'target'> & {
  readonly settings: Pick<ConfigResultV5['settings'], 'language'>;
};

/** The protocol from which `config` answers `language` (N3) and `header` (N5). */
export const CONFIG_LANGUAGE_SINCE = 5;
export const CONFIG_HEADER_SINCE = 5;

/**
 * The header with its blank line. From protocol 5 the core's own text — what `generate`
 * would write now, `Base-Blob`, `Sir-Version` and `Grammar` included — taken as it comes:
 * which fields, in which order, is the core's contract (VERSIONING.md H1–H4), and a list
 * kept here would fall behind its first new field. A core of protocol 4 does not answer
 * it; then the two fields the extension can vouch for, `Sir` and `Target`.
 */
export function patchHeader(config: ConfigAnswer, protocol: number): string {
  if (protocol >= CONFIG_HEADER_SINCE && typeof config.header === 'string') return config.header;
  const target = config.target === null ? [] : [`Target: ${config.target}`];
  return [`Sir: ${PATCH_FORMAT}`, ...target, '', ''].join('\n');
}

/**
 * The word for `# match`, or null for "the core picks none — let the person write it".
 *
 * From protocol 5 it is the core's own answer, the very word `generate` would write
 * (`cpp` for `.cc`). Its null is kept: a name no language answers to, or an extension no
 * grammar has, which `generate` would refuse — guessing past it would hand the person a
 * heading that fails. A core of protocol 4 does not answer it; then the configured
 * language, else the file's extension: every name and extension the core reads is a word
 * `# match` accepts (protocol 3), only maybe not the one `generate` would pick.
 */
export function matchLanguage(config: ConfigAnswer, protocol: number, codePath: string): string | null {
  if (protocol >= CONFIG_LANGUAGE_SINCE && config.language !== undefined) return config.language;
  // an empty name is no name, as the core reads it
  if (config.settings.language) return config.settings.language;
  const extension = extname(codePath).slice(1).toLowerCase();
  return extension === '' ? null : extension;
}

export interface Template {
  /** the header with its blank line, as `patchHeader` gives it */
  readonly header: string;
  /** the word of `# match`; null makes it the first tab stop */
  readonly language: string | null;
}

/** The whole new patch, in the syntax of `vscode.SnippetString`. */
export function newPatchSnippet({ header, language }: Template): string {
  const first = language === null ? 2 : 1;
  return [
    escapeSnippet(header) + `# match ${language === null ? '${1:language}' : escapeSnippet(language)}`,
    '    ...',
    `    \${${first}:anchor before the change}`,
    '    >>>',
    `    \${${first + 1}:anchor after the change}`,
    '    ...',
    '# end',
    '# patch',
    '    $0',
    '# end',
    '',
  ].join('\n');
}

/** Text as a snippet takes it literally: `$`, `}` and `\` would be syntax. */
export function escapeSnippet(text: string): string {
  return text.replace(/[$}\\]/g, '\\$&');
}
