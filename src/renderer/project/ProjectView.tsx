// Werkzeugfenster „Project“: der Dateibaum des Projekts wie in IntelliJ. Die Regeln ohne DOM stehen in fileTree.ts.
//
// - Ordner werden erst beim Aufklappen gelesen; bei Dateiereignissen liest der Baum nur die betroffenen, schon
//   gelesenen Ordner neu. Aufgeklappte Ordner und Auswahl hängen an Pfaden und überstehen das Neueinlesen.
// - Gezeichnet werden nur die sichtbaren Zeilen (feste Zeilenhöhe), damit auch ein aufgeklapptes node_modules
//   flüssig bleibt.
// - Einfachklick wählt aus (Ctrl und Shift wie üblich für mehrere), Doppelklick oder Enter klappt Ordner auf und zu
//   und öffnet Dateien. Tasten wie in IntelliJ, dazu F2 zum Umbenennen wie unter Windows.
// - Die aufgeklappten Ordner speichert der Kern im Projekt-Zustand.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { fileNameProblem, splitExtension, splitNewName } from '../../shared/fileNames';
import {
  CodiumError,
  ErrorCode,
  type CodiumApi,
  type FileEntry,
  type FileOperation,
  type FilesChangedEvent,
  type ProjectInfo,
} from '../../shared/types';
import { errorText } from '../errors';
import { ChevronRightIcon, CollapseAllIcon, FileIcon, FolderIcon, LocateIcon } from '../icons';
import type { Notify } from '../Notices';
import { useAsk, useAskText } from '../popup/Dialogs';
import { Menu, type MenuEntry } from '../popup/Menu';
import { baseName, isSameOrInside, parentPath, pathKey, relativeLabel } from './filePaths';
import {
  moveSubtree,
  movedKey,
  parentRow,
  rangeKeys,
  selectionAfterDelete,
  treeKey,
  visibleRows,
  withoutSubtree,
  type Listing,
  type TreeRow,
} from './fileTree';
import { ToolWindowHeader } from './ToolWindowHeader';

/** Höhe einer Zeile in Pixeln; muss zu `.file-tree-row` passen. */
export const TREE_ROW_HEIGHT = 24;
/** Zeilen, die über und unter dem sichtbaren Bereich zusätzlich gezeichnet werden. */
const OVERSCAN = 12;
/** Kürzel im Baum wie in IntelliJ, zur Anzeige im Rechtsklick-Menü. */
const SHORTCUTS = { copy: 'Ctrl+C', copyPath: 'Ctrl+Shift+C', paste: 'Ctrl+V', rename: 'Shift+F6', delete: 'Delete' };
/** Hinweis beim Umbenennen einer Java-Datei: In Codium ist das kein Refactoring. */
export const JAVA_RENAME_HINT = 'Only the file is renamed. References to the class in other files are not updated.';

interface ProjectViewProps {
  api: CodiumApi;
  project: ProjectInfo;
  notify: Notify;
  onHide: () => void;
  /** „Datei öffnen“ (Doppelklick, Enter, neue Datei); Ticket 05 öffnet daraus einen Tab. */
  onOpenFile: (path: string) => void;
}

interface ContextMenu {
  x: number;
  y: number;
  viaKeyboard: boolean;
}

