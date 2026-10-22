import * as vscode from 'vscode';
import { COMMANDS } from '../commands/ids.ts';
import type { Base } from '../commands/generate.ts';
import type { Draft } from '../feedback/draft.ts';
import { describeChange } from '../feedback/draft.ts';
import { PATCH_LANGUAGE } from '../patch-files.ts';

/** What a draft belongs to: the file of code and the base of the run that gave up. */
export interface DraftRun {
  readonly code: vscode.Uri;
  readonly base: Base;
}

interface Entry extends DraftRun {
  readonly draft: Draft;
}

/**
 * The drafts of Write by Hand (N4): unsaved `.sirp` buffers, each tied to the run that
 * gave up — the code and its base, for Continue Generate to send them again with the
 * draft as `keep`. A lens over the header continues; a hunk of the draft that does not
 * stand is marked on its line. Closing the buffer drops the draft.
 */
export class PatchDrafts implements vscode.Disposable, vscode.CodeLensProvider {
  private readonly entries = new Map<string, Entry>();
  private readonly problems = vscode.languages.createDiagnosticCollection('sir-draft');
  private readonly changes = new vscode.EventEmitter<void>();
  private readonly subscriptions: readonly vscode.Disposable[];
  readonly onDidChangeCodeLenses: vscode.Event<void> = this.changes.event;

  constructor() {
    this.subscriptions = [
      vscode.languages.registerCodeLensProvider({ language: PATCH_LANGUAGE, scheme: 'untitled' }, this),
      vscode.workspace.onDidCloseTextDocument((document) => this.forget(document.uri)),
      this.problems,
      this.changes,
    ];
  }

  /** The run a draft belongs to, or undefined for any other buffer. */
  runOf(document: vscode.TextDocument): DraftRun | undefined {
    return this.entries.get(document.uri.toString());
  }

  /**
   * Opens a draft beside the code, the cursor on its starting hunk. `place` is where the
   * patch goes when nothing is there yet: the draft is then bound to it, as New Sir
   * Patch does; over an existing patch it is a plain buffer, and Continue Generate asks
   * before writing over that patch.
   */
  async open(draft: Draft, run: DraftRun, place: vscode.Uri | undefined): Promise<vscode.TextDocument> {
    const bound = place?.with({ scheme: 'untitled' });
    const started = bound === undefined ? undefined : vscode.workspace.textDocuments.find((d) => d.uri.toString() === bound.toString());
    const document =
      started ??
      (bound !== undefined
        ? await vscode.workspace.openTextDocument(bound)
        : await vscode.workspace.openTextDocument({ language: PATCH_LANGUAGE, content: '' }));
    if (document.languageId !== PATCH_LANGUAGE) await vscode.languages.setTextDocumentLanguage(document, PATCH_LANGUAGE);
    await this.fill(document, draft, run, vscode.ViewColumn.Beside);
    return document;
  }

  /** The next round: the core gave up on another change, and its draft holds the hunks so far. */
  async replace(document: vscode.TextDocument, draft: Draft, run: DraftRun): Promise<void> {
    await this.fill(document, draft, run, vscode.ViewColumn.Active);
  }

  /** A hunk of the draft that does not stand, marked on its line until the next run. */
  async problem(document: vscode.TextDocument, line: number, message: string): Promise<void> {
    const at = Math.min(Math.max(0, line - 1), document.lineCount - 1);
    const range = document.lineAt(at).range;
    const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
    diagnostic.source = 'sir';
    this.problems.set(document.uri, [diagnostic]);
    await vscode.window.showTextDocument(document, { preview: false, selection: new vscode.Range(range.start, range.start) });
  }

  clearProblems(document: vscode.TextDocument): void {
    this.problems.delete(document.uri);
  }

  /** The draft is done with: the patch is written. Closed without asking to save it. */
  async close(document: vscode.TextDocument): Promise<void> {
    this.forget(document.uri);
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const entry = this.entries.get(document.uri.toString());
    if (entry === undefined) return [];
    const top = new vscode.Range(0, 0, 0, 0);
    const lenses = [
      new vscode.CodeLens(top, { title: '▶ Continue Generate', command: COMMANDS.continueGenerate, arguments: [document.uri] }),
    ];
    const change = entry.draft.change;
    if (change !== undefined) {
      const at = new vscode.Position(Math.max(0, change.line - 1), 0);
      lenses.push(
        new vscode.CodeLens(top, {
          title: 'Show the Change',
          tooltip: describeChange(change),
          command: 'vscode.open',
          arguments: [entry.code, { selection: new vscode.Range(at, at), preview: false }],
        }),
      );
    }
    return lenses;
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.entries.clear();
  }

  private async fill(document: vscode.TextDocument, draft: Draft, run: DraftRun, column: vscode.ViewColumn): Promise<void> {
    const editor = await vscode.window.showTextDocument(document, { viewColumn: column, preview: false });
    const whole = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    if (!(await editor.edit((edit) => edit.replace(whole, draft.text)))) throw new Error('the editor refused the draft');
    this.entries.set(document.uri.toString(), { ...run, draft });
    this.problems.delete(document.uri);
    this.changes.fire();
    const at = new vscode.Position(Math.min(Math.max(0, draft.line - 1), document.lineCount - 1), 0);
    editor.selection = new vscode.Selection(at, at);
    editor.revealRange(new vscode.Range(at, at), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private forget(uri: vscode.Uri): void {
    if (this.entries.delete(uri.toString())) this.changes.fire();
    this.problems.delete(uri);
  }
}
