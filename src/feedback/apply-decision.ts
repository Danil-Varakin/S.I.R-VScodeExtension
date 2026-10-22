import type { HunkLink } from '../service/protocol.ts';

// Whether Apply may write a patch into its code, and what to say when it may not. The
// patch is always laid on its clean base out of git — never on the code itself: the core
// does not see a patch that is already there, and laid on patched code it writes every
// hunk a second time (docs/07-proposals.md §0.2). On the clean base that cannot happen,
// so the only questions left are about the code: is the result already there, is the
// code still its base, or does it hold edits the patch does not have.
//
// Pure, so every row of the table is tested without an editor.

export type ApplyDecision =
  /** the base is the saved file — the very file: laid on it, a patch already there doubles */
  | { readonly kind: 'saved-base' }
  /** some hunk does not land on the base: the result would be part of the patch */
  | { readonly kind: 'does-not-land'; readonly landed: number; readonly total: number; readonly first: HunkLink }
  /** the code is already the base with the patch: nothing to write */
  | { readonly kind: 'applied' }
  /** the code is its base: the result replaces it and nothing is lost */
  | { readonly kind: 'write' }
  /** the code is neither: writing the result would drop edits the patch does not have */
  | { readonly kind: 'local-edits' };

export interface ApplyInput {
  readonly base: 'git' | 'saved';
  readonly hunks: readonly HunkLink[];
  /** the clean base the patch was laid on */
  readonly baseText: string;
  /** the base with the patch, as the core's `apply` gave it; undefined when not asked yet */
  readonly result: string | undefined;
  /** the code as the editor holds it: unsaved edits count */
  readonly code: string;
}

/** Undefined when the decision needs `result` and it was not given: ask the core, then ask again. */
export function applyDecisionOf(input: ApplyInput): ApplyDecision | undefined {
  if (input.base === 'saved') return { kind: 'saved-base' };
  const failing = input.hunks.filter((h) => h.status !== 'ok');
  if (failing.length > 0) {
    return { kind: 'does-not-land', landed: input.hunks.length - failing.length, total: input.hunks.length, first: failing[0]! };
  }
  if (input.result === undefined) return undefined;
  if (input.code === input.result) return { kind: 'applied' };
  if (input.code === input.baseText) return { kind: 'write' };
  return { kind: 'local-edits' };
}

// ---- Apply All: what a run found ----

export type ApplyOutcome = ApplyDecision['kind'] | 'failed';

/** In the order the summary names them: what is written first, what needs a hand last. */
const OUTCOMES: readonly ApplyOutcome[] = ['write', 'applied', 'local-edits', 'does-not-land', 'saved-base', 'failed'];

const OUTCOME_WORDS: Readonly<Record<ApplyOutcome, string>> = {
  write: 'to apply',
  applied: 'already applied',
  'local-edits': 'with edits not in their patch',
  'does-not-land': 'do not land',
  'saved-base': 'have no git base',
  failed: 'could not be read',
};

/** Why a patch was left alone, for the list of skipped ones. */
export const SKIP_REASON: Readonly<Record<Exclude<ApplyOutcome, 'write' | 'applied'>, string>> = {
  'local-edits': 'the code has edits that are not in the patch: generate the patch again to keep them, or apply it alone to overwrite them',
  'does-not-land': 'not every hunk lands on the base',
  'saved-base': 'the base is the saved file; apply needs a git base (generate.base)',
  failed: 'the core could not read it',
};

export type ApplyCounts = Readonly<Record<ApplyOutcome, number>>;

export function countsOf(outcomes: readonly ApplyOutcome[]): ApplyCounts {
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<ApplyOutcome, number>;
  for (const outcome of outcomes) counts[outcome]++;
  return counts;
}

/** `3 to apply · 1 already applied · 2 do not land` — only what there is. */
export function describeCounts(counts: ApplyCounts): string {
  const parts = OUTCOMES.filter((o) => counts[o] > 0).map((o) => `${counts[o]} ${OUTCOME_WORDS[o]}`);
  return parts.length > 0 ? parts.join(' · ') : 'no patches';
}

/** How many patches Apply All lays through the editor's Refactor Preview; above it, on disk (A7-c). */
export const PREVIEW_LIMIT = 50;
