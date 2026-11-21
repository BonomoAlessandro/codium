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
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  type CodiumApi,
  type CursorState,
  type FileOperation,
  type LineEnding,
  type ProjectInfo,
  type TextEncoding,
} from '../../shared/types';
import { errorText } from '../errors';
import { ChevronDownIcon, CloseIcon, FileIcon, PinIcon } from '../icons';
import { shortcutLabel, type KeyCommand, type ToolWindowCommand } from '../keymap';
import type { Notify } from '../Notices';
import { Menu, type MenuAnchor, type MenuEntry } from '../popup/Menu';
import { isSameOrInside, movedPath, pathKey, relativeLabel } from '../project/filePaths';
import { EDITOR_ACTIONS } from './editorActions';
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
}

/** Was ein Tab zeigt; `null`, solange die Datei noch nicht gelesen wurde. */
type TabContent =
  | { kind: 'loading' }
  | { kind: 'text'; encoding: TextEncoding; lineEnding: LineEnding; large: boolean }
  | { kind: 'image'; dataUrl: string; size: number }
  | { kind: 'binary'; size: number }
  | { kind: 'tooLarge'; size: number };

interface Tab {
  path: string;
  content: TabContent | null;
  /** Angeheftet: steht links und bleibt bei „Close All Tabs“ und „Close Other Tabs“ offen. */
  pinned: boolean;
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
  listener: monaco.IDisposable;
}

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
}

