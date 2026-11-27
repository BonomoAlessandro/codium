// Branch-Dropdown der Kopfzeile (Tickets 15, 16, 18, 25 und 31), wie in IntelliJ: direkt unter dem Branch-Knopf, links
// bündig. Oben die Titelzeile mit dem Symbolknopf „Fetch“ und das Suchfeld (Tippen filtert sofort), darunter die
// Aktionen „Pull“, „Commit…“, „Push…“ und „New Branch…“ mit Symbol und Kürzel, dann die Bereiche „Recent“ (zuletzt
// ausgecheckt), „Local“ und „Remote“. Der aktuelle Branch trägt das gelbe Etikett, voraus und zurück stehen als farbige
// Pfeile.
//
// Präfixe wie `feature/` bilden Ordner (Ticket 31; die Zeilen bildet branchRows.ts). Ein Ordner klappt mit Klick, Enter
// oder Pfeil rechts bzw. links auf und zu; Pfeil links auf einem Branch im Ordner springt zum Ordner. Mit Shift, Ctrl
// oder Alt gehören Pfeil links und rechts dem Suchfeld. Beim Öffnen sind die Ordner offen, die der Nutzer aufgeklappt
// hat (das Projektfenster merkt sie sich für die Sitzung), und dazu die des aktuellen Branches, ohne dass diese gemerkt
// würden. Beim Filtern sind alle Ordner mit Treffern offen; nach dem Leeren des Suchfelds gilt wieder der gemerkte
// Zustand.
//
// Eine Branch-Zeile öffnet ihr Untermenü rechts daneben, nur per Klick, Enter oder Pfeil rechts (Ticket 33): lokal
// „Checkout“, „New Branch from '…'…“, „Rename…“, „Delete“; remote „Checkout“ und „New Branch from '…'…“. Überfahren
// hebt die Zeile nur hervor; es öffnet kein Untermenü und wechselt oder schliesst auch kein offenes. Ein Klick auf eine
// andere Branch-Zeile öffnet deren Untermenü an seiner Stelle, ein Klick auf die Zeile des offenen schliesst es wieder.
// Pfeil links und Escape schliessen es ebenfalls; tippt man im Untermenü ein Zeichen, schliesst es und das Zeichen
// geht ins Suchfeld.
//
// Escape, ein Klick daneben (überall im Fenster, auch auf die leere Kopfzeile), der Fokusverlust des Fensters, eine
// Grössenänderung oder ein Tastenkürzel der App schliesst das Dropdown (Ticket 33, popup/dismiss.ts). Der Fokus liegt
// danach auf dem Branch-Knopf, ausser ein angeklicktes Element oder das Kürzel nimmt ihn.

import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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
  FolderIcon,
  IncomingIcon,
  OutgoingIcon,
  PlusIcon,
  PullIcon,
  PushIcon,
} from '../icons';
import { shortcutLabel } from '../keymap';
import { useDismiss, type DismissReason } from '../popup/dismiss';
import { Menu, registerOpenMenu, type MenuEntry } from '../popup/Menu';
import { moveSelection } from '../search/searchResults';
import {
  branchRows,
  collapseFolder,
  expandFolder,
  filterFolders,
  openFolderState,
  parentRow,
  toggleFolderState,
  type BranchListRow,
  type BranchSection,
} from './branchRows';

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

/**
 * Warum sich das Dropdown schliesst; davon hängt ab, wohin der Fokus geht. `action`: Eine Aktion läuft gleich danach
 * (auch ein Tastenkürzel der App); der Fokus geht vorher an den Branch-Knopf, damit sich Dialoge ihn merken. Dazu die
 * Gründe aus dismiss.ts: Klick daneben (`outside`), Fokusverlust (`blur`) und Grössenänderung des Fensters (`resize`).
 */
export type BranchPopupCloseReason = 'escape' | 'action' | DismissReason;

interface BranchPopupProps {
  api: CodiumApi;
  state: GitState;
  actions: BranchActions;
  /** Der Branch-Knopf der Kopfzeile; das Dropdown hängt darunter. */
  anchor: HTMLElement;
  /** Die Ordner, die der Nutzer aufgeklappt hat (Ticket 31); das Projektfenster merkt sie sich für die Sitzung. */
  openFolders: ReadonlySet<string>;
  /** Der Nutzer hat ohne Filter einen Ordner auf- oder zugeklappt. */
  onOpenFoldersChange: (folders: ReadonlySet<string>) => void;
  /**
   * Das Dropdown schliesst sich: mit Escape, durch einen Klick daneben, weil das Fenster den Fokus verliert oder seine
   * Grösse ändert, oder weil eine Aktion läuft. Der Aufrufer gibt den Fokus an den Branch-Knopf zurück (nach einem
   * Klick daneben nur, wenn der Klick ihn niemandem gegeben hat).
   */
  onClose: (reason: BranchPopupCloseReason) => void;
}

