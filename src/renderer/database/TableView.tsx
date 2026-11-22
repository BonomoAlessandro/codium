// Tabelleninhalt als Tab im Code-Bereich (Ticket 21): Seiten zu 500 Zeilen, Sortieren und Filtern in der Datenbank,
// Bearbeiten mit Änderungssatz (geänderte Zellen markiert, neue Zeilen, durchgestrichene gelöschte), „Submit“
// (Ctrl + Enter) in einer Transaktion und „Revert“. Views und Tabellen ohne Primärschlüssel sind schreibgeschützt.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CodiumApi, DbChangeSet, DbRowsPage, DbSort, DbTableInfo, DbValue } from '../../shared/types';
import { EDITOR_FONT_FAMILY, monaco } from '../editor/monaco';
import { errorText } from '../errors';
import type { Notify } from '../Notices';
import { keepFocusInside, useAsk } from '../popup/Dialogs';
import { Menu, type MenuEntry } from '../popup/Menu';

const PAGE = 500;

export interface TableSpec {
  connectionId: string;
  connectionName: string;
  schema: string;
  table: string;
}

interface TableViewProps {
  api: CodiumApi;
  notify: Notify;
  spec: TableSpec;
  /** Meldet offene Änderungen (für die Rückfrage beim Schliessen des Tabs). */
  onDirtyChange: (dirty: boolean) => void;
}

/** Offene Änderungen: geänderte Zellen geladener Zeilen, gelöschte geladene Zeilen, neue Zeilen. */
interface Changes {
  edits: ReadonlyMap<number, ReadonlyMap<number, DbValue>>;
  deleted: ReadonlySet<number>;
  added: ReadonlyArray<ReadonlyMap<number, DbValue>>;
  /** Gelöschte neue Zeilen (Index in `added`). */
  addedDeleted: ReadonlySet<number>;
}

const NO_CHANGES: Changes = { edits: new Map(), deleted: new Set(), added: [], addedDeleted: new Set() };

function isDirty(c: Changes): boolean {
  return c.edits.size > 0 || c.deleted.size > 0 || c.added.some((_, i) => !c.addedDeleted.has(i));
}

