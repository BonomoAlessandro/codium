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

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  CodiumApi,
  CursorState,
  FileOperation,
  LineEnding,
  ProjectInfo,
  TextEncoding,
} from '../../shared/types';
import { errorText } from '../errors';
import { CloseIcon, FileIcon } from '../icons';
import type { Notify } from '../Notices';
import { isSameOrInside, movedPath, pathKey, relativeLabel } from '../project/filePaths';
import { EDITOR_FONT_FAMILY, editorFontReady, languageOf, monaco } from './monaco';
import { tabLabels, withTab, withoutTab } from './tabs';

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

export interface EditorAreaHandle {
  /** Öffnet eine Datei als Tab oder aktiviert ihren Tab. */
  open(path: string, options?: OpenOptions): void;
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
}

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
      .request('project.setTabs', { tabs: tabsRef.current.map((t) => t.path), active: activeRef.current })
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

  /** Liest die Datei eines Tabs und legt bei Text ihr Modell an. */
  const load = useCallback(
    async (filePath: string) => {
      const key = pathKey(filePath);
      setContent(key, { kind: 'loading' });
      try {
        const [content, cursor] = await Promise.all([
          api.request('files.read', { path: filePath }),
          api.request('project.cursor', { path: filePath }),
        ]);
        // Während des Lesens geschlossen oder umbenannt: nichts mehr anlegen.
        const current = tabPath(key);
        if (current === undefined) return;
        if (content.kind !== 'text') {
          setContent(key, content.kind === 'image' ? { kind: 'image', dataUrl: content.dataUrl, size: content.size } : { kind: content.kind, size: content.size });
          return;
        }
        const model = monaco.editor.createModel(content.text, languageOf(current), monaco.Uri.file(current));
        model.setEOL(content.lineEnding === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF);
        addModel(key, model, model.getAlternativeVersionId(), { initialCursor: cursor });
        setContent(key, { kind: 'text', encoding: content.encoding, lineEnding: content.lineEnding, large: content.large });
      } catch (err) {
        // Die Datei lässt sich nicht lesen (etwa inzwischen gelöscht): Der Tab schliesst, die Meldung sagt warum.
        callbacks.current.notify({ level: 'error', text: errorText(err) });
        closeRef.current(filePath);
      }
    },
    [addModel, api, setContent],
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
      if (next.length !== tabsRef.current.length) setTabs([...tabsRef.current, { path: filePath, content: null }]);
      activate(filePath, options);
      persistTabs();
    },
    [activate, persistTabs, setTabs],
  );

  const close = useCallback(
    (filePath: string) => {
      const key = pathKey(filePath);
      if (editorRef.current && entryOfModel(editorRef.current.getModel())?.[0] === key) saveCursorNow();
      const result = withoutTab(
        tabsRef.current.map((t) => t.path),
        activeRef.current,
        filePath,
      );
      disposeModel(key);
      pendingTargets.current.delete(key);
      setTabs(tabsRef.current.filter((t) => pathKey(t.path) !== key));
      if (result.active === null) setActive(null);
      else if (activeRef.current === null || pathKey(result.active) !== pathKey(activeRef.current)) {
        activeRef.current = null;
        activate(result.active);
      }
      persistTabs();
    },
    [activate, disposeModel, entryOfModel, persistTabs, saveCursorNow, setActive, setTabs],
  );
  const closeRef = useRef(close);
  closeRef.current = close;

  useImperativeHandle(ref, () => ({ open }), [open]);

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
    return () => {
      disposed = true;
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
          const merged = [...saved.tabs.filter((p) => !opened.some((t) => pathKey(t.path) === pathKey(p))).map((p) => ({ path: p, content: null })), ...opened];
          setTabs(merged);
          persistTabs();
          return;
        }
        setTabs(saved.tabs.map((p) => ({ path: p, content: null })));
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
      for (const tab of tabsRef.current.filter((t) => isSameOrInside(t.path, op.path))) close(tab.path);
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
    const renamed = tabsRef.current.map((t) => (isSameOrInside(t.path, op.from) ? { ...t, path: movedPath(t.path, op.from, op.to) } : t));
    setTabs(renamed);
    if (activeRef.current !== null && isSameOrInside(activeRef.current, op.from)) setActive(movedPath(activeRef.current, op.from, op.to));
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

  return (
    <>
      {tabs.length > 0 && (
        <div className="editor-tabs" role="tablist" aria-label="Editor Tabs">
          {tabs.map((tab) => {
            const key = pathKey(tab.path);
            const label = labels.get(key) ?? { name: tab.path };
            const isActive = activeTab === tab;
            return (
              <div
                key={key}
                role="tab"
                className={isActive ? 'editor-tab active' : 'editor-tab'}
                aria-selected={isActive}
                aria-label={label.hint ? `${label.name} – ${label.hint}` : label.name}
                data-modified={dirty.has(key) ? 'true' : undefined}
                title={relativeLabel(project.path, tab.path)}
                tabIndex={-1}
                onMouseDown={(e) => {
                  if (e.button === 0) activate(tab.path, { focus: true });
                }}
              >
                <span className="editor-tab-icon">
                  <FileIcon />
                </span>
                <span className="editor-tab-name">{label.name}</span>
                {label.hint && <span className="editor-tab-hint">{label.hint}</span>}
                {dirty.has(key) && <span className="editor-tab-modified" title="Unsaved changes" />}
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
              </div>
            );
          })}
        </div>
      )}
      <div className="editor-body">
        <div ref={hostRef} className="editor-host" style={showEditor ? undefined : { display: 'none' }} />
        {tabs.length === 0 && empty}
        {activeTab && !showEditor && <TabNotice tab={activeTab} />}
      </div>
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
