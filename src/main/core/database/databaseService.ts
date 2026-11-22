// Datenbank-Dienst im Projekt-Kern (Ticket 20): Verbindungen zu PostgreSQL mit node-postgres, im Projekt-Zustand
// gespeichert, das Passwort nur verschlüsselt (Port „Geheimnisse“). Pro Verbindung ein kleiner Pool, beim Abbau des
// Projekt-Kerns abgebaut. Werte kommen in ihrer Textdarstellung, ohne Umwandlung in JavaScript-Zahlen oder -Daten.
// Lädt nie Electron.

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  ErrorCode,
  type CommandParams,
  type DbChangeSet,
  type DbColumn,
  type DbConnection,
  type DbConnectionInput,
  type DbRelation,
  type DbRowsPage,
  type DbSort,
  type DbTableColumn,
  type DbTableInfo,
  type DbValue,
} from '../../../shared/types';
import type { SecretsPort } from '../ports';
import type { ProjectCore } from '../projectCore';
import { CommandError } from '../router';
import { MAX_DB_CONNECTIONS, type StoredDbConnection } from '../schema';

export interface DatabaseServiceOptions {
  secrets: SecretsPort;
  log: (message: string) => void;
  /** Wartezeit beim Verbinden; Tests setzen eine kürzere. */
  connectTimeoutMs?: number;
}

const POOL_SIZE = 3;
/** Zeilen je Seite im Tabelleninhalt. */
const TABLE_PAGE = 500;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

/** Alle Werte als Text, wie PostgreSQL sie schickt (grosse Zahlen, Zeitzonen, Genauigkeit bleiben erhalten). */
const TEXT_TYPES = { getTypeParser: () => (value: string) => value } as unknown as pg.CustomTypesConfig;

export class DatabaseService {
  private readonly pools = new Map<string, Promise<pg.Pool>>();
  /** Je Verbindung erhöht bei jedem Abbau ihres Pools; ein Pool aus einer älteren Generation wird gleich wieder beendet. */
  private readonly generations = new Map<string, number>();
  /** Abgefragte Passwörter, nur bis zum Schliessen des Fensters. */
  private readonly sessionPasswords = new Map<string, string>();
  private disposed = false;

  constructor(
    private readonly project: ProjectCore,
    private readonly options: DatabaseServiceOptions,
  ) {
    project.onDispose(() => this.dispose());
  }

  // ---------- Verbindungen ----------

  connections(): DbConnection[] {
    return this.stored().map(publicConnection);
  }

  async saveConnection(params: CommandParams<'db.saveConnection'>): Promise<DbConnection> {
    const p = params as Partial<CommandParams<'db.saveConnection'>>;
    const input = connectionInput(p?.connection);
    if (p.password !== undefined && typeof p.password !== 'string') throw new CommandError('The password must be a text.', ErrorCode.invalidParams);
    const existing = p.id === undefined ? undefined : this.find(p.id);
    if (p.id === undefined && this.stored().length >= MAX_DB_CONNECTIONS) throw new CommandError('Too many connections.', ErrorCode.invalidParams);
    // Nie im Klartext: ohne Verschlüsselung kein gespeichertes Passwort.
    let password = input.askPassword ? undefined : existing?.password;
    if (!input.askPassword && p.password !== undefined) {
      if (p.password === '') password = undefined;
      else {
        if (!(await this.options.secrets.available())) {
          throw new CommandError('Passwords cannot be stored encrypted on this system. Use “Ask for password every time”.', ErrorCode.dbFailed);
        }
        password = await this.options.secrets.encrypt(p.password);
      }
    }
    const saved: StoredDbConnection = { id: existing?.id ?? randomUUID(), ...input, ...(password !== undefined ? { password } : {}) };
    this.project.updateState((state) => {
      const list = state.databaseConnections ?? [];
      const index = list.findIndex((c) => c.id === saved.id);
      state.databaseConnections = index >= 0 ? list.map((c, i) => (i === index ? saved : c)) : [...list, saved];
    });
    // Geänderte Felder: Der alte Pool und ein abgefragtes Passwort gelten nicht mehr (ein für Host A eingegebenes
    // Passwort ginge sonst ungefragt an Host B; Review).
    await this.dropPool(saved.id);
    this.sessionPasswords.delete(saved.id);
    return publicConnection(saved);
  }

