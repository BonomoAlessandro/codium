// Werkzeugfenster „Database“ (Ticket 20): Verbindungen des Projekts als Baum aus Verbindung, Datenbank, Schemas,
// Tabellen und Views und deren Spalten, geladen beim Aufklappen. „+“ legt eine Verbindung an; Rechtsklick „Edit…“,
// „Delete“ und „Refresh“. Fehlt ein Passwort (etwa mit „Ask for password every time“), fragt das Fenster danach.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CodiumError, ErrorCode, type CodiumApi, type DbConnection } from '../../shared/types';
import { errorText } from '../errors';
import type { Notify } from '../Notices';
import { useAsk, useAskText } from '../popup/Dialogs';
import { Menu, type MenuEntry } from '../popup/Menu';
import { ToolWindowHeader } from '../project/ToolWindowHeader';
import { ConnectionDialog } from './ConnectionDialog';

interface DatabaseToolWindowProps {
  api: CodiumApi;
  notify: Notify;
  onHide: () => void;
  /** Doppelklick auf eine Tabelle oder View (Inhalt als Tab, Ticket 21). */
  onOpenTable?: (connection: DbConnection, schema: string, table: string) => void;
}

/** Ein Knoten des Baums; die Kinder kommen beim Aufklappen. */
interface TreeNode {
  key: string;
  label: string;
  detail?: string;
  kind: 'connection' | 'database' | 'schema' | 'table' | 'view' | 'column';
  connection: DbConnection;
  schema?: string;
  table?: string;
  primaryKey?: boolean;
  leaf?: boolean;
}

