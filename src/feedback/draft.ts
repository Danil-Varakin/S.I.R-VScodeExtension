/**
 * A hunk written by hand where synthesis gave up (N4), as the core hands it over and takes
 * it back: a `SynthesisError` carries the `.sirp` so far as `draft` — every hunk that
 * landed and a starting hunk for the change — and the next `generate` takes it, finished,
 * as `keep`. The service keeps no session; the draft is the whole state.
 *
 * Pure: what an error's `detail` says, read once here, so the commands and the tests
 * agree on it.
 */

/** The protocol from which `SynthesisError` hands over a draft and `generate` takes `keep`. */
export const DRAFT_SINCE = 5;

export interface Draft {
  /** the `.sirp` so far: the header, the hunks that landed, the starting hunk last */
  readonly text: string;
  /** the starting hunk's number in `text`, from 1 */
  readonly hunk: number;
  /** the line of its `# match` in `text`, from 1 */
  readonly line: number;
  /** the change synthesis could not anchor: its line in the text so far, what went, what came */
  readonly change: { readonly line: number; readonly removed: readonly string[]; readonly added: readonly string[] } | undefined;
}

/** The draft a `SynthesisError` carries, or undefined: a core before protocol 5, or a
 *  failure before any change. */
export function draftOf(detail: Readonly<Record<string, unknown>> | undefined, protocol: number): Draft | undefined {
  if (protocol < DRAFT_SINCE || detail === undefined) return undefined;
  const { draft, draftHunk, draftLine, change } = detail;
  if (typeof draft !== 'string' || typeof draftHunk !== 'number' || typeof draftLine !== 'number') return undefined;
  return { text: draft, hunk: draftHunk, line: draftLine, change: changeOf(change) };
}

function changeOf(value: unknown): Draft['change'] {
  if (value === null || typeof value !== 'object') return undefined;
  const { line, removed, added } = value as Record<string, unknown>;
  const lines = (v: unknown): v is string[] => Array.isArray(v) && v.every((l) => typeof l === 'string');
  return typeof line === 'number' && lines(removed) && lines(added) ? { line, removed, added } : undefined;
}

/** Where in the draft a `keep` that does not stand went wrong: the line, from 1, and the
 *  hunk when the core names one. `ParseError` names the line only. */
export function keepProblemOf(detail: Readonly<Record<string, unknown>> | undefined): { readonly line: number; readonly hunk: number | undefined } | undefined {
  const line = detail?.['mdLine'];
  if (typeof line !== 'number') return undefined;
  const hunk = detail?.['hunk'];
  return { line, hunk: typeof hunk === 'number' ? hunk : undefined };
}

/** The change, as a hover shows it: `-` the lines that went, `+` the ones that came. */
export function describeChange(change: NonNullable<Draft['change']>): string {
  return [...change.removed.map((l) => `- ${l}`), ...change.added.map((l) => `+ ${l}`)].join('\n');
}
