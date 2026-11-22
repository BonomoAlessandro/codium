// Datenbank-Dienst im Projekt-Kern (Ticket 20): Verbindungen zu PostgreSQL mit node-postgres, im Projekt-Zustand
// gespeichert, das Passwort nur verschlüsselt (Port „Geheimnisse“). Pro Verbindung ein kleiner Pool, beim Abbau des
// Projekt-Kerns abgebaut. Werte kommen in ihrer Textdarstellung, ohne Umwandlung in JavaScript-Zahlen oder -Daten.
// Lädt nie Electron.

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ErrorCode, type CommandParams, type DbColumn, type DbConnection, type DbConnectionInput, type DbRelation } from '../../../shared/types';
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
