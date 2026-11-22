// Code-Bereich mit Datei-Tabs und Monaco. Die Tabs gehören zur Oberfläche; ihre Reihenfolge, der aktive Tab und der
// Cursor je Datei gehen an den Kern, der sie im Projekt-Zustand sichert. Die Regeln ohne DOM stehen in tabs.ts.
//
// - Ein Modell pro Datei: Alle Ansichten derselben Datei (heute der Tab, ab Ticket 17 die Vergleichsansicht, ab
//   Ticket 12 der Sprach-Dienst) teilen es. Ein Editor zeigt das Modell des aktiven Tabs; beim Wechsel merkt er sich
//   Cursor, Auswahl und Scrollstand des vorherigen.
// - Eine Datei wird erst gelesen, wenn ihr Tab das erste Mal aktiv wird; nach einem Neustart also nur der aktive.
// - Eingaben ändern nur das Modell; gespeichert wird mit Ticket 07. Bis dahin zeigt der Tab „ungespeichert“, solange
//   das Modell nicht dem gelesenen Stand entspricht (auch Rückgängig zählt).
// - Monaco öffnet andere Dateien (Sprungziele ab Ticket 12) über den eigenen Editor-Opener als Tab.
// - Ticket 06: Mittelklick und Rechtsklick-Menü an den Tabs, angeheftete Tabs links, eine scrollbare Tableiste mit
//   Liste aller Tabs, die Kürzel der zentralen Tastenbelegung im Editor (`handleCommand`), Ctrl + Tab durch die
//   zuletzt benutzten Tabs und Ctrl + Mausrad für die Schriftgrösse aller Editoren.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CodiumError,
  ErrorCode,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  type ChangeBlock,
  type CodeLocation,
  type CodiumApi,
  type FileContent,
  type FilesChangedEvent,
  type CursorState,
  type FileOperation,
  type LineEnding,
  type MarkdownView,
  type ProjectInfo,
  type SearchMatch,
  type TextEncoding,
} from '../../shared/types';
import { errorText } from '../errors';
import { ChevronDownIcon, CloseIcon, FileIcon, PinIcon } from '../icons';
import { shortcutLabel, type KeyCommand, type ToolWindowCommand } from '../keymap';
import type { Notify } from '../Notices';
import { isDialogOpen, useAsk } from '../popup/Dialogs';
import { Menu, type MenuAnchor, type MenuEntry } from '../popup/Menu';
import { baseName, isSameOrInside, movedPath, pathKey, relativeLabel } from '../project/filePaths';
import {
  DocumentSync,
  hasLanguageServer,
  isJdtPath,
  isReadOnlyTarget,
  jdtTitle,
  languageOfPath,
  pathOfUri,
  registerLanguageFeatures,
  uriOfPath,
} from '../language/languageClient';
import { MarkdownPreview } from '../markdown/MarkdownPreview';
import { isMarkdownFile } from '../markdown/markdown';
import { EDITOR_ACTIONS } from './editorActions';
import { DiffView } from './DiffView';
import { ChangeBars, rollbackBlock } from './changeBars';
import { NavigationHistory, type NavLocation } from './navigationHistory';
import { EDITOR_FONT_FAMILY, editorFontReady, languageOf, monaco } from './monaco';
import { pinTab, recentOrder, tabLabels, tabsToClose, unpinTab, withTab, withoutTab } from './tabs';

/** Was die Statusleiste vom aktiven Tab zeigt. */
export interface EditorStatus {
  line: number;
  column: number;
  lineEnding: LineEnding;
  encoding: TextEncoding;
}

/** Wohin der Cursor nach dem Öffnen soll (etwa ein Sprungziel); Zeilen und Spalten ab 1. */
export type EditorTarget = monaco.IRange | monaco.IPosition;

export interface OpenOptions {
  /** Den Fokus in den Editor setzen (bei Aktionen des Nutzers). */
  focus?: boolean;
  target?: EditorTarget;
}

/** Befehle der zentralen Tastenbelegung, die der Code-Bereich ausführt (alle ausser den Werkzeugfenstern). */
export type AreaCommand = Exclude<KeyCommand, ToolWindowCommand>;

export interface EditorAreaHandle {
  /** Öffnet eine Datei als Tab oder aktiviert ihren Tab. */
  open(path: string, options?: OpenOptions): void;
  /**
   * Führt ein Kürzel der zentralen Belegung aus. Liefert, ob es angenommen wurde; dann geht die Taste nicht weiter
   * (auch nicht an Monaco).
   */
  handleCommand(command: AreaCommand, repeat: boolean): boolean;
  /**
   * Speichert alle Tabs mit Eingaben und wartet, bis alle Speichervorgänge des Fensters fertig sind. Git-Aktionen
   * (ab Ticket 15) warten darauf. Tabs mit „File changed on disk“ bleiben bis zur Entscheidung ungespeichert.
   */
  saveAll(): Promise<void>;
  /**
   * Öffnet ein mitgeliefertes Dokument (etwa das README) schreibgeschützt in einem Tab, an einer Zeile. Solche Tabs
   * sind keine Datei-Tabs: Sie werden weder gespeichert noch nach einem Neustart wiederhergestellt.
   */
  openDocument(doc: ReadOnlyDocument): void;
  /** Öffnet eine Vergleichsansicht (Ticket 17). */
  openDiff(diff: DiffSpec): void;
}

/** Ein schreibgeschütztes Dokument für einen Tab. */
export interface ReadOnlyDocument {
  /** Name im Tab, etwa „README.md“. */
  title: string;
  text: string;
  /** Sprache für die Farben, etwa „markdown“. */
  language: string;
  /** Zeile (ab 1), an der der Cursor stehen soll. */
  line?: number;
}

/** Pfade schreibgeschützter Dokument-Tabs beginnen so; es sind keine Dateien. */
const DOCUMENT_PREFIX = 'codium:\\';
/** Vergleichsansichten sind Dokument-Tabs (nicht gespeichert, keine Datei) mit eigenem Präfix. */
const DIFF_PREFIX = `${DOCUMENT_PREFIX}diff\\`;
const isDiffTab = (tabPath: string) => tabPath.startsWith(DIFF_PREFIX);
export const isDocumentTab = (tabPath: string) => tabPath.startsWith(DOCUMENT_PREFIX);

/** Was ein Tab zeigt; `null`, solange die Datei noch nicht gelesen wurde. */
type TabContent =
  | { kind: 'loading' }
  | { kind: 'text'; encoding: TextEncoding; lineEnding: LineEnding; large: boolean; readOnly?: true }
  | { kind: 'image'; dataUrl: string; size: number }
  | { kind: 'binary'; size: number }
  | { kind: 'tooLarge'; size: number }
  | {
      kind: 'diff';
      diff: DiffSpec;
      /** Der alte Stand, sobald geholt; `binary`, wenn eine Seite keine Textdatei ist. */
      original: { text: string } | { binary: true } | null;
    };

/** Eine Vergleichsansicht (Ticket 17). */
export interface DiffSpec {
  /** Titel im Tab und über der Ansicht. */
  title: string;
  /** Die Datei, um die es geht (für die Sprache und den Vergleich mit dem Arbeitsordner). */
  filePath: string;
  /** Linke Seite: der Stand von `path` in `commit` (Standard HEAD); `null` für leer (neue Dateien). */
  base: { path: string; commit?: string } | null;
  /** Rechte Seite: `file` ist das gemeinsame Modell der Datei (bearbeitbar), sonst ein fester Text. */
  modified: { kind: 'file' } | { kind: 'text'; text: string };
  /** Unterscheidet Vergleiche derselben Datei (etwa verschiedene Commits). */
  id: string;
}

interface Tab {
  path: string;
  content: TabContent | null;
  /** Angeheftet: steht links und bleibt bei „Close All Tabs“ und „Close Other Tabs“ offen. */
  pinned: boolean;
  /**
   * Unsichtbar: Die Datei einer Vergleichsansicht, ohne eigenen Tab. Sie lädt und speichert wie ein Datei-Tab und wird
   * sichtbar, sobald man die Datei öffnet (Ticket 17).
   */
  hidden?: true;
}

/** Befehle im Editor, die auch mit dem Fokus in Monacos Suchfeld oder Eingabe wirken; die anderen brauchen den Text. */
const WIDGET_COMMANDS: ReadonlySet<AreaCommand> = new Set(['editor.find', 'editor.replace', 'editor.gotoLine']);

/** Das Modell einer offenen Textdatei mit dem, was der Editor beim Wechseln braucht. */
interface ModelEntry {
  model: monaco.editor.ITextModel;
  /** Stand des Modells, der dem Inhalt auf der Festplatte entspricht; `-1`, wenn es keinen solchen mehr gibt. */
  savedVersion: number;
  viewState: monaco.editor.ICodeEditorViewState | null;
  /** Gespeicherter Cursor aus dem Projekt-Zustand, für das erste Zeigen. */
  initialCursor: CursorState | null;
  /** Ziel, das beim nächsten Zeigen angesteuert wird. */
  target: EditorTarget | null;
  /** Der Text auf der Festplatte, wie er zuletzt gelesen oder geschrieben wurde (mit dem Zeilenende des Modells). */
  diskText: string;
  /**
   * Stand der Datei beim letzten Lesen oder Schreiben. Gespeichert wird nur, wenn die Datei noch diesen Stand hat;
   * sonst gilt sie als von aussen geändert (Review von Ticket 07).
   */
  diskStamp: string;
  /** Zeitgeber des automatischen Speicherns nach der letzten Eingabe. */
  saveTimer: number | null;
  /** Das laufende Speichern; das nächste schliesst sich an, damit nie eine ältere Fassung eine neuere überschreibt. */
  saving: Promise<void>;
  listener: monaco.IDisposable;
}

/** So lange nach der letzten Eingabe wird automatisch gespeichert. */
const AUTOSAVE_DELAY_MS = 1000;

/** So viele Pixel `deltaY` sind eine Raste des Mausrads (Chromium unter Windows: 100). */
const WHEEL_NOTCH_PIXELS = 100;

/** So lange nach der letzten Bewegung wird der Cursor gesichert. */
const CURSOR_SAVE_DELAY_MS = 300;

interface EditorAreaProps {
  api: CodiumApi;
  project: ProjectInfo;
  notify: Notify;
  fontSize: number;
  /** Der aktive Datei-Tab hat gewechselt (Pfad oder `null`), etwa für „Select Opened File“. */
  onActiveFileChange: (path: string | null) => void;
  /** Cursor, Zeilenende und Kodierung des aktiven Tabs für die Statusleiste; `null` ohne Text-Tab. */
  onStatusChange: (status: EditorStatus | null) => void;
  /** Ohne Tabs: der Inhalt des leeren Code-Bereichs. */
  empty: ReactNode;
  /** Alt + F7: Verwendungen als Reiter im Werkzeugfenster „Find“. */
  onShowUsages: (title: string, matches: SearchMatch[]) => void;
}

