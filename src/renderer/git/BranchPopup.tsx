// Branch-Dropdown der Kopfzeile (Tickets 15, 16, 18 und 25), wie in IntelliJ: direkt unter dem Branch-Knopf, links
// bündig. Oben die Titelzeile mit dem Symbolknopf „Fetch“ und das Suchfeld (Tippen filtert sofort), darunter die
// Aktionen „Pull“, „Commit…“, „Push…“ und „New Branch…“ mit Symbol und Kürzel, dann die lokalen und die
// Remote-Branches. Der aktuelle Branch trägt das gelbe Etikett, voraus und zurück stehen als farbige Pfeile.
//
// Eine Branch-Zeile öffnet ihr Untermenü rechts daneben (Enter, Pfeil rechts, Klick oder Überfahren): lokal
// „Checkout“, „New Branch from '…'…“, „Rename…“, „Delete“; remote „Checkout“ und „New Branch from '…'…“. Pfeil links
// schliesst es wieder. Escape oder ein Klick daneben schliesst das Dropdown; danach liegt der Fokus wieder auf dem
// Branch-Knopf.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CodiumApi, GitBranches, GitState } from '../../shared/types';
import { errorText } from '../errors';
import {
  BranchCurrentIcon,
  BranchIcon,
  CheckoutIcon,
  ChevronRightIcon,
  CommitActionIcon,
  DeleteIcon,
  FetchIcon,
  FindIcon,
  IncomingIcon,
  OutgoingIcon,
  PlusIcon,
  PullIcon,
  PushIcon,
} from '../icons';
import { shortcutLabel } from '../keymap';
import { Menu, type MenuEntry } from '../popup/Menu';
import { moveSelection } from '../search/searchResults';

/** Die Aktionen des Menüs; der Aufrufer speichert vorher alle Tabs und zeigt Fehler. */
export interface BranchActions {
  /** „Commit…“: die Änderungsansicht (Ticket 16). */
  commit(): void;
  /** „Pull“, „Push…“, „Fetch“ (Ticket 18). */
  pull(): void;
  push(): void;
  fetch(): void;
  newBranch(from?: string): void;
  checkout(name: string): void;
  checkoutRemote(name: string): void;
  rename(name: string): void;
  remove(name: string): void;
}

/** Warum sich das Dropdown schliesst; davon hängt ab, wohin der Fokus geht. */
export type BranchPopupCloseReason = 'escape' | 'outside' | 'action';

interface BranchPopupProps {
  api: CodiumApi;
  state: GitState;
  actions: BranchActions;
  /** Der Branch-Knopf der Kopfzeile; das Dropdown hängt darunter. */
  anchor: HTMLElement;
  /**
   * Das Dropdown schliesst sich: mit Escape, durch einen Klick daneben oder weil eine Aktion läuft. Nach Escape und nach
   * einem Klick auf eine Stelle ohne eigenen Fokus geht der Fokus zurück an den Branch-Knopf.
   */
  onClose: (reason: BranchPopupCloseReason) => void;
}

type Row =
  | { kind: 'action'; label: string; icon: ReactNode; shortcut?: string; run: () => void }
  | { kind: 'separator' }
  | { kind: 'header'; label: string }
  | { kind: 'local'; name: string; current: boolean; upstream?: string; ahead?: number; behind?: number }
  | { kind: 'remote'; name: string };

type BranchRow = Extract<Row, { kind: 'local' | 'remote' }>;

/** Abstand zum Knopf und zum Fensterrand, wie bei den Menüs. */
const GAP = 4;
const MARGIN = 6;
/** So lange ruht die Maus auf einer Branch-Zeile, bis ihr Untermenü aufgeht. */
const HOVER_DELAY_MS = 200;

function isBranch(row: Row | undefined): row is BranchRow {
  return row?.kind === 'local' || row?.kind === 'remote';
}