  async deleteConnection(params: CommandParams<'db.deleteConnection'>): Promise<void> {
    const connection = this.find((params as Partial<CommandParams<'db.deleteConnection'>>)?.id);
    this.project.updateState((state) => {
      state.databaseConnections = (state.databaseConnections ?? []).filter((c) => c.id !== connection.id);
    });
    this.sessionPasswords.delete(connection.id);
    await this.dropPool(connection.id);
  }

  /** „Test Connection“: verbindet einmal mit den eingegebenen Feldern und fragt die Version ab. */
  async testConnection(params: CommandParams<'db.testConnection'>): Promise<{ serverVersion: string }> {
    const p = params as Partial<CommandParams<'db.testConnection'>>;
    const input = connectionInput(p?.connection);
    if (p.password !== undefined && typeof p.password !== 'string') throw new CommandError('The password must be a text.', ErrorCode.invalidParams);
    let password = p.password;
    if (password === undefined && p.id !== undefined) password = await this.passwordFor(this.find(p.id), false);
    const client = new pg.Client(this.clientConfig(input, password));
    // Ein Abbruch der Verbindung meldet pg auch als Ereignis; ohne Empfänger beendete es den Hauptprozess (Review).
    client.on('error', (err) => this.options.log(`Test der Verbindung „${input.name}“: ${err.message}`));
    try {
      await client.connect();
      const result = await client.query<{ server_version: string }>('SHOW server_version');
      return { serverVersion: result.rows[0]?.server_version ?? '' };
    } catch (err) {
      throw dbError(err);
    } finally {
      await client.end().catch(() => {});
    }
  }

  /** Ein abgefragtes Passwort für diese Verbindung, bis das Fenster schliesst. */
  async setPassword(params: CommandParams<'db.setPassword'>): Promise<void> {
    const p = params as Partial<CommandParams<'db.setPassword'>>;
    const connection = this.find(p?.id);
    if (typeof p.password !== 'string') throw new CommandError('A password is expected.', ErrorCode.invalidParams);
    this.sessionPasswords.set(connection.id, p.password);
    await this.dropPool(connection.id);
  }

  // ---------- Baum ----------

  async schemas(params: CommandParams<'db.schemas'>): Promise<string[]> {
    const connection = this.find((params as Partial<CommandParams<'db.schemas'>>)?.id);
    // Ohne Systemschemas: pg_catalog, pg_toast, pg_temp_* und information_schema.
    const rows = await this.query<{ name: string }>(
      connection,
      `SELECT nspname AS name FROM pg_catalog.pg_namespace
        WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
        ORDER BY nspname`,
    );
    return rows.map((r) => r.name);
  }

  async relations(params: CommandParams<'db.relations'>): Promise<DbRelation[]> {
    const p = params as Partial<CommandParams<'db.relations'>>;
    const connection = this.find(p?.id);
    const schema = identifier(p.schema, 'schema');
    const rows = await this.query<{ name: string; kind: string }>(
      connection,
      `SELECT c.relname AS name, c.relkind AS kind FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'f', 'v', 'm')
        ORDER BY c.relname`,
      [schema],
    );
    return rows.map((r) => ({ name: r.name, kind: r.kind === 'v' || r.kind === 'm' ? 'view' : 'table' }));
  }