type Row = { kind: 'action'; label: string; icon: ReactNode; shortcut?: string; run: () => void } | { kind: 'separator' } | BranchListRow;

type BranchRow = Extract<Row, { kind: 'local' | 'remote' }>;
type FolderRow = Extract<Row, { kind: 'folder' }>;

/** Wie ein Untermenü aufging: per Tastatur mit dem ersten Eintrag hervorgehoben, per Klick ohne. */
type OpenedBy = 'keyboard' | 'click';

/** Abstand zum Knopf und zum Fensterrand, wie bei den Menüs. */
const GAP = 4;
const MARGIN = 6;
const NO_FOLDERS: ReadonlySet<string> = new Set();

function isBranch(row: Row | undefined): row is BranchRow {
  return row?.kind === 'local' || row?.kind === 'remote';
}

/** Die Ebene einer Zeile im Baum; Aktionen, Trennlinien und Überschriften haben keine. */
function levelOf(row: Row | undefined): number | undefined {
  return row && 'level' in row ? row.level : undefined;
}

/** Der volle Name eines Branches; mit ihm arbeiten Untermenü, Checkout und Tooltip, auch wenn die Zeile kürzer ist. */
function branchName(row: BranchRow): string {
  return row.kind === 'local' ? row.branch.name : row.name;
}

/** Ein getipptes Zeichen (kein Kürzel, keine Leertaste: die wählt im Menü). */
function isTypedCharacter(e: KeyboardEvent): boolean {
  return e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.altKey && !e.metaKey;
}

