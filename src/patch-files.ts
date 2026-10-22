/**
 * What a patch is called, in one place.
 *
 * The suffix, the language id and the glob were spelled out in six modules — `place.ts`,
 * `ui/highlight.ts`, `ui/code-lens.ts`, `ui/patch-tree.ts`, `commands/generate.ts`,
 * `project/gate.ts` — each with its own literal. The command ids were gathered into
 * `commands/ids.ts` for the same reason, with the same note that one copy is already one
 * too many: rename the extension and a forgotten literal does not fail, it quietly stops
 * recognising patches in one feature while the rest go on working.
 *
 * They are also spelled in `package.json` (`languages`, `grammars`, the menu `when`
 * clauses), which is the one other copy, as for the commands.
 */

/** Patches are `.sirp` — the core refuses any other name. */
export const PATCH_SUFFIX = '.sirp';

/** The `languages` contribution of `package.json`. */
export const PATCH_LANGUAGE = 'sir';

/** Every patch of the workspace, for `findFiles` and for a `DocumentSelector`. */
export const PATCHES_GLOB = `**/*${PATCH_SUFFIX}`;

/** The `Sir:` of a patch started by hand when the core gives no header (`config.header`
 *  is null). Format 2 is the one sir 0.5 reads and writes (VERSIONING.md H1). */
export const PATCH_FORMAT = 2;

/** What a search for every patch of the workspace leaves out. */
export const PATCHES_EXCLUDE = '**/node_modules/**';

/** Whether a path names a patch. Said of the path, never of what the file holds. */
export function isPatchPath(path: string): boolean {
  return path.endsWith(PATCH_SUFFIX);
}