  async columns(params: CommandParams<'db.columns'>): Promise<DbColumn[]> {
    const p = params as Partial<CommandParams<'db.columns'>>;
    const connection = this.find(p?.id);
    const schema = identifier(p.schema, 'schema');
    const table = identifier(p.table, 'table');
    const rows = await this.query<{ name: string; type: string; nullable: string; primary_key: string }>(
      connection,
      `SELECT a.attname AS name,
              pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
              (NOT a.attnotnull)::text AS nullable,
              EXISTS (SELECT 1 FROM pg_catalog.pg_index i
                       WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY (i.indkey))::text AS primary_key
         FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [schema, table],
    );
    // Die Werte kommen als Text (siehe TEXT_TYPES): Wahrheitswerte als „true“/„false“.
    return rows.map((r) => ({ name: r.name, type: r.type, nullable: r.nullable === 'true', primaryKey: r.primary_key === 'true' }));
  }

  // ---------- Tabelleninhalt und Bearbeiten (Ticket 21) ----------

  /** Aufbau: Spalten (bytea und JSON erkannt), Primärschlüssel in seiner Reihenfolge, Schreibschutz mit Grund. */
  async tableInfo(params: CommandParams<'db.tableInfo'>): Promise<DbTableInfo> {
    const p = params as Partial<CommandParams<'db.tableInfo'>>;
    return this.describe(this.find(p?.id), identifier(p.schema, 'schema'), identifier(p.table, 'table'));
  }

  private async describe(connection: StoredDbConnection, schema: string, table: string): Promise<DbTableInfo> {
    return (await this.describeFull(connection, schema, table)).info;
  }

  /** Aufbau samt Basistyp je Spalte (bei Domänen der Typ darunter; Review von Ticket 21). */
  private async describeFull(connection: StoredDbConnection, schema: string, table: string): Promise<{ info: DbTableInfo; bases: Map<string, string> }> {
    const rows = await this.query<{ name: string; type: string; base: string; nullable: string; pk_position: string | null; relkind: string }>(
      connection,
      `SELECT a.attname AS name,
              pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
              bt.typname AS base,
              (NOT a.attnotnull)::text AS nullable,
              (SELECT array_position(i.indkey::int2[], a.attnum) FROM pg_catalog.pg_index i
                WHERE i.indrelid = c.oid AND i.indisprimary)::text AS pk_position,
              c.relkind::text AS relkind
         FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
         JOIN pg_catalog.pg_type bt ON bt.oid = CASE WHEN t.typtype = 'd' THEN t.typbasetype ELSE t.oid END
        WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [schema, table],
    );
    if (rows.length === 0) throw new CommandError(`The table ${schema}.${table} no longer exists.`, ErrorCode.dbFailed);
    const kind = rows[0].relkind === 'v' || rows[0].relkind === 'm' ? 'view' : 'table';
    const primaryKey = rows
      .filter((r) => r.pk_position !== null)
      .sort((a, b) => Number(a.pk_position) - Number(b.pk_position))
      .map((r) => r.name);
    const columns: DbTableColumn[] = rows.map((r) => ({
      name: r.name,
      type: r.type,
      nullable: r.nullable === 'true',
      primaryKey: r.pk_position !== null,
      binary: r.base === 'bytea',
      json: r.base === 'json' || r.base === 'jsonb',
    }));
    const binaryKey = columns.some((c) => c.primaryKey && c.binary);
    const readOnlyReason =
      kind === 'view'
        ? 'Views are read-only.'
        : primaryKey.length === 0
          ? 'This table has no primary key, so rows cannot be identified safely. It is read-only.'
          : binaryKey
            ? 'The primary key contains a binary column, so rows cannot be identified safely. It is read-only.'
            : undefined;
    return { info: { kind, columns, primaryKey, ...(readOnlyReason ? { readOnlyReason } : {}) }, bases: new Map(rows.map((r) => [r.name, r.base])) };
  }