export function BranchPopup({ api, state, actions, anchor, openFolders, onOpenFoldersChange, onClose }: BranchPopupProps) {
  const [branches, setBranches] = useState<GitBranches | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [submenu, setSubmenu] = useState<{ index: number; anchor: HTMLElement; openedBy: OpenedBy } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Offene Ordner ohne Filter: der gemerkte Zustand, beim Öffnen dazu die Ordner des aktuellen Branches (nicht gemerkt).
  const [folders, setFolders] = useState(() => openFolderState(openFolders, state.branch));
  // Offene Ordner beim Filtern, sobald der Nutzer dort einen auf- oder zuklappt; gilt nur für diesen Suchtext.
  const [filterOpen, setFilterOpen] = useState<{ query: string; folders: ReadonlySet<string> } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchRef = useRef<HTMLButtonElement>(null);
  /** Die Auswahl kam von der Tastatur; nur dann rollt die Liste zu ihr (beim Überfahren spränge sie unter der Maus). */
  const selectedByKeyboard = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onOpenFoldersChangeRef = useRef(onOpenFoldersChange);
  onOpenFoldersChangeRef.current = onOpenFoldersChange;
  const submenuRef = useRef(submenu);
  submenuRef.current = submenu;
  const id = useId();
  const rowId = (index: number) => `${id}-row-${index}`;

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

  useEffect(() => onOpenFoldersChangeRef.current(folders.remembered), [folders.remembered]);

  const q = query.trim().toLowerCase();
  const filterDefault = useMemo(() => (branches && q !== '' ? filterFolders(branches, q) : NO_FOLDERS), [branches, q]);
  const shownFolders = q === '' ? folders.shown : filterOpen?.query === q ? filterOpen.folders : filterDefault;

  const rows = useMemo(() => {
    const list = branches ? branchRows(branches, q, shownFolders) : [];
    const result: Row[] = [];
    // Die Aktionen nur ohne Suchtext, wie bisher; „Fetch“ ist der Knopf in der Titelzeile.
    if (q === '') {
      result.push(
        { kind: 'action', label: 'Pull', icon: <PullIcon />, shortcut: shortcutLabel('vcs.pull'), run: () => actions.pull() },
        { kind: 'action', label: 'Commit…', icon: <CommitActionIcon />, shortcut: shortcutLabel('vcs.commit'), run: () => actions.commit() },
        { kind: 'action', label: 'Push…', icon: <PushIcon />, shortcut: shortcutLabel('vcs.push'), run: () => actions.push() },
        { kind: 'action', label: 'New Branch…', icon: <PlusIcon />, run: () => actions.newBranch() },
      );
      if (list.length > 0) result.push({ kind: 'separator' });
    }
    result.push(...list);
    return result;
  }, [branches, q, shownFolders, actions]);
  const selectable = rows.map((r, i) => (r.kind === 'action' || r.kind === 'folder' || isBranch(r) ? i : -1)).filter((i) => i >= 0);
  const selectedRow = selectable[Math.min(selected, selectable.length - 1)];

  // Neuer Suchtext: Auswahl von vorn, ein offenes Untermenü gehört zu einer anderen Liste.
  useEffect(() => {
    setSelected(0);
    setSubmenu(null);
  }, [query]);
  useEffect(() => {
    if (!selectedByKeyboard.current) return;
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedRow]);

  // Unter dem Knopf, links bündig, im Fenster gehalten; die Liste scrollt, wenn unten der Platz fehlt. Die Breite folgt
  // dem Inhalt (zwischen Mindest- und Höchstbreite, app.css) und wird beim Aufklappen höchstens grösser, nie kleiner,
  // damit das Dropdown beim Tippen und Zuklappen nicht springt. Ändert das Fenster seine Grösse, schliesst es (Ticket 33).
  const place = () => {
    const el = ref.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const top = r.bottom + GAP;
    el.style.left = `${Math.max(MARGIN, Math.min(r.left, window.innerWidth - el.offsetWidth - MARGIN))}px`;
    el.style.top = `${top}px`;
    el.style.maxHeight = `${Math.max(120, window.innerHeight - top - MARGIN)}px`;
  };
  /** Hält die erreichte Breite fest. */
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    const width = el.getBoundingClientRect().width;
    if (width > parseFloat(el.style.minWidth || '0')) el.style.minWidth = `${width}px`;
    place();
  };
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useLayoutEffect(() => fitRef.current(), [rows, error]);

  // Angemeldet wie ein Menü: Tastenkürzel der App schliessen das Dropdown zuerst.
  useEffect(() => registerOpenMenu(() => onCloseRef.current('action')), []);

  // Ein Klick daneben schliesst, auch auf die leere Kopfzeile; ebenso der Fokusverlust und eine Grössenänderung des
  // Fensters (dismiss.ts). Zum Dropdown gehören der Branch-Knopf (sein Klick schaltet es selbst um) und das Untermenü.
  useDismiss(
    (target) => !!ref.current?.contains(target) || anchor.contains(target) || (target instanceof Element && !!target.closest('[role="menu"]')),
    (reason) => onCloseRef.current(reason),
  );

  // Escape schliesst (ist das Untermenü offen, schliesst dieses sich selbst). Ein getipptes Zeichen in einem
  // fokussierten Untermenü schliesst es und geht ins Suchfeld.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (submenuRef.current) {
        if (!isTypedCharacter(e) || !(document.activeElement instanceof Element) || !document.activeElement.closest('[role="menu"]')) return;
        e.preventDefault();
        e.stopPropagation();
        setSubmenu(null);
        setQuery((q) => q + e.key);
        setFilterOpen(null);
        inputRef.current?.focus({ preventScroll: true });
        return;
      }
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current('escape');
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const run = (fn: () => void) => () => {
    setSubmenu(null);
    onCloseRef.current('action');
    fn();
  };
  const openSubmenu = (index: number, openedBy: OpenedBy) => {
    const element = listRef.current?.querySelector<HTMLElement>(`[data-row="${index}"]`);
    if (element && isBranch(rows[index])) setSubmenu({ index, anchor: element, openedBy });
  };
  const closeSubmenu = () => {
    setSubmenu(null);
    inputRef.current?.focus({ preventScroll: true });
  };
  /** Klappt einen Ordner auf oder zu; zu heisst auch alle Ordner darin (Ticket 29). */
  const toggleFolder = (row: FolderRow) => {
    setSubmenu(null);
    if (q === '') setFolders(toggleFolderState(folders, row.key, !row.expanded));
    else setFilterOpen({ query: q, folders: row.expanded ? collapseFolder(shownFolders, row.key) : expandFolder(shownFolders, row.key) });
  };
  const selectRow = (index: number) => {
    const position = selectable.indexOf(index);
    if (position < 0) return;
    selectedByKeyboard.current = true;
    setSelected(position);
  };
  const entriesFor = (row: BranchRow): MenuEntry[] => {
    const name = branchName(row);
    if (row.kind === 'local') {
      const current = row.branch.current;
      return [
        { kind: 'item', label: 'Checkout', icon: <CheckoutIcon />, disabled: current, run: run(() => actions.checkout(name)) },
        { kind: 'item', label: `New Branch from '${name}'…`, icon: <PlusIcon />, run: run(() => actions.newBranch(name)) },
        { kind: 'item', label: 'Rename…', run: run(() => actions.rename(name)) },
        { kind: 'separator' },
        { kind: 'item', label: 'Delete', icon: <DeleteIcon />, disabled: current, run: run(() => actions.remove(name)) },
      ];
    }
    return [
      { kind: 'item', label: 'Checkout', icon: <CheckoutIcon />, run: run(() => actions.checkoutRemote(name)) },
      { kind: 'item', label: `New Branch from '${name}'…`, icon: <PlusIcon />, run: run(() => actions.newBranch(name)) },
    ];
  };
  const activate = (index: number, openedBy: OpenedBy) => {
    const row = rows[index];
    if (row?.kind === 'action') run(row.run)();
    else if (row?.kind === 'folder') toggleFolder(row);
    // Ein Klick auf die Zeile des offenen Untermenüs schliesst es, wie der Branch-Knopf das Dropdown und ein Klick
    // einen Ordner umschaltet (Ticket 33).
    else if (isBranch(row) && openedBy === 'click' && submenu?.index === index) closeSubmenu();
    else if (isBranch(row)) openSubmenu(index, openedBy);
  };
  /** Pfeil rechts und links auf Ordnern und Branches, wie im Dateibaum; liefert, ob die Taste etwas bewirkt hat. */
  const treeKey = (key: string, index: number): boolean => {
    const row = rows[index];
    if (key === 'ArrowRight' && row?.kind === 'folder') {
      if (!row.expanded) toggleFolder(row);
      else if (levelOf(rows[index + 1]) === row.level + 1) selectRow(index + 1);
      return true;
    }
    if (key === 'ArrowLeft' && (row?.kind === 'folder' || isBranch(row))) {
      if (row.kind === 'folder' && row.expanded) {
        toggleFolder(row);
        return true;
      }
      const parent = parentRow(rows, index);
      if (parent < 0) return false;
      selectRow(parent);
      return true;
    }
    return false;
  };
  /** Überfahren hebt die Zeile nur hervor; ein Untermenü öffnet, wechselt und schliesst es nicht (Ticket 33). */
  const hover = (index: number) => {
    const position = selectable.indexOf(index);
    if (position >= 0 && position !== selected) {
      selectedByKeyboard.current = false;
      setSelected(position);
    }
  };

  const renderRow = (row: Row, i: number): ReactNode => {
    if (row.kind === 'separator') return <div key={`s:${i}`} className="branch-dropdown-separator" role="presentation" />;
    if (row.kind === 'header') return null;
    const isSelected = i === selectedRow;
    const isOpen = submenu?.index === i;
    const common = {
      id: rowId(i),
      'data-row': i,
      role: 'option',
      'aria-selected': isSelected,
      onMouseMove: () => hover(i),
      onClick: () => activate(i, 'click'),
    } as const;
    if (row.kind === 'action') {
      return (
        <div key={`action:${row.label}`} {...common} aria-label={row.label} aria-keyshortcuts={row.shortcut} className={isSelected ? 'branch-row selected' : 'branch-row'}>
          <span className="branch-row-icon" aria-hidden="true">
            {row.icon}
          </span>
          <span className="branch-row-name">{highlight(row.label, query)}</span>
          <span className="branch-row-end">
            {row.shortcut && (
              <span className="branch-row-shortcut" aria-hidden="true">
                {row.shortcut}
              </span>
            )}
          </span>
        </div>
      );
    }
    const indent = { '--branch-level': row.level } as CSSProperties;
    if (row.kind === 'folder') {
      return (
        <div
          key={`folder:${row.key}`}
          {...common}
          aria-label={row.name}
          aria-expanded={row.expanded}
          data-folder={row.path}
          className={isSelected ? 'branch-row branch-folder selected' : 'branch-row branch-folder'}
          style={indent}
        >
          <span className={row.expanded ? 'branch-row-arrow expanded' : 'branch-row-arrow'} aria-hidden="true">
            <ChevronRightIcon />
          </span>
          <span className="branch-row-icon folder" aria-hidden="true">
            <FolderIcon />
          </span>
          <span className="branch-row-name" title={row.path}>
            {highlight(row.name, query)}
          </span>
        </div>
      );
    }
    const local = row.kind === 'local' ? row.branch : null;
    const classes = ['branch-row', isSelected && 'selected', isOpen && 'open', local?.current && 'current'];
    return (
      <div key={`${row.kind}:${row.key}`} {...common} aria-label={branchName(row)} className={classes.filter(Boolean).join(' ')} style={indent}>
        <span className="branch-row-arrow" aria-hidden="true" />
        <span className="branch-row-icon" aria-hidden="true">
          {local?.current ? <BranchCurrentIcon /> : <BranchIcon />}
        </span>
        <span className="branch-row-name" title={branchName(row)}>
          {highlight(row.label, query)}
        </span>
        {local?.upstream && (
          <span className="branch-row-detail" title={local.upstream}>
            {local.upstream}
          </span>
        )}
        <span className="branch-row-end">
          {local && <BranchSync ahead={local.ahead} behind={local.behind} />}
          <span className="branch-row-more" aria-hidden="true">
            <ChevronRightIcon />
          </span>
        </span>
      </div>
    );
  };

  // Die Bereiche „Recent“, „Local“ und „Remote“ als Gruppen mit Überschrift; die Aktionen stehen davor.
  const segments: Array<{ section: BranchSection | null; label?: string; items: ReactNode[] }> = [{ section: null, items: [] }];
  rows.forEach((row, i) => {
    if (row.kind === 'header') segments.push({ section: row.section, label: row.label, items: [] });
    else segments[segments.length - 1].items.push(renderRow(row, i));
  });

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
      // Klicks auf Titelzeile, Gruppenköpfe oder leere Fläche lassen den Fokus im Suchfeld.
      onMouseDown={(e) => {
        if (!(e.target instanceof Element) || !e.target.closest('input, button')) e.preventDefault();
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
          aria-controls={`${id}-list`}
          aria-activedescendant={selectedRow === undefined ? undefined : rowId(selectedRow)}
          placeholder="Search branches"
          value={query}
          autoFocus
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setFilterOpen(null);
          }}
          onKeyDown={(e) => {
            const row = selectedRow === undefined ? undefined : rows[selectedRow];
            // Mit Shift, Ctrl oder Alt gehören Pfeil links und rechts dem Suchfeld (Text markieren, wortweise springen).
            const horizontal = e.key === 'ArrowRight' || e.key === 'ArrowLeft';
            if (horizontal && (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)) return;
            if (e.key === 'Enter' || (e.key === 'ArrowRight' && isBranch(row))) {
              e.preventDefault();
              if (selectedRow !== undefined) activate(selectedRow, 'keyboard');
              return;
            }
            // Pfeil rechts und links wirken nur auf Ordner und Branches; sonst bewegen sie die Schreibmarke.
            if (horizontal && selectedRow !== undefined && treeKey(e.key, selectedRow)) {
              e.preventDefault();
              return;
            }
            const next = moveSelection(selected, selectable.length, e.key);
            if (next !== selected) {
              e.preventDefault();
              selectedByKeyboard.current = true;
              setSelected(next);
            }
          }}
        />
      </label>
      <div
        ref={listRef}
        id={`${id}-list`}
        className="branch-dropdown-list"
        role="listbox"
        aria-label="Branches"
        // Ein offenes Untermenü hängt an seiner Zeile; rollt die Liste, schliesst es.
        onScroll={() => {
          if (submenuRef.current) closeSubmenu();
        }}
      >
        {error && <p className="branch-dropdown-empty">{error}</p>}
        {!error && branches && selectable.length === 0 && <p className="branch-dropdown-empty">No matching branches</p>}
        {segments.map((segment) =>
          segment.section === null ? (
            <Fragment key="actions">{segment.items}</Fragment>
          ) : (
            <div key={`group:${segment.section}`} role="group" aria-label={segment.label} className="branch-dropdown-section">
              <div className="branch-dropdown-group" role="presentation">
                {segment.label}
              </div>
              {segment.items}
            </div>
          ),
        )}
      </div>
      {submenu && isBranch(submenuRow) && (
        <Menu
          key={submenu.index}
          label={branchName(submenuRow)}
          entries={entriesFor(submenuRow)}
          anchor={submenu.anchor}
          placement="beside"
          container={ref.current ?? undefined}
          highlightFirst={submenu.openedBy === 'keyboard'}
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