export function TableView({ api, notify, spec, onDirtyChange }: TableViewProps) {
  const [info, setInfo] = useState<DbTableInfo | null>(null);
  const [page, setPage] = useState<DbRowsPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<DbSort | null>(null);
  const [filterInput, setFilterInput] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changes, setChanges] = useState<Changes>(NO_CHANGES);
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [editing, setEditing] = useState<{ row: number; col: number; value: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; row: number; col: number } | null>(null);
  const [bigEditor, setBigEditor] = useState<{ row: number; col: number } | null>(null);
  const ask = useAsk();
  const gridRef = useRef<HTMLDivElement>(null);
  const request = useRef(0);

  const dirty = isDirty(changes);
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => onDirtyRef.current(dirty), [dirty]);
  useEffect(() => () => onDirtyRef.current(false), []);

  const params = { id: spec.connectionId, schema: spec.schema, table: spec.table };

  /** Lädt Aufbau und Seite; Fehler (etwa ein ungültiger Filter) zeigt die Ansicht mit der Meldung der Datenbank. */
  const load = useCallback(
    async (next: { offset: number; sort: DbSort | null; filter: string }) => {
      const id = ++request.current;
      setLoading(true);
      try {
        const [tableInfo, rows] = await Promise.all([
          api.request('db.tableInfo', params),
          api.request('db.tableRows', { ...params, offset: next.offset, ...(next.sort ? { sort: next.sort } : {}), ...(next.filter.trim() ? { filter: next.filter } : {}) }),
        ]);
        if (id !== request.current) return;
        setInfo(tableInfo);
        setPage(rows);
        setError(null);
      } catch (err) {
        if (id !== request.current) return;
        setError(errorText(err));
        setPage(null);
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, spec.connectionId, spec.schema, spec.table],
  );

  useEffect(() => {
    void load({ offset, sort, filter });
  }, [load, offset, sort, filter]);

  /** Mit offenen Änderungen erst fragen (Seite, Sortierung, Filter). */
  const confirmDiscard = async (): Promise<boolean> => {
    if (!dirty) return true;
    const choice = await ask({
      title: 'Unsaved Changes',
      message: `${spec.schema}.${spec.table} has changes that are not submitted. Discard them?`,
      buttons: [
        { id: 'discard', label: 'Discard' },
        { id: 'cancel', label: 'Cancel', primary: true },
      ],
    });
    if (choice !== 'discard') return false;
    setChanges(NO_CHANGES);
    setEditing(null);
    return true;
  };

  const go = async (apply: () => void) => {
    if (!(await confirmDiscard())) return;
    setSelected(null);
    apply();
  };

  const readOnly = info?.readOnlyReason !== undefined;
  const columns = info?.columns ?? [];
  const loaded = page?.rows ?? [];
  const rowCount = loaded.length + changes.added.length;

  const valueAt = (row: number, col: number): DbValue => {
    if (row >= loaded.length) {
      const added = changes.added[row - loaded.length];
      return added.has(col) ? (added.get(col) ?? null) : '';
    }
    const edited = changes.edits.get(row);
    if (edited?.has(col)) return edited.get(col) ?? null;
    return loaded[row][col];
  };
  const isChanged = (row: number, col: number) => (row >= loaded.length ? changes.added[row - loaded.length].has(col) : changes.edits.get(row)?.has(col) === true);
  const isDeleted = (row: number) => (row >= loaded.length ? changes.addedDeleted.has(row - loaded.length) : changes.deleted.has(row));
  const canEdit = (col: number) => !readOnly && !saving && columns[col] !== undefined && !columns[col].binary;

  const setCell = (row: number, col: number, value: DbValue) => {
    setChanges((c) => {
      if (row >= loaded.length) {
        const added = [...c.added];
        const cells = new Map(added[row - loaded.length]);
        // In neuen Zeilen heisst ein leerer Text „nicht gesetzt“ (Standardwert greift); NULL bleibt gesetzt.
        if (value === '') cells.delete(col);
        else cells.set(col, value);
        added[row - loaded.length] = cells;
        return { ...c, added };
      }
      const edits = new Map(c.edits);
      const cells = new Map(edits.get(row) ?? []);
      // Zurück auf den ursprünglichen Wert: keine Änderung mehr.
      if (value === loaded[row][col]) cells.delete(col);
      else cells.set(col, value);
      if (cells.size === 0) edits.delete(row);
      else edits.set(row, cells);
      return { ...c, edits };
    });
  };

  const addRow = () => {
    if (readOnly || saving) return;
    setChanges((c) => ({ ...c, added: [...c.added, new Map()] }));
    setSelected({ row: rowCount, col: 0 });
    window.setTimeout(() => gridRef.current?.scrollTo({ top: gridRef.current.scrollHeight }), 0);
  };

  const toggleDelete = (row: number) => {
    if (readOnly || saving) return;
    setChanges((c) => {
      if (row >= loaded.length) {
        const set = new Set(c.addedDeleted);
        const i = row - loaded.length;
        if (set.has(i)) set.delete(i);
        else set.add(i);
        return { ...c, addedDeleted: set };
      }
      const set = new Set(c.deleted);
      if (set.has(row)) set.delete(row);
      else set.add(row);
      return { ...c, deleted: set };
    });
  };

  const changeSet = (): DbChangeSet => {
    const name = (col: number) => columns[col].name;
    const keyOf = (row: number) => Object.fromEntries((info?.primaryKey ?? []).map((k) => [k, loaded[row][columns.findIndex((c) => c.name === k)]]));
    const updates: DbChangeSet['updates'] = [];
    for (const [row, cells] of changes.edits) {
      if (changes.deleted.has(row)) continue;
      updates.push({
        key: keyOf(row),
        original: Object.fromEntries([...cells.keys()].map((col) => [name(col), loaded[row][col]])),
        values: Object.fromEntries([...cells].map(([col, value]) => [name(col), value])),
      });
    }
    return {
      updates,
      inserts: changes.added.filter((_, i) => !changes.addedDeleted.has(i)).map((cells) => ({ values: Object.fromEntries([...cells].map(([col, value]) => [name(col), value])) })),
      deletes: [...changes.deleted].map((row) => ({ key: keyOf(row) })),
    };
  };

  const submit = async () => {
    if (!dirty || readOnly || saving) return;
    setEditing(null);
    setSaving(true);
    try {
      await api.request('db.submitChanges', { ...params, changes: changeSet() });
      setChanges(NO_CHANGES);
      notify({ level: 'success', text: `Saved changes to ${spec.schema}.${spec.table}.` });
      await load({ offset, sort, filter });
    } catch (err) {
      // Zurückgerollt; der Änderungssatz bleibt offen, zum Korrigieren und erneuten Speichern.
      notify({ level: 'error', text: errorText(err) });
    } finally {
      setSaving(false);
    }
  };

  const revert = () => {
    setChanges(NO_CHANGES);
    setEditing(null);
  };

  const commitEdit = () => {
    if (!editing) return;
    setCell(editing.row, editing.col, editing.value);
    setEditing(null);
    gridRef.current?.focus();
  };

  const startEdit = (row: number, col: number) => {
    if (!canEdit(col) || isDeleted(row)) return;
    const value = valueAt(row, col);
    setEditing({ row, col, value: value ?? '' });
  };

  const cycleSort = (column: string) =>
    void go(() => {
      setOffset(0);
      setSort((s) => (s?.column !== column ? { column, direction: 'asc' } : s.direction === 'asc' ? { column, direction: 'desc' } : null));
    });

  const menuEntries = (row: number, col: number): MenuEntry[] => {
    const column = columns[col];
    return [
      { kind: 'item', label: 'Set NULL', // Auch bei NOT NULL: Die Datenbank lehnt es dann mit ihrer Meldung ab.
        disabled: !canEdit(col) || isDeleted(row), run: () => setCell(row, col, null) },
      { kind: 'item', label: 'Open Editor', disabled: !column || column.binary, run: () => setBigEditor({ row, col }) },
      { kind: 'separator' },
      { kind: 'item', label: isDeleted(row) ? 'Restore Row' : 'Delete Row', disabled: readOnly || saving, run: () => toggleDelete(row) },
    ];
  };

  const firstRow = offset + 1;
  const lastRow = offset + loaded.length;

  return (
    <div
      className="table-view"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          if (editing) commitEdit();
          void submit();
        }
      }}
    >
      <div className="table-toolbar" role="toolbar" aria-label="Table">
        <button type="button" disabled={offset === 0 || loading} onClick={() => void go(() => setOffset((o) => Math.max(0, o - PAGE)))}>
          Previous
        </button>
        <button type="button" disabled={!page?.hasMore || loading} onClick={() => void go(() => setOffset((o) => o + PAGE))}>
          Next
        </button>
        <span className="table-range" aria-label="Rows">
          {loaded.length === 0 ? 'No rows' : `Rows ${firstRow}–${lastRow}`}
        </span>
        <form
          className="table-filter"
          onSubmit={(e) => {
            e.preventDefault();
            void go(() => {
              setOffset(0);
              setFilter(filterInput);
            });
          }}
        >
          <span className="table-filter-label">WHERE</span>
          <input aria-label="Filter" spellCheck={false} placeholder="status = 'active'" value={filterInput} onChange={(e) => setFilterInput(e.target.value)} />
        </form>
        <span className="table-toolbar-spacer" />
        <button type="button" disabled={readOnly || saving || !info} onClick={addRow}>
          Add Row
        </button>
        <button type="button" disabled={readOnly || saving || selected === null} onClick={() => selected && toggleDelete(selected.row)}>
          Delete Row
        </button>
        <button type="button" disabled={!dirty || saving} onClick={revert}>
          Revert
        </button>
        <button type="button" className="button-primary" disabled={!dirty || readOnly || saving} title="Ctrl+Enter" onClick={() => void submit()}>
          Submit
        </button>
      </div>
      {info?.readOnlyReason && (
        <p className="table-readonly" role="note">
          Read-only: {info.readOnlyReason}
        </p>
      )}
      {error && (
        <p className="table-error" role="alert">
          {error}
        </p>
      )}
      <div ref={gridRef} className="table-grid" tabIndex={0} role="grid" aria-label={`${spec.schema}.${spec.table}`} aria-busy={loading || saving}>
        <table>
          <thead>
            <tr>
              <th className="table-rownum" />
              {columns.map((c) => (
                <th key={c.name} title={`${c.type}${c.primaryKey ? ', primary key' : ''}`}>
                  <button type="button" className="table-sort" onClick={() => cycleSort(c.name)} aria-sort={sort?.column === c.name ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    {c.name}
                    {sort?.column === c.name ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, row) => (
              <tr key={row} className={`${isDeleted(row) ? 'deleted' : ''}${row >= loaded.length ? ' added' : ''}`} aria-label={`Row ${row + 1}`}>
                <td className="table-rownum">{row >= loaded.length ? '+' : offset + row + 1}</td>
                {columns.map((c, col) => {
                  const value = valueAt(row, col);
                  const isEditing = editing?.row === row && editing.col === col;
                  const isSelected = selected?.row === row && selected.col === col;
                  return (
                    <td
                      key={c.name}
                      role="gridcell"
                      aria-label={`${c.name} ${row + 1}`}
                      aria-selected={isSelected}
                      className={`${isChanged(row, col) ? 'changed' : ''}${isSelected ? ' selected' : ''}`}
                      onMouseDown={(e) => {
                        if (e.button === 0 || e.button === 2) setSelected({ row, col });
                      }}
                      onDoubleClick={() => startEdit(row, col)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY, row, col });
                      }}
                    >
                      {isEditing ? (
                        <input
                          className="table-cell-input"
                          autoFocus
                          spellCheck={false}
                          value={editing.value}
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.ctrlKey) {
                              e.preventDefault();
                              commitEdit();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              e.stopPropagation();
                              setEditing(null);
                              gridRef.current?.focus();
                            }
                          }}
                        />
                      ) : value === null ? (
                        <span className="db-null">null</span>
                      ) : c.binary && row < loaded.length ? (
                        <span className="db-binary">binary, {value} bytes</span>
                      ) : (
                        value
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {menu && <Menu label="Cell" entries={menuEntries(menu.row, menu.col)} anchor={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />}
      {bigEditor && columns[bigEditor.col] && (
        <ValueEditor
          title={`${columns[bigEditor.col].name} (${columns[bigEditor.col].type})`}
          value={valueAt(bigEditor.row, bigEditor.col)}
          json={columns[bigEditor.col].json}
          readOnly={!canEdit(bigEditor.col) || isDeleted(bigEditor.row)}
          onApply={(value) => setCell(bigEditor.row, bigEditor.col, value)}
          onClose={() => setBigEditor(null)}
        />
      )}
    </div>
  );
}

/** „Open Editor“: ein grösseres Feld für lange Texte und JSON (mit Farben). */
function ValueEditor({ title, value, json, readOnly, onApply, onClose }: { title: string; value: DbValue; json: boolean; readOnly: boolean; onApply: (value: string) => void; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const model = monaco.editor.createModel(value ?? '', json ? 'json' : 'plaintext');
    const editor = monaco.editor.create(hostRef.current!, {
      model,
      readOnly,
      automaticLayout: true,
      minimap: { enabled: false },
      fontFamily: EDITOR_FONT_FAMILY,
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      ariaLabel: title,
    });
    editorRef.current = editor;
    editor.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab' && dialogRef.current && !editor.hasTextFocus()) {
        keepFocusInside(e, dialogRef.current);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      editor.dispose();
      model.dispose();
    };
    // Nur beim Öffnen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className="dialog-overlay">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} className="dialog value-editor">
        <div className="dialog-title">{title}</div>
        <div ref={hostRef} className="value-editor-host" />
        <div className="dialog-buttons">
          {!readOnly && (
            <button
              type="button"
              className="button-primary"
              onClick={() => {
                onApply(editorRef.current?.getValue() ?? '');
                onClose();
              }}
            >
              OK
            </button>
          )}
          <button type="button" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
