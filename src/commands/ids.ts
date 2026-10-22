/**
 * The command ids, in one place. They are also spelled out in `package.json`, and
 * that is one copy too many already: a third and fourth scattered through the code
 * would drift the moment a command is renamed, and a wrong id fails silently as a
 * command that simply does nothing.
 */
export const COMMANDS = {
  generate: 'sir.generate',
  generateAgainstFile: 'sir.generateAgainstFile',
  showBase: 'sir.showBase',
  toggle: 'sir.toggle',
  goToBaseline: 'sir.goToBaseline',
  showLog: 'sir.showLog',
  previewPatch: 'sir.previewPatch',
  showEditsNotInPatch: 'sir.showEditsNotInPatch',
  checkAll: 'sir.checkAll',
  copyReport: 'sir.copyReport',
  openFailed: 'sir.openFailed',
  repair: 'sir.repair',
  apply: 'sir.apply',
  applyAll: 'sir.applyAll',
  initConfig: 'sir.initConfig',
  newPatch: 'sir.newPatch',
  continueGenerate: 'sir.continueGenerate',
} as const;

/** The labels offered on notifications, shared by every command that offers them. */
export const ACTIONS = {
  generate: 'Generate Patch',
  generateAgainstFile: 'Pick Old File',
  showLog: 'Show Log',
  showLine: 'Show the Line',
  writeByHand: 'Write by Hand',
  showInBaseline: 'Show How Far It Got',
  deletePatch: 'Delete Patch…',
  showBase: 'Show Base',
  previewResult: 'Preview Result',
  previewPatch: 'Preview Patch',
  apply: 'Apply Patch',
  overwrite: 'Overwrite',
  showEditsNotInPatch: 'Show Edits Not in Patch',
  save: 'Save',
  showSkipped: 'Show Skipped',
} as const;
