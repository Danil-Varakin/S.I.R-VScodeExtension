import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { GenerateParamsV5, GenerateResult, GitSourceParams } from '../service/protocol.ts';
import { ERROR_KIND, originKind } from '../service/protocol.ts';
import type { SirDeps } from '../deps.ts';
import type { Log } from '../ui/log.ts';
import { ACTIONS, COMMANDS } from './ids.ts';
import { SirServiceError, RequestCancelledError, UnsupportedDocumentError, errorMessage } from '../errors.ts';
import { activeFile } from '../active-file.ts';
import { NoBaselineError, savedBaseline } from '../baseline/saved.ts';
import { reveal } from '../ui/reveal.ts';
import { choose, offer, offerLog } from '../ui/notify.ts';
import { describeBase, effectiveBase } from '../project/base.ts';
import { chosenEolOf } from '../project/project.ts';
import { fileExists, readLiveText, replaceText } from '../workspace-fs.ts';
import { overridesFrom } from '../settings.ts';
import { clock } from '../duration.ts';
import { notedHunks } from '../feedback/notes.ts';
import type { Destination, Place } from '../feedback/destination.ts';
import { destinationOf, questionFor } from '../feedback/destination.ts';
import { isSupportedFile, unsupportedMessage } from '../project/languages.ts';
import { PATCH_LANGUAGE } from '../patch-files.ts';
import { keyLabel } from '../keys.ts';
import { draftOf, keepProblemOf } from '../feedback/draft.ts';
import type { Draft } from '../feedback/draft.ts';
import { describePairReason } from '../feedback/pair-reason.ts';

type GenerateDeps = Pick<SirDeps, 'service' | 'project' | 'cache' | 'log' | 'drafts'>;

type Source =
  | { readonly kind: 'ok'; readonly document: vscode.TextDocument }
  | { readonly kind: 'none' }
  | { readonly kind: 'unsupported'; readonly scheme: string };

/** The OLD version of one run: text we hold, or a revision the core reads out of git. */
export type Base =
  | { readonly kind: 'text'; readonly text: string; readonly unchanged: string }
  | { readonly kind: 'git'; readonly git: GitSourceParams };

/** The buffer against the base the project names — a git revision, or the saved file. */
export function generatePatch(deps: GenerateDeps, target?: vscode.Uri): Promise<void> {
  return generate(deps, target, projectBase);
}

/**
 * The buffer against a file picked for this one run — the CLI's `--in-old`. The pick is
 * never remembered: the next run, and navigation, go back to the saved file.
 */
export function generateAgainstFile(deps: GenerateDeps, target?: vscode.Uri): Promise<void> {
  return generate(deps, target, pickedBase);
}

/**
 * The base the core names for this file — `sir.base.*` over `generate.base` — or, with
 * none named, the file as saved on disk. The saved file is read here and sent as text; a
 * git base is only named, and the core reads it.
 */
async function projectBase(document: vscode.TextDocument, { project, log }: GenerateDeps): Promise<Base> {
  const config = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'S.I.R: reading the project config' },
    () => project.config(document.uri),
  );
  const base = effectiveBase(config, chosenEolOf(document.uri));
  log.info(`base for ${document.uri.fsPath}: ${describeBase(base)}`);
  switch (base.kind) {
    case 'unavailable':
      throw new NoBaselineError(document.uri.fsPath, base.reason, base.gitReason);
    case 'git':
      log.info(`  eol ${base.git.eol ?? 'repository'}`);
      return { kind: 'git', git: base.git };
    case 'saved':
      return {
        kind: 'text',
        text: await savedBaseline(document.uri),
        unchanged: `sir: ${basename(document.uri.fsPath)} has no unsaved changes`,
      };
  }
}

async function pickedBase(document: vscode.TextDocument, { log }: GenerateDeps): Promise<Base | undefined> {
  const name = basename(document.uri.fsPath);
  const picked = await vscode.window.showOpenDialog({
    title: `Old version of ${name}`,
    openLabel: 'Compare Against',
    canSelectMany: false,
    defaultUri: document.uri,
  });
  const old = picked?.[0];
  if (old === undefined) return undefined;
  if (old.fsPath === document.uri.fsPath) {
    throw new Error('the old file cannot be the edited file itself — Generate Patch compares it with what is saved');
  }
  log.info(`base for ${document.uri.fsPath}: ${old.fsPath}, this run only`);
  return {
    kind: 'text',
    // as the editor has it, when it is open with edits of its own
    text: await readLiveText(old),
    unchanged: `sir: ${name} matches ${basename(old.fsPath)}, nothing to patch`,
  };
}