export const EditorArea = forwardRef<EditorAreaHandle, EditorAreaProps>(function EditorArea(
  { api, project, notify, fontSize, onActiveFileChange, onStatusChange, empty, onShowUsages },
  ref,
) {
  const [tabs, setTabsState] = useState<readonly Tab[]>([]);
  const [active, setActiveState] = useState<string | null>(null);
  const [dirty, setDirty] = useState<ReadonlySet<string>>(() => new Set());
  const [editorReady, setEditorReady] = useState(false);
  const tabsRef = useRef(tabs);
  const activeRef = useRef(active);
  const models = useRef(new Map<string, ModelEntry>());
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  /** Der Editor soll den Fokus bekommen, sobald er das Modell des aktiven Tabs zeigt. */
  const focusPending = useRef(false);
  const cursorTimer = useRef<number | null>(null);
  /** Die Tabs sind aus dem Projekt-Zustand geladen; vorher wird nichts gespeichert. */
  const restored = useRef(false);
  const callbacks = useRef({ onActiveFileChange, onStatusChange, notify });
  callbacks.current = { onActiveFileChange, onStatusChange, notify };

  const setTabs = useCallback((next: readonly Tab[]) => {
    tabsRef.current = next;
    setTabsState(next);
  }, []);

  const setActive = useCallback((next: string | null) => {
    activeRef.current = next;
    setActiveState(next);
  }, []);

  /** Tabs, die nach einem Neustart wiederkommen: keine mitgelieferten Dokumente, keine Ziele ausserhalb des Projekts. */
  const persistable = (tabPathValue: string) =>
    !isDocumentTab(tabPathValue) && isInside(tabPathValue, project.path) && !tabsRef.current.some((t) => t.hidden && pathKey(t.path) === pathKey(tabPathValue));

  // Sprach-Dienst (Ticket 12): Dokumente melden, Sprachfunktionen in Monaco.
  const documentSync = useMemo(() => new DocumentSync(api), [api]);
  useEffect(() => {
    const off = registerLanguageFeatures(api, (filePath) => documentSync.flush(filePath));
    return () => {
      off();
      documentSync.dispose();
    };
  }, [api, documentSync]);

  /** Speichert Reihenfolge und aktiven Tab im Kern. */
  const persistTabs = useCallback(() => {
    if (!restored.current) return;
    api
      .request('project.setTabs', {
        tabs: tabsRef.current.filter((t) => persistable(t.path)).map((t) => t.path),
        active: activeRef.current !== null && persistable(activeRef.current) ? activeRef.current : null,
        pinned: tabsRef.current.filter((t) => t.pinned && persistable(t.path)).map((t) => t.path),
      })
      .catch((err: unknown) => console.error('Tabs nicht gespeichert:', err));
  }, [api]);

  const entryOfModel = useCallback((model: monaco.editor.ITextModel | null): [string, ModelEntry] | undefined => {
    if (!model) return undefined;
    for (const pair of models.current) if (pair[1].model === model) return pair;
    return undefined;
  }, []);

  const tabPath = (key: string) => tabsRef.current.find((t) => pathKey(t.path) === key)?.path;

  /** Sichert Cursor und Scrollstand der Datei, die der Editor gerade zeigt. */
  const saveCursorNow = useCallback(() => {
    if (cursorTimer.current !== null) window.clearTimeout(cursorTimer.current);
    cursorTimer.current = null;
    const editor = editorRef.current;
    const pair = entryOfModel(editor?.getModel() ?? null);
    const position = editor?.getPosition();
    if (!editor || !pair || !position) return;
    const filePath = tabPath(pair[0]);
    if (filePath === undefined || isDocumentTab(filePath)) return;
    const cursor = { line: position.lineNumber, column: position.column, scrollTop: Math.max(0, Math.round(editor.getScrollTop())) };
    api.request('project.setCursor', { path: filePath, cursor }).catch((err: unknown) => console.error('Cursor nicht gespeichert:', err));
  }, [api, entryOfModel]);

  const updateDirty = useCallback((key: string) => {
    const entry = models.current.get(key);
    const isDirty = entry !== undefined && entry.model.getAlternativeVersionId() !== entry.savedVersion;
    setDirty((current) => {
      if (current.has(key) === isDirty) return current;
      const next = new Set(current);
      if (isDirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const addModel = useCallback(
    (key: string, model: monaco.editor.ITextModel, savedVersion: number, extra: Partial<ModelEntry> = {}) => {
      const listener = model.onDidChangeContent(() => {
        updateDirty(key);
        scheduleSaveRef.current(key);
      });
      models.current.set(key, {
        model,
        savedVersion,
        viewState: null,
        initialCursor: null,
        target: null,
        diskText: model.getValue(),
        diskStamp: '',
        saveTimer: null,
        saving: Promise.resolve(),
        ...extra,
        listener,
      });
      updateDirty(key);
    },
    [updateDirty],
  );

  /** Gibt das Modell einer Datei frei; zeigt der Editor es gerade, zeigt er danach nichts. */
  /** Der Editor der gerade gezeigten Vergleichsansicht (Ticket 17). */
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const disposeModel = useCallback((key: string) => {
    const entry = models.current.get(key);
    if (!entry) return;
    if (editorRef.current?.getModel() === entry.model) editorRef.current.setModel(null);
    // Auch die Vergleichsansicht gibt es frei, bevor es entsorgt wird (sonst meldet Monaco einen Fehler; Review).
    if (diffEditorRef.current?.getModel()?.modified === entry.model) diffEditorRef.current.setModel(null);
    if (entry.saveTimer !== null) window.clearTimeout(entry.saveTimer);
    entry.listener.dispose();
    documentSync.didClose(pathOfUri(entry.model.uri));
    entry.model.dispose();
    models.current.delete(key);
    updateDirty(key);
    setConflict(key, false);
  }, [updateDirty]);

  // ---------- Speichern (Ticket 07) ----------

  /** Tabs mit „File changed on disk“: Bis zur Entscheidung ruht ihr automatisches Speichern. */
  const [conflicts, setConflictsState] = useState<ReadonlySet<string>>(() => new Set());
  const conflictsRef = useRef(conflicts);
  const setConflict = (key: string, on: boolean) => {
    if (conflictsRef.current.has(key) === on) return;
    const next = new Set(conflictsRef.current);
    if (on) next.add(key);
    else next.delete(key);
    conflictsRef.current = next;
    setConflictsState(next);
  };

  /**
   * Speichert eine Datei, wenn ihr Modell vom Stand auf der Festplatte abweicht. Text und Stand werden sofort
   * festgehalten (auch wenn der Tab gleich schliesst); geschrieben wird nach dem vorherigen Speichern derselben Datei.
   * Mit `force` auch ohne Abweichung („Keep Mine“).
   */
  const saveNow = (key: string, force = false): Promise<void> => {
    const entry = models.current.get(key);
    if (!entry) return Promise.resolve();
    if (entry.saveTimer !== null) window.clearTimeout(entry.saveTimer);
    entry.saveTimer = null;
    const version = entry.model.getAlternativeVersionId();
    const tab = tabsRef.current.find((t) => pathKey(t.path) === key);
    if (!tab || tab.content?.kind !== 'text' || tab.content.readOnly || conflictsRef.current.has(key)) return entry.saving;
    if (!force && version === entry.savedVersion) return entry.saving;
    const text = entry.model.getValue();
    const { encoding, lineEnding } = tab.content;
    const run = entry.saving.then(async () => {
      let stamp: string;
      try {
        // Der erwartete Stand gilt erst jetzt, nach dem vorherigen Speichern; „Keep Mine“ schreibt ohne Prüfung.
        ({ stamp } = await api.request('files.write', {
          path: tab.path,
          text,
          encoding,
          lineEnding,
          ...(force ? {} : { expectedStamp: entry.diskStamp }),
        }));
      } catch (err) {
        if (err instanceof CodiumError && err.code === ErrorCode.fileChanged && models.current.get(key) === entry) {
          // Von aussen geändert, bevor die Meldung der Überwachung da war: Hinweis statt Überschreiben.
          setConflict(key, true);
          return;
        }
        // Wurde die Datei inzwischen in Codium umbenannt, speichert der Tab unter dem neuen Namen; sonst bleibt die
        // Markierung „ungespeichert“ (bzw. der Tab ist zu), und die Meldung sagt warum.
        const renamedMeanwhile = models.current.get(key) !== entry && err instanceof CodiumError && err.code === ErrorCode.fileNotFound;
        if (!renamedMeanwhile) callbacks.current.notify({ level: 'error', text: errorText(err) });
        return;
      }
      // Gilt nur, solange das Modell noch dasselbe ist (nicht geschlossen, nicht umbenannt).
      if (models.current.get(key) !== entry) return;
      entry.savedVersion = version;
      entry.diskText = text;
      entry.diskStamp = stamp;
      updateDirty(key);
    });
    entry.saving = run;
    return run;
  };

  /** Automatisches Speichern etwa eine Sekunde nach der letzten Eingabe; im Konflikt nicht. */
  const scheduleSave = (key: string) => {
    const entry = models.current.get(key);
    if (!entry || conflictsRef.current.has(key)) return;
    if (entry.saveTimer !== null) window.clearTimeout(entry.saveTimer);
    entry.saveTimer = window.setTimeout(() => void saveNow(key), AUTOSAVE_DELAY_MS);
  };
  const scheduleSaveRef = useRef(scheduleSave);
  scheduleSaveRef.current = scheduleSave;

  /** Speichert alle Tabs mit Eingaben und wartet, bis alle Speichervorgänge fertig sind (etwa vor Git-Aktionen). */
  const saveAll = useCallback(async (): Promise<void> => {
    await Promise.all([...models.current.keys()].map((key) => saveNowRef.current(key)));
  }, []);
  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;

  /** Ersetzt den Inhalt eines Tabs, solange der Tab noch offen ist. */
  const setContent = useCallback(
    (key: string, content: TabContent) => {
      if (!tabsRef.current.some((t) => pathKey(t.path) === key)) return false;
      setTabs(tabsRef.current.map((t) => (pathKey(t.path) === key ? { ...t, content } : t)));
      return true;
    },
    [setTabs],
  );

  /**
   * Laufende Lesevorgänge je Tab (Schlüssel → Kennung). Ein Ergebnis zählt nur, solange seine Kennung noch gilt:
   * Schliessen, Umbenennen und erneutes Lesen machen sie ungültig (Review von Ticket 05).
   */
  const loads = useRef(new Map<string, number>());
  const loadCounter = useRef(0);

  /** Liest die Datei eines Tabs und legt bei Text ihr Modell an. */
  const load = useCallback(
    async (filePath: string) => {
      const key = pathKey(filePath);
      const id = ++loadCounter.current;
      loads.current.set(key, id);
      setContent(key, { kind: 'loading' });
      try {
        const [content, cursor] = await Promise.all([
          // Nur Ziele ausserhalb des Projekts kommen über den Sprach-Dienst; Dateien unter node_modules im Projekt liest der
          // Datei-Dienst mit Erkennung von Kodierung, Bildern und Grösse (Review von Ticket 12).
          !isInside(filePath, project.path)
            ? api.request('language.readTarget', { path: filePath }).then((target) => libraryContent(target.text))
            : api.request('files.read', { path: filePath }),
          api.request('project.cursor', { path: filePath }).catch(() => null),
        ]);
        if (loads.current.get(key) !== id) return;
        loads.current.delete(key);
        const current = tabPath(key);
        if (current === undefined) return;
        if (content.kind !== 'text') {
          setContent(key, content.kind === 'image' ? { kind: 'image', dataUrl: content.dataUrl, size: content.size } : { kind: content.kind, size: content.size });
          return;
        }
        // Ein Modell pro Datei: Gibt es (wider Erwarten) schon eines unter dieser Adresse, weicht es dem neuen.
        const uri = uriOfPath(current);
        disposeModel(key);
        monaco.editor.getModel(uri)?.dispose();
        const model = monaco.editor.createModel(content.text, languageOfPath(current), uri);
        model.setEOL(content.lineEnding === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF);
        addModel(key, model, model.getAlternativeVersionId(), { initialCursor: cursor, diskStamp: content.stamp });
        // Der Kern merkt sich `large` (ab 5 MB): Sprach-Dienst (Ticket 12) und Änderungsbalken (Ticket 17) bleiben für
        // solche Tabs aus.
        const readOnly = libraryTab(current, project.path);
        setContent(key, { kind: 'text', encoding: content.encoding, lineEnding: content.lineEnding, large: content.large, ...(readOnly ? { readOnly: true as const } : {}) });
        // Sprach-Dienst (Ticket 12): nicht für Tabs ab 5 MB und nicht für schreibgeschützte Bibliotheksziele.
        if (!content.large && !readOnly) documentSync.didOpen(current, model);
        // Markdown: die gemerkte Ansicht („Split“ ohne gemerkte); ab 5 MB nur der Editor (Ticket 23).
        // Mitgelieferte Dokumente (README) gehören zu keinem Projekt: Ihre Ansicht gilt nur, solange der Tab offen ist.
        if (isMarkdownFile(current) && !content.large && isDocumentTab(current)) {
          setMarkdownView(key, 'split', false);
        } else if (isMarkdownFile(current) && !content.large) {
          void api.request('project.markdownView', { path: current }).then(
            (view) => setMarkdownView(key, view ?? 'split', false),
            () => setMarkdownView(key, 'split', false),
          );
        }
      } catch (err) {
        if (loads.current.get(key) !== id) return;
        loads.current.delete(key);
        // Die Datei lässt sich nicht lesen (etwa inzwischen gelöscht): Der Tab schliesst, die Meldung sagt warum.
        callbacks.current.notify({ level: 'error', text: errorText(err) });
        closeRef.current([filePath], { saveCursor: false });
      }
    },
    [addModel, api, disposeModel, setContent],
  );

  /** Macht einen Tab aktiv; vorher merkt sich der Editor den Stand des bisherigen. */
  const activate = useCallback(
    (filePath: string, options: OpenOptions = {}) => {
      const key = pathKey(filePath);
      const tab = tabsRef.current.find((t) => pathKey(t.path) === key);
      if (!tab) return;
      const editor = editorRef.current;
      const shown = entryOfModel(editor?.getModel() ?? null);
      if (editor && shown && shown[0] !== key) {
        saveCursorNow();
        shown[1].viewState = editor.saveViewState();
        // Tabwechsel speichert den bisherigen sofort.
        void saveNowRef.current(shown[0]);
      }
      const entry = models.current.get(key);
      if (options.target) {
        if (entry) entry.target = options.target;
        else pendingTargets.current.set(key, options.target);
      }
      if (options.focus) focusPending.current = true;
      if (activeRef.current === null || pathKey(activeRef.current) !== key) {
        setActive(tab.path);
        persistTabs();
      } else if (entry && options.target) {
        // Schon aktiv: das Ziel gleich ansteuern.
        showTarget(entry);
      }
      if (tab.content === null) void load(tab.path);
      if (options.focus && entry && editor?.getModel() === entry.model) {
        focusPending.current = false;
        editor.focus();
      }
    },
    [entryOfModel, load, persistTabs, saveCursorNow, setActive],
  );

  // ---------- Markdown-Vorschau (Ticket 23) ----------

  /** Ansicht je Markdown-Tab (Schlüssel); fehlt sie, ist es keine Markdown-Datei mit Vorschau. */
  const [markdownViews, setMarkdownViews] = useState<ReadonlyMap<string, MarkdownView>>(() => new Map());
  /** Breite des Editors in der geteilten Ansicht in Prozent. */
  const [splitPercent, setSplitPercent] = useState(50);
  /** Oberste sichtbare Editorzeile, für das synchrone Scrollen. */
  const [topLine, setTopLine] = useState(1);
  const topLineFrame = useRef<number | null>(null);

  const setMarkdownView = useCallback(
    (key: string, view: MarkdownView, persist: boolean) => {
      setMarkdownViews((current) => new Map(current).set(key, view));
      const tabPathValue = tabsRef.current.find((t) => pathKey(t.path) === key)?.path;
      if (persist && tabPathValue && !isDocumentTab(tabPathValue)) {
        void api.request('project.setMarkdownView', { path: tabPathValue, view }).catch(() => {});
      }
    },
    [api],
  );

  /** Meldet die oberste sichtbare Zeile, höchstens einmal je Bild. */
  const reportTopLine = () => {
    if (topLineFrame.current !== null) return;
    topLineFrame.current = window.requestAnimationFrame(() => {
      topLineFrame.current = null;
      const range = editorRef.current?.getVisibleRanges()[0];
      if (range) setTopLine(range.startLineNumber);
    });
  };

  /** Ziehen an der Trennlinie zwischen Editor und Vorschau. */
  const startSplitDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const body = bodyRef.current;
    if (e.button !== 0 || !body) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rect = body.getBoundingClientRect();
    const move = (ev: PointerEvent) => setSplitPercent(Math.min(85, Math.max(15, ((ev.clientX - rect.left) / rect.width) * 100)));
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  /** Ziele für Tabs, deren Modell es noch nicht gibt. */
  const pendingTargets = useRef(new Map<string, EditorTarget>());

  const open = useCallback(
    (filePath: string, options: OpenOptions = {}) => {
      const next = withTab(
        tabsRef.current.map((t) => t.path),
        filePath,
      );
      if (next.length !== tabsRef.current.length) setTabs([...tabsRef.current, { path: filePath, content: null, pinned: false }]);
      // Die Datei einer Vergleichsansicht hat schon einen unsichtbaren Tab: Er wird sichtbar.
      else if (tabsRef.current.some((t) => t.hidden && pathKey(t.path) === pathKey(filePath))) {
        setTabs(tabsRef.current.map((t) => (pathKey(t.path) === pathKey(filePath) ? { path: t.path, content: t.content, pinned: t.pinned } : t)));
      }
      activate(filePath, options);
      persistTabs();
    },
    [activate, persistTabs, setTabs],
  );

  /**
   * Schliesst Tabs auf einmal; erst danach wird ein neuer aktiver Tab bestimmt (und nur er gelesen). Mit
   * `saveCursor: false` (etwa weil die Datei gelöscht ist) wird der Cursor nicht mehr gesichert.
   */
  const closeTabs = useCallback(
    (paths: readonly string[], { saveCursor = true }: { saveCursor?: boolean } = {}) => {
      const keys = new Set(paths.map(pathKey).filter((k) => tabsRef.current.some((t) => pathKey(t.path) === k)));
      if (keys.size === 0) return;
      // Vergleichsansichten (Ticket 17): Ihre Datei bleibt als unsichtbarer Tab, solange eine offen bleibt; schliesst die
      // letzte, schliesst auch der unsichtbare Tab.
      const diffFiles = (exclude: Set<string>) =>
        new Set(
          tabsRef.current
            .filter((t) => !exclude.has(pathKey(t.path)) && t.content?.kind === 'diff' && t.content.diff.modified.kind === 'file')
            .map((t) => pathKey((t.content as { diff: DiffSpec }).diff.filePath)),
        );
      const stillUsed = diffFiles(keys);
      const toHide = [...keys].filter((k) => stillUsed.has(k) && !isDiffTab(k));
      for (const k of toHide) keys.delete(k);
      if (toHide.length > 0) setTabs(tabsRef.current.map((t) => (toHide.includes(pathKey(t.path)) ? { ...t, hidden: true as const } : t)));
      for (const t of tabsRef.current) {
        if (t.hidden && !stillUsed.has(pathKey(t.path)) && !toHide.includes(pathKey(t.path))) keys.add(pathKey(t.path));
      }
      if (keys.size === 0) {
        if (toHide.includes(pathKey(activeRef.current ?? ''))) {
          const visible = tabsRef.current.filter((t) => !t.hidden && !toHide.includes(pathKey(t.path)));
          if (visible[0]) activate(visible[0].path);
        }
        persistTabs();
        return;
      }
      const shownKey = entryOfModel(editorRef.current?.getModel() ?? null)?.[0];
      if (shownKey !== undefined && keys.has(shownKey)) {
        if (saveCursor) saveCursorNow();
        else if (cursorTimer.current !== null) {
          window.clearTimeout(cursorTimer.current);
          cursorTimer.current = null;
        }
      }
      let result = { tabs: tabsRef.current.filter((t) => !t.hidden || keys.has(pathKey(t.path))).map((t) => t.path), active: activeRef.current };
      for (const k of toHide) if (result.active !== null && pathKey(result.active) === k) result = withoutTab(result.tabs, result.active, result.active);
      for (const t of tabsRef.current) if (keys.has(pathKey(t.path))) result = withoutTab(result.tabs, result.active, t.path);
      for (const key of keys) {
        // Schliessen speichert vorher (Text und Stand werden sofort festgehalten); eine gelöschte Datei nicht.
        if (saveCursor) void saveNowRef.current(key);
        disposeModel(key);
        pendingTargets.current.delete(key);
        loads.current.delete(key);
      }
      setTabs(tabsRef.current.filter((t) => !keys.has(pathKey(t.path))));
      if (result.active === null) setActive(null);
      else if (activeRef.current === null || pathKey(result.active) !== pathKey(activeRef.current)) {
        activeRef.current = null;
        activate(result.active);
      }
      persistTabs();
    },
    [activate, disposeModel, entryOfModel, persistTabs, saveCursorNow, setActive, setTabs],
  );
  const closeRef = useRef(closeTabs);
  closeRef.current = closeTabs;
  /**
   * Schliessen durch den Nutzer (Kreuz, Mittelklick, Ctrl + F4, Menü): Tabs mit Eingaben werden erst gespeichert.
   * Lässt sich einer nicht speichern (etwa ein Zeichen, das die Kodierung nicht kennt, oder „File changed on disk“),
   * fragt Codium, bevor die Eingaben verloren gehen (Review von Ticket 07).
   */
  const closeByUser = useCallback(
    async (paths: readonly string[]) => {
      const keys = paths.map(pathKey);
      const unsavedNow = () => keys.filter((key) => {
        const entry = models.current.get(key);
        return entry !== undefined && entry.model.getAlternativeVersionId() !== entry.savedVersion;
      });
      await Promise.all(unsavedNow().map((key) => saveNowRef.current(key)));
      const unsaved = new Set(unsavedNow());
      if (unsaved.size > 0) {
        const names = tabsRef.current.filter((t) => unsaved.has(pathKey(t.path))).map((t) => relativeLabel(project.path, t.path));
        const choice = await askRef.current({
          title: 'Close',
          message: 'These files have changes that could not be saved. Close them anyway and discard the changes?',
          items: names,
          buttons: [
            { id: 'discard', label: 'Discard and Close' },
            { id: 'cancel', label: 'Cancel', primary: true },
          ],
        });
        if (choice !== 'discard') {
          closeTabs(paths.filter((p) => !unsaved.has(pathKey(p))));
          return;
        }
      }
      closeTabs(paths);
    },
    [closeTabs, project.path],
  );
  const ask = useAsk();
  const askRef = useRef(ask);
  askRef.current = ask;
  const close = useCallback((filePath: string) => void closeByUser([filePath]), [closeByUser]);

  // ---------- Ctrl + Tab: zuletzt benutzte Tabs ----------

  /** Schlüssel der Tabs, zuletzt benutzter zuerst. */
  const recent = useRef<string[]>([]);
  /** Ein laufendes Ctrl + Tab: die Reihenfolge beim Start und die Stelle darin. Endet mit dem Loslassen von Ctrl. */
  const switching = useRef<{ order: string[]; index: number } | null>(null);

  useEffect(() => {
    if (active === null || switching.current) return;
    const key = pathKey(active);
    recent.current = [key, ...recent.current.filter((k) => k !== key)];
  }, [active]);

  /** Ctrl + Tab (weiter in die Vergangenheit) bzw. Ctrl + Shift + Tab (zurück). */
  const switchRecent = useCallback(
    (step: 1 | -1) => {
      switching.current ??= { order: recentOrder(tabsRef.current.filter((t) => !t.hidden), recent.current), index: 0 };
      const { order } = switching.current;
      if (order.length < 2) return;
      switching.current.index = (switching.current.index + step + order.length) % order.length;
      activate(order[switching.current.index], { focus: true });
    },
    [activate],
  );

  // Loslassen von Ctrl beendet den Wechsel; erst dann zählt der gewählte Tab als zuletzt benutzt.
  useEffect(() => {
    const finish = () => {
      if (!switching.current) return;
      switching.current = null;
      const current = activeRef.current;
      if (current !== null) recent.current = [pathKey(current), ...recent.current.filter((k) => k !== pathKey(current))];
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') finish();
    };
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', finish);
    return () => {
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', finish);
    };
  }, []);

  // ---------- Zurück und Vor (Ticket 13) ----------

  const history = useRef(new NavigationHistory());
  /** Die letzte bekannte Stelle des Cursors. */
  const lastPlace = useRef<NavLocation | null>(null);
  /** Während Zurück/Vor: das Ziel; die Bewegung dorthin ist kein neuer Eintrag. */
  const navigatingTo = useRef<NavLocation | null>(null);
  /** Gerade wurde das Modell gewechselt; die nächste Cursorbewegung durch Codium gehört noch dazu. */
  const modelJustChanged = useRef(false);

  const currentPlace = (): NavLocation | null => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const position = editor?.getPosition();
    if (!model || !position) return null;
    const known = entryOfModel(model);
    return { path: (known && tabPath(known[0])) ?? pathOfUri(model.uri), line: position.lineNumber, column: position.column };
  };
  const trackPlaceRef = useRef((_jump = false) => {});
  trackPlaceRef.current = (jump = false) => {
    const place = currentPlace();
    if (!place) return;
    const target = navigatingTo.current;
    if (target) {
      // Erst wenn das Ziel erreicht ist, zählen Bewegungen wieder (Review von Ticket 13: kein fester Zeitgeber mehr).
      if (target.path.toLowerCase() === place.path.toLowerCase() && target.line === place.line) navigatingTo.current = null;
      lastPlace.current = place;
      return;
    }
    const last = lastPlace.current;
    const afterSwitch = modelJustChanged.current;
    if (!jump) modelJustChanged.current = false;
    if (last && afterSwitch && jump) {
      lastPlace.current = place;
      return;
    }
    if (last) {
      const sameFile = last.path.toLowerCase() === place.path.toLowerCase();
      if (jump && sameFile && last.line !== place.line) history.current.jumped(last);
      else history.current.moved(last, place);
    }
    lastPlace.current = place;
  };

  /** Zurück (`-1`) oder Vor (`1`); `false`, wenn es keinen Eintrag gibt. */
  const navigate = (direction: -1 | 1): boolean => {
    // Läuft noch eine Navigation (der Tab lädt), gilt deren Ziel als Ausgangsstelle (Review von Ticket 13).
    const current = navigatingTo.current ?? currentPlace() ?? lastPlace.current;
    if (!current) return false;
    const target = direction < 0 ? history.current.goBack(current) : history.current.goForward(current);
    if (!target) return false;
    navigatingTo.current = target;
    // Gibt es die Zielzeile nicht mehr, erreicht der Cursor sie nie: dann nach einer Weile wieder zählen.
    window.setTimeout(() => {
      if (navigatingTo.current === target) navigatingTo.current = null;
    }, 10_000);
    open(target.path, { focus: true, target: { lineNumber: target.line, column: target.column } });
    return true;
  };
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Die Seitentasten der Maus („zurück“, „vor“) wirken wie Ctrl + Alt + Links/Rechts.
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      // Wie die Tastatur: nicht hinter einer Rückfrage oder einem Dialog (Review von Ticket 13).
      if (isDialogOpen()) return;
      if (e.type === 'mouseup') navigateRef.current(e.button === 3 ? -1 : 1);
    };
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('mouseup', onMouse, true);
    return () => {
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('mouseup', onMouse, true);
    };
  }, []);

  // ---------- Kürzel der zentralen Belegung ----------

  const handleCommand = useCallback(
    (command: AreaCommand, repeat: boolean): boolean => {
      const editor = editorRef.current;
      if (command.startsWith('editor.')) {
        if (!editor) return false;
        if (WIDGET_COMMANDS.has(command) ? editor.hasWidgetFocus() : editor.hasTextFocus()) {
          editor.trigger('keyboard', EDITOR_ACTIONS[command as keyof typeof EDITOR_ACTIONS], null);
          return true;
        }
        // In Monacos Eingaben (etwa dem Suchfeld) gehören Rückgängig und Wiederholen der Eingabe; alle anderen Kürzel
        // werden dort geschluckt, damit Monacos eigene Belegung (etwa Ctrl + D, Mehrfach-Cursor) nicht wirkt
        // (Review von Ticket 06).
        if (command === 'editor.undo' || command === 'editor.redo') return false;
        return editor.hasWidgetFocus();
      }
      switch (command) {
        case 'tab.close':
          if (activeRef.current === null) return false;
          if (!repeat) close(activeRef.current);
          return true;
        case 'tab.recent':
        case 'tab.recentForward':
          if (tabsRef.current.length === 0) return false;
          switchRecent(command === 'tab.recent' ? 1 : -1);
          return true;
        case 'navigate.back':
        case 'navigate.forward':
          if (!repeat) navigate(command === 'navigate.back' ? -1 : 1);
          return true;
        case 'navigate.usages': {
          // Alt + F7: die Verwendungen als Reiter ins Werkzeugfenster „Find“.
          const model = editor?.getModel();
          const position = editor?.getPosition();
          if (!editor?.hasTextFocus() || !model || !position) return false;
          if (repeat || !hasLanguageServer(pathOfUri(model.uri))) return true;
          const filePath = pathOfUri(model.uri);
          documentSync.flush(filePath);
          const word = model.getWordAtPosition(position)?.word ?? baseName(filePath);
          void api
            .request('language.references', { path: filePath, line: position.lineNumber - 1, character: position.column - 1 })
            .then((locations) => {
              if (locations.length === 0) {
                notify({ level: 'info', text: `No usages of “${word}” found.` });
                return;
              }
              onShowUsages(`Usages of ${word}`, locations.map(usageMatch));
            })
            .catch((err: unknown) => notify({ level: 'error', text: errorText(err) }));
          return true;
        }
        case 'file.saveAll':
          if (!repeat) void saveAll();
          return true;
        default:
          // Kürzel späterer Tickets: im Editor abfangen, damit Monacos eigene Belegung nicht wirkt.
          return editor?.hasWidgetFocus() ?? false;
      }
    },
    [close, saveAll, switchRecent],
  );

  const openDocument = useCallback(
    (doc: ReadOnlyDocument) => {
      const docPath = DOCUMENT_PREFIX + doc.title;
      const key = pathKey(docPath);
      const target = doc.line ? { lineNumber: doc.line, column: 1 } : undefined;
      if (!tabsRef.current.some((t) => pathKey(t.path) === key)) {
        const uri = monaco.Uri.from({ scheme: 'codium-doc', path: `/${doc.title}` });
        monaco.editor.getModel(uri)?.dispose();
        const model = monaco.editor.createModel(doc.text, doc.language, uri);
        addModel(key, model, model.getAlternativeVersionId());
        setTabs([
          ...tabsRef.current,
          { path: docPath, content: { kind: 'text', encoding: 'utf-8', lineEnding: 'LF', large: false, readOnly: true }, pinned: false },
        ]);
      }
      activate(docPath, { focus: true, ...(target ? { target } : {}) });
    },
    [activate, addModel, setTabs],
  );

  /** Öffnet eine Vergleichsansicht als Tab; beim Vergleich mit dem Arbeitsordner lädt die Datei (unsichtbar) mit. */
  const openDiff = useCallback(
    (diff: DiffSpec) => {
      const diffPath = `${DIFF_PREFIX}${diff.id}`;
      const key = pathKey(diffPath);
      const known = tabsRef.current.find((t) => pathKey(t.path) === key);
      const content = { kind: 'diff' as const, diff, original: null };
      const next = known
        ? tabsRef.current.map((t) => (t === known ? { ...t, content } : t))
        : [...tabsRef.current, { path: diffPath, content, pinned: false }];
      const fileKey = pathKey(diff.filePath);
      const withFile = diff.modified.kind === 'file';
      const needsTab = withFile && !next.some((t) => pathKey(t.path) === fileKey);
      setTabs(needsTab ? [...next, { path: diff.filePath, content: null, pinned: false, hidden: true as const }] : next);
      activate(diffPath, { focus: false });
      // Die Datei laden, wann immer sie noch kein Modell hat (auch ein wiederhergestellter, noch nicht gelesener Tab;
      // Review); danach den alten Stand mit ihrer Kodierung holen.
      const loading = withFile && !models.current.has(fileKey) && !loads.current.has(fileKey) ? load(diff.filePath) : Promise.resolve();
      void loading.then(() => loadOriginal(diffPath));
    },
    [activate, load, setTabs],
  );

  /** Holt den alten Stand eines Vergleichs-Tabs (neu nach einem Commit oder Wechsel des Branches). */
  const loadOriginal = (diffPath: string): Promise<void> => {
    const tab = tabsRef.current.find((t) => t.path === diffPath);
    if (tab?.content?.kind !== 'diff') return Promise.resolve();
    const { diff } = tab.content;
    const fileContent = tabsRef.current.find((t) => pathKey(t.path) === pathKey(diff.filePath))?.content;
    const encoding = fileContent?.kind === 'text' ? fileContent.encoding : undefined;
    const request = diff.base
      ? api.request('git.fileAtCommit', { path: diff.base.path, ...(diff.base.commit ? { commit: diff.base.commit } : {}), ...(encoding ? { encoding } : {}) })
      : Promise.resolve({ exists: false, text: '' } as { exists: boolean; text: string; binary?: true });
    return request.then(
      (result) => {
        const current = tabsRef.current.find((t) => t.path === diffPath);
        if (current?.content?.kind !== 'diff' || current.content.diff !== diff) return;
        const original = result.binary ? { binary: true as const } : { text: result.text };
        setTabs(tabsRef.current.map((t) => (t === current ? { ...t, content: { kind: 'diff' as const, diff, original } } : t)));
      },
      (err: unknown) => notify({ level: 'error', text: errorText(err) }),
    );
  };
  const loadOriginalRef = useRef(loadOriginal);
  loadOriginalRef.current = loadOriginal;
  // Nach einem Commit oder Wechsel des Branches gilt ein neuer alter Stand.
  useEffect(
    () =>
      api.on('git.stateChanged', () => {
        for (const t of tabsRef.current) if (t.content?.kind === 'diff' && !t.content.diff.base?.commit) void loadOriginalRef.current(t.path);
      }),
    [api],
  );

  /** Ein angeklickter Änderungsbalken: alter Stand und „Rollback Lines“. */
  const [rollback, setRollback] = useState<{ block: ChangeBlock; model: monaco.editor.ITextModel; x: number; y: number } | null>(null);
  const changeBarsRef = useRef<ChangeBars | null>(null);

  useImperativeHandle(ref, () => ({ open, handleCommand, saveAll, openDocument, openDiff }), [open, handleCommand, saveAll, openDocument, openDiff]);

  // Verliert das Fenster den Fokus, wird alles gespeichert (etwa vor dem Wechsel in ein Terminal oder zu Git).
  useEffect(() => {
    const onBlur = () => void saveAll();
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [saveAll]);

  // ---------- Anheften, Sammel-Schliessen, Menüs ----------

  const setPinned = useCallback(
    (filePath: string, pinned: boolean) => {
      setTabs(pinned ? pinTab(tabsRef.current, filePath) : unpinTab(tabsRef.current, filePath));
      persistTabs();
    },
    [persistTabs, setTabs],
  );

  /** Rechtsklick-Menü eines Tabs bzw. die Liste aller Tabs. */
  const [menu, setMenu] = useState<{ kind: 'tab'; path: string; anchor: MenuAnchor } | { kind: 'all'; anchor: MenuAnchor } | null>(
    null,
  );

  const tabMenuEntries = (filePath: string): MenuEntry[] => {
    const tab = tabsRef.current.find((t) => pathKey(t.path) === pathKey(filePath));
    if (!tab) return [];
    const closing = (action: 'others' | 'all' | 'right') => tabsToClose(tabsRef.current, action, filePath);
    const item = (label: string, action: 'others' | 'all' | 'right'): MenuEntry => ({
      kind: 'item',
      label,
      disabled: closing(action).length === 0,
      run: () => void closeByUser(closing(action)),
    });
    return [
      { kind: 'item', label: 'Close', shortcut: shortcutLabel('tab.close'), run: () => close(filePath) },
      item('Close Other Tabs', 'others'),
      item('Close All Tabs', 'all'),
      item('Close Tabs to the Right', 'right'),
      { kind: 'separator' },
      tab.pinned
        ? { kind: 'item', label: 'Unpin Tab', run: () => setPinned(filePath, false) }
        : { kind: 'item', label: 'Pin Tab', run: () => setPinned(filePath, true) },
    ];
  };

  // ---------- Tableiste: Überlauf, Scrollen, aktiven Tab zeigen ----------

  const tabListRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const hasTabs = tabs.length > 0;
  useEffect(() => {
    const list = tabListRef.current;
    if (!list) {
      setOverflowing(false);
      return;
    }
    const measure = () => setOverflowing(list.scrollWidth > list.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const child of list.children) observer.observe(child);
    return () => observer.disconnect();
  }, [tabs]);

  // Der aktive Tab ist immer zu sehen.
  useEffect(() => {
    if (active === null) return;
    const el = tabListRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(pathKey(active))}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs]);

  // Das Mausrad scrollt die Tableiste waagrecht (React meldet `wheel` nur passiv, daher direkt am Element).
  useEffect(() => {
    const list = tabListRef.current;
    if (!list) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      list.scrollLeft += e.deltaY;
    };
    list.addEventListener('wheel', onWheel, { passive: false });
    return () => list.removeEventListener('wheel', onWheel);
  }, [hasTabs]);

  // ---------- Ctrl + Mausrad: Schriftgrösse aller Editoren ----------

  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    // Kleine Schritte (Touchpad, Zoomgeste) werden gesammelt; eine Stufe gibt es erst ab einer Mausraste
    // (Review von Ticket 06).
    let collected = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.deltaY === 0) return;
      // Vor Monaco: Er würde sonst scrollen, und die Seite würde zoomen.
      e.preventDefault();
      e.stopPropagation();
      const notch = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? WHEEL_NOTCH_PIXELS : e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 3 : 1;
      if (Math.sign(collected) !== Math.sign(e.deltaY)) collected = 0;
      collected += e.deltaY;
      if (Math.abs(collected) < notch) return;
      const steps = Math.trunc(collected / notch);
      collected -= steps * notch;
      const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSizeRef.current - steps));
      if (next === fontSizeRef.current) return;
      fontSizeRef.current = next;
      api.request('app.updateSettings', { fontSize: next }).catch((err: unknown) => console.error('Schriftgrösse nicht gespeichert:', err));
    };
    body.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => body.removeEventListener('wheel', onWheel, { capture: true });
  }, [api]);

  // Den Editor anlegen, sobald die Schrift geladen ist (sonst misst Monaco die Zeichen der Ersatzschrift).
  useEffect(() => {
    let disposed = false;
    let editor: monaco.editor.IStandaloneCodeEditor | null = null;
    const listeners: monaco.IDisposable[] = [];
    void editorFontReady().then(() => {
      const host = hostRef.current;
      if (disposed || !host) return;
      editor = monaco.editor.create(host, {
        model: null,
        fontFamily: EDITOR_FONT_FAMILY,
        fontSize: fontSizeRef.current,
        lineHeight: 1.4,
        fontLigatures: false,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: true,
        renderLineHighlight: 'line',
        // Sprachfunktionen kommen nur vom Sprach-Dienst (ab Ticket 12), keine Vorschläge aus Wörtern der Datei.
        wordBasedSuggestions: 'off',
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        // Links öffnen sich hier nicht; das Fenster lässt ohnehin keine Navigation zu.
        links: false,
        'semanticHighlighting.enabled': true,
        stickyScroll: { enabled: false },
        fixedOverflowWidgets: true,
        guides: { indentation: true, bracketPairs: false },
        bracketPairColorization: { enabled: false },
        mouseWheelZoom: false,
        contextmenu: true,
        ariaLabel: 'Editor',
      });
      editorRef.current = editor;
      // Änderungsbalken (Ticket 17): nur für Datei-Tabs mit Text unter 5 MB; nicht versionierte liefern keine Blöcke.
      const bars = new ChangeBars(
        api,
        editor,
        (model) => {
          const key = entryOfModel(model)?.[0];
          const tab = key === undefined ? undefined : tabsRef.current.find((t) => pathKey(t.path) === key);
          if (!tab || tab.content?.kind !== 'text' || tab.content.large || tab.content.readOnly) return null;
          if (isDocumentTab(tab.path) || isJdtPath(tab.path)) return null;
          return { path: tab.path, encoding: tab.content.encoding };
        },
        (block, position) => {
          const model = editor?.getModel();
          if (model) setRollback({ block, model, ...position });
        },
      );
      changeBarsRef.current = bars;
      const offGit = api.on('git.stateChanged', () => bars.refreshNow());
      listeners.push({ dispose: () => offGit() }, bars);
      listeners.push(
        editor.onDidChangeCursorPosition((e) => {
          reportStatus();
          scheduleCursorSave();
          // Bewegungen durch Codium oder Monaco selbst (Sprung zur Definition in derselben Datei, Zu Zeile,
          // Suchtreffer) sind Sprünge, auch über wenige Zeilen (Review von Ticket 13); Tippen und Klicken nicht.
          trackPlaceRef.current(e.source === 'api');
        }),
        editor.onDidChangeModel(() => {
          // Wer das Modell wechselt, setzt den Cursor gleich danach (Ziel des Sprungs, gemerkte Stelle): das gehört zum
          // Wechsel und ist kein eigener Sprung.
          trackPlaceRef.current();
          modelJustChanged.current = true;
        }),
        editor.onDidScrollChange(() => reportTopLine()),
        editor.onDidScrollChange((e) => {
          if (e.scrollTopChanged) scheduleCursorSave();
        }),
      );
      setEditorReady(true);
    });
    // Schliesst das Fenster oder endet Codium, wird eine noch verzögerte Cursorbewegung sofort gesichert.
    const flushCursor = () => {
      if (cursorTimer.current !== null) saveCursorRef.current();
    };
    window.addEventListener('pagehide', flushCursor);
    return () => {
      disposed = true;
      window.removeEventListener('pagehide', flushCursor);
      flushCursor();
      for (const listener of listeners) listener.dispose();
      editor?.dispose();
      editorRef.current = null;
      for (const key of [...models.current.keys()]) {
        const entry = models.current.get(key)!;
        entry.listener.dispose();
        entry.model.dispose();
      }
      models.current.clear();
      if (cursorTimer.current !== null) window.clearTimeout(cursorTimer.current);
    };
    // Nur einmal pro Fenster; Schriftgrösse und Rückrufe kommen über Refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize });
  }, [fontSize, editorReady]);

  const scheduleCursorSave = () => {
    if (cursorTimer.current !== null) window.clearTimeout(cursorTimer.current);
    cursorTimer.current = window.setTimeout(() => saveCursorRef.current(), CURSOR_SAVE_DELAY_MS);
  };
  const saveCursorRef = useRef(saveCursorNow);
  saveCursorRef.current = saveCursorNow;

  /** Meldet Cursor, Zeilenende und Kodierung des aktiven Tabs an die Statusleiste. */
  const reportStatus = () => {
    const editor = editorRef.current;
    const key = activeRef.current === null ? null : pathKey(activeRef.current);
    const tab = key === null ? undefined : tabsRef.current.find((t) => pathKey(t.path) === key);
    const entry = key === null ? undefined : models.current.get(key);
    const position = editor?.getPosition();
    if (!editor || !tab || tab.content?.kind !== 'text' || !entry || editor.getModel() !== entry.model || !position) {
      callbacks.current.onStatusChange(null);
      return;
    }
    callbacks.current.onStatusChange({
      line: position.lineNumber,
      column: position.column,
      lineEnding: tab.content.lineEnding,
      encoding: tab.content.encoding,
    });
  };

  /** Steuert ein Ziel an (Sprung) und vergisst es. */
  const showTarget = (entry: ModelEntry) => {
    const editor = editorRef.current;
    const target = entry.target;
    if (!editor || !target) return;
    entry.target = null;
    if ('startLineNumber' in target) {
      editor.setSelection(target);
      editor.revealRangeInCenterIfOutsideViewport(target);
    } else {
      editor.setPosition(target);
      editor.revealPositionInCenterIfOutsideViewport(target);
    }
  };

  // Der Editor zeigt das Modell des aktiven Tabs, sobald es da ist; beim ersten Zeigen mit dem gespeicherten Cursor.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const key = active === null ? null : pathKey(active);
    const entry = key === null ? undefined : models.current.get(key);
    if (!entry) {
      if (editor.getModel()) editor.setModel(null);
      reportStatus();
      return;
    }
    const pending = key === null ? undefined : pendingTargets.current.get(key);
    if (pending && key !== null) {
      entry.target = pending;
      pendingTargets.current.delete(key);
    }
    const activeContent = tabsRef.current.find((t) => pathKey(t.path) === key)?.content;
    editor.updateOptions({ readOnly: activeContent?.kind === 'text' && activeContent.readOnly === true });
    if (editor.getModel() !== entry.model) {
      editor.layout();
      editor.setModel(entry.model);
      if (entry.viewState) {
        editor.restoreViewState(entry.viewState);
      } else if (entry.initialCursor) {
        const { line, column, scrollTop } = entry.initialCursor;
        editor.setPosition({ lineNumber: line, column });
        editor.setScrollTop(scrollTop);
        // Liegt der Cursor nach einer Änderung von aussen nicht mehr im Bild, holt Monaco ihn herein.
        editor.revealPositionInCenterIfOutsideViewport({ lineNumber: line, column });
      }
      entry.initialCursor = null;
    }
    showTarget(entry);
    if (focusPending.current) {
      focusPending.current = false;
      // Hat inzwischen ein Dialog oder Suchfenster den Fokus (der Nutzer war schneller), bleibt er dort.
      if (!document.activeElement?.closest('[role="dialog"]')) editor.focus();
    }
    reportStatus();
    // `tabs` gehört dazu: Erst wenn der Inhalt gelesen ist, gibt es das Modell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tabs, editorReady]);

  // Den aktiven Datei-Tab melden (für „Select Opened File“) und als zuletzt geöffnet merken (Ctrl + E).
  useEffect(() => {
    const isFile = active !== null && !isDocumentTab(active);
    callbacks.current.onActiveFileChange(isFile ? active : null);
    if (isFile) void api.request('project.addRecentFile', { path: active }).catch(() => {});
  }, [active, api]);

  // Die gespeicherten Tabs laden; gelesen wird nur der aktive.
  useEffect(() => {
    let live = true;
    api.request('project.tabs').then(
      (saved) => {
        if (!live) return;
        restored.current = true;
        if (tabsRef.current.length > 0) {
          // Der Nutzer war schneller und hat schon geöffnet: Die gespeicherten kommen davor dazu.
          const opened = tabsRef.current;
          const pinned = new Set((saved.pinned ?? []).map(pathKey));
          const savedTabs = saved.tabs
            .filter((p) => !opened.some((t) => pathKey(t.path) === pathKey(p)))
            .map((p) => ({ path: p, content: null, pinned: pinned.has(pathKey(p)) }));
          const merged = [...savedTabs.filter((t) => t.pinned), ...savedTabs.filter((t) => !t.pinned), ...opened];
          setTabs(merged);
          persistTabs();
          return;
        }
        const pinned = new Set((saved.pinned ?? []).map(pathKey));
        setTabs(saved.tabs.map((p) => ({ path: p, content: null, pinned: pinned.has(pathKey(p)) })));
        if (saved.active !== null) activate(saved.active);
      },
      (err: unknown) => {
        restored.current = true;
        console.error('Tabs nicht geladen:', err);
      },
    );
    return () => {
      live = false;
    };
  }, [activate, api, persistTabs, setTabs]);

  // Dateioperationen in Codium: Tabs folgen einer Umbenennung, beim Löschen schliessen sie.
  const onOperation = useRef<(op: FileOperation) => void>(() => {});
  onOperation.current = (op) => {
    // Der Verlauf und die letzte Stelle folgen; sonst entstünde beim Wechsel auf das neue Modell ein Eintrag mit dem
    // alten Pfad (Review von Ticket 13).
    if (op.kind === 'deleted' || op.kind === 'renamed') {
      const from = op.kind === 'deleted' ? op.path : op.from;
      const to = op.kind === 'deleted' ? null : op.to;
      history.current.rename(from, to);
      const last = lastPlace.current;
      if (last && isSameOrInside(last.path, from)) lastPlace.current = to === null ? null : { ...last, path: to + last.path.slice(from.length) };
    }
    if (op.kind === 'deleted') {
      // Alle auf einmal und ohne den Cursor zu sichern: Der Kern hat ihn mit der Datei schon vergessen.
      closeTabs(
        tabsRef.current.filter((t) => isSameOrInside(t.path, op.path)).map((t) => t.path),
        { saveCursor: false },
      );
      return;
    }
    if (op.kind !== 'renamed') return;
    const affected = tabsRef.current.filter((t) => isSameOrInside(t.path, op.from));
    if (affected.length === 0) return;
    const editor = editorRef.current;
    for (const tab of affected) {
      const oldKey = pathKey(tab.path);
      const newPath = movedPath(tab.path, op.from, op.to);
      const entry = models.current.get(oldKey);
      if (!entry) continue;
      // Das Modell gehört zum Pfad (Monaco führt es unter seiner Adresse): ein neues unter dem neuen Pfad, mit dem
      // Inhalt und der Markierung „ungespeichert“ des alten. Den Rückgängig-Verlauf behält Monaco dabei nicht.
      const attached = editor?.getModel() === entry.model;
      const viewState = attached && editor ? editor.saveViewState() : entry.viewState;
      const wasDirty = entry.model.getAlternativeVersionId() !== entry.savedVersion;
      const inConflict = conflictsRef.current.has(oldKey);
      const model = monaco.editor.createModel(entry.model.getValue(), languageOf(newPath), monaco.Uri.file(newPath));
      model.setEOL(entry.model.getEndOfLineSequence());
      disposeModel(oldKey);
      const newKey = pathKey(newPath);
      addModel(newKey, model, wasDirty ? -1 : model.getAlternativeVersionId(), { viewState, diskText: entry.diskText, diskStamp: entry.diskStamp });
      const renamedContent = tabsRef.current.find((t) => pathKey(t.path) === oldKey)?.content;
      if (renamedContent?.kind === 'text' && !renamedContent.large && !renamedContent.readOnly) documentSync.didOpen(newPath, model);
      // Die Ansicht einer Markdown-Datei wandert mit (solange es eine bleibt).
      setMarkdownViews((current) => {
        const view = current.get(oldKey);
        // In „.md“ umbenannt: jetzt mit Vorschau (Review von Ticket 23).
        if (view === undefined) return isMarkdownFile(newPath) ? new Map(current).set(newKey, 'split') : current;
        const next = new Map(current);
        next.delete(oldKey);
        if (isMarkdownFile(newPath)) next.set(newKey, view);
        return next;
      });
      // Ungespeicherte Eingaben werden unter dem neuen Namen gespeichert, ein offener Konflikt bleibt.
      if (inConflict) setConflict(newKey, true);
      else if (wasDirty) scheduleSave(newKey);
    }
    // Tabs, die gerade lesen, lesen unter dem neuen Pfad neu (der alte Lesevorgang zählt nicht mehr).
    const interrupted = new Set(affected.map((t) => pathKey(t.path)).filter((key) => loads.current.delete(key)));
    const renamed = tabsRef.current.map((t) => {
      if (t.content?.kind === 'diff' && isSameOrInside(t.content.diff.filePath, op.from)) {
        const diff = { ...t.content.diff, filePath: movedPath(t.content.diff.filePath, op.from, op.to) };
        return { ...t, content: { ...t.content, diff } };
      }
      if (!isSameOrInside(t.path, op.from)) return t;
      const moved = movedPath(t.path, op.from, op.to);
      return interrupted.has(pathKey(t.path)) ? { ...t, path: moved, content: null } : { ...t, path: moved };
    });
    setTabs(renamed);
    for (const t of renamed) if (t.hidden && t.content === null) void load(t.path);
    if (activeRef.current !== null && isSameOrInside(activeRef.current, op.from)) {
      const activePath = movedPath(activeRef.current, op.from, op.to);
      setActive(activePath);
      if (renamed.find((t) => pathKey(t.path) === pathKey(activePath))?.content === null) void load(activePath);
    }
    persistTabs();
  };
  useEffect(() => api.on('files.operation', (op) => onOperation.current(op)), [api]);

  // ---------- Änderungen von aussen (Ticket 07) ----------

  /**
   * Übernimmt den Inhalt auf der Festplatte ins Modell, als eigener Schritt im Rückgängig-Verlauf. Ersetzt wird nur der
   * Teil zwischen gleichem Anfang und gleichem Ende; so bleiben Cursor und Scrollstand, so gut es geht.
   */
  const applyDisk = (key: string, entry: ModelEntry, content: Extract<FileContent, { kind: 'text' }>) => {
    const { model } = entry;
    const eol = content.lineEnding === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF;
    if (model.getEndOfLineSequence() !== eol) model.setEOL(eol);
    const next = content.text.replace(/\r\n|\r|\n/g, model.getEOL());
    const current = model.getValue();
    if (next !== current) {
      let start = 0;
      while (start < current.length && start < next.length && current[start] === next[start]) start++;
      let end = 0;
      while (
        end < current.length - start &&
        end < next.length - start &&
        current[current.length - 1 - end] === next[next.length - 1 - end]
      ) end++;
      const from = model.getPositionAt(start);
      const to = model.getPositionAt(current.length - end);
      model.pushStackElement();
      model.pushEditOperations(
        [],
        [{ range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column), text: next.slice(start, next.length - end) }],
        () => null,
      );
      model.pushStackElement();
    }
    entry.savedVersion = model.getAlternativeVersionId();
    entry.diskText = model.getValue();
    entry.diskStamp = content.stamp;
    if (entry.saveTimer !== null) window.clearTimeout(entry.saveTimer);
    entry.saveTimer = null;
    setConflict(key, false);
    updateDirty(key);
    setContent(key, { kind: 'text', encoding: content.encoding, lineEnding: content.lineEnding, large: content.large });
  };

  /**
   * Eine offene Datei hat sich auf der Festplatte geändert (oder vielleicht, nach verpassten Ereignissen). Ohne
   * ungespeicherte Eingaben lädt der Tab still neu; mit ihnen erscheint „File changed on disk“, und das automatische
   * Speichern ruht. Liest die Datei gleich, zählt nur, was sich wirklich unterscheidet (etwa nicht das Echo eines
   * eigenen Schreibvorgangs).
   */
  const reloadFromDisk = async (filePath: string) => {
    const key = pathKey(filePath);
    const tab = tabsRef.current.find((t) => pathKey(t.path) === key);
    if (!tab || tab.content === null || loads.current.has(key)) return;
    const entry = models.current.get(key);
    if (!entry) {
      // Bild, Binärdatei, zu gross: neu lesen, wenn der Tab aktiv ist, sonst beim nächsten Aktivieren.
      setTabs(tabsRef.current.map((t) => (pathKey(t.path) === key ? { ...t, content: null } : t)));
      if (activeRef.current !== null && pathKey(activeRef.current) === key) void load(tab.path);
      return;
    }
    // Erst alles Laufende speichern, sonst gälte der eigene, noch nicht geschriebene Stand als fremd.
    await entry.saving;
    let content: FileContent;
    try {
      content = await api.request('files.read', { path: tab.path });
    } catch (err) {
      if (err instanceof CodiumError && err.code === ErrorCode.fileNotFound) return; // Das Löschen meldet sich selbst.
      console.error('Datei nicht neu gelesen:', err);
      return;
    }
    if (models.current.get(key) !== entry) return;
    if (content.kind !== 'text') {
      disposeModel(key);
      setContent(key, content.kind === 'image' ? { kind: 'image', dataUrl: content.dataUrl, size: content.size } : { kind: content.kind, size: content.size });
      return;
    }
    const sameText = content.text.replace(/\r\n|\r|\n/g, entry.model.getEOL()) === entry.diskText;
    const shown = tab.content.kind === 'text' ? tab.content : null;
    if (sameText && shown?.encoding === content.encoding && shown.lineEnding === content.lineEnding) return;
    if (entry.model.getAlternativeVersionId() !== entry.savedVersion) {
      if (entry.saveTimer !== null) window.clearTimeout(entry.saveTimer);
      entry.saveTimer = null;
      setConflict(key, true);
      return;
    }
    applyDisk(key, entry, content);
  };
  const reloadRef = useRef(reloadFromDisk);
  reloadRef.current = reloadFromDisk;

  useEffect(
    () =>
      api.on('files.changed', (event: FilesChangedEvent) => {
        // Gelöscht heisst: nach dem Bündeln wirklich weg. „Gelöscht und neu angelegt“ kommt als Änderung.
        const deleted = event.changes.filter((c) => c.kind === 'deleted');
        // Von aussen gelöschte Dateien fallen auch aus dem Navigationsverlauf (Review von Ticket 13).
        for (const c of deleted) {
          history.current.rename(c.path, null);
          if (lastPlace.current && isSameOrInside(lastPlace.current.path, c.path)) lastPlace.current = null;
        }
        const gone = tabsRef.current.filter((t) => deleted.some((c) => isSameOrInside(t.path, c.path))).map((t) => t.path);
        if (gone.length > 0) closeRef.current(gone, { saveCursor: false });
        const changed = new Set(event.changes.filter((c) => c.kind !== 'deleted').map((c) => pathKey(c.path)));
        for (const tab of tabsRef.current) {
          // Nach verpassten Ereignissen (`rescanned`) werden alle offenen Tabs geprüft.
          if (isDocumentTab(tab.path)) continue;
          if (event.rescanned || changed.has(pathKey(tab.path))) void reloadRef.current(tab.path);
        }
      }),
    [api],
  );

  /** „Load from Disk“: die fremde Fassung übernehmen, die eigenen Eingaben verwerfen. */
  const loadFromDisk = async (filePath: string) => {
    const key = pathKey(filePath);
    const entry = models.current.get(key);
    if (!entry) return;
    try {
      const content = await api.request('files.read', { path: filePath });
      if (models.current.get(key) !== entry) return;
      if (content.kind === 'text') applyDisk(key, entry, content);
      else void reloadRef.current(filePath);
    } catch (err) {
      callbacks.current.notify({ level: 'error', text: errorText(err) });
    }
  };

  /** „Keep Mine“: die eigene Fassung speichern. */
  const keepMine = (filePath: string) => {
    const key = pathKey(filePath);
    setConflict(key, false);
    void saveNow(key, true);
  };

  // Monaco öffnet andere Dateien (etwa Sprungziele) als Tab von Codium.
  useEffect(() => {
    const opener = monaco.editor.registerEditorOpener({
      openCodeEditor: (_source, resource, selectionOrPosition) => {
        // Dateien und Klassendateien von jdtls (Ticket 14); andere Adressen öffnet Monaco nicht.
        if (resource.scheme !== 'file' && resource.scheme !== 'jdt') return false;
        const model = monaco.editor.getModel(resource);
        const known = entryOfModel(model);
        const filePath = (known && tabPath(known[0])) ?? (resource.scheme === 'jdt' ? pathOfUri(resource) : windowsPath(resource.fsPath));
        open(filePath, { focus: true, ...(selectionOrPosition ? { target: selectionOrPosition } : {}) });
        return true;
      },
    });
    return () => opener.dispose();
  }, [entryOfModel, open]);

  // Dokument-Tabs (etwa das README von Codium) sind keine Dateien des Projekts: Sie heissen nach dem Dokument, bei
  // gleichem Namen wie eine Datei mit dem Zusatz „Codium“ (Review von Ticket 09).
  const labels = useMemo(() => {
    const fileLabels = tabLabels(
      tabs.map((t) => t.path).filter((p) => !isDocumentTab(p) && !isJdtPath(p)),
      project.path,
    );
    for (const tab of tabs) {
      if (!isDocumentTab(tab.path)) continue;
      if (tab.content?.kind === 'diff') {
        fileLabels.set(pathKey(tab.path), { name: tab.content.diff.title });
        continue;
      }
      const name = tab.path.slice(DOCUMENT_PREFIX.length);
      const clash = tabs.some((t) => !isDocumentTab(t.path) && fileLabels.get(pathKey(t.path))?.name.toLowerCase() === name.toLowerCase());
      fileLabels.set(pathKey(tab.path), clash ? { name, hint: 'Codium' } : { name });
    }
    // Klassendateien von jdtls (Ticket 14) heissen nach der Klasse.
    for (const tab of tabs) if (isJdtPath(tab.path)) fileLabels.set(pathKey(tab.path), { name: jdtTitle(tab.path) });
    return fileLabels;
  }, [tabs, project.path]);
  /** Tooltip und Detail eines Tabs: der Pfad im Projekt, bei Dokumenten ein Hinweis. */
  const tabDescription = (tabPath: string) =>
    isDiffTab(tabPath)
      ? `Diff of ${relativeLabel(project.path, (tabsRef.current.find((t) => t.path === tabPath)?.content as { diff?: DiffSpec } | null)?.diff?.filePath ?? '')}`
      : isDocumentTab(tabPath)
      ? `${tabPath.slice(DOCUMENT_PREFIX.length)} – comes with Codium (read-only)`
      : isJdtPath(tabPath)
        ? `${jdtTitle(tabPath)} – library class (read-only)`
        : relativeLabel(project.path, tabPath);
  const activeTab = active === null ? undefined : tabs.find((t) => pathKey(t.path) === pathKey(active));
  const showEditor = activeTab?.content?.kind === 'text';
  /** Eine Seite des Vergleichs ist keine Textdatei (Review von Ticket 17). */
  const diffUnavailable = (content: Extract<TabContent, { kind: 'diff' }>) => {
    if (content.original && 'binary' in content.original) return true;
    if (content.diff.modified.kind !== 'file') return false;
    const file = tabs.find((t) => pathKey(t.path) === pathKey(content.diff.filePath))?.content;
    return file != null && file.kind !== 'text' && file.kind !== 'loading';
  };
  const activeKey = activeTab ? pathKey(activeTab.path) : null;
  const activeView = activeKey !== null && showEditor ? markdownViews.get(activeKey) : undefined;
  // Beim Tabwechsel gilt die oberste Zeile des neuen Editors, nicht die des vorigen (Review von Ticket 23).
  useEffect(() => {
    reportTopLine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);
  const activeModel = activeKey !== null && activeView !== undefined && activeView !== 'editor' ? models.current.get(activeKey)?.model : undefined;

  const tabLabel = (tab: Tab) => labels.get(pathKey(tab.path)) ?? { name: tab.path };
  /** Nach einem Menü geht der Fokus in den Editor zurück, wenn er etwas zeigt. */
  const closeMenu = () => {
    setMenu(null);
    if (showEditorRef.current) editorRef.current?.focus();
  };
  const showEditorRef = useRef(showEditor);
  showEditorRef.current = showEditor;

  return (
    <>
      {hasTabs && (
        <div className="editor-tabs-bar">
          <div ref={tabListRef} className="editor-tabs" role="tablist" aria-label="Editor Tabs">
            {tabs.filter((t) => !t.hidden).map((tab) => {
              const key = pathKey(tab.path);
              const label = tabLabel(tab);
              const isActive = activeTab === tab;
              return (
                <div
                  key={key}
                  data-key={key}
                  role="tab"
                  className={`editor-tab${isActive ? ' active' : ''}${tab.pinned ? ' pinned' : ''}`}
                  aria-selected={isActive}
                  aria-label={label.hint ? `${label.name} – ${label.hint}` : label.name}
                  data-modified={dirty.has(key) ? 'true' : undefined}
                  data-pinned={tab.pinned ? 'true' : undefined}
                  title={tabDescription(tab.path)}
                  tabIndex={-1}
                  onMouseDown={(e) => {
                    if (e.button === 0) activate(tab.path, { focus: true });
                    // Mittelklick: ohne das Scrollen mit dem Mausrad, das Chromium sonst beginnt.
                    if (e.button === 1) e.preventDefault();
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) close(tab.path);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ kind: 'tab', path: tab.path, anchor: { x: e.clientX, y: e.clientY } });
                  }}
                >
                  <span className="editor-tab-icon">
                    <FileIcon />
                  </span>
                  <span className="editor-tab-name">{label.name}</span>
                  {label.hint && <span className="editor-tab-hint">{label.hint}</span>}
                  {dirty.has(key) && <span className="editor-tab-modified" title="Unsaved changes" />}
                  {tab.pinned ? (
                    <button
                      type="button"
                      className="editor-tab-close editor-tab-pin"
                      aria-label={`Unpin ${label.name}`}
                      title="Unpin Tab"
                      tabIndex={-1}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => setPinned(tab.path, false)}
                    >
                      <PinIcon />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="editor-tab-close"
                      aria-label={`Close ${label.name}`}
                      title="Close"
                      tabIndex={-1}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => close(tab.path)}
                    >
                      <CloseIcon />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {overflowing && (
            <button
              type="button"
              className="icon-button editor-tabs-all"
              aria-label="Show All Tabs"
              title="Show All Tabs"
              aria-haspopup="menu"
              onClick={(e) => setMenu({ kind: 'all', anchor: e.currentTarget })}
            >
              <ChevronDownIcon />
            </button>
          )}
        </div>
      )}
      {activeTab && conflicts.has(pathKey(activeTab.path)) && (
        <div className="editor-conflict" role="alert">
          <span className="editor-conflict-text">File changed on disk</span>
          <button type="button" onClick={() => void loadFromDisk(activeTab.path)}>
            Load from Disk
          </button>
          <button type="button" onClick={() => keepMine(activeTab.path)}>
            Keep Mine
          </button>
        </div>
      )}
      <div ref={bodyRef} className="editor-body">
        <div
          ref={hostRef}
          className="editor-host"
          style={
            !showEditor || activeView === 'preview'
              ? { display: 'none' }
              : activeView === 'split'
                ? { right: `${100 - splitPercent}%` }
                : undefined
          }
        />
        {activeView !== undefined && activeTab && (
          <>
            <div className="markdown-views" role="group" aria-label="Markdown View">
              {(['editor', 'split', 'preview'] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  className={activeView === view ? 'active' : undefined}
                  aria-pressed={activeView === view}
                  onClick={() => setMarkdownView(pathKey(activeTab.path), view, true)}
                >
                  {view === 'editor' ? 'Editor' : view === 'split' ? 'Split' : 'Preview'}
                </button>
              ))}
            </div>
            {activeView === 'split' && (
              <div
                className="markdown-splitter"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize Preview"
                style={{ left: `${splitPercent}%` }}
                onPointerDown={startSplitDrag}
              />
            )}
            {activeModel && (
              <div className="markdown-preview-host" style={activeView === 'split' ? { left: `${splitPercent}%` } : undefined}>
                <MarkdownPreview
                  key={activeKey}
                  api={api}
                  model={activeModel}
                  filePath={activeTab.path}
                  projectPath={project.path}
                  topLine={activeView === 'split' ? topLine : null}
                />
              </div>
            )}
          </>
        )}
        {activeTab?.content?.kind === 'diff' && (diffUnavailable(activeTab.content) ? (
          <div className="editor-notice" role="note">
            <p className="editor-notice-title">Binary files cannot be compared.</p>
          </div>
        ) : (
          <DiffView
            key={activeTab.path}
            title={activeTab.content.diff.title}
            original={activeTab.content.original && 'text' in activeTab.content.original ? activeTab.content.original.text : null}
            language={languageOfPath(activeTab.content.diff.filePath)}
            fontSize={fontSize}
            onEditor={(e) => (diffEditorRef.current = e)}
            modified={
              activeTab.content.diff.modified.kind === 'text'
                ? activeTab.content.diff.modified
                : (models.current.get(pathKey(activeTab.content.diff.filePath))?.model ?? null)
            }
          />
        ))}
        {!hasTabs && empty}
        {activeTab && !showEditor && <TabNotice tab={activeTab} />}
      </div>
      {rollback && (
        <ChangePopup
          block={rollback.block}
          x={rollback.x}
          y={rollback.y}
          onClose={() => {
            setRollback(null);
            editorRef.current?.focus();
          }}
          onRollback={() => {
            rollbackBlock(rollback.model, rollback.block);
            setRollback(null);
            changeBarsRef.current?.refreshNow();
            editorRef.current?.focus();
          }}
        />
      )}
      {menu?.kind === 'tab' && <Menu label="Editor Tab" entries={tabMenuEntries(menu.path)} anchor={menu.anchor} onClose={closeMenu} />}
      {menu?.kind === 'all' && (
        <Menu
          label="All Tabs"
          entries={tabs.filter((t) => !t.hidden).map((tab): MenuEntry => {
            const label = tabLabel(tab);
            return {
              kind: 'item',
              label: label.name,
              detail: label.hint ?? tabDescription(tab.path),
              run: () => activate(tab.path, { focus: true }),
            };
          })}
          anchor={menu.anchor}
          onClose={closeMenu}
        />
      )}
    </>
  );
});

