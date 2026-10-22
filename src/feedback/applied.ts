import type { HunkLink } from '../service/protocol.ts';
import type { Texts } from './verdict.ts';
import { isNothingToCheck, verdictOf } from './verdict.ts';

// Is the patch in the code? One fact about the whole file — said once, after the patch's
// header and on the patch's name in the Explorer and its tab — while the dot of every hunk
// says only whether that hunk lands. Read off the verdicts the lenses already have: no
// `apply`, so it costs the core nothing, and Check All can say it of a closed patch from
// its `resolve` alone.

export type PatchState =
  /** the code holds what every hunk that lands writes */
  | 'applied'
  /** the code is its base: the patch is not in it — every fresh checkout of upstream */
  | 'not-applied'
  /** the code no longer holds what some hunk writes */
  | 'changed'
  /** the base is the saved file and the code is that file: it cannot be told (Q1) */
  | 'nothing-to-check';

/** Undefined when the code moved on and no hunk lands: nothing to say it of, and Problems says why. */
export function patchStateOf(hunks: readonly HunkLink[], texts: Texts): PatchState | undefined {
  // a fact about the whole file, whatever the hunks say: with the saved file as base, the
  // file just saved IS the base, and the patch's anchors are often not found in it at all
  if (texts.targetText === texts.baselineText) return isNothingToCheck(texts) ? 'nothing-to-check' : 'not-applied';
  let placed = false;
  for (const hunk of hunks) {
    switch (verdictOf(hunk, texts).kind) {
      case 'drifted':
        return 'changed';
      case 'placed':
        placed = true;
        break;
      default:
        break;
    }
  }
  return placed ? 'applied' : undefined;
}

export interface PatchStateView {
  /** after the header line */
  readonly label: string;
  /** the label's hover and the Explorer's tooltip */
  readonly hover: string;
  /** on the patch's name in the Explorer and its tab; one or two characters, the editor's
   *  limit. Not git's letters: a `.sirp` is in git too, and `M` beside `M` says nothing. */
  readonly badge: string | undefined;
}

export const PATCH_STATE_VIEW: Readonly<Record<PatchState, PatchStateView>> = {
  applied: {
    label: '✓ applied',
    hover: 'The patch is in the code: the code holds what every hunk writes.',
    badge: '✓',
  },
  'not-applied': {
    label: '○ not applied — the code is its base',
    hover:
      'The code is still its base: the patch is not in it. That is how every fresh checkout of upstream reads; the dot of each hunk says whether it would land.',
    badge: '○',
  },
  changed: {
    label: '⚠ the code changed since the patch',
    hover:
      'The code no longer holds what some hunks write (the yellow dots): generate the patch again to keep the edits, or the next build from the patch drops them.',
    badge: '≠',
  },
  'nothing-to-check': {
    label: '◌ nothing to check — the base is the saved file',
    hover:
      'The base is the saved file and the code has no unsaved edits: whether the patch is in it cannot be told. Name a git base (generate.base) for patches that live in the repository.',
    badge: undefined,
  },
};