  /** Eine Seite zu 500 Zeilen; Werte als Text, bytea als Länge. */
  async tableRows(params: CommandParams<'db.tableRows'>): Promise<DbRowsPage> {
    const p = params as Partial<CommandParams<'db.tableRows'>>;
    const connection = this.find(p?.id);
    const schema = identifier(p.schema, 'schema');
    const table = identifier(p.table, 'table');
    const offset = p.offset ?? 0;
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) throw new CommandError('A row offset is expected.', ErrorCode.invalidParams);
    if (p.filter !== undefined && typeof p.filter !== 'string') throw new CommandError('The filter must be a text.', ErrorCode.invalidParams);
    const info = await this.describe(connection, schema, table);
    const names = new Set(info.columns.map((c) => c.name));
    const jsonColumns = new Set(info.columns.filter((c) => c.json && c.type !== 'jsonb').map((c) => c.name));
    // json hat keinen Ordnungsoperator: nach seinem Text sortieren (Review).
    const sortKey = (name: string) => (jsonColumns.has(name) ? `${quoteIdent(name)}::text` : quoteIdent(name));
    let order: string[];
    if (p.sort !== undefined) {
      const sort = p.sort as Partial<DbSort> | null;
      if (!sort || typeof sort.column !== 'string' || !names.has(sort.column) || (sort.direction !== 'asc' && sort.direction !== 'desc')) {
        throw new CommandError('Not a valid sort column.', ErrorCode.invalidParams);
      }
      // Gleiche Werte in der gewählten Spalte: der Primärschlüssel hält die Seiten stabil.
      order = [`${sortKey(sort.column)} ${sort.direction === 'asc' ? 'ASC' : 'DESC'}`, ...info.primaryKey.filter((k) => k !== sort.column).map(quoteIdent)];
    } else {
      order = info.primaryKey.map(quoteIdent);
    }
    const select = info.columns.map((c) => (c.binary ? `octet_length(${quoteIdent(c.name)})::text` : quoteIdent(c.name))).join(', ');
    const filter = p.filter?.trim();
    // Der Filter ist die WHERE-Bedingung des Nutzers, unverändert (seine eigene Datenbank, Spezifikation).
    const sql =
      `SELECT ${select} FROM ${quoteIdent(schema)}.${quoteIdent(table)}` +
      (filter ? `\nWHERE (${filter}\n)` : '') +
      (order.length > 0 ? ` ORDER BY ${order.join(', ')}` : '') +
      ` LIMIT ${TABLE_PAGE + 1} OFFSET ${offset}`;
    const pool = await this.poolFor(connection);
    try {
      const result = await pool.query<DbValue[]>({ text: sql, rowMode: 'array' });
      // Ein Filter mit „;“ ergibt mehrere Anweisungen und mehrere Ergebnisse (Review).
      if (Array.isArray(result) || !Array.isArray(result.rows)) throw new CommandError('The filter must be a single condition (no “;”).', ErrorCode.dbFailed);
      const rows = result.rows.slice(0, TABLE_PAGE);
      return { rows, hasMore: result.rows.length > TABLE_PAGE };
    } catch (err) {
      throw this.failure(connection, err);
    }
  }

  /**
   * Speichert einen Änderungssatz in einer Transaktion mit Parametern. Updates treffen die Zeile über den
   * Primärschlüssel und die ursprünglichen Werte der geänderten Spalten (Textdarstellung, NULL-sicher), Deletes über den
   * Primärschlüssel; trifft eine Anweisung keine Zeile, bricht alles ab. Bei jedem Fehler wird zurückgerollt.
   */
  async submitChanges(params: CommandParams<'db.submitChanges'>): Promise<void> {
    const p = params as Partial<CommandParams<'db.submitChanges'>>;
    const connection = this.find(p?.id);
    const schema = identifier(p.schema, 'schema');
    const table = identifier(p.table, 'table');
    const changes = changeSet(p.changes);
    const { info, bases } = await this.describeFull(connection, schema, table);
    if (info.readOnlyReason) throw new CommandError(info.readOnlyReason, ErrorCode.dbFailed);
    const columns = new Map(info.columns.map((c) => [c.name, c]));
    const checkColumns = (record: Record<string, DbValue>, what: string) => {
      for (const name of Object.keys(record)) {
        const column = columns.get(name);
        if (!column) throw new CommandError(`Unknown column in ${what}: ${name}`, ErrorCode.invalidParams);
        if (column.binary && what !== 'key') throw new CommandError(`Binary columns are read-only: ${name}`, ErrorCode.invalidParams);
      }
    };
    const keyOf = (key: Record<string, DbValue>) => {
      checkColumns(key, 'key');
      for (const k of info.primaryKey) if (!(k in key) || key[k] === null) throw new CommandError('Each changed row needs its primary key.', ErrorCode.invalidParams);
      return info.primaryKey.map((k) => [k, key[k]] as const);
    };
    const target = `${quoteIdent(schema)}.${quoteIdent(table)}`;
    const describeKey = (key: ReadonlyArray<readonly [string, DbValue]>) => key.map(([k, v]) => `${k} = ${v}`).join(', ');

    await this.project.progress.run('Saving changes…', async () => {
      const pool = await this.poolFor(connection);
      let client: pg.PoolClient;
      try {
        client = await pool.connect();
      } catch (err) {
        throw this.failure(connection, err);
      }
      try {
        await client.query('BEGIN');
        for (const update of changes.updates) {
          checkColumns(update.values, 'update');
          checkColumns(update.original, 'update');
          const set = Object.keys(update.values);
          if (set.length === 0) continue;
          const key = keyOf(update.key);
          const values: DbValue[] = [];
          const param = (value: DbValue) => {
            values.push(value);
            return `$${values.length}`;
          };
          const assignments = set.map((name) => `${quoteIdent(name)} = ${param(update.values[name])}`);
          const where = [
            ...key.map(([name, value]) => `${quoteIdent(name)} = ${param(value)}`),
            // Fremde Änderung: die ursprünglichen Werte der geänderten Spalten, als Text und NULL-sicher verglichen.
            // char(n) verliert mit ::text die Füllzeichen, die der geladene Wert hat: dort im eigenen Typ vergleichen.
            ...Object.keys(update.original).map((name) =>
              bases.get(name) === 'bpchar'
                ? `${quoteIdent(name)} IS NOT DISTINCT FROM CAST(${param(update.original[name])} AS ${columns.get(name)!.type})`
                : `${quoteIdent(name)}::text IS NOT DISTINCT FROM ${param(update.original[name])}`,
            ),
          ];
          const result = await client.query(`UPDATE ${target} SET ${assignments.join(', ')} WHERE ${where.join(' AND ')}`, values);
          if (result.rowCount !== 1) {
            throw new CommandError(`The row (${describeKey(key)}) was changed or deleted in the meantime. Nothing was saved; reload to see the current values.`, ErrorCode.dbFailed);
          }
        }
        for (const removal of changes.deletes) {
          const key = keyOf(removal.key);
          const values = key.map(([, value]) => value);
          const where = key.map(([name], i) => `${quoteIdent(name)} = $${i + 1}`);
          const result = await client.query(`DELETE FROM ${target} WHERE ${where.join(' AND ')}`, values);
          if (result.rowCount !== 1) {
            throw new CommandError(`The row (${describeKey(key)}) was already deleted. Nothing was saved; reload to see the current rows.`, ErrorCode.dbFailed);
          }
        }
        for (const insert of changes.inserts) {
          checkColumns(insert.values, 'insert');
          // Leere Zellen fehlen schon (Standardwerte und automatische Schlüssel greifen); gesetztes NULL bleibt NULL.
          const names = Object.keys(insert.values);
          if (names.length === 0) {
            await client.query(`INSERT INTO ${target} DEFAULT VALUES`);
            continue;
          }
          await client.query(
            `INSERT INTO ${target} (${names.map(quoteIdent).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`,
            names.map((n) => insert.values[n]),
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err instanceof CommandError ? err : this.failure(connection, err);
      } finally {
        client.release();
      }
    });
  }

  // ---------- Abfragen (auch für Ticket 21) ----------

  /** Eine Abfrage über den Pool der Verbindung; Fehler mit der Meldung der Datenbank. */
  async query<T extends object>(connection: StoredDbConnection, sql: string, values: unknown[] = []): Promise<T[]> {
    const pool = await this.poolFor(connection);
    try {
      const result = await pool.query(sql, values);
      return result.rows as T[];
    } catch (err) {
      throw this.failure(connection, err);
    }
  }

  /** Die gespeicherte Verbindung mit dieser Kennung. */
  find(id: unknown): StoredDbConnection {
    if (typeof id !== 'string') throw new CommandError('A connection id is expected.', ErrorCode.invalidParams);
    const found = this.stored().find((c) => c.id === id);
    if (!found) throw new CommandError('The connection no longer exists.', ErrorCode.invalidParams);
    return found;
  }

  /** Der Pool der Verbindung (angelegt beim ersten Gebrauch). Ohne nötiges Passwort: `DB_PASSWORD_REQUIRED`. */
  async poolFor(connection: StoredDbConnection): Promise<pg.Pool> {
    if (this.disposed) throw new CommandError('The project is closing.', ErrorCode.dbFailed);
    const known = this.pools.get(connection.id);
    if (known) return known;
    // Gleichzeitige erste Anfragen teilen sich einen Pool; wurde er während des Entschlüsselns verworfen (Bearbeiten,
    // Schliessen des Fensters), wird der neue gleich wieder beendet (Review).
    const generation = this.generations.get(connection.id) ?? 0;
    const creating = (async () => {
      const password = await this.passwordFor(connection, true);
      const pool = new pg.Pool({ ...this.clientConfig(connection, password), max: POOL_SIZE, idleTimeoutMillis: 30_000 });
      // Ein Fehler einer ruhenden Verbindung (etwa ein Neustart des Servers) darf den Hauptprozess nicht beenden.
      pool.on('error', (err) => this.options.log(`Datenbank „${connection.name}“: ${err.message}`));
      if (this.disposed || (this.generations.get(connection.id) ?? 0) !== generation) {
        await pool.end().catch(() => {});
        throw new CommandError('The connection was changed or closed. Try again.', ErrorCode.dbFailed);
      }
      return pool;
    })();
    this.pools.set(connection.id, creating);
    creating.catch(() => {
      if (this.pools.get(connection.id) === creating) this.pools.delete(connection.id);
    });
    return creating;
  }

  private clientConfig(input: DbConnectionInput, password: string | undefined): pg.ClientConfig {
    return {
      host: input.host,
      port: input.port,
      database: input.database,
      user: input.user,
      // Immer ausdrücklich, auch leer: Sonst nähme node-postgres PGPASSWORD oder die pgpass-Datei des Nutzers und
      // schickte sie an den eingegebenen Host (Review).
      password: async () => password ?? '',
      // „ja“: verschlüsselt ohne Zertifikatsprüfung (wie sslmode=require); „nein“: unverschlüsselt.
      ssl: input.ssl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      application_name: 'Codium',
      types: TEXT_TYPES,
    };
  }

  /** Abgefragt, sonst gespeichert (entschlüsselt); mit „Ask for password every time“ ohne Abfrage: fragen lassen. */
  private async passwordFor(connection: StoredDbConnection, required: boolean): Promise<string | undefined> {
    const session = this.sessionPasswords.get(connection.id);
    if (session !== undefined) return session;
    if (connection.askPassword) {
      if (!required) return undefined;
      throw new CommandError(`Enter the password for “${connection.name}”.`, ErrorCode.dbPasswordRequired, { id: connection.id });
    }
    if (connection.password === undefined) return undefined;
    try {
      return await this.options.secrets.decrypt(connection.password);
    } catch (err) {
      // Etwa ein Projekt-Zustand von einem anderen Benutzerkonto: neu eingeben lassen.
      this.options.log(`Passwort von „${connection.name}“ lässt sich nicht entschlüsseln: ${(err as Error).message}`);
      if (!required) return undefined;
      throw new CommandError(`The saved password for “${connection.name}” cannot be decrypted. Enter it again.`, ErrorCode.dbPasswordRequired, { id: connection.id });
    }
  }

  /** Ein Fehler der Datenbank; ein abgelehntes Passwort führt zur erneuten Abfrage. */
  private failure(connection: StoredDbConnection, err: unknown): CommandError {
    if (err instanceof CommandError) return err;
    const code = (err as { code?: unknown }).code;
    // 28P01: falsches Passwort; 28000: Anmeldung abgelehnt.
    if ((code === '28P01' || code === '28000') && (connection.askPassword || this.sessionPasswords.has(connection.id))) {
      this.sessionPasswords.delete(connection.id);
      void this.dropPool(connection.id);
      return new CommandError(dbMessage(err), ErrorCode.dbPasswordRequired, { id: connection.id });
    }
    if (typeof code === 'string' && /^(08|28|3D|57P)/.test(code)) void this.dropPool(connection.id);
    return dbError(err);
  }

  private stored(): StoredDbConnection[] {
    return this.project.state.databaseConnections ?? [];
  }

  /**
   * Beendet den Pool einer Verbindung. Anfragen, die ihn schon haben, scheitern dann mit einer Meldung von pg; das
   * betrifft nur Anfragen während eines Verbindungsfehlers oder einer Änderung der Verbindung.
   */
  private async dropPool(id: string): Promise<void> {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    const pool = this.pools.get(id);
    if (!pool) return;
    this.pools.delete(id);
    await pool.then((p) => p.end()).catch(() => {});
  }

  /** Beim Abbau des Projekt-Kerns: alle Pools zu, abgefragte Passwörter vergessen. */
  private async dispose(): Promise<void> {
    this.disposed = true;
    this.sessionPasswords.clear();
    const pools = [...this.pools.values()];
    this.pools.clear();
    await Promise.allSettled(pools.map((p) => p.then((pool) => pool.end())));
  }

  /** Für Tests: Zahl offener Pools. */
  get openPools(): number {
    return this.pools.size;
  }
}

function publicConnection(c: StoredDbConnection): DbConnection {
  return { id: c.id, name: c.name, host: c.host, port: c.port, database: c.database, user: c.user, ssl: c.ssl, askPassword: c.askPassword, hasPassword: c.password !== undefined };
}

/** Die Felder einer Verbindung, geprüft. */
function connectionInput(value: unknown): DbConnectionInput {
  if (typeof value !== 'object' || value === null) throw new CommandError('Connection fields are expected.', ErrorCode.invalidParams);
  const v = value as Record<string, unknown>;
  const text = (key: string, required: boolean) => {
    const raw = v[key];
    if (typeof raw !== 'string' || (required && raw.trim() === '')) throw new CommandError(`Enter the ${key}.`, ErrorCode.invalidParams);
    return raw.trim();
  };
  const port = v.port === undefined ? 5432 : v.port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) throw new CommandError('Enter a port between 1 and 65535.', ErrorCode.invalidParams);
  return {
    name: text('name', true),
    host: text('host', true),
    port,
    database: text('database', true),
    user: text('user', true),
    ssl: v.ssl === true,
    askPassword: v.askPassword === true,
  };
}

