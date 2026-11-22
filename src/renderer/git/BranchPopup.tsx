// Branch-Menü der Kopfzeile (Ticket 15), wie in IntelliJ: oben ein Suchfeld und „New Branch…“, darunter die lokalen
// und die Remote-Branches getrennt, der aktuelle markiert. Enter oder ein Klick auf einen Branch öffnet sein Untermenü:
// lokal „Checkout“, „New Branch from '…'…“, „Rename…“, „Delete“; remote „Checkout“ und „New Branch from '…'…“.
// Die Einträge „Commit…“, „Pull“, „Push…“ und „Fetch“ kommen mit den Tickets 16 und 18.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CodiumApi, GitBranches, GitState } from '../../shared/types';
import { errorText } from '../errors';
import { Menu, type MenuEntry } from '../popup/Menu';
import { QuickPopup } from '../search/QuickPopup';
import { moveSelection } from '../search/searchResults';

/** Die Aktionen des Menüs; der Aufrufer speichert vorher alle Tabs und zeigt Fehler. */
export interface BranchActions {
  newBranch(from?: string): void;
  checkout(name: string): void;
  checkoutRemote(name: string): void;
  rename(name: string): void;
  remove(name: string): void;
}

interface BranchPopupProps {
  api: CodiumApi;
  state: GitState;
  actions: BranchActions;
  onClose: () => void;
}

type Row =
  | { kind: 'action'; label: string; run: () => void }
  | { kind: 'header'; label: string }
  | { kind: 'local'; name: string; current: boolean; upstream?: string }
  | { kind: 'remote'; name: string };

export function BranchPopup({ api, state, actions, onClose }: BranchPopupProps) {
  const [branches, setBranches] = useState<GitBranches | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [submenu, setSubmenu] = useState<{ row: Row; anchor: HTMLElement } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.request('git.branches').then(
      (result) => {
        if (live) setBranches(result);
      },
      (err: unknown) => {
        if (live) setError(errorText(err));
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (name: string) => q === '' || name.toLowerCase().includes(q);
    const local = (branches?.local ?? []).filter((b) => match(b.name));
    const remote = (branches?.remote ?? []).filter((b) => match(b.name));
    const result: Row[] = [];
    if (q === '') result.push({ kind: 'action', label: 'New Branch…', run: () => actions.newBranch() });
    if (local.length > 0) result.push({ kind: 'header', label: 'Local' }, ...local.map((b): Row => ({ kind: 'local', ...b })));
    if (remote.length > 0) result.push({ kind: 'header', label: 'Remote' }, ...remote.map((b): Row => ({ kind: 'remote', name: b.name })));
    return result;
  }, [branches, query, actions]);
  const selectable = rows.map((r, i) => (r.kind === 'header' ? -1 : i)).filter((i) => i >= 0);
  const selectedRow = selectable[Math.min(selected, selectable.length - 1)];

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedRow]);

  const close = () => {
    setSubmenu(null);
    onClose();
  };
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  const entriesFor = (row: Row): MenuEntry[] => {
    if (row.kind === 'local') {
      return [
        { kind: 'item', label: 'Checkout', disabled: row.current, run: run(() => actions.checkout(row.name)) },
        { kind: 'item', label: `New Branch from '${row.name}'…`, run: run(() => actions.newBranch(row.name)) },
        { kind: 'item', label: 'Rename…', run: run(() => actions.rename(row.name)) },
        { kind: 'item', label: 'Delete', disabled: row.current, run: run(() => actions.remove(row.name)) },
      ];
    }
    if (row.kind === 'remote') {
      return [
        { kind: 'item', label: 'Checkout', run: run(() => actions.checkoutRemote(row.name)) },
        { kind: 'item', label: `New Branch from '${row.name}'…`, run: run(() => actions.newBranch(row.name)) },
      ];
    }
    return [];
  };
  const activate = (index: number) => {
    const row = rows[index];
    if (!row || row.kind === 'header') return;
    if (row.kind === 'action') {
      run(row.run)();
      return;
    }
    const element = listRef.current?.querySelector<HTMLElement>(`[data-row="${index}"]`);
    if (element) setSubmenu({ row, anchor: element });
  };

  const current = state.branch ?? state.detached ?? '';
  return (
    <QuickPopup label="Git Branches" className="branch-popup" onClose={() => (submenu ? setSubmenu(null) : close())}>
      <div className="quick-popup-header">
        <span className="quick-popup-title">Git Branches</span>
        <span className="quick-popup-detail">{current}</span>
      </div>
      <input
        className="quick-popup-input"
        aria-label="Search branches"
        placeholder="Search branches"
        value={query}
        autoFocus
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'ArrowRight') {
            e.preventDefault();
            if (selectedRow !== undefined) activate(selectedRow);
            return;
          }
          const next = moveSelection(selected, selectable.length, e.key);
          if (next !== selected) {
            e.preventDefault();
            setSelected(next);
          }
        }}
      />
      <div ref={listRef} className="quick-popup-list" role="listbox" aria-label="Branches">
        {error && <p className="quick-popup-empty">{error}</p>}
        {!error && branches && rows.length === 0 && <p className="quick-popup-empty">No matching branches</p>}
        {rows.map((row, i) =>
          row.kind === 'header' ? (
            <div key={`h:${row.label}`} className="branch-popup-header" role="presentation">
              {row.label}
            </div>
          ) : (
            <div
              key={row.kind === 'action' ? 'action' : `${row.kind}:${row.name}`}
              data-row={i}
              role="option"
              aria-selected={i === selectedRow}
              aria-label={row.kind === 'action' ? row.label : row.name}
              className={`quick-popup-item${i === selectedRow ? ' selected' : ''}${row.kind === 'local' && row.current ? ' current' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                setSelected(selectable.indexOf(i));
              }}
              onClick={() => activate(i)}
            >
              <span className="quick-popup-name">{row.kind === 'action' ? row.label : row.name}</span>
              {row.kind === 'local' && row.current && <span className="quick-popup-detail">current</span>}
              {row.kind === 'local' && row.upstream && !row.current && <span className="quick-popup-detail">{row.upstream}</span>}
            </div>
          ),
        )}
      </div>
      {submenu && (
        <Menu
          label={submenu.row.kind === 'local' || submenu.row.kind === 'remote' ? submenu.row.name : 'Branch'}
          entries={entriesFor(submenu.row)}
          anchor={submenu.anchor}
          highlightFirst
          onClose={() => setSubmenu(null)}
        />
      )}
    </QuickPopup>
  );
}
