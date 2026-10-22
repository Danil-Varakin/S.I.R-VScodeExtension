import * as vscode from 'vscode';
import type { FocusMark } from '../navigation/focus.ts';

/** One half of the diff and how the chosen hunk is marked in it. */
export interface FocusSide {
  readonly uri: vscode.Uri;
  readonly mark: FocusMark;
  readonly label: string;
}

const FILL = new vscode.ThemeColor('sir.selectedHunkBackground');
const LINE = new vscode.ThemeColor('sir.selectedHunkForeground');

/**
 * The hunk chosen by Go to What the Hunk Replaces, marked in «base ↔ base + patch» (B10):
 * its lines filled and framed, a label after the first, a mark on the scrollbar; on a side
 * where the hunk covers nothing, a line between two lines. A selection would do none of
 * it — it is thin on the diff's own colours and gone at the first click.
 *
 * The mark stays while that diff is open and its two texts are the ones it was measured
 * in: an editor that comes back on screen is painted again, an edit of the patch or a
 * moved base clears it, and so does the next diff.
 */
export class HunkFocus implements vscode.Disposable {
  private readonly fill = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: FILL,
    overviewRulerColor: LINE,
    overviewRulerLane: vscode.OverviewRulerLane.Center,
  });
  // a frame of whole lines: its top on the first line, its bottom on the last
  private readonly top = edge('2px 0 0 0');
  private readonly bottom = edge('0 0 2px 0');
  private readonly point = vscode.window.createTextEditorDecorationType({
    before: { contentText: '▸', color: LINE, fontWeight: 'bold' },
    overviewRulerColor: LINE,
    overviewRulerLane: vscode.OverviewRulerLane.Center,
  });
  private readonly label = vscode.window.createTextEditorDecorationType({});
  private readonly types = [this.fill, this.top, this.bottom, this.point, this.label];

  private diff: { readonly original: string; readonly modified: string } | undefined;
  private sides: readonly FocusSide[] = [];
  private readonly subscriptions: readonly vscode.Disposable[];

  constructor() {
    this.subscriptions = [
      vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach((e) => this.paint(e))),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.sideOf(e.document.uri) !== undefined) this.clear();
      }),
      vscode.window.tabGroups.onDidChangeTabs(() => {
        if (this.diff !== undefined && !this.diffOpen()) this.clear();
      }),
    ];
  }

  /** Marks `sides` in the diff of `original` and `modified`; whatever was marked before is cleared. */
  show(original: vscode.Uri, modified: vscode.Uri, sides: readonly FocusSide[]): void {
    this.clear();
    this.diff = { original: original.toString(), modified: modified.toString() };
    this.sides = sides;
    for (const editor of vscode.window.visibleTextEditors) this.paint(editor);
  }

  /** What is marked now, while its diff is open: each side's document, kind of mark and label. */
  marked(): readonly { readonly uri: string; readonly kind: FocusMark['kind']; readonly label: string }[] {
    if (!this.diffOpen()) return [];
    return this.sides.map((s) => ({ uri: s.uri.toString(), kind: s.mark.kind, label: s.label }));
  }

  clear(): void {
    const was = this.sides;
    this.diff = undefined;
    this.sides = [];
    for (const editor of vscode.window.visibleTextEditors) {
      const key = editor.document.uri.toString();
      if (was.some((s) => s.uri.toString() === key)) for (const type of this.types) editor.setDecorations(type, []);
    }
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    for (const type of this.types) type.dispose();
  }

  private paint(editor: vscode.TextEditor): void {
    const side = this.sideOf(editor.document.uri);
    if (side === undefined || !this.diffOpen()) return;
    const { mark } = side;
    const document = editor.document;
    const line = (n: number): vscode.Range => document.lineAt(Math.min(Math.max(0, n), document.lineCount - 1)).range;

    const sets = new Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]>(this.types.map((t) => [t, []]));
    let labelLine: number;
    switch (mark.kind) {
      case 'block': {
        sets.get(this.fill)!.push({ range: new vscode.Range(line(mark.first).start, line(mark.last).end) });
        sets.get(this.top)!.push({ range: line(mark.first) });
        sets.get(this.bottom)!.push({ range: line(mark.last) });
        labelLine = mark.first;
        break;
      }
      case 'gap': {
        sets.get(mark.edge === 'above' ? this.top : this.bottom)!.push({ range: line(mark.line) });
        labelLine = mark.line;
        break;
      }
      case 'point': {
        const at = new vscode.Position(mark.cursor.line, mark.cursor.character);
        sets.get(this.point)!.push({ range: new vscode.Range(at, at) });
        labelLine = mark.cursor.line;
        break;
      }
    }
    const end = line(labelLine).end;
    sets.get(this.label)!.push({
      range: new vscode.Range(end, end),
      renderOptions: {
        after: {
          // the no-break spaces pad the text inside its background; `margin` keeps it off the code
          contentText: ` ${side.label} `,
          color: new vscode.ThemeColor('editor.background'),
          backgroundColor: LINE,
          margin: '0 0 0 2em',
        },
      },
    });
    for (const [type, ranges] of sets) editor.setDecorations(type, ranges);
  }

  private sideOf(uri: vscode.Uri): FocusSide | undefined {
    const key = uri.toString();
    return this.sides.find((s) => s.uri.toString() === key);
  }

  /** Whether the diff the mark was made for is still among the tabs. */
  private diffOpen(): boolean {
    const diff = this.diff;
    if (diff === undefined) return false;
    return vscode.window.tabGroups.all.some((group) =>
      group.tabs.some(
        (tab) =>
          tab.input instanceof vscode.TabInputTextDiff &&
          tab.input.original.toString() === diff.original &&
          tab.input.modified.toString() === diff.modified,
      ),
    );
  }
}

function edge(borderWidth: string): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    borderStyle: 'solid',
    borderColor: LINE,
    borderWidth,
    overviewRulerColor: LINE,
    overviewRulerLane: vscode.OverviewRulerLane.Center,
  });
}
