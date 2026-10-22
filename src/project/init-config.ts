/**
 * What Sir: Init Config does, once the core has said where the config goes and whether
 * one is there (README "Init Config"). Pure, so the refusal in an untrusted workspace —
 * which the end-to-end suite cannot reach: it runs with workspace trust off — is tested.
 */
export type InitConfigAction =
  /** an untrusted workspace has no config written into it, nor one opened for it */
  | 'refuse'
  /** a config is there already: it is opened, never rewritten */
  | 'open'
  | 'write';

export function initConfigAction(trusted: boolean, exists: boolean): InitConfigAction {
  if (!trusted) return 'refuse';
  return exists ? 'open' : 'write';
}