export function DatabaseToolWindow({ api, notify, onHide, onOpenTable }: DatabaseToolWindowProps) {
  const [connections, setConnections] = useState<DbConnection[]>([]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [children, setChildren] = useState<ReadonlyMap<string, TreeNode[]>>(() => new Map());
  const [loading, setLoading] = useState<ReadonlySet<string>>(() => new Set());
  const [dialog, setDialog] = useState<{ connection?: DbConnection } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; connection: DbConnection } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const ask = useAsk();
  const askText = useAskText();

  const reloadConnections = useCallback(async () => {
    const list = await api.request('db.connections').catch((err: unknown) => {
      notify({ level: 'error', text: errorText(err) });
      return [] as DbConnection[];
    });
    setConnections(list);
  }, [api, notify]);

  useEffect(() => {
    void reloadConnections();
  }, [reloadConnections]);

  /** Laufende Passwortabfragen je Verbindung: Mehrere Anfragen, die gleichzeitig scheitern, fragen nur einmal (Review). */
  const prompts = useRef(new Map<string, Promise<boolean>>());

  /** Fragt nach dem Passwort und übergibt es dem Kern; `false` bei Abbruch oder Fehler. */
  const promptPassword = useCallback(
    (connection: DbConnection, message: string): Promise<boolean> => {
      const running = prompts.current.get(connection.id);
      if (running) return running;
      const prompt = (async () => {
        let entered: string | null = null;
        await askText({
          title: `Password for ${connection.name}`,
          message: `${message}\n${connection.user}@${connection.host}:${connection.port}/${connection.database}`,
          value: '',
          password: true,
          okLabel: 'Connect',
          submit: (value) => {
            entered = value;
            return Promise.resolve();
          },
        });
        if (entered === null) return false;
        try {
          await api.request('db.setPassword', { id: connection.id, password: entered });
          return true;
        } catch (err) {
          notify({ level: 'error', text: `${connection.name}: ${errorText(err)}` });
          return false;
        }
      })();
      prompts.current.set(connection.id, prompt);
      void prompt.finally(() => prompts.current.delete(connection.id));
      return prompt;
    },
    [api, askText, notify],
  );

  /** Fragt bei fehlendem Passwort danach und wiederholt; liefert `null` bei Abbruch oder Fehler. */
  const withPassword = useCallback(
    async <T,>(connection: DbConnection, work: () => Promise<T>): Promise<T | null> => {
      for (;;) {
        try {
          return await work();
        } catch (err) {
          if (err instanceof CodiumError && err.code === ErrorCode.dbPasswordRequired) {
            if (!(await promptPassword(connection, err.message))) return null;
            continue;
          }
          // Die Meldung der Datenbank als Fehlerhinweis.
          notify({ level: 'error', text: `${connection.name}: ${errorText(err)}` });
          return null;
        }
      }
    },
    [notify, promptPassword],
  );

  /** Je Knoten ein Zähler; „Refresh“ erhöht ihn, ein älteres Ergebnis fällt dann weg (Review). */
  const tokens = useRef(new Map<string, number>());

  const load = useCallback(
    async (node: TreeNode) => {
      const { connection } = node;
      const token = tokens.current.get(node.key) ?? 0;
      setLoading((s) => new Set(s).add(node.key));
      const id = connection.id;
      const done = () =>
        setLoading((s) => {
          const next = new Set(s);
          next.delete(node.key);
          return next;
        });
      let result: TreeNode[] | null = null;
      try {
        result = await withPassword(connection, async (): Promise<TreeNode[]> => {
        if (node.kind === 'connection') {
          // Unter der Verbindung die konfigurierte Datenbank (ohne Abfrage).
          return [{ key: `d:${id}`, label: connection.database, kind: 'database', connection }];
        }
        if (node.kind === 'database') {
          const schemas = await api.request('db.schemas', { id });
          return schemas.map((schema) => ({ key: `s:${id}:${schema}`, label: schema, kind: 'schema', connection, schema }));
        }
        if (node.kind === 'schema') {
          const relations = await api.request('db.relations', { id, schema: node.schema! });
          return relations.map((r) => ({ key: `t:${id}:${node.schema}:${r.name}`, label: r.name, kind: r.kind, connection, schema: node.schema, table: r.name }));
        }
        const columns = await api.request('db.columns', { id, schema: node.schema!, table: node.table! });
        return columns.map((c) => ({
          key: `c:${id}:${node.schema}:${node.table}:${c.name}`,
          label: c.name,
          detail: `${c.type}${c.nullable ? '' : ' not null'}`,
          kind: 'column',
          connection,
          primaryKey: c.primaryKey,
          leaf: true,
        }));
        });
      } finally {
        done();
      }
      // Inzwischen neu angestossen („Refresh“, Bearbeiten): dieses Ergebnis gilt nicht mehr.
      if ((tokens.current.get(node.key) ?? 0) !== token) return;
      if (result === null) {
        setExpanded((s) => {
          const next = new Set(s);
          next.delete(node.key);
          return next;
        });
        return;
      }
      setChildren((m) => new Map(m).set(node.key, result));
    },
    [api, withPassword],
  );

  const toggle = (node: TreeNode) => {
    if (node.leaf) return;
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(node.key)) next.delete(node.key);
      else next.add(node.key);
      return next;
    });
  };

  /** „Refresh“: Der Ast der Verbindung lädt neu; aufgeklappte Knoten laden ihre Kinder gleich wieder (siehe unten). */
  const refresh = (connection: DbConnection) => {
    const mine = (key: string) => key.includes(`:${connection.id}`);
    for (const key of [...children.keys(), ...loading]) if (mine(key)) tokens.current.set(key, (tokens.current.get(key) ?? 0) + 1);
    setChildren((m) => new Map([...m].filter(([key]) => !mine(key))));
    setLoading((s) => new Set([...s].filter((key) => !mine(key))));
  };

  const remove = async (connection: DbConnection) => {
    const choice = await ask({
      title: 'Delete Connection',
      message: `Delete the connection “${connection.name}”?`,
      buttons: [
        { id: 'delete', label: 'Delete' },
        { id: 'cancel', label: 'Cancel', primary: true },
      ],
    });
    if (choice !== 'delete') return;
    try {
      await api.request('db.deleteConnection', { id: connection.id });
      await reloadConnections();
    } catch (err) {
      notify({ level: 'error', text: errorText(err) });
    }
  };

  const menuEntries = (connection: DbConnection): MenuEntry[] => [
    { kind: 'item', label: 'Edit…', run: () => setDialog({ connection }) },
    { kind: 'item', label: 'Delete', run: () => void remove(connection) },
    { kind: 'item', label: 'Refresh', run: () => refresh(connection) },
  ];

  const rows: Array<{ node: TreeNode; depth: number }> = [];
  const walk = (node: TreeNode, depth: number) => {
    rows.push({ node, depth });
    if (!expanded.has(node.key)) return;
    for (const child of children.get(node.key) ?? []) walk(child, depth + 1);
  };
  for (const connection of connections) walk({ key: `conn:${connection.id}`, label: connection.name, kind: 'connection', connection }, 0);

  // Aufgeklappte Knoten ohne Kinder laden (beim Aufklappen und nach „Refresh“, von oben nach unten).
  useEffect(() => {
    for (const { node } of rows) {
      if (expanded.has(node.key) && !children.has(node.key) && !loading.has(node.key)) void load(node);
    }
  });

  return (
    <>
      <ToolWindowHeader title="Database" onHide={onHide}>
        <button type="button" className="icon-button" aria-label="New Connection" title="New Connection" onClick={() => setDialog({})}>
          +
        </button>
      </ToolWindowHeader>
      <div className="tool-window-body database-body">
        {connections.length === 0 ? (
          <p className="tool-window-placeholder">No connections. Click + to add one.</p>
        ) : (
          <div className="database-tree" role="tree" aria-label="Database">
            {rows.map(({ node, depth }) => (
              <div
                key={node.key}
                role="treeitem"
                aria-label={node.label}
                aria-level={depth + 1}
                aria-expanded={node.leaf ? undefined : expanded.has(node.key)}
                aria-selected={selected === node.key}
                aria-busy={loading.has(node.key) || undefined}
                className={`database-node database-${node.kind}${selected === node.key ? ' selected' : ''}`}
                style={{ paddingLeft: 6 + depth * 16 }}
                onMouseDown={(e) => {
                  if (e.button === 0 || e.button === 2) setSelected(node.key);
                }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).classList.contains('database-arrow')) toggle(node);
                }}
                onDoubleClick={() => {
                  if ((node.kind === 'table' || node.kind === 'view') && onOpenTable) onOpenTable(node.connection, node.schema!, node.table!);
                  else toggle(node);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Enter') {
                    e.preventDefault();
                    if ((e.key === 'ArrowRight') !== expanded.has(node.key) || e.key === 'Enter') toggle(node);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (node.kind === 'connection') setMenu({ x: e.clientX, y: e.clientY, connection: node.connection });
                }}
                tabIndex={selected === node.key ? 0 : -1}
              >
                <span className="database-arrow" aria-hidden="true">
                  {node.leaf ? '' : expanded.has(node.key) ? '▾' : '▸'}
                </span>
                <span className="database-label">
                  {node.primaryKey && (
                    <span className="database-pk" title="Primary key">
                      🔑
                    </span>
                  )}
                  {node.label}
                </span>
                {node.detail && <span className="database-detail">{node.detail}</span>}
                {node.kind === 'connection' && <span className="database-detail">{`${node.connection.host}:${node.connection.port}`}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      {menu && <Menu label="Connection" entries={menuEntries(menu.connection)} anchor={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />}
      {dialog && (
        <ConnectionDialog
          api={api}
          {...(dialog.connection ? { connection: dialog.connection } : {})}
          onSaved={(saved) => {
            // Erst die geänderten Felder, dann der Ast: sonst zeigte er noch den alten Datenbanknamen (Review).
            const edited = dialog.connection !== undefined;
            void reloadConnections().then(() => {
              if (edited) refresh(saved);
            });
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
