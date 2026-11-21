// Projektsuche (Ctrl + Shift + F) wie in IntelliJ: Suchfeld mit „Match case“, „Words“, „Regex“, Dateimaske und
// „include ignored“; die Treffer kommen gestreamt schon während des Tippens (eine neue Eingabe bricht die laufende
// Suche ab), darunter die Vorschau der Fundstelle in Monaco mit Farben. Enter oder Doppelklick öffnet die Datei an der
// Fundstelle; „Open in Find Window“ legt die Liste im Werkzeugfenster „Find“ ab.

import { useEffect, useRef, useState } from 'react';
import type { CodiumApi, Events, ProjectInfo, SearchMatch, SearchOptions } from '../../shared/types';
import { errorText } from '../errors';
import { EDITOR_FONT_FAMILY, languageOf, monaco } from '../editor/monaco';
import { baseName } from '../project/filePaths';
import { QuickPopup } from './QuickPopup';
import { matchParts, moveSelection } from './searchResults';

/** Was eine abgeschlossene oder laufende Suche geliefert hat. */
export interface SearchOutcome {
  options: SearchOptions;
  matches: SearchMatch[];
  limitReached: boolean;
}

interface FindInFilesPopupProps {
  api: CodiumApi;
  project: ProjectInfo;
  /** Die Optionen der letzten Suche (bleiben über das Schliessen hinweg). */
  initial: SearchOptions;
  fontSize: number;
  onOptions: (options: SearchOptions) => void;
  onOpenMatch: (match: SearchMatch) => void;
  onOpenInFindWindow: (outcome: SearchOutcome) => void;
  onClose: () => void;
}

/** Zeilen davor und danach, die die Vorschau zeigt. */
const PREVIEW_CONTEXT_LINES = 4;

