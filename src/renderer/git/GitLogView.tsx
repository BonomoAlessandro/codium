// Reiter „Log“ im Werkzeugfenster „Git“ (Ticket 19): Liste mit Graph, Betreff, Etiketten, Autor und Datum, die beim
// Scrollen nachlädt; Filter nach Text (Nachricht oder Hash-Anfang), Branch und Autor; rechts die Dateien und Details
// des gewählten Commits. Den Graph rechnet der Git-Dienst, hier wird nur gezeichnet. Gezeigt werden nur die sichtbaren
// Zeilen, damit auch einige tausend Commits flüssig scrollen.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CodiumApi, GitBranches, GitCommitDetails, GitGraphRow, GitLogCommit, GitLogFilter } from '../../shared/types';
import { errorText } from '../errors';
import { Menu, type MenuEntry } from '../popup/Menu';
import type { Notify } from '../Notices';

const ROW_HEIGHT = 24;
const LANE_WIDTH = 14;
/** So nah am Ende der Liste (in Zeilen) lädt die nächste Seite. */
const PREFETCH_ROWS = 60;
const COLORS = ['#4b8ce8', '#d9822b', '#4caf6a', '#c75cc2', '#d6b33d', '#3fb6b2', '#e0605e', '#8d8de6'];

interface GitLogViewProps {
  api: CodiumApi;
  notify: Notify;
  /** Vergleich einer Datei des Commits gegen den ersten Elterncommit (schreibgeschützt, Ticket 17). */
  onShowDiff: (details: GitCommitDetails, file: GitCommitDetails['files'][number]) => void;
  /** „New Branch…“ ab einem Commit (Dialog des Projektfensters). */
  onNewBranch: (from: string) => void;
}