/** Was ein Tab ohne Editor zeigt: Bild, Hinweise für Binärdateien und zu grosse Dateien, Laden. */
/** Alter Stand eines Änderungsblocks mit „Rollback Lines“ (Ticket 17). */
function ChangePopup({ block, x, y, onClose, onRollback }: { block: ChangeBlock; x: number; y: number; onClose: () => void; onRollback: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="change-popup"
      role="dialog"
      aria-label="Change"
      style={{ left: x + 8, top: y }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="change-popup-toolbar">
        <button type="button" onClick={onRollback}>
          Rollback Lines
        </button>
      </div>
      {block.oldLines.length > 0 ? (
        <pre className="change-popup-old" aria-label="Previous Content">
          {block.oldLines.join('\n')}
        </pre>
      ) : (
        <p className="change-popup-empty">Added lines</p>
      )}
    </div>
  );
}

function TabNotice({ tab }: { tab: Tab }) {
  const content = tab.content;
  if (content === null || content.kind === 'loading') return <div className="editor-notice" aria-busy="true" />;
  // Vergleichsansichten zeichnet der Code-Bereich selbst (DiffView).
  if (content.kind === 'diff') return null;
  if (content.kind === 'image') {
    return (
      <div className="editor-image" role="img" aria-label={`Image ${baseNameOf(tab.path)}`}>
        <img src={content.dataUrl} alt={baseNameOf(tab.path)} draggable={false} />
        <p className="editor-image-info">{formatSize(content.size)}</p>
      </div>
    );
  }
  if (content.kind === 'binary') {
    return (
      <div className="editor-notice" role="note">
        <p className="editor-notice-title">This file is binary and cannot be shown.</p>
        <p className="editor-notice-detail">{formatSize(content.size)}</p>
      </div>
    );
  }
  if (content.kind === 'tooLarge') {
    return (
      <div className="editor-notice" role="note">
        <p className="editor-notice-title">This file is too large to open.</p>
        <p className="editor-notice-detail">{`${formatSize(content.size)}. Codium opens files up to 50 MB.`}</p>
      </div>
    );
  }
  return null;
}

function baseNameOf(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf('\\') + 1);
}