/**
 * Continue Generate (N4): the run that gave up, again — the same code, the same base —
 * with the draft finished by hand as `keep`. Its hunks are settled; synthesis goes on
 * from them. All of it standing, the patch is written as by Generate Patch and the draft
 * closed; another change it cannot anchor, and the draft is the next one.
 */
export async function continueGenerate(deps: GenerateDeps, target?: vscode.Uri): Promise<void> {
  const draft =
    target === undefined
      ? vscode.window.activeTextEditor?.document
      : vscode.workspace.textDocuments.find((d) => d.uri.toString() === target.toString());
  const run = draft === undefined ? undefined : deps.drafts.runOf(draft);
  if (draft === undefined || run === undefined) {
    void vscode.window.showErrorMessage('sir: Continue Generate goes on from a draft of Write by Hand — this is not one');
    return;
  }
  deps.drafts.clearProblems(draft);
  await generate(deps, run.code, () => Promise.resolve(run.base), draft);
}

async function generate(
  deps: GenerateDeps,
  target: vscode.Uri | undefined,
  baseOf: (document: vscode.TextDocument, deps: GenerateDeps) => Promise<Base | undefined>,
  /** Continue Generate: the draft whose text goes as `keep` */
  draft?: vscode.TextDocument,
): Promise<void> {
  const { service, log } = deps;
  let document: vscode.TextDocument | undefined;
  let base: Base | undefined;
  try {
    const source = await sourceOf(target);
    if (source.kind === 'none') {
      void vscode.window.showErrorMessage('sir: no active editor');
      return;
    }
    if (source.kind === 'unsupported') throw new UnsupportedDocumentError(source.scheme);
    document = source.document;

    if (document.languageId === PATCH_LANGUAGE) {
      void vscode.window.showErrorMessage(
        `sir: ${basename(document.uri.fsPath)} is a patch — generate from the file of code it patches (${keyLabel('toggle')} goes there)`,
      );
      return;
    }
    const refusal = await unsupported(document, deps);
    if (refusal !== undefined) {
      void vscode.window.showErrorMessage(`sir: ${refusal}`);
      return;
    }

    base = await baseOf(document, deps);
    if (base === undefined) return;

    const newText = document.getText();
    if (base.kind === 'text' && base.text === newText) {
      void vscode.window.showInformationMessage(base.unchanged);
      return;
    }

    const result = await synthesize(service, document, base, newText, log, draft?.getText());
    if (result === undefined) return;
    const destination = await deliver(result, document, deps);
    // only once its hunks are in the patch: kept by Open Existing, the hand work stays open
    if (draft !== undefined && destination === 'write') await deps.drafts.close(draft);
  } catch (e) {
    if (document !== undefined && base !== undefined && (await handedToDraft(e, document, base, draft, deps))) return;
    await report(e, document, log);
  }
}

/**
 * What a run that gave up hands to a draft (N4), when the core gives one: a change it
 * cannot anchor offers Write by Hand — or, in Continue Generate, becomes the next draft —
 * and a hunk of the draft that does not stand is marked on its line. False: not ours,
 * reported as any other failure.
 */
async function handedToDraft(
  e: unknown,
  document: vscode.TextDocument,
  base: Base,
  draft: vscode.TextDocument | undefined,
  deps: GenerateDeps,
): Promise<boolean> {
  if (!(e instanceof SirServiceError)) return false;
  const { log, drafts, service } = deps;
  const run = { code: document.uri, base };
  const next = e.kind === ERROR_KIND.synthesis ? draftOf(e.detail, (await service.ensureCompatible()).protocol) : undefined;

  if (next !== undefined && draft !== undefined) {
    log.info(`${e.message} — the next draft`);
    await drafts.replace(draft, next, run);
    void vscode.window.showWarningMessage(`sir: ${e.message} — write this hunk by hand too, then Continue Generate`);
    return true;
  }
  if (next !== undefined) {
    log.error(e.message);
    const choice = await choose('error', `sir: ${e.message}`, [ACTIONS.writeByHand, ACTIONS.showLine]);
    if (choice === ACTIONS.writeByHand) await writeByHand(next, run, deps);
    else if (choice === ACTIONS.showLine && e.newLine !== undefined) await showLine(document, e.newLine);
    return true;
  }
  const problem = draft === undefined ? undefined : keepProblemOf(e.detail);
  if (draft !== undefined && problem !== undefined) {
    log.error(e.message);
    await drafts.problem(draft, problem.line, e.message);
    void vscode.window.showErrorMessage(`sir: ${e.message}`);
    return true;
  }
  return false;
}

