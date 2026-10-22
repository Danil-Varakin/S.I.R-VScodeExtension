import type { BaselineDocuments } from './baseline/documents.ts';
import type { PatchIndexCache } from './navigation/patch-index.ts';
import type { PatchResults } from './navigation/results.ts';
import type { Project } from './project/project.ts';
import type { SirService } from './service/client.ts';
import type { Log } from './ui/log.ts';
import type { PatchDrafts } from './ui/drafts.ts';
import type { HunkFocus } from './ui/hunk-focus.ts';

/** What the commands work with, made once in `activate`. */
export interface SirDeps {
  readonly service: SirService;
  readonly project: Project;
  readonly cache: PatchIndexCache;
  readonly baselines: BaselineDocuments;
  /** base + patch, by the core: the right half of Preview Patch */
  readonly results: PatchResults;
  /** the hunk marked in that diff by Go to What the Hunk Replaces (B10) */
  readonly focus: HunkFocus;
  readonly log: Log;
  /** the drafts of Write by Hand (N4) */
  readonly drafts: PatchDrafts;
}