export function ProjectView({ api, project, notify, onHide, onOpenFile }: ProjectViewProps) {
  const root = project.path;
  const rootKey = pathKey(root);
  const ask = useAsk();
  const askText = useAskText();

  // ---------- Zustand: gelesene Ordner, aufgeklappte Ordner, Auswahl ----------

  const [listings, setListingsState] = useState<ReadonlyMap<string, Listing>>(() => new Map());
  /** Aufgeklappte Ordner: Schlüssel → Pfad; `null`, bis der Kern sie geliefert hat. */
  const [expanded, setExpandedState] = useState<ReadonlyMap<string, string> | null>(null);
  const [selection, setSelectionState] = useState<ReadonlySet<string>>(() => new Set());
  const [lead, setLeadState] = useState<string | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });

  // Die Refs halten immer den neuesten Stand, auch bevor React neu gezeichnet hat; Ereignisse des Kerns lesen daraus.
  const listingsRef = useRef(listings);
  const expandedRef = useRef(expanded);
  const selectionRef = useRef(selection);
  const leadRef = useRef(lead);
  const anchorRef = useRef<string | null>(null);
  const clipboard = useRef<string[]>([]);
  const generations = useRef(new Map<string, number>());
  const inFlight = useRef(new Set<string>());
  /** Ordner, die während ihres Lesens noch einmal einen Anlass bekamen; sie werden danach ein weiteres Mal gelesen. */
  const dirtyWhileLoading = useRef(new Set<string>());
  const pendingReloads = useRef(new Set<string>());
  const reloadTimer = useRef<number | null>(null);
  /** Ein Pfad, der ausgewählt und ins Bild gebracht werden soll, sobald seine Zeile da ist. */
  const revealRef = useRef<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const savedScrollTop = useRef(0);

  const rows = useMemo(
    () => (expanded ? visibleRows(root, project.name, listings, expanded) : []),
    [root, project.name, listings, expanded],
  );
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const leadIndex = lead === null ? -1 : rows.findIndex((r) => r.key === lead);

  /** Ändert die gelesenen Ordner; der Ref gilt sofort. */
  const updateListings = useCallback((update: (current: ReadonlyMap<string, Listing>) => ReadonlyMap<string, Listing>) => {
    const next = update(listingsRef.current);
    if (next === listingsRef.current) return;
    listingsRef.current = next;
    setListingsState(next);
  }, []);

  const setSelection = useCallback((keys: ReadonlySet<string>, newLead: string | null) => {
    selectionRef.current = keys;
    leadRef.current = newLead;
    setSelectionState(keys);
    setLeadState(newLead);
  }, []);

  const selectOnly = useCallback(
    (path: string) => {
      const key = pathKey(path);
      anchorRef.current = key;
      setSelection(new Set([key]), key);
    },
    [setSelection],
  );

  /** Ändert die aufgeklappten Ordner und speichert sie noch im selben Ereignis im Kern. */
  const setExpanded = useCallback(
    (update: (current: ReadonlyMap<string, string>) => ReadonlyMap<string, string>) => {
      const current = expandedRef.current;
      if (!current) return;
      const next = update(current);
      if (next === current) return;
      expandedRef.current = next;
      setExpandedState(next);
      api
        .request('project.setExpandedFolders', { paths: [...next.values()] })
        .catch((err: unknown) => console.error('Aufgeklappte Ordner nicht gespeichert:', err));
    },
    [api],
  );

  // Die gespeicherten aufgeklappten Ordner laden.
  useEffect(() => {
    let active = true;
    const apply = (paths: string[]) => {
      if (!active || expandedRef.current) return;
      const map = new Map(paths.map((p) => [pathKey(p), p]));
      expandedRef.current = map;
      setExpandedState(map);
    };
    api.request('project.expandedFolders').then(apply, (err: unknown) => {
      console.error('Aufgeklappte Ordner nicht geladen:', err);
      apply([root]);
    });
    return () => {
      active = false;
    };
  }, [api, root]);

  // ---------- Lesen der Ordner ----------

  /** Liest einen Ordner (neu). Eine ältere Antwort für denselben Ordner zählt nicht mehr, wenn eine neuere unterwegs ist. */
  const load = useCallback(
    (dir: string) => {
      const key = pathKey(dir);
      const generation = (generations.current.get(key) ?? 0) + 1;
      generations.current.set(key, generation);
      inFlight.current.add(key);
      const isLatest = () => generations.current.get(key) === generation;
      api.request('files.list', { path: dir }).then(
        (entries) => {
          if (!isLatest()) return;
          inFlight.current.delete(key);
          updateListings((prev) => new Map(prev).set(key, { path: dir, entries }));
          // Kam während des Lesens ein neuer Anlass, gleich noch einmal; so ist je Ordner höchstens ein Lesen unterwegs.
          if (dirtyWhileLoading.current.delete(key)) load(dir);
        },
        (err: unknown) => {
          if (!isLatest()) return;
          inFlight.current.delete(key);
          dirtyWhileLoading.current.delete(key);
          // Der Ordner ist weg oder lässt sich nicht lesen (etwa eine Junction nach ausserhalb des Projekts): zuklappen.
          updateListings((prev) => (hasKeyWithin(prev, dir) ? withoutSubtree(prev, dir) : prev));
          setExpanded((current) => (hasKeyWithin(current, dir) ? withoutSubtree(current, dir) : current));
          if (!(err instanceof CodiumError && err.code === ErrorCode.fileNotFound)) notify({ level: 'error', text: errorText(err) });
        },
      );
    },
    [api, notify, setExpanded, updateListings],
  );

  // Aufgeklappte, sichtbare Ordner ohne Inhalt lesen.
  useEffect(() => {
    for (const row of rows) if (row.loading && !inFlight.current.has(row.key)) load(row.path);
  }, [rows, load]);

  /**
   * Liest einen schon gelesenen Ordner kurz darauf neu; mehrere Anlässe kurz nacheinander ergeben ein Lesen. Wird er
   * gerade zum ersten Mal gelesen, folgt ein zweites Lesen, denn das erste kann die Änderung verpasst haben.
   */
  const scheduleReload = useCallback(
    (dir: string) => {
      const key = pathKey(dir);
      if (!listingsRef.current.has(key)) {
        if (inFlight.current.has(key)) dirtyWhileLoading.current.add(key);
        return;
      }
      pendingReloads.current.add(key);
      if (reloadTimer.current !== null) return;
      reloadTimer.current = window.setTimeout(() => {
        reloadTimer.current = null;
        const keys = [...pendingReloads.current];
        pendingReloads.current.clear();
        for (const k of keys) {
          const listing = listingsRef.current.get(k);
          if (!listing) continue;
          if (inFlight.current.has(k)) dirtyWhileLoading.current.add(k);
          else load(listing.path);
        }
      }, 30);
    },
    [load],
  );

  useEffect(
    () => () => {
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
    },
    [],
  );

  /** Vergisst einen gelöschten Pfad mit allem darunter: Inhalt, aufgeklappte Ordner, Auswahl. */
  const forget = useCallback(
    (target: string) => {
      // Ein Lesen, das noch unterwegs ist, zählt nicht mehr; sonst käme der gelöschte Inhalt zurück.
      for (const key of generations.current.keys()) {
        if (!isSameOrInside(key, target)) continue;
        generations.current.set(key, (generations.current.get(key) ?? 0) + 1);
        inFlight.current.delete(key);
        dirtyWhileLoading.current.delete(key);
      }
      updateListings((prev) => (hasKeyWithin(prev, target) ? withoutSubtree(prev, target) : prev));
      setExpanded((current) => (hasKeyWithin(current, target) ? withoutSubtree(current, target) : current));
      const selected = [...selectionRef.current];
      if (selected.some((k) => isSameOrInside(k, target)) || (leadRef.current && isSameOrInside(leadRef.current, target))) {
        const remaining = new Set(selected.filter((k) => !isSameOrInside(k, target)));
        const newLead = leadRef.current && isSameOrInside(leadRef.current, target) ? pathKey(parentPath(target)) : leadRef.current;
        setSelection(remaining.size > 0 || newLead === null ? remaining : new Set([newLead]), newLead);
      }
    },
    [setExpanded, setSelection, updateListings],
  );

  /** Nach dem Umbenennen: Inhalt, aufgeklappte Ordner und Auswahl wandern mit. */
  const relocate = useCallback(
    (from: string, to: string) => {
      for (const key of generations.current.keys()) {
        if (!isSameOrInside(key, from)) continue;
        generations.current.set(key, (generations.current.get(key) ?? 0) + 1);
        inFlight.current.delete(key);
        dirtyWhileLoading.current.delete(key);
      }
      updateListings((prev) =>
        hasKeyWithin(prev, from)
          ? moveSubtree(prev, from, to, (listing, move) => ({
              path: move(listing.path),
              entries: listing.entries.map((e) => ({ ...e, path: move(e.path) })),
            }))
          : prev,
      );
      setExpanded((current) => (hasKeyWithin(current, from) ? moveSubtree(current, from, to, (p, move) => move(p)) : current));
      const fromKey = pathKey(from);
      const move = (key: string) => (isSameOrInside(key, from) ? movedKey(key, fromKey, to) : key);
      if ([...selectionRef.current].some((k) => isSameOrInside(k, from)) || (leadRef.current && isSameOrInside(leadRef.current, from))) {
        setSelection(new Set([...selectionRef.current].map(move)), leadRef.current === null ? null : move(leadRef.current));
        if (anchorRef.current) anchorRef.current = move(anchorRef.current);
      }
    },
    [setExpanded, setSelection, updateListings],
  );

  // ---------- Ereignisse des Kerns ----------

  const handlers = useRef({
    changed: (_event: FilesChangedEvent) => {},
    operation: (_op: FileOperation) => {},
  });
  handlers.current = {
    changed: (event) => {
      for (const change of event.changes) {
        if (change.kind === 'deleted') forget(change.path);
        // Ein Ordner, der gelöscht und neu angelegt wurde, hat womöglich anderen Inhalt.
        if (change.kind === 'changed') scheduleReload(change.path);
        else scheduleReload(parentPath(change.path));
      }
      if (event.rescanned) for (const listing of listingsRef.current.values()) scheduleReload(listing.path);
    },
    operation: (op) => {
      if (op.kind === 'renamed') {
        relocate(op.from, op.to);
        scheduleReload(parentPath(op.from));
        scheduleReload(parentPath(op.to));
        return;
      }
      const target = op.kind === 'copied' ? op.to : op.path;
      if (op.kind === 'deleted') forget(op.path);
      scheduleReload(parentPath(target));
    },
  };
  useEffect(() => {
    const offChanged = api.on('files.changed', (event) => handlers.current.changed(event));
    const offOperation = api.on('files.operation', (op) => handlers.current.operation(op));
    return () => {
      offChanged();
      offOperation();
    };
  }, [api]);

  // ---------- Sichtbarer Bereich ----------

  const scrollToIndex = useCallback((index: number) => {
    const el = treeRef.current;
    if (!el || index < 0) return;
    const top = index * TREE_ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + TREE_ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + TREE_ROW_HEIGHT - el.clientHeight;
  }, []);

  // Grösse beobachten; ein verborgenes Werkzeugfenster hat Höhe 0 und verliert dabei seine Bildlaufposition.
  useEffect(() => {
    const el = treeRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientHeight > 0 && el.scrollTop !== savedScrollTop.current) el.scrollTop = savedScrollTop.current;
      setViewport((old) => (old.top === el.scrollTop && old.height === el.clientHeight ? old : { top: el.scrollTop, height: el.clientHeight }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Einen neuen oder kopierten Eintrag auswählen und zeigen, sobald seine Zeile da ist.
  useEffect(() => {
    const target = revealRef.current;
    if (target === null) return;
    const index = rows.findIndex((r) => r.key === pathKey(target));
    if (index < 0) return;
    revealRef.current = null;
    selectOnly(target);
    scrollToIndex(index);
  }, [rows, selectOnly, scrollToIndex]);

  const reveal = (target: string) => {
    revealRef.current = target;
    selectOnly(target);
  };

  // ---------- Aktionen ----------

  const expand = (row: TreeRow) => setExpanded((current) => new Map(current).set(row.key, row.path));

  const collapse = (row: TreeRow) => {
    setExpanded((current) => {
      if (!current.has(row.key)) return current;
      const next = new Map(current);
      next.delete(row.key);
      return next;
    });
    // Ausgewählte Einträge darin verschwinden; die Auswahl geht auf den Ordner.
    const hidden = (key: string) => key !== row.key && isSameOrInside(key, row.path);
    if ([...selectionRef.current].some(hidden) || (leadRef.current !== null && hidden(leadRef.current))) {
      anchorRef.current = row.key;
      setSelection(new Set([...selectionRef.current].filter((k) => !hidden(k)).concat(row.key)), row.key);
    }
  };

  const toggle = (row: TreeRow) => (row.expanded ? collapse(row) : expand(row));

  const collapseAll = () => {
    setExpanded((current) => (current.size === 1 && current.has(rootKey) ? current : new Map([[rootKey, root]])));
    // Was jetzt verborgen ist, gibt die Auswahl an den obersten Ordner darüber ab.
    const current = rowsRef.current;
    const leadAt = current.findIndex((r) => r.key === leadRef.current);
    if (leadAt >= 0 && current[leadAt].depth > 1) {
      let top = leadAt;
      while (current[top].depth > 1) top = parentRow(current, top);
      selectOnly(current[top].path);
    } else if ([...selectionRef.current].some((k) => (current.find((r) => r.key === k)?.depth ?? 0) > 1)) {
      selectOnly(leadAt >= 0 ? current[leadAt].path : root);
    }
  };

  /** Die ausgewählten Zeilen in der Reihenfolge des Baums. */
  const selectedRows = rows.filter((r) => selection.has(r.key));
  const leadRow = leadIndex >= 0 ? rows[leadIndex] : null;

  /** Ziel für „New“ und „Paste“: der aktuelle Ordner bzw. der Ordner der aktuellen Datei. */
  const targetDir = (): string => {
    if (!leadRow) return root;
    return leadRow.isDirectory ? leadRow.path : parentPath(leadRow.path);
  };

  const siblingsOf = (dir: string): FileEntry[] => listingsRef.current.get(pathKey(dir))?.entries ?? [];

  const createEntry = async (directory: boolean) => {
    const parent = targetDir();
    const siblings = siblingsOf(parent);
    let created: string | null = null;
    const answer = await askText({
      title: directory ? 'New Directory' : 'New File',
      validate: (value) => {
        const split = splitNewName(value);
        if ('problem' in split) return split.problem;
        const first = pathKey(split.segments[0]);
        const clash = siblings.find((e) => pathKey(e.name) === first);
        if (clash && (split.segments.length === 1 || !clash.isDirectory)) return `“${clash.name}” already exists.`;
        return null;
      },
      submit: async (value) => {
        try {
          created = await api.request(directory ? 'files.createDirectory' : 'files.createFile', { parent, name: value });
          return null;
        } catch (err) {
          return errorText(err);
        }
      },
    });
    const path = created as string | null;
    if (answer === null || path === null) return;
    // Zielordner und neue Zwischenordner aufklappen, den neuen Eintrag zeigen; eine neue Datei öffnet wie in IntelliJ.
    setExpanded((current) => {
      const next = new Map(current);
      for (let dir = parentPath(path); isSameOrInside(dir, parent); dir = parentPath(dir)) {
        next.set(pathKey(dir), dir);
        if (pathKey(dir) === pathKey(parent)) break;
      }
      return next;
    });
    reveal(path);
    if (!directory) onOpenFile(path);
  };

  const rename = async () => {
    const row = selectedRows.length === 1 ? selectedRows[0] : null;
    if (!row || row.isRoot) return;
    const siblings = siblingsOf(parentPath(row.path));
    const { base } = splitExtension(row.name, row.isDirectory);
    const isJava = !row.isDirectory && /\.java$/i.test(row.name);
    await askText({
      title: 'Rename',
      message: `Rename ${row.isDirectory ? 'directory' : 'file'} “${row.name}” to:`,
      value: row.name,
      selection: [0, base.length],
      hint: isJava ? JAVA_RENAME_HINT : undefined,
      okLabel: 'Rename',
      validate: (value) => {
        const problem = fileNameProblem(value);
        if (problem) return problem;
        const clash = pathKey(value) !== row.key.slice(row.key.lastIndexOf('\\') + 1) && siblings.some((e) => pathKey(e.name) === pathKey(value));
        return clash ? `“${value}” already exists.` : null;
      },
      submit: async (value) => {
        if (value === row.name) return null;
        try {
          const renamed = await api.request('files.rename', { path: row.path, newName: value });
          reveal(renamed);
          return null;
        } catch (err) {
          return errorText(err);
        }
      },
    });
  };

  const deleteSelected = async () => {
    const targets = selectedRows.filter((r) => !r.isRoot);
    if (targets.length === 0) return;
    const single = targets.length === 1 ? targets[0] : null;
    const message = single
      ? `Delete ${single.isDirectory ? 'directory' : 'file'} “${single.name}”${single.isDirectory ? ' with all its contents' : ''}?`
      : `Delete ${targets.length} items?`;
    const choice = await ask({
      title: 'Delete',
      message: `${message} ${single ? 'It is' : 'They are'} moved to the Recycle Bin.`,
      items: targets.map((r) => relativeLabel(root, r.path)),
      buttons: [
        { id: 'delete', label: 'Delete', primary: true },
        { id: 'cancel', label: 'Cancel' },
      ],
    });
    if (choice !== 'delete') return;
    const next = selectionAfterDelete(rowsRef.current, targets.map((r) => r.path));
    try {
      await api.request('files.delete', { paths: targets.map((r) => r.path) });
      if (next) selectOnly(next);
    } catch (err) {
      notify({ level: 'error', text: errorText(err) });
    }
  };

  const copySelected = () => {
    const paths = selectedRows.filter((r) => !r.isRoot).map((r) => r.path);
    if (paths.length === 0) return;
    clipboard.current = paths;
    setHasClipboard(true);
  };

  const paste = async () => {
    const sources = clipboard.current;
    if (sources.length === 0) return;
    const target = targetDir();
    const afterPaste = (copies: string[]) => {
      setExpanded((current) => (current.has(pathKey(target)) ? current : new Map(current).set(pathKey(target), target)));
      if (copies.length > 0) reveal(copies[0]);
    };
    try {
      if (sources.length === 1) {
        const source = sources[0];
        const suggestion = await api.request('files.suggestCopyName', { source, target });
        if (suggestion !== baseName(source)) {
          // Namenskonflikt: Der Kern schlägt einen Namen mit Zusatz vor, der Nutzer kann ihn ändern.
          const isDirectory = siblingsOf(parentPath(source)).find((e) => pathKey(e.path) === pathKey(source))?.isDirectory ?? false;
          let copies: string[] = [];
          const answer = await askText({
            title: 'Copy',
            message: `Copy “${baseName(source)}” to “${relativeLabel(root, target)}” as:`,
            value: suggestion,
            selection: [0, splitExtension(suggestion, isDirectory).base.length],
            okLabel: 'Copy',
            validate: fileNameProblem,
            submit: async (value) => {
              try {
                copies = await api.request('files.copy', { sources, target, newName: value });
                return null;
              } catch (err) {
                return errorText(err);
              }
            },
          });
          if (answer !== null) afterPaste(copies);
          return;
        }
      }
      afterPaste(await api.request('files.copy', { sources, target }));
    } catch (err) {
      notify({ level: 'error', text: errorText(err) });
    }
  };

  const copyPath = () => {
    const paths = selectedRows.map((r) => r.path);
    if (paths.length === 0) return;
    api.request('files.copyPaths', { paths }).catch((err: unknown) => notify({ level: 'error', text: errorText(err) }));
  };

  const showInExplorer = () => {
    if (!leadRow) return;
    api.request('files.showInExplorer', { path: leadRow.path }).catch((err: unknown) => notify({ level: 'error', text: errorText(err) }));
  };

  const open = (row: TreeRow) => {
    if (!row.isDirectory) onOpenFile(row.path);
  };

  // ---------- Bedienung ----------

  const moveTo = (index: number, extend: boolean) => {
    const row = rows[index];
    if (!row) return;
    if (extend && anchorRef.current !== null) {
      const anchorAt = rows.findIndex((r) => r.key === anchorRef.current);
      setSelection(new Set(rangeKeys(rows, anchorAt < 0 ? index : anchorAt, index)), row.key);
    } else {
      selectOnly(row.path);
    }
    scrollToIndex(index);
  };

  const openMenuAtLead = () => {
    const el = treeRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const index = Math.max(0, leadIndex);
    const depth = rows[index]?.depth ?? 0;
    setMenu({
      x: box.left + 28 + depth * 18,
      y: Math.min(box.bottom, box.top + (index + 1) * TREE_ROW_HEIGHT - el.scrollTop),
      viaKeyboard: true,
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.metaKey) return;
    const ctrl = e.ctrlKey;
    let handled = true;
    if (ctrl && e.code === 'KeyC') {
      if (e.shiftKey) copyPath();
      else copySelected();
    } else if (ctrl && !e.shiftKey && e.code === 'KeyV') void paste();
    else if (!ctrl && (e.key === 'F2' || (e.shiftKey && e.key === 'F6'))) void rename();
    else if (!ctrl && !e.shiftKey && e.key === 'Delete') void deleteSelected();
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) openMenuAtLead();
    else if (ctrl) handled = false;
    else {
      const pageSize = Math.max(1, Math.floor((treeRef.current?.clientHeight ?? 0) / TREE_ROW_HEIGHT));
      const action = treeKey(e.key, e.shiftKey, rows, leadIndex, pageSize);
      if (!action) handled = false;
      else if (action.type === 'move') moveTo(action.index, action.extend);
      else if (action.type === 'expand') expand(rows[action.index]);
      else if (action.type === 'collapse') collapse(rows[action.index]);
      else if (action.type === 'open') open(rows[action.index]);
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onRowMouseDown = (e: ReactMouseEvent, row: TreeRow, index: number) => {
    if (e.button === 2) {
      // Rechtsklick auf eine nicht ausgewählte Zeile wählt nur sie aus; das Menü folgt mit `contextmenu`.
      if (!selectionRef.current.has(row.key)) selectOnly(row.path);
      return;
    }
    if (e.button !== 0) return;
    if (e.shiftKey && anchorRef.current !== null) moveTo(index, true);
    else if (e.ctrlKey) {
      const next = new Set(selectionRef.current);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      anchorRef.current = row.key;
      setSelection(next, row.key);
    } else selectOnly(row.path);
  };

  const menuEntries = (): MenuEntry[] => {
    const hasRoot = selectedRows.some((r) => r.isRoot);
    const single = selectedRows.length === 1 ? selectedRows[0] : null;
    return [
      {
        kind: 'submenu',
        label: 'New',
        entries: [
          { kind: 'item', label: 'File', run: () => void createEntry(false) },
          { kind: 'item', label: 'Directory', run: () => void createEntry(true) },
        ],
      },
      { kind: 'separator' },
      { kind: 'item', label: 'Copy', shortcut: SHORTCUTS.copy, disabled: selectedRows.length === 0 || hasRoot, run: copySelected },
      { kind: 'item', label: 'Copy Path', shortcut: SHORTCUTS.copyPath, disabled: selectedRows.length === 0, run: copyPath },
      { kind: 'item', label: 'Paste', shortcut: SHORTCUTS.paste, disabled: !hasClipboard, run: () => void paste() },
      { kind: 'separator' },
      { kind: 'item', label: 'Rename…', shortcut: SHORTCUTS.rename, disabled: !single || single.isRoot, run: () => void rename() },
      {
        kind: 'item',
        label: 'Delete…',
        shortcut: SHORTCUTS.delete,
        disabled: selectedRows.length === 0 || hasRoot,
        run: () => void deleteSelected(),
      },
      { kind: 'separator' },
      { kind: 'item', label: 'Open in Explorer', disabled: !leadRow, run: showInExplorer },
      // Kommt mit dem Terminal (Ticket 11).
      { kind: 'item', label: 'Open in Terminal', disabled: true, run: () => {} },
    ];
  };

  // ---------- Darstellung ----------

  const first = Math.max(0, Math.floor(viewport.top / TREE_ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / TREE_ROW_HEIGHT) + OVERSCAN);
  const drawn = rows.slice(first, last).map((row, i) => ({ row, index: first + i }));
  // Die aktuelle Zeile ist immer gezeichnet, damit `aria-activedescendant` auf sie zeigt.
  if (leadIndex >= 0 && (leadIndex < first || leadIndex >= last)) drawn.push({ row: rows[leadIndex], index: leadIndex });
  const rowId = (index: number) => `file-tree-row-${index}`;

  return (
    <>
      <ToolWindowHeader title="Project" onHide={onHide}>
        {/* Wirkt ab Ticket 05, wenn es offene Dateien gibt. */}
        <button type="button" className="icon-button" aria-label="Select Opened File" title="Select Opened File" disabled>
          <LocateIcon />
        </button>
        <button type="button" className="icon-button" aria-label="Collapse All" title="Collapse All" onClick={collapseAll}>
          <CollapseAllIcon />
        </button>
      </ToolWindowHeader>
      <div className="tool-window-body file-tree-body">
      <div
        ref={treeRef}
        className="file-tree"
        role="tree"
        aria-label="Project Files"
        aria-multiselectable="true"
        aria-activedescendant={leadIndex >= 0 ? rowId(leadIndex) : undefined}
        tabIndex={0}
        data-autofocus=""
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.clientHeight > 0) savedScrollTop.current = el.scrollTop;
          setViewport({ top: el.scrollTop, height: el.clientHeight });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, viaKeyboard: false });
        }}
      >
        <div className="file-tree-content" style={{ height: rows.length * TREE_ROW_HEIGHT }}>
          {drawn.map(({ row, index }) => (
            <div
              key={row.key}
              id={rowId(index)}
              role="treeitem"
              aria-label={row.name}
              aria-level={row.depth + 1}
              aria-expanded={row.isDirectory ? row.expanded : undefined}
              aria-selected={selection.has(row.key)}
              className={[
                'file-tree-row',
                selection.has(row.key) && 'selected',
                index === leadIndex && 'lead',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ top: index * TREE_ROW_HEIGHT, paddingLeft: 6 + row.depth * 18 }}
              title={row.isRoot ? row.path : undefined}
              onMouseDown={(e) => onRowMouseDown(e, row, index)}
              onDoubleClick={(e) => {
                if (e.ctrlKey || e.shiftKey) return;
                if (row.isDirectory) toggle(row);
                else open(row);
              }}
            >
              <span
                className={row.expanded ? 'file-tree-arrow expanded' : 'file-tree-arrow'}
                onMouseDown={(e) => {
                  if (e.button !== 0 || !row.isDirectory) return;
                  // Der Pfeil klappt nur auf und zu, die Auswahl bleibt.
                  e.stopPropagation();
                  toggle(row);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                {row.isDirectory && <ChevronRightIcon />}
              </span>
              <span className={row.isDirectory ? 'file-tree-icon folder' : 'file-tree-icon'}>
                {row.isDirectory ? <FolderIcon /> : <FileIcon />}
              </span>
              <span className={row.isRoot ? 'file-tree-name root' : 'file-tree-name'}>{row.name}</span>
              {row.isRoot && <span className="file-tree-detail">{row.path}</span>}
              {row.loading && <span className="file-tree-detail">loading…</span>}
            </div>
          ))}
        </div>
      </div>
      </div>
      {menu && (
        <Menu
          label="Project Files"
          entries={menuEntries()}
          anchor={{ x: menu.x, y: menu.y }}
          highlightFirst={menu.viaKeyboard}
          onClose={() => {
            setMenu(null);
            treeRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
}

/** Ob ein Verzeichnis (Schlüssel → Wert) einen Schlüssel unter `target` hat (oder `target` selbst). */
function hasKeyWithin(map: ReadonlyMap<string, unknown>, target: string): boolean {
  for (const key of map.keys()) if (isSameOrInside(key, target)) return true;
  return false;
}