export function GitLogView({ api, notify, onShowDiff, onNewBranch }: GitLogViewProps) {
  const [filter, setFilter] = useState<GitLogFilter>({});
  const [textInput, setTextInput] = useState('');
  const [authorInput, setAuthorInput] = useState('');
  const [commits, setCommits] = useState<GitLogCommit[]>([]);
  const [graph, setGraph] = useState(true);
  const [done, setDone] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<GitCommitDetails | null>(null);
  const [branches, setBranches] = useState<GitBranches | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; hash: string } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const listRef = useRef<HTMLDivElement>(null);
  /** Der Stand, zu dem die geladenen Zeilen gehören; eine Antwort zu einem älteren Stand fällt weg. */
  const loading = useRef<Promise<void> | null>(null);
  const version = useRef<number | null>(null);
  const request = useRef(0);

  // Text und Autor wirken entprellt.
  useEffect(() => {
    const timer = window.setTimeout(() => setFilter((f) => ({ ...f, text: textInput.trim() || undefined, author: authorInput.trim() || undefined })), 300);
    return () => window.clearTimeout(timer);
  }, [textInput, authorInput]);

  /** Lädt ab `offset`; mit 0 von vorn (behält die Auswahl, wenn der Commit noch da ist). */
  const load = useCallback(
    async (offset: number) => {
      const id = ++request.current;
      const page = await api.request('git.log', { filter, offset }).catch((err: unknown) => {
        notify({ level: 'error', text: errorText(err) });
        return null;
      });
      if (!page || id !== request.current) return;
      // Ein neuer Stand im Kern (Refs geändert): von vorn.
      if (offset > 0 && page.version !== version.current) {
        void load(0);
        return;
      }
      version.current = page.version;
      setGraph(page.graph);
      setDone(page.done);
      setCommits((current) => (offset === 0 ? page.commits : [...current.slice(0, offset), ...page.commits]));
      if (offset === 0) setSelected((s) => (s !== null && page.commits.some((c) => c.hash === s) ? s : null));
    },
    [api, filter, notify],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  // Nach eigenen Git-Aktionen und bei Änderungen an den Refs (auch nach Fetch) neu laden.
  useEffect(() => api.on('git.refsChanged', () => void load(0)), [api, load]);

  useEffect(() => {
    let live = true;
    const read = () =>
      api.request('git.branches').then(
        (b) => live && setBranches(b),
        () => {},
      );
    void read();
    const off = api.on('git.refsChanged', () => void read());
    return () => {
      live = false;
      off();
    };
  }, [api]);

  // Details des gewählten Commits.
  useEffect(() => {
    if (selected === null) {
      setDetails(null);
      return;
    }
    let live = true;
    api.request('git.commitDetails', { hash: selected }).then(
      (d) => live && setDetails(d),
      (err: unknown) => live && notify({ level: 'error', text: errorText(err) }),
    );
    return () => {
      live = false;
    };
  }, [api, notify, selected]);

  // Höhe der Liste (für die sichtbaren Zeilen).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    setHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
  const last = Math.min(commits.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + 10);

  // Nachladen beim Scrollen.
  useEffect(() => {
    if (done || loading.current || commits.length === 0 || last < commits.length - PREFETCH_ROWS) return;
    loading.current = load(commits.length).finally(() => {
      loading.current = null;
    });
  }, [commits.length, done, last, load]);

  const lanes = useMemo(() => {
    let max = 0;
    for (const c of commits) {
      if (!c.graph) continue;
      max = Math.max(max, c.graph.column, ...c.graph.lines.map((l) => Math.max(l.from, l.to)));
    }
    return max + 1;
  }, [commits]);
  const authors = useMemo(() => [...new Set(commits.map((c) => c.author))].sort((a, b) => a.localeCompare(b)), [commits]);

  const select = (index: number) => {
    const c = commits[Math.max(0, Math.min(commits.length - 1, index))];
    if (!c) return;
    setSelected(c.hash);
    const el = listRef.current;
    if (el) {
      const top = commits.indexOf(c) * ROW_HEIGHT;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    }
  };

  const menuEntries = (hash: string): MenuEntry[] => [
    {
      kind: 'item',
      label: 'Copy Revision Number',
      run: () => void api.request('git.copyRevision', { hash }).catch((err: unknown) => notify({ level: 'error', text: errorText(err) })),
    },
    { kind: 'item', label: 'New Branch…', run: () => onNewBranch(hash) },
    {
      kind: 'item',
      label: 'Checkout Revision',
      run: () => void api.request('git.checkoutRevision', { hash }).catch((err: unknown) => notify({ level: 'error', text: errorText(err) })),
    },
  ];

  const selectedIndex = selected === null ? -1 : commits.findIndex((c) => c.hash === selected);

  return (
    <div className="git-log">
      <div className="git-log-main">
        <div className="git-log-filters" role="toolbar" aria-label="Log Filters">
          <input type="search" aria-label="Filter Log" placeholder="Text or hash" value={textInput} onChange={(e) => setTextInput(e.target.value)} />
          <select aria-label="Branch" value={filter.branch ?? ''} onChange={(e) => setFilter((f) => ({ ...f, branch: e.target.value || undefined }))}>
            <option value="">All branches</option>
            {branches?.local.map((b) => (
              <option key={`l:${b.name}`} value={b.name}>
                {b.name}
              </option>
            ))}
            {branches?.remote.map((b) => (
              <option key={`r:${b.name}`} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
          <input type="search" aria-label="Author" placeholder="Author" list="git-log-authors" value={authorInput} onChange={(e) => setAuthorInput(e.target.value)} />
          <datalist id="git-log-authors">
            {authors.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
        <div
          ref={listRef}
          className="git-log-list"
          role="listbox"
          aria-label="Commits"
          tabIndex={0}
          aria-activedescendant={selectedIndex >= 0 ? `commit-${commits[selectedIndex].hash}` : undefined}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              select(selectedIndex + (e.key === 'ArrowDown' ? 1 : -1));
            }
          }}
        >
          {commits.length === 0 && <p className="tool-window-placeholder">{done ? 'No commits' : 'Loading…'}</p>}
          <div style={{ height: commits.length * ROW_HEIGHT, position: 'relative' }}>
            {commits.slice(first, last).map((c, i) => {
              const index = first + i;
              return (
                <div
                  key={c.hash}
                  id={`commit-${c.hash}`}
                  role="option"
                  aria-selected={c.hash === selected}
                  aria-label={c.subject}
                  className={`git-log-row${c.hash === selected ? ' selected' : ''}`}
                  style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
                  onMouseDown={(e) => {
                    if (e.button === 0 || e.button === 2) setSelected(c.hash);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, hash: c.hash });
                  }}
                >
                  {graph && <GraphCell row={c.graph} previous={commits[index - 1]?.graph} lanes={lanes} />}
                  <span className="git-log-subject">
                    {c.refs.map((r) => (
                      <span key={`${r.kind}:${r.name}`} className={`git-log-ref ${r.kind}`}>
                        {r.name}
                      </span>
                    ))}
                    {c.subject}
                  </span>
                  <span className="git-log-author">{c.author}</span>
                  <span className="git-log-date">{formatDate(c.date)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="git-log-details">
        {details ? (
          <>
            <div className="git-log-files" role="tree" aria-label="Changed Files">
              {details.files.map((f) => (
                <div
                  key={f.repoPath}
                  role="treeitem"
                  aria-label={baseName(f.repoPath)}
                  className={`commit-file git-${statusKind(f.status)}`}
                  title={f.origRepoPath ? `${f.origRepoPath} → ${f.repoPath}` : f.repoPath}
                  onDoubleClick={() => onShowDiff(details, f)}
                >
                  <span className="commit-file-name">{baseName(f.repoPath)}</span>
                  <span className="commit-file-folder">{folderOf(f.repoPath)}</span>
                </div>
              ))}
              {details.files.length === 0 && <p className="tool-window-placeholder">No changed files</p>}
            </div>
            <div className="git-log-message" aria-label="Commit Details">
              <pre>{details.message}</pre>
              <p>
                <span className="git-log-hash">{details.hash.slice(0, 10)}</span> {details.author} &lt;{details.email}&gt; {formatDate(details.date)}
              </p>
            </div>
          </>
        ) : (
          <p className="tool-window-placeholder">Select a commit</p>
        )}
      </div>
      {menu && <Menu label="Commit" entries={menuEntries(menu.hash)} anchor={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Zeichnet eine Zeile des Graphs: die untere Hälfte der eigenen Linien, die obere Hälfte der Linien von oben. */
function GraphCell({ row, previous, lanes }: { row?: GitGraphRow; previous?: GitGraphRow; lanes: number }) {
  const x = (column: number) => column * LANE_WIDTH + LANE_WIDTH / 2;
  const mid = ROW_HEIGHT / 2;
  const color = (n: number) => COLORS[n % COLORS.length];
  return (
    <svg className="git-log-graph" width={lanes * LANE_WIDTH} height={ROW_HEIGHT} aria-hidden="true">
      {previous?.lines.map((l, i) => (
        <line key={`u${i}`} x1={(x(l.from) + x(l.to)) / 2} y1={0} x2={x(l.to)} y2={mid} stroke={color(l.color)} strokeWidth={2} />
      ))}
      {row?.lines.map((l, i) => (
        <line key={`d${i}`} x1={x(l.from)} y1={mid} x2={(x(l.from) + x(l.to)) / 2} y2={ROW_HEIGHT} stroke={color(l.color)} strokeWidth={2} />
      ))}
      {row && <circle cx={x(row.column)} cy={mid} r={4} fill={color(row.color)} />}
    </svg>
  );
}

function statusKind(status: string): string {
  if (status === 'A' || status === 'C') return 'added';
  if (status === 'D') return 'deleted';
  if (status === 'R') return 'renamed';
  return 'modified';
}

function baseName(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

function folderOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