/** Opens the draft at the place of the file's patch — bound to it when nothing is there yet. */
async function writeByHand(draft: Draft, run: { code: vscode.Uri; base: Base }, { project, drafts, log }: GenerateDeps): Promise<void> {
  const pair = await project.pair(run.code);
  if (pair.kind !== 'code' || pair.patchPath === null) {
    void vscode.window.showErrorMessage(`sir: ${describePairReason(pair.reason)}`);
    return;
  }
  const place = vscode.Uri.file(pair.patchPath);
  const exists = await fileExists(place);
  await drafts.open(draft, run, exists ? undefined : place);
  log.info(`draft for ${run.code.fsPath}: hunk ${draft.hunk} to write by hand${exists ? `, over ${place.fsPath}` : ''}`);
}

/**
 * A file the core has no grammar for is refused here, before it is sent (D3) — unless a
 * language is named for it, by the settings or the config, which the core then takes.
 */
async function unsupported(document: vscode.TextDocument, { service, project }: GenerateDeps): Promise<string | undefined> {
  const { sir, languages } = await service.version();
  const path = document.uri.fsPath;
  if (isSupportedFile(path, languages)) return undefined;
  const named =
    overridesFrom(vscode.workspace.getConfiguration('sir', document.uri), vscode.workspace.isTrusted).language ??
    (await project.config(document.uri)).settings.language;
  return named === null || named === undefined ? unsupportedMessage(path, sir, languages) : undefined;
}

async function sourceOf(target: vscode.Uri | undefined): Promise<Source> {
  if (target === undefined) return activeFile();
  if (target.scheme !== 'file') return { kind: 'unsupported', scheme: target.scheme };
  return { kind: 'ok', document: await vscode.workspace.openTextDocument(target) };
}

async function synthesize(
  service: SirDeps['service'],
  document: vscode.TextDocument,
  base: Base,
  newText: string,
  log: Log,
  keep?: string,
): Promise<GenerateResult | undefined> {
  const params: GenerateParamsV5 = {
    ...(base.kind === 'text' ? { baseText: base.text } : { baseGit: base.git }),
    newText,
    path: document.uri.fsPath,
    ...(keep !== undefined ? { keep } : {}),
    ...overridesFrom(vscode.workspace.getConfiguration('sir', document.uri), vscode.workspace.isTrusted),
  };

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `S.I.R: generating patch for ${basename(document.uri.fsPath)}`,
      cancellable: true,
    },
    async (progress, token) => {
      // the clock ticks on its own: one long step of synthesis sends no progress for minutes
      const started = Date.now();
      let segment = '';
      const show = (): void => {
        const elapsed = clock(Date.now() - started);
        progress.report({ message: segment === '' ? elapsed : `${segment} · ${elapsed}` });
      };
      const ticking = setInterval(show, 1_000);
      try {
        return await service.request('generate', params, {
          token,
          onProgress: (done, total) => {
            segment = `segment ${done}/${total}`;
            show();
          },
        });
      } catch (e) {
        if (e instanceof RequestCancelledError || token.isCancellationRequested) {
          log.info('generate cancelled');
          return undefined;
        }
        if (e instanceof SirServiceError && e.kind === ERROR_KIND.noChanges) {
          // not a failure: the buffer is its base, as the language reads it
          const against = e.detail?.['baseSpec'];
          const name = basename(document.uri.fsPath);
          log.info(e.message);
          void vscode.window.showInformationMessage(
            typeof against === 'string'
              ? `sir: ${name} matches ${against}, nothing to patch`
              : `sir: ${name} matches its base, nothing to patch`,
          );
          return undefined;
        }
        throw e;
      } finally {
        clearInterval(ticking);
      }
    },
  );
}

async function deliver(result: GenerateResult, document: vscode.TextDocument, deps: GenerateDeps): Promise<Destination> {
  const { log } = deps;
  log.info(describeConfig(result.config));
  for (const warning of result.warnings) log.info(`warning: ${warning}`);

  if (result.outPath === null) throw new Error('the core reported no place for this patch');
  const patchUri = vscode.Uri.file(result.outPath);

  const destination = await chooseDestination(patchUri, result, document, deps);
  if (destination === 'abandon') return destination;
  if (destination === 'open-existing') {
    await openBeside(patchUri);
    return destination;
  }

  await writePatch(patchUri, result, log);
  await openBeside(patchUri);
  await reportOutcome(result, document, patchUri, log);
  return destination;
}

/** Asks what `feedback/destination.ts` decided to ask, and reports the answer. */
async function chooseDestination(
  patchUri: vscode.Uri,
  result: GenerateResult,
  document: vscode.TextDocument,
  { project, cache }: GenerateDeps,
): Promise<Destination> {
  const question = questionFor(await placeOf(patchUri, result, document, { project, cache }));
  if (question === undefined) return 'write';
  const choice = await vscode.window.showWarningMessage(
    question.title,
    { modal: true, ...(question.detail !== undefined ? { detail: question.detail } : {}) },
    ...question.buttons,
  );
  return destinationOf(choice);
}

