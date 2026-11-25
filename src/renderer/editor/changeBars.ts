// Änderungsbalken im Editor (Ticket 17): blau geändert, grün neu, grauer Keil für gelöschte Zeilen, gegenüber dem
// letzten Commit. Die Blöcke rechnet der Git-Dienst (ohne Git-Aufruf je Anfrage); die Oberfläche fragt beim Tippen
// entprellt nach. Ein Klick auf einen Balken meldet den Block (die Oberfläche zeigt den alten Stand und „Rollback
// Lines“). Keine Balken für nicht versionierte Dateien (der Kern liefert keine) und für Tabs ab 5 MB.

import type { ChangeBlock, CodiumApi, TextEncoding } from '../../shared/types';
import { monaco } from './monaco';

const DELAY_MS = 250;

/** Stapelreihenfolge der Änderungen im Streifen am rechten Rand (Ticket 28). */
const GIT_OVERVIEW_Z_INDEX = 5;

export class ChangeBars {
  private decorations: monaco.editor.IEditorDecorationsCollection;
  private blocks: ChangeBlock[] = [];
  /** Stand des Modells, zu dem `blocks` gehören. */
  private blocksVersion = -1;
  private timer: number | null = null;
  private generation = 0;
  private readonly disposables: monaco.IDisposable[] = [];

  constructor(
    private readonly api: CodiumApi,
    private readonly editor: monaco.editor.ICodeEditor,
    /** Pfad der Datei im Editor, wenn sie Balken bekommt (Datei-Tab mit Text, nicht ab 5 MB); sonst `null`. */
    private readonly pathOf: (model: monaco.editor.ITextModel) => { path: string; encoding: TextEncoding } | null,
    private readonly onClick: (block: ChangeBlock, position: { x: number; y: number }) => void,
  ) {
    this.decorations = editor.createDecorationsCollection();
    this.disposables.push(
      editor.onDidChangeModel(() => this.refreshNow()),
      editor.onDidChangeModelContent(() => this.schedule()),
      editor.onMouseDown((e) => {
        if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS) return;
        const line = e.target.position?.lineNumber;
        if (line === undefined) return;
        // Nach einer Eingabe, deren Blöcke noch nicht da sind, stimmen die Zeilen nicht mehr: erst neu holen (Review).
        if (this.editor.getModel()?.getVersionId() !== this.blocksVersion) {
          this.refreshNow();
          return;
        }
        const block = this.blockAt(line);
        if (!block) return;
        e.event.preventDefault();
        onClick(block, { x: e.event.posx, y: e.event.posy });
      }),
    );
  }

  /** Blöcke neu holen (etwa nach einem Commit oder einem Wechsel des Branches). */
  refreshNow(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    void this.update();
  }

  dispose(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
    this.decorations.clear();
  }

  /** Der Block an einer Zeile; gelöschte Blöcke an der Zeile davor oder danach. */
  blockAt(line: number): ChangeBlock | undefined {
    return this.blocks.find((b) => (b.kind === 'deleted' ? line === b.line || line === b.line - 1 : line >= b.line && line < b.line + b.count));
  }

  private schedule(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.update();
    }, DELAY_MS);
  }

  private async update(): Promise<void> {
    const model = this.editor.getModel();
    const gen = ++this.generation;
    const file = model ? this.pathOf(model) : null;
    if (!model || file === null) {
      this.blocks = [];
      this.decorations.clear();
      return;
    }
    const version = model.getVersionId();
    const blocks = await this.api.request('git.changes', { path: file.path, text: model.getValue(), encoding: file.encoding }).catch(() => []);
    // Ein neueres Nachfragen oder ein anderes Modell macht diese Antwort überflüssig.
    if (gen !== this.generation || this.editor.getModel() !== model || model.getVersionId() !== version) return;
    this.blocks = blocks;
    this.blocksVersion = version;
    this.decorations.set(
      blocks.map((b) => {
        const lines = model.getLineCount();
        if (b.kind === 'deleted') {
          const line = Math.min(Math.max(1, b.line - 1), lines);
          return {
            range: new monaco.Range(line, 1, line, 1),
            options: { linesDecorationsClassName: b.line - 1 >= 1 ? 'change-bar deleted below' : 'change-bar deleted above' },
          };
        }
        return {
          range: new monaco.Range(b.line, 1, Math.min(b.line + b.count - 1, lines), 1),
          options: {
            isWholeLine: true,
            linesDecorationsClassName: `change-bar ${b.kind}`,
            overviewRuler: { color: b.kind === 'added' ? '#549159' : '#375fad', position: monaco.editor.OverviewRulerLane.Left },
            // Seit Ticket 28 teilen sich alle Markierungen eine Spur im Streifen; Monaco zeichnet sie nach zIndex. Über
            // den hervorgehobenen Vorkommen eines Worts (0), unter Suchtreffern (10 und 13), Info-Markierungen (10),
            // Warnungen (20) und Fehlern (30).
            zIndex: GIT_OVERVIEW_Z_INDEX,
          },
        };
      }),
    );
  }
}

/** Ersetzt einen Block im Modell durch seinen alten Stand („Rollback Lines“). */
export function rollbackBlock(model: monaco.editor.ITextModel, block: ChangeBlock): void {
  const eol = model.getEOL();
  const old = block.oldLines.join(eol);
  const lines = model.getLineCount();
  let range: monaco.Range;
  let text: string;
  if (block.kind === 'deleted') {
    // Vor der Zeile `line` einfügen; am Ende der Datei hinter der letzten Zeile.
    if (block.line > lines) {
      range = new monaco.Range(lines, model.getLineMaxColumn(lines), lines, model.getLineMaxColumn(lines));
      text = eol + old;
    } else {
      range = new monaco.Range(block.line, 1, block.line, 1);
      text = old + eol;
    }
  } else if (block.kind === 'added') {
    const last = block.line + block.count - 1;
    // Die Zeilen samt ihrem Zeilenende entfernen (am Ende der Datei das davor).
    range =
      last < lines
        ? new monaco.Range(block.line, 1, last + 1, 1)
        : new monaco.Range(Math.max(1, block.line - 1), block.line > 1 ? model.getLineMaxColumn(block.line - 1) : 1, last, model.getLineMaxColumn(last));
    text = '';
  } else {
    const last = block.line + block.count - 1;
    range = new monaco.Range(block.line, 1, last, model.getLineMaxColumn(last));
    text = old;
  }
  // Ein eigener Schritt im Rückgängig-Verlauf, nicht mit dem Tippen davor vermengt (Review).
  model.pushStackElement();
  model.pushEditOperations([], [{ range, text }], () => null);
  model.pushStackElement();
}