/** Grösse zum Lesen, etwa „12.3 KB“ oder „60.0 MB“. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Ein Pfad aus einer Monaco-Adresse in der Schreibweise von Windows (Laufwerksbuchstabe gross). */
/**
 * Schreibgeschützt: Sprungziele in Bibliotheken (Typdefinitionen unter node_modules) und alles ausserhalb des Projekts.
 * Eine Datei unter node_modules, die man selbst im Baum öffnet, bleibt bearbeitbar.
 */
function libraryTab(filePath: string, projectPath: string): boolean {
  return isReadOnlyTarget(filePath) || !isInside(filePath, projectPath);
}

function isInside(filePath: string, projectPath: string): boolean {
  const file = filePath.toLowerCase();
  const root = projectPath.toLowerCase().replace(/[\\/]+$/, '');
  return file === root || file.startsWith(`${root}\\`) || file.startsWith(`${root}/`);
}

/** Inhalt eines Bibliotheksziels wie `files.read` (UTF-8, Zeilenende aus dem Text). */
function libraryContent(text: string): FileContent {
  return { kind: 'text', text, encoding: 'utf-8', lineEnding: text.includes('\r\n') ? 'CRLF' : 'LF', large: false, stamp: '' } as FileContent;
}

/** Eine Verwendung als Treffer für das Werkzeugfenster „Find“. */
function usageMatch(location: CodeLocation): SearchMatch {
  const { start, end } = location.range;
  return {
    path: location.path,
    line: start.line + 1,
    column: start.character + 1,
    length: end.line === start.line ? Math.max(1, end.character - start.character) : 1,
    lineText: location.lineText ?? '',
    lineOffset: 0,
  };
}

function windowsPath(fsPath: string): string {
  return /^[a-z]:/.test(fsPath) ? fsPath[0].toUpperCase() + fsPath.slice(1) : fsPath;
}