function identifier(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw new CommandError(`A ${what} name is expected.`, ErrorCode.invalidParams);
  return value;
}

/** Die Meldung der Datenbank im Wortlaut (mit Hinweis, wenn PostgreSQL einen schickt). */
function dbMessage(err: unknown): string {
  const e = err as { message?: string; detail?: string; hint?: string; code?: string };
  const parts = [e.message ?? String(err)];
  if (e.detail) parts.push(e.detail);
  if (e.hint) parts.push(`Hint: ${e.hint}`);
  return parts.join('\n');
}

function dbError(err: unknown): CommandError {
  if (err instanceof CommandError) return err;
  return new CommandError(dbMessage(err), ErrorCode.dbFailed);
}

/** Ein Name als Bezeichner in SQL: in Anführungszeichen, eingebettete verdoppelt. */
function quoteIdent(name: string): string {
  if (name.includes('\0')) throw new CommandError('Not a valid name.', ErrorCode.invalidParams);
  return `"${name.replace(/"/g, '""')}"`;
}

/** Werte eines Änderungssatzes: Text oder NULL. */
function valueRecord(value: unknown): Record<string, DbValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CommandError('Values are expected.', ErrorCode.invalidParams);
  const result: Record<string, DbValue> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v !== null && typeof v !== 'string') throw new CommandError(`The value of ${key} must be a text or null.`, ErrorCode.invalidParams);
    result[key] = v;
  }
  return result;
}

/** Der Änderungssatz, geprüft. */
function changeSet(value: unknown): DbChangeSet {
  if (typeof value !== 'object' || value === null) throw new CommandError('A change set is expected.', ErrorCode.invalidParams);
  const v = value as Record<string, unknown>;
  const list = (key: string) => {
    if (!Array.isArray(v[key])) throw new CommandError(`The change set needs ${key}.`, ErrorCode.invalidParams);
    return v[key] as Array<Record<string, unknown>>;
  };
  return {
    updates: list('updates').map((u) => ({ key: valueRecord(u?.key), original: valueRecord(u?.original), values: valueRecord(u?.values) })),
    inserts: list('inserts').map((i) => ({ values: valueRecord(i?.values) })),
    deletes: list('deletes').map((d) => ({ key: valueRecord(d?.key) })),
  };
}