export function FindInFilesPopup({ api, project, initial, fontSize, onOptions, onOpenMatch, onOpenInFindWindow, onClose }: FindInFilesPopupProps) {
  const [options, setOptionsState] = useState(initial);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [state, setState] = useState<{ running: boolean; limitReached: boolean; error: string | null }>({
    running: false,
    limitReached: false,
    error: null,
  });
  const [selected, setSelected] = useState(0);
  /** Kennung der aktuellen Suche im Kern; `null`, solange keine läuft oder ihre Antwort noch aussteht. */
  const searchId = useRef<number | null>(null);
  /** Nummer der letzten Anfrage; nur deren Antwort zählt (Review von Ticket 08). */
  const requestSeq = useRef(0);
  /** Treffer, die vor der Antwort mit ihrer Kennung ankamen. */
  const early = useRef(new Map<number, Array<Events['search.results']>>());
  const closed = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Beim Öffnen ist der letzte Suchtext ausgewählt, wie in IntelliJ: Tippen ersetzt ihn.
  useEffect(() => inputRef.current?.select(), []);

  const setOptions = (next: SearchOptions) => {
    setOptionsState(next);
    onOptions(next);
  };

  /** Übernimmt Treffer der aktuellen Suche. */
  const apply = (event: { matches: SearchMatch[]; done: boolean; limitReached?: true; error?: string }) => {
    if (event.matches.length > 0) setMatches((current) => [...current, ...event.matches]);
    if (event.done) {
      setState({ running: false, limitReached: event.limitReached === true, error: event.error ?? null });
      searchId.current = null;
    }
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // Treffer der laufenden Suche einsammeln; Treffer vor der Antwort mit der Kennung werden aufgehoben.
  useEffect(
    () =>
      api.on('search.results', (event) => {
        if (event.searchId === searchId.current) {
          applyRef.current(event);
          return;
        }
        if (searchId.current === null && requestSeq.current > 0) {
          const list = early.current.get(event.searchId) ?? [];
          list.push(event);
          early.current.set(event.searchId, list);
        }
      }),
    [api],
  );

  // Jede Änderung startet nach einer kurzen Pause eine neue Suche; der Kern bricht die laufende ab.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMatches([]);
      setSelected(0);
      const seq = ++requestSeq.current;
      searchId.current = null;
      early.current.clear();
      if (options.query === '') {
        setState({ running: false, limitReached: false, error: null });
        return;
      }
      setState({ running: true, limitReached: false, error: null });
      api.request('search.start', options).then(
        (result) => {
          if (closed.current) {
            // Das Fenster ist zu: Die Suche braucht niemand mehr.
            void api.request('search.cancel', { searchId: result.searchId }).catch(() => {});
            return;
          }
          if (seq !== requestSeq.current) return;
          searchId.current = result.searchId;
          for (const event of early.current.get(result.searchId) ?? []) applyRef.current(event);
          early.current.clear();
        },
        (err: unknown) => {
          if (seq === requestSeq.current) setState({ running: false, limitReached: false, error: errorText(err) });
        },
      );
    }, 120);
    return () => window.clearTimeout(timer);
  }, [api, options]);

  // Beim Schliessen die laufende Suche abbrechen (auch eine, deren Antwort noch aussteht, siehe oben).
  useEffect(
    () => () => {
      closed.current = true;
      const id = searchId.current;
      if (id !== null) void api.request('search.cancel', { searchId: id }).catch(() => {});
    },
    [api],
  );

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const open = (index: number) => {
    const match = matches[index];
    if (!match) return;
    onClose();
    onOpenMatch(match);
  };

  const toggle = (key: 'matchCase' | 'wholeWord' | 'regex', label: string, text: string) => (
    <button
      type="button"
      className={`quick-popup-toggle${options[key] ? ' active' : ''}`}
      aria-label={label}
      aria-pressed={options[key]}
      title={label}
      onClick={() => setOptions({ ...options, [key]: !options[key] })}
    >
      {text}
    </button>
  );

  const status = state.error
    ? state.error
    : state.limitReached
      ? `${matches.length}+ matches, more results`
      : state.running
        ? `${matches.length} matches…`
        : options.query === ''
          ? ''
          : `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`;

  return (
    <QuickPopup label="Find in Files" className="find-popup" onClose={onClose}>
      <div className="quick-popup-header">
        <span className="quick-popup-title">Find in Files</span>
        <label className="quick-popup-option">
          <input
            type="checkbox"
            checked={options.includeIgnored}
            onChange={(e) => setOptions({ ...options, includeIgnored: e.target.checked })}
          />
          include ignored
        </label>
        <input
          className="find-popup-mask"
          aria-label="File mask"
          placeholder="File mask, e.g. *.java"
          value={options.fileMask}
          spellCheck={false}
          onChange={(e) => setOptions({ ...options, fileMask: e.target.value })}
        />
      </div>
      <div className="find-popup-query">
        <input
          className="quick-popup-input"
          ref={inputRef}
          aria-label="Search text"
          placeholder="Search text"
          value={options.query}
          autoFocus
          spellCheck={false}
          onChange={(e) => setOptions({ ...options, query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              open(selected);
              return;
            }
            const next = moveSelection(selected, matches.length, e.key);
            if (next !== selected) {
              e.preventDefault();
              setSelected(next);
            }
          }}
        />
        {toggle('matchCase', 'Match case', 'Cc')}
        {toggle('wholeWord', 'Words', 'W')}
        {toggle('regex', 'Regex', '.*')}
      </div>
      <div ref={listRef} className="quick-popup-list find-popup-list" role="listbox" aria-label="Search Results">
        {matches.map((match, i) => (
          <div
            key={`${match.path}:${match.line}:${match.column}`}
            role="option"
            aria-selected={i === selected}
            className={`find-popup-item${i === selected ? ' selected' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              setSelected(i);
            }}
            onDoubleClick={() => open(i)}
          >
            <span className="find-popup-line">
              {matchParts(match).map((part, j) => (part.marked ? <mark key={j}>{part.text}</mark> : <span key={j}>{part.text}</span>))}
            </span>
            <span className="quick-popup-detail">{`${baseName(match.path)} ${match.line}`}</span>
          </div>
        ))}
      </div>
      <Preview api={api} match={matches[selected] ?? null} fontSize={fontSize} />
      <div className="find-popup-footer">
        <span className="find-popup-status" role="status">
          {status}
        </span>
        <button
          type="button"
          disabled={matches.length === 0 || state.running}
          title={state.running ? 'Available when the search is complete' : undefined}
          onClick={() => {
            onClose();
            onOpenInFindWindow({ options, matches, limitReached: state.limitReached });
          }}
        >
          Open in Find Window
        </button>
      </div>
      <span hidden>{project.name}</span>
    </QuickPopup>
  );
}

/**
 * Vorschau der Fundstelle in einem schreibgeschützten Monaco mit Farben. Ist die Datei in einem Tab offen, zeigt sie
 * dessen Modell (ein Modell pro Datei); sonst ein eigenes Vorschau-Modell, das mit dem Fenster verschwindet.
 */
function Preview({ api, match, fontSize }: { api: CodiumApi; match: SearchMatch | null; fontSize: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const previews = useRef(new Map<string, monaco.editor.ITextModel>());
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const editor = monaco.editor.create(host, {
      model: null,
      readOnly: true,
      domReadOnly: true,
      fontFamily: EDITOR_FONT_FAMILY,
      fontSize,
      lineHeight: 1.4,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      contextmenu: false,
      folding: false,
      links: false,
      automaticLayout: true,
      ariaLabel: 'Preview',
    });
    editorRef.current = editor;
    decorations.current = editor.createDecorationsCollection();
    const models = previews.current;
    return () => {
      editor.dispose();
      editorRef.current = null;
      for (const model of models.values()) model.dispose();
      models.clear();
    };
    // Einmal pro Fenster; die Schriftgrösse gilt beim Öffnen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    const editor = editorRef.current;
    if (!editor) return;
    if (!match) {
      editor.setModel(null);
      return;
    }
    const show = (model: monaco.editor.ITextModel) => {
      if (!live) return;
      editor.setModel(model);
      const range = new monaco.Range(match.line, match.column, match.line, match.column + match.length);
      decorations.current?.set([{ range, options: { inlineClassName: 'find-preview-match' } }]);
      editor.revealLinesInCenter(Math.max(1, match.line - PREVIEW_CONTEXT_LINES), match.line + PREVIEW_CONTEXT_LINES);
    };
    const shared = monaco.editor.getModel(monaco.Uri.file(match.path));
    if (shared) {
      show(shared);
      return;
    }
    const cached = previews.current.get(match.path);
    if (cached) {
      show(cached);
      return;
    }
    api.request('files.read', { path: match.path }).then(
      (content) => {
        if (!live || content.kind !== 'text' || content.large) return;
        const uri = monaco.Uri.from({ scheme: 'codium-preview', path: `/${match.path.replaceAll('\\', '/')}` });
        const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(content.text, languageOf(match.path), uri);
        previews.current.set(match.path, model);
        show(model);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, match]);

  return <div ref={hostRef} className="find-popup-preview" aria-label="Preview" />;
}