/**
 * The facts the decision is made from. Only what is in the way is asked of the core: a
 * place with nothing at it needs neither this file's `Target` nor the notes of a patch
 * that is not there.
 */
async function placeOf(
  patchUri: vscode.Uri,
  result: GenerateResult,
  document: vscode.TextDocument,
  { project, cache }: Pick<GenerateDeps, 'project' | 'cache'>,
): Promise<Place> {
  // where a patch goes is the project config's to say — and in a workspace nobody has
  // trusted, that config may have come with somebody else's repository. Inside the
  // workspace it can only reach the workspace's own files; anywhere else it is asked.
  const allowed = vscode.workspace.isTrusted || vscode.workspace.getWorkspaceFolder(patchUri) !== undefined;
  const bare = {
    patchPath: patchUri.fsPath,
    codeName: basename(document.uri.fsPath),
    exists: result.outExists,
    outTarget: result.outTarget,
    allowed,
  };
  if (!allowed || !result.outExists) return { ...bare, ownTarget: null, notes: null };

  const existing = await cache.get(patchUri);
  return {
    ...bare,
    ownTarget: (await project.config(document.uri)).target,
    notes: existing.kind === 'ready' ? notedHunks(existing.index.hunks) : null,
  };
}

async function writePatch(patchUri: vscode.Uri, result: GenerateResult, log: Log): Promise<void> {
  // the core opens the .sirp with its header — Target among it — itself
  await replaceText(patchUri, result.patch);
  log.info(`wrote ${patchUri.fsPath}: ${result.hunks.length} hunk(s), language ${result.language ?? 'none'}`);
}

async function reportOutcome(
  result: GenerateResult,
  document: vscode.TextDocument,
  patchUri: vscode.Uri,
  log: Log,
): Promise<void> {
  if (!result.reproducesNew) {
    // what the patch does make of the base is the useful part, not the log
    const message = `sir: the patch does not reproduce ${basename(document.uri.fsPath)} exactly`;
    log.warn(message);
    if (await offer('warning', message, ACTIONS.previewResult)) {
      await vscode.commands.executeCommand(COMMANDS.previewPatch, patchUri);
    }
    return;
  }
  if (result.warnings.length > 0) {
    await offerLog(
      `sir: generated ${result.hunks.length} hunk(s) with ${result.warnings.length} warning(s)`,
      log,
      'warning',
    );
  }
}

/** Which settings the config file set, and which the editor settings overrode. */
function describeConfig(config: GenerateResult['config']): string {
  const keys = (kind: 'config' | 'flag'): string[] =>
    Object.entries(config.origins)
      .filter(([, origin]) => originKind(origin) === kind)
      .map(([key]) => key);

  const overridden = keys('flag');
  const tail = overridden.length > 0 ? `; overridden by editor settings: ${overridden.join(', ')}` : '';

  if (config.file === null) {
    return `config: none, built-in defaults${tail === '' ? ' only' : ''}${tail}`;
  }
  const applied = keys('config');
  const list = applied.length > 0 ? applied.join(', ') : 'nothing';
  return `config: ${config.file} applied ${list}${tail}`;
}

async function openBeside(uri: vscode.Uri): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  // beside the code the first time; back into its own tab on every regeneration after
  await reveal(document, vscode.ViewColumn.Beside);
}

async function report(e: unknown, document: vscode.TextDocument | undefined, log: Log): Promise<void> {
  const message = errorMessage(e);
  log.error(message);

  if (e instanceof NoBaselineError) {
    // the same buffer, against a file picked by hand
    if (await offer('error', `sir: ${message}`, ACTIONS.generateAgainstFile)) {
      await vscode.commands.executeCommand(COMMANDS.generateAgainstFile, document?.uri);
    }
    return;
  }

  const line = e instanceof SirServiceError && e.kind === ERROR_KIND.synthesis ? e.newLine : undefined;
  if (line !== undefined && document !== undefined) {
    // the change no pattern anchors: where it is in the buffer is the useful part
    if (await offer('error', `sir: ${message}`, ACTIONS.showLine)) await showLine(document, line);
    return;
  }

  await offerLog(`sir: ${message}`, log);
}

async function showLine(document: vscode.TextDocument, line: number): Promise<void> {
  const at = new vscode.Position(Math.min(Math.max(0, line - 1), document.lineCount - 1), 0);
  await reveal(document, vscode.ViewColumn.Active, new vscode.Range(at, at));
}
