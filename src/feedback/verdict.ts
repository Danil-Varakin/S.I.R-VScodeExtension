import type { HunkLink, Span } from '../service/protocol.ts';
import { describeFailure, failureLine } from '../navigation/failure.ts';
import { placementOf, trimmed } from '../navigation/hunks.ts';
import { LineMap } from '../navigation/text.ts';

export interface Texts {
  readonly targetText: string;
  readonly baselineText: string;
  /** what the base is: with the saved file, code equal to it is no evidence either way */
  readonly base?: { readonly kind: string };
}

/**
 * The lenses, the squiggles and the highlights all ask for the same verdicts of the same
 * table. An index is immutable, so each verdict is worked out once per index — and the
 * line tables of its two texts once, not once per hunk.
 */
interface Memo {
  readonly target: LineMap;
  readonly baseline: LineMap;
  readonly verdicts: Map<HunkLink, Verdict>;
}

const memos = new WeakMap<Texts, Memo>();

function memoOf(texts: Texts): Memo {
  let memo = memos.get(texts);
  if (memo === undefined) {
    memo = {
      target: new LineMap(texts.targetText),
      baseline: new LineMap(texts.baselineText),
      verdicts: new Map(),
    };
    memos.set(texts, memo);
  }
  return memo;
}

export type Verdict =
  | { readonly kind: 'placed'; readonly line: number | undefined }
  | { readonly kind: 'unapplied'; readonly line: number | undefined }
  /** the base is the saved file and the code is that file: nothing to compare (Q1) */
  | { readonly kind: 'nothing-to-check'; readonly line: number | undefined }
  | { readonly kind: 'drifted' }
  | { readonly kind: 'unresolved' };

export type Severity = 'error' | 'warning';

export interface Problem {
  /** 1-based line in the `.sirp` */
  readonly line: number;
  readonly message: string;
  readonly severity: Severity;
  /** the state a whole-patch problem comes from, as the diagnostic's code */
  readonly code?: string;
}

export const DRIFTED_MESSAGE =
  'the code no longer holds what this hunk writes; regenerate the patch';

/**
 * The dot that opens a lens title: does the hunk land? Green, yellow, red — and nothing
 * about whether the patch is in the code, which is one fact about the whole file and is
 * said once, after the patch's header (`feedback/applied.ts`). A white circle for «lands,
 * not applied» read as «unknown» on every hunk of every fresh checkout, where not applied
 * is the normal state.
 *
 * Emoji, and for one reason: a CodeLens carries nothing but `title` and `tooltip`, and the
 * editor paints every lens in the theme's `editorCodeLens.foreground` — one grey for all
 * of them, which no extension can set per lens (API reference, `CodeLens`). An emoji
 * brings its own colour with it.
 *
 * The hunk's own header also gets a coloured mark (`feedback/highlight.ts`), which is the
 * one place a real theme colour can be used.
 */
export const GLYPH = {
  /** placed, not applied yet, or nothing to check: the hunk has its place */
  lands: '🟢',
  drifted: '🟡',
  unresolved: '🔴',
} as const;

export function verdictOf(hunk: HunkLink, texts: Texts): Verdict {
  const memo = memoOf(texts);
  let verdict = memo.verdicts.get(hunk);
  if (verdict === undefined) {
    verdict = judge(hunk, texts, memo);
    memo.verdicts.set(hunk, verdict);
  }
  return verdict;
}

function judge(hunk: HunkLink, texts: Texts, memo: Memo): Verdict {
  if (hunk.status !== 'ok') return { kind: 'unresolved' };

  switch (placementOf(hunk, texts.targetText, texts.baselineText)) {
    case 'matches':
      return { kind: 'placed', line: lineOf(memo.target, hunk.final) };
    case 'unapplied':
      // just saved: the base became the buffer, and the patch's edit is in both
      return {
        kind: isNothingToCheck(texts) ? 'nothing-to-check' : 'unapplied',
        line: lineOf(memo.baseline, hunk.base),
      };
    case 'drifted':
      return { kind: 'drifted' };
  }
}

export function lensTitle(hunk: HunkLink, verdict: Verdict, target: string): string {
  switch (verdict.kind) {
    case 'placed':
    case 'unapplied':
    case 'nothing-to-check':
      // in the code or in the base: where it is, or where it would go
      return `${GLYPH.lands} ${where(target, verdict.line)}${hunk.dependsOnEarlier ? ' · depends on an earlier hunk' : ''}`;
    case 'drifted':
      return `${GLYPH.drifted} differs from the code — regenerate?`;
    case 'unresolved':
      return `${GLYPH.unresolved} ${shortFailure(hunk)}`;
  }
}

export function problemsOf(hunks: readonly HunkLink[], texts: Texts): Problem[] {
  const out: Problem[] = [];
  for (const hunk of hunks) {
    const problem = problemOf(hunk, verdictOf(hunk, texts));
    if (problem !== undefined) out.push(problem);
  }
  return out;
}

/**
 * What Check All can say of a patch no editor holds: the core's answer without the two
 * texts, so the hunks that land nowhere or in too many places — drift needs the code and
 * is left to the editor. Every such hunk is said somewhere: one with no line of its own
 * is said on its first line, or on the header.
 */
export function unresolvedProblems(hunks: readonly HunkLink[]): Problem[] {
  const out: Problem[] = [];
  for (const hunk of hunks) {
    if (hunk.status === 'ok') continue;
    out.push(
      problemOf(hunk, { kind: 'unresolved' }) ?? {
        line: hunk.mdSpan?.[0] ?? 1,
        message: hunk.failure === undefined ? hunk.status : describeFailure(hunk.failure, hunk.status),
        severity: 'error',
      },
    );
  }
  return out;
}

function problemOf(hunk: HunkLink, verdict: Verdict): Problem | undefined {
  const first = hunk.mdSpan?.[0];

  if (verdict.kind === 'drifted') {
    return first === undefined
      ? undefined
      : { line: first, message: DRIFTED_MESSAGE, severity: 'warning' };
  }
  if (verdict.kind !== 'unresolved') return undefined;

  // an ambiguous pattern has no broken step, so it belongs to the hunk as a whole
  const line = hunk.status === 'ambiguous' ? (first ?? failureLine(hunk)) : failureLine(hunk);
  if (line === undefined) return undefined;

  const message =
    hunk.failure === undefined ? hunk.status : describeFailure(hunk.failure, hunk.status);
  return { line, message, severity: 'error' };
}

/** Saved-file base, code equal to it: whether the patch is in the code cannot be told. */
export function isNothingToCheck(texts: Texts): boolean {
  return texts.base?.kind === 'saved' && texts.targetText === texts.baselineText;
}

function shortFailure(hunk: HunkLink): string {
  const failure = hunk.failure;
  if (hunk.status === 'ambiguous') {
    const places = failure?.candidates?.length;
    return places === undefined ? 'ambiguous' : `fits ${places} places`;
  }

  const step = failure?.failedStepIndex;
  const total = failure?.totalSteps;
  if (hunk.status === 'no-match' && step !== undefined) {
    if (total === undefined) return `anchor ${step + 1} not found`;
    if (step >= total) return 'the pattern ended, the code did not';
    return `anchor ${step + 1} of ${total} not found`;
  }
  return failure?.message ?? hunk.status;
}

function where(target: string, line: number | undefined): string {
  return line === undefined ? target : `${target}:${line}`;
}

function lineOf(lines: LineMap, span: Span | undefined): number | undefined {
  if (span === undefined) return undefined;
  return lines.positionOf(trimmed(lines.text, span).start).line + 1;
}