export const EditorArea = forwardRef<EditorAreaHandle, EditorAreaProps>(function EditorArea(
  { api, project, notify, fontSize, onActiveFileChange, onStatusChange, empty },
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

  /** Speichert Reihenfolge und aktiven Tab im Kern. */
  const persistTabs = useCallback(() => {
    if (!restored.current) return;
    api
      .request('project.setTabs', {
        tabs: tabsRef.current.map((t) => t.path),
        active: activeRef.current,
        pinned: tabsRef.current.filter((t) => t.pinned).map((t) => t.path),
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
    if (filePath === undefined) return;
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
      const listener = model.onDidChangeContent(() => updateDirty(key));
      models.current.set(key, { model, savedVersion, viewState: null, initialCursor: null, target: null, ...extra, listener });
      updateDirty(key);
    },
    [updateDirty],
  );

  /** Gibt das Modell einer Datei frei; zeigt der Editor es gerade, zeigt er danach nichts. */
  const disposeModel = useCallback((key: string) => {
    const entry = models.current.get(key);
    if (!entry) return;
    if (editorRef.current?.getModel() === entry.model) editorRef.current.setModel(null);
    entry.listener.dispose();
    entry.model.dispose();
    models.current.delete(key);
    updateDirty(key);
  }, [updateDirty]);

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
          api.request('files.read', { path: filePath }),
          api.request('project.cursor', { path: filePath }),
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
        const uri = monaco.Uri.file(current);
        disposeModel(key);
        monaco.editor.getModel(uri)?.dispose();
        const model = monaco.editor.createModel(content.text, languageOf(current), uri);
        model.setEOL(content.lineEnding === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF);
        addModel(key, model, model.getAlternativeVersionId(), { initialCursor: cursor });
        // Der Kern merkt sich `large` (ab 5 MB): Sprach-Dienst (Ticket 12) und Änderungsbalken (Ticket 17) bleiben für
        // solche Tabs aus.
        setContent(key, { kind: 'text', encoding: content.encoding, lineEnding: content.lineEnding, large: content.large });
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

  /** Ziele für Tabs, deren Modell es noch nicht gibt. */
  const pendingTargets = useRef(new Map<string, EditorTarget>());

  const open = useCallback(
    (filePath: string, options: OpenOptions = {}) => {
      const next = withTab(
        tabsRef.current.map((t) => t.path),
        filePath,
      );
      if (next.length !== tabsRef.current.length) setTabs([...tabsRef.current, { path: filePath, content: null, pinned: false }]);
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
      const shownKey = entryOfModel(editorRef.current?.getModel() ?? null)?.[0];
      if (shownKey !== undefined && keys.has(shownKey)) {
        if (saveCursor) saveCursorNow();
        else if (cursorTimer.current !== null) {
          window.clearTimeout(cursorTimer.current);
          cursorTimer.current = null;
        }
      }
      let result = { tabs: tabsRef.current.map((t) => t.path), active: activeRef.current };
      for (const t of tabsRef.current) if (keys.has(pathKey(t.path))) result = withoutTab(result.tabs, result.active, t.path);
      for (const key of keys) {
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
  const close = useCallback((filePath: string) => closeTabs([filePath]), [closeTabs]);

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
      switching.current ??= { order: recentOrder(tabsRef.current, recent.current), index: 0 };
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
        default:
          // Kürzel späterer Tickets: im Editor abfangen, damit Monacos eigene Belegung nicht wirkt.
          return editor?.hasWidgetFocus() ?? false;
      }
    },
    [close, switchRecent],
  );

  useImperativeHandle(ref, () => ({ open, handleCommand }), [open, handleCommand]);

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
      run: () => closeTabs(closing(action)),
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
      listeners.push(
        editor.onDidChangeCursorPosition(() => {
          reportStatus();
          scheduleCursorSave();
        }),
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
      editor.focus();
    }
    reportStatus();
    // `tabs` gehört dazu: Erst wenn der Inhalt gelesen ist, gibt es das Modell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tabs, editorReady]);

  // Den aktiven Datei-Tab melden (für „Select Opened File“).
  useEffect(() => {
    callbacks.current.onActiveFileChange(active);
  }, [active]);

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
      const model = monaco.editor.createModel(entry.model.getValue(), languageOf(newPath), monaco.Uri.file(newPath));
      model.setEOL(entry.model.getEndOfLineSequence());
      disposeModel(oldKey);
      addModel(pathKey(newPath), model, wasDirty ? -1 : model.getAlternativeVersionId(), { viewState });
    }
    // Tabs, die gerade lesen, lesen unter dem neuen Pfad neu (der alte Lesevorgang zählt nicht mehr).
    const interrupted = new Set(affected.map((t) => pathKey(t.path)).filter((key) => loads.current.delete(key)));
    const renamed = tabsRef.current.map((t) => {
      if (!isSameOrInside(t.path, op.from)) return t;
      const moved = movedPath(t.path, op.from, op.to);
      return interrupted.has(pathKey(t.path)) ? { ...t, path: moved, content: null } : { ...t, path: moved };
    });
    setTabs(renamed);
    if (activeRef.current !== null && isSameOrInside(activeRef.current, op.from)) {
      const activePath = movedPath(activeRef.current, op.from, op.to);
      setActive(activePath);
      if (renamed.find((t) => pathKey(t.path) === pathKey(activePath))?.content === null) void load(activePath);
    }
    persistTabs();
  };
  useEffect(() => api.on('files.operation', (op) => onOperation.current(op)), [api]);

  // Monaco öffnet andere Dateien (etwa Sprungziele) als Tab von Codium.
  useEffect(() => {
    const opener = monaco.editor.registerEditorOpener({
      openCodeEditor: (_source, resource, selectionOrPosition) => {
        if (resource.scheme !== 'file') return false;
        const model = monaco.editor.getModel(resource);
        const known = entryOfModel(model);
        const filePath = (known && tabPath(known[0])) ?? windowsPath(resource.fsPath);
        open(filePath, { focus: true, ...(selectionOrPosition ? { target: selectionOrPosition } : {}) });
        return true;
      },
    });
    return () => opener.dispose();
  }, [entryOfModel, open]);

  const labels = useMemo(() => tabLabels(tabs.map((t) => t.path), project.path), [tabs, project.path]);
  const activeTab = active === null ? undefined : tabs.find((t) => pathKey(t.path) === pathKey(active));
  const showEditor = activeTab?.content?.kind === 'text';

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
            {tabs.map((tab) => {
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
                  title={relativeLabel(project.path, tab.path)}
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
      <div ref={bodyRef} className="editor-body">
        <div ref={hostRef} className="editor-host" style={showEditor ? undefined : { display: 'none' }} />
        {!hasTabs && empty}
        {activeTab && !showEditor && <TabNotice tab={activeTab} />}
      </div>
      {menu?.kind === 'tab' && <Menu label="Editor Tab" entries={tabMenuEntries(menu.path)} anchor={menu.anchor} onClose={closeMenu} />}
      {menu?.kind === 'all' && (
        <Menu
          label="All Tabs"
          entries={tabs.map((tab): MenuEntry => {
            const label = tabLabel(tab);
            return {
              kind: 'item',
              label: label.name,
              detail: label.hint ?? relativeLabel(project.path, tab.path),
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
function TabNotice({ tab }: { tab: Tab }) {
  const content = tab.content;
  if (content === null || content.kind === 'loading') return <div className="editor-notice" aria-busy="true" />;
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
function windowsPath(fsPath: string): string {
  return /^[a-z]:/.test(fsPath) ? fsPath[0].toUpperCase() + fsPath.slice(1) : fsPath;
}