export function BranchPopup({ api, state, actions, anchor, onClose }: BranchPopupProps) {
  const [branches, setBranches] = useState<GitBranches | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [submenu, setSubmenu] = useState<{ index: number; anchor: HTMLElement; viaKeyboard: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<{ index: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const submenuRef = useRef(submenu);
  submenuRef.current = submenu;

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
    // Die Aktionen nur ohne Suchtext, wie bisher; „Fetch“ ist der Knopf in der Titelzeile.
    if (q === '') {
      result.push(
        { kind: 'action', label: 'Pull', icon: <PullIcon />, shortcut: shortcutLabel('vcs.pull'), run: () => actions.pull() },
        { kind: 'action', label: 'Commit…', icon: <CommitActionIcon />, shortcut: shortcutLabel('vcs.commit'), run: () => actions.commit() },
        { kind: 'action', label: 'Push…', icon: <PushIcon />, shortcut: shortcutLabel('vcs.push'), run: () => actions.push() },
        { kind: 'action', label: 'New Branch…', icon: <PlusIcon />, run: () => actions.newBranch() },
      );
      if (local.length + remote.length > 0) result.push({ kind: 'separator' });
    }
    if (local.length > 0) result.push({ kind: 'header', label: 'Local' }, ...local.map((b): Row => ({ kind: 'local', ...b })));
    if (remote.length > 0) result.push({ kind: 'header', label: 'Remote' }, ...remote.map((b): Row => ({ kind: 'remote', name: b.name })));
    return result;
  }, [branches, query, actions]);
  const selectable = rows.map((r, i) => (r.kind === 'action' || isBranch(r) ? i : -1)).filter((i) => i >= 0);
  const selectedRow = selectable[Math.min(selected, selectable.length - 1)];

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedRow]);

  // Unter dem Knopf, links bündig, im Fenster gehalten; die Liste scrollt, wenn unten der Platz fehlt.
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = anchor.getBoundingClientRect();
      const top = r.bottom + GAP;
      el.style.left = `${Math.max(MARGIN, Math.min(r.left, window.innerWidth - el.offsetWidth - MARGIN))}px`;
      el.style.top = `${top}px`;
      el.style.maxHeight = `${Math.max(120, window.innerHeight - top - MARGIN)}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  // Escape schliesst (ist das Untermenü offen, schliesst dieses sich selbst); ein Klick daneben ebenso.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || submenuRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current('escape');
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target || ref.current?.contains(target) || anchor.contains(target) || target.closest('[role="menu"]')) return;
      onCloseRef.current('outside');
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [anchor]);

  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current.timer);
    },
    [],
  );

  const cancelHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current.timer);
    hoverTimer.current = null;
  };
  const run = (fn: () => void) => () => {
    cancelHover();
    setSubmenu(null);
    onCloseRef.current('action');
    fn();
  };
  const openSubmenu = (index: number, viaKeyboard: boolean) => {
    cancelHover();
    const element = listRef.current?.querySelector<HTMLElement>(`[data-row="${index}"]`);
    if (element && isBranch(rows[index])) setSubmenu({ index, anchor: element, viaKeyboard });
  };
  const closeSubmenu = () => {
    setSubmenu(null);
    inputRef.current?.focus({ preventScroll: true });
  };
  const entriesFor = (row: BranchRow): MenuEntry[] => {
    if (row.kind === 'local') {
      return [
        { kind: 'item', label: 'Checkout', icon: <CheckoutIcon />, disabled: row.current, run: run(() => actions.checkout(row.name)) },
        { kind: 'item', label: `New Branch from '${row.name}'…`, icon: <PlusIcon />, run: run(() => actions.newBranch(row.name)) },
        { kind: 'item', label: 'Rename…', run: run(() => actions.rename(row.name)) },
        { kind: 'separator' },
        { kind: 'item', label: 'Delete', icon: <DeleteIcon />, disabled: row.current, run: run(() => actions.remove(row.name)) },
      ];
    }
    return [
      { kind: 'item', label: 'Checkout', icon: <CheckoutIcon />, run: run(() => actions.checkoutRemote(row.name)) },
      { kind: 'item', label: `New Branch from '${row.name}'…`, icon: <PlusIcon />, run: run(() => actions.newBranch(row.name)) },
    ];
  };
  const activate = (index: number, viaKeyboard: boolean) => {
    const row = rows[index];
    if (row?.kind === 'action') run(row.run)();
    else if (isBranch(row)) openSubmenu(index, viaKeyboard);
  };
  const hover = (index: number) => {
    const position = selectable.indexOf(index);
    if (position >= 0 && position !== selected) setSelected(position);
    const row = rows[index];
    if (!isBranch(row)) {
      cancelHover();
      if (submenuRef.current) closeSubmenu();
      return;
    }
    if (submenuRef.current?.index === index || hoverTimer.current?.index === index) return;
    cancelHover();
    const timer = setTimeout(() => {
      hoverTimer.current = null;
      openSubmenu(index, false);
    }, HOVER_DELAY_MS);
    hoverTimer.current = { index, timer };
  };

  const current = state.branch ?? state.detached ?? '';
  const submenuRow = submenu ? rows[submenu.index] : undefined;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Git Branches"
      className="branch-dropdown"
      onKeyDown={(e) => {
        // Tab bleibt im Dropdown: zwischen Suchfeld und „Fetch“.
        if (e.key !== 'Tab') return;
        e.preventDefault();
        (document.activeElement === inputRef.current ? fetchRef.current : inputRef.current)?.focus();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="branch-dropdown-title">
        <span className="branch-dropdown-heading" title={current}>
          Git Branches
        </span>
        <button ref={fetchRef} type="button" className="icon-button" aria-label="Fetch" title="Fetch" onClick={run(() => actions.fetch())}>
          <FetchIcon />
        </button>
      </div>
      <label className="branch-dropdown-search">
        <FindIcon size={16} />
        <input
          ref={inputRef}
          aria-label="Search branches"
          placeholder="Search branches"
          value={query}
          autoFocus
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            const row = selectedRow === undefined ? undefined : rows[selectedRow];
            if (e.key === 'Enter' || (e.key === 'ArrowRight' && isBranch(row))) {
              e.preventDefault();
              if (selectedRow !== undefined) activate(selectedRow, true);
              return;
            }
            const next = moveSelection(selected, selectable.length, e.key);
            if (next !== selected) {
              e.preventDefault();
              setSelected(next);
            }
          }}
        />
      </label>
      <div ref={listRef} className="branch-dropdown-list" role="listbox" aria-label="Branches" onMouseLeave={cancelHover}>
        {error && <p className="branch-dropdown-empty">{error}</p>}
        {!error && branches && selectable.length === 0 && <p className="branch-dropdown-empty">No matching branches</p>}
        {rows.map((row, i) => {
          if (row.kind === 'separator') return <div key={`s:${i}`} className="branch-dropdown-separator" role="presentation" />;
          if (row.kind === 'header') {
            return (
              <div key={`h:${row.label}`} className="branch-dropdown-group" role="presentation">
                {row.label}
              </div>
            );
          }
          const isSelected = i === selectedRow;
          const isOpen = submenu?.index === i;
          const label = row.kind === 'action' ? row.label : row.name;
          const classes = ['branch-row', isSelected && 'selected', isOpen && 'open', row.kind === 'local' && row.current && 'current'];
          return (
            <div
              key={row.kind === 'action' ? `action:${row.label}` : `${row.kind}:${row.name}`}
              data-row={i}
              role="option"
              aria-selected={isSelected}
              aria-label={label}
              aria-haspopup={row.kind === 'action' ? undefined : 'menu'}
              aria-expanded={row.kind === 'action' ? undefined : isOpen}
              aria-keyshortcuts={row.kind === 'action' ? row.shortcut : undefined}
              className={classes.filter(Boolean).join(' ')}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => hover(i)}
              onClick={() => activate(i, false)}
            >
              <span className="branch-row-icon" aria-hidden="true">
                {row.kind === 'action' ? row.icon : row.kind === 'local' && row.current ? <BranchCurrentIcon /> : <BranchIcon />}
              </span>
              <span className="branch-row-name">{highlight(label, query)}</span>
              {row.kind === 'local' && row.upstream && <span className="branch-row-detail">{row.upstream}</span>}
              <span className="branch-row-end">
                {row.kind === 'action' && row.shortcut && (
                  <span className="branch-row-shortcut" aria-hidden="true">
                    {row.shortcut}
                  </span>
                )}
                {row.kind === 'local' && <BranchSync ahead={row.ahead} behind={row.behind} />}
                {row.kind !== 'action' && (
                  <span className="branch-row-more" aria-hidden="true">
                    <ChevronRightIcon />
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {submenu && isBranch(submenuRow) && (
        <Menu
          key={submenu.index}
          label={submenuRow.name}
          entries={entriesFor(submenuRow)}
          anchor={submenu.anchor}
          placement="beside"
          highlightFirst={submenu.viaKeyboard}
          onClose={closeSubmenu}
        />
      )}
    </div>,
    document.body,
  );
}

/** Der Suchtext im Namen fett, wie in den Suchfenstern. */
function highlight(name: string, query: string): ReactNode {
  const q = query.trim().toLowerCase();
  const at = q === '' ? -1 : name.toLowerCase().indexOf(q);
  if (at < 0) return name;
  return (
    <>
      {name.slice(0, at)}
      <mark>{name.slice(at, at + q.length)}</mark>
      {name.slice(at + q.length)}
    </>
  );
}

/**
 * Voraus und zurück gegenüber dem Upstream als kleine farbige Pfeile mit Zahl: grün ausgehend, blau eingehend. In der
 * Kopfzeile und im Dropdown.
 */
export function BranchSync({ ahead = 0, behind = 0 }: { ahead?: number; behind?: number }) {
  if (ahead <= 0 && behind <= 0) return null;
  return (
    <span className="branch-sync">
      {ahead > 0 && (
        <span className="branch-sync-outgoing" title={`${ahead} outgoing`}>
          <OutgoingIcon />
          {ahead}
        </span>
      )}
      {behind > 0 && (
        <span className="branch-sync-incoming" title={`${behind} incoming`}>
          <IncomingIcon />
          {behind}
        </span>
      )}
    </span>
  );
}
