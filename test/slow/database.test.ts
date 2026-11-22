// Langsamer Testlauf (Ticket 20): Datenbank-Verbindungen und Baum gegen ein PostgreSQL aus embedded-postgres auf einem
// Zufallsport. Das Passwort verschlüsselt der nachgemachte Port „Geheimnisse“.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandArgs, CommandName, CommandResult, DbConnectionInput } from '../../src/shared/types';
import { createTestCore, restart, type TestCore } from '../support/core';
import { PG_DATABASE, PG_PASSWORD, PG_USER, startPostgres, type TestPostgres } from '../support/postgres';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';

describe('Datenbank: Verbindungen und Baum', () => {
  const tempDir = useTempDirs();
  let server: TestPostgres;

  beforeAll(async () => {
    server = await startPostgres();
    // Die Prüfung auf Prozesse sieht den laufenden Server (sonst bewiese sie nach dem Stoppen nichts).
    expect(server.processes()).toBeGreaterThan(0);
    await server.sql(`
      CREATE SCHEMA crm;
      CREATE TABLE crm.customers (id serial PRIMARY KEY, name text NOT NULL, email varchar(40));
      CREATE TABLE crm.order_items (order_id int, line int, qty numeric(12,2) NOT NULL, PRIMARY KEY (order_id, line));
      CREATE TABLE crm.audit_log (at timestamptz, message text);
      CREATE VIEW crm.named_customers AS SELECT id, name FROM crm.customers;
    `);
  });

  afterAll(async () => {
    await server?.stop();
    // Nach den Tests läuft kein PostgreSQL-Prozess mehr.
    if (server) expect(server.processes()).toBe(0);
  });

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  const input = (overrides: Partial<DbConnectionInput> = {}): DbConnectionInput => ({
    name: 'Shop',
    host: '127.0.0.1',
    port: server.port,
    database: PG_DATABASE,
    user: PG_USER,
    ssl: false,
    askPassword: false,
    ...overrides,
  });

  async function open(dataDir: string, project: string, test = createTestCore(dataDir, { dbConnectTimeoutMs: 5000 })) {
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    const windowId = test.ports.windows.windowTitled(`${path.basename(project)} – Codium`);
    return { test, windowId };
  }

  function projectDir(name: string): string {
    const dir = path.join(tempDir(), name);
    fs.mkdirSync(dir);
    return dir;
  }

  it('testet Verbindungen (gültig und ungültig)', async () => {
    const { test, windowId } = await open(tempDir(), projectDir('alpha'));
    const ok = await call(test, windowId, 'db.testConnection', { connection: input(), password: PG_PASSWORD });
    expect(ok.serverVersion).toMatch(/^\d+/);
    await expect(call(test, windowId, 'db.testConnection', { connection: input(), password: 'falsch' })).rejects.toMatchObject({
      code: 'DB_FAILED',
      message: expect.stringMatching(/password authentication failed/),
    });
    await expect(call(test, windowId, 'db.testConnection', { connection: input({ database: 'gibt_es_nicht' }), password: PG_PASSWORD })).rejects.toMatchObject({
      code: 'DB_FAILED',
      message: expect.stringMatching(/gibt_es_nicht/),
    });
    await expect(call(test, windowId, 'db.testConnection', { connection: input({ name: '' }) })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('zeigt Schemas ohne Systemschemas, Tabellen und Views, Spalten mit Primärschlüssel und Nullbarkeit', async () => {
    const { test, windowId } = await open(tempDir(), projectDir('alpha'));
    const saved = await call(test, windowId, 'db.saveConnection', { connection: input(), password: PG_PASSWORD });
    expect(await call(test, windowId, 'db.schemas', { id: saved.id })).toEqual(['crm', 'public']);
    expect(await call(test, windowId, 'db.relations', { id: saved.id, schema: 'crm' })).toEqual([
      { name: 'audit_log', kind: 'table' },
      { name: 'customers', kind: 'table' },
      { name: 'named_customers', kind: 'view' },
      { name: 'order_items', kind: 'table' },
    ]);
    expect(await call(test, windowId, 'db.columns', { id: saved.id, schema: 'crm', table: 'customers' })).toEqual([
      { name: 'id', type: 'integer', nullable: false, primaryKey: true },
      { name: 'name', type: 'text', nullable: false, primaryKey: false },
      { name: 'email', type: 'character varying(40)', nullable: true, primaryKey: false },
    ]);
    const items = await call(test, windowId, 'db.columns', { id: saved.id, schema: 'crm', table: 'order_items' });
    expect(items.filter((c) => c.primaryKey).map((c) => c.name)).toEqual(['order_id', 'line']);
    expect(items.find((c) => c.name === 'qty')).toEqual({ name: 'qty', type: 'numeric(12,2)', nullable: false, primaryKey: false });
    expect((await call(test, windowId, 'db.columns', { id: saved.id, schema: 'crm', table: 'audit_log' })).some((c) => c.primaryKey)).toBe(false);
  });

  it('speichert das Passwort nur verschlüsselt; „Ask for password every time“ speichert keines und fragt', async () => {
    const dataDir = tempDir();
    const { test, windowId } = await open(dataDir, projectDir('alpha'));
    const saved = await call(test, windowId, 'db.saveConnection', { connection: input(), password: PG_PASSWORD });
    expect(saved.hasPassword).toBe(true);
    const stored = test.core.projectCore(windowId)!.state.databaseConnections!.find((c) => c.id === saved.id)!;
    expect(stored.password).toMatch(/^fake:/);
    // Der Zustand wird kurz nach der Änderung geschrieben.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const files = fs.readdirSync(dataDir, { recursive: true }).map(String).filter((f) => f.endsWith('.json'));
    for (const f of files) expect(fs.readFileSync(path.join(dataDir, f), 'utf8')).not.toContain(PG_PASSWORD);

    const ask = await call(test, windowId, 'db.saveConnection', { connection: input({ name: 'Ask', askPassword: true }), password: PG_PASSWORD });
    expect(ask.hasPassword).toBe(false);
    expect(test.core.projectCore(windowId)!.state.databaseConnections!.find((c) => c.id === ask.id)!.password).toBeUndefined();
    await expect(call(test, windowId, 'db.schemas', { id: ask.id })).rejects.toMatchObject({ code: 'DB_PASSWORD_REQUIRED' });
    // Ein falsches abgefragtes Passwort fragt erneut; ein richtiges gilt bis zum Schliessen des Fensters.
    await call(test, windowId, 'db.setPassword', { id: ask.id, password: 'falsch' });
    await expect(call(test, windowId, 'db.schemas', { id: ask.id })).rejects.toMatchObject({ code: 'DB_PASSWORD_REQUIRED' });
    await call(test, windowId, 'db.setPassword', { id: ask.id, password: PG_PASSWORD });
    expect(await call(test, windowId, 'db.schemas', { id: ask.id })).toContain('crm');

    // Bearbeiten ohne Passwort behält das gespeicherte; Löschen entfernt die Verbindung.
    const edited = await call(test, windowId, 'db.saveConnection', { id: saved.id, connection: input({ name: 'Shop (edited)' }) });
    expect(edited).toMatchObject({ id: saved.id, name: 'Shop (edited)', hasPassword: true });
    expect(await call(test, windowId, 'db.schemas', { id: saved.id })).toContain('crm');
    await call(test, windowId, 'db.deleteConnection', { id: saved.id });
    expect((await call(test, windowId, 'db.connections')).map((c) => c.name)).toEqual(['Ask']);
  });

  it('schickt nie PGPASSWORD des Nutzers; Bearbeiten verwirft ein abgefragtes Passwort; ein Pool je Verbindung', async () => {
    const { test, windowId } = await open(tempDir(), projectDir('alpha'));
    // Ohne gespeichertes Passwort darf node-postgres nicht auf PGPASSWORD zurückgreifen (Review).
    const before = process.env.PGPASSWORD;
    process.env.PGPASSWORD = PG_PASSWORD;
    try {
      const plain = await call(test, windowId, 'db.saveConnection', { connection: input({ name: 'Plain' }) });
      await expect(call(test, windowId, 'db.schemas', { id: plain.id })).rejects.toMatchObject({ code: 'DB_FAILED' });
      await expect(call(test, windowId, 'db.testConnection', { connection: input() })).rejects.toMatchObject({ code: 'DB_FAILED' });
    } finally {
      if (before === undefined) delete process.env.PGPASSWORD;
      else process.env.PGPASSWORD = before;
    }

    // Ein abgefragtes Passwort gilt nach einer Änderung der Verbindung nicht mehr.
    const ask = await call(test, windowId, 'db.saveConnection', { connection: input({ name: 'Ask', askPassword: true }) });
    await call(test, windowId, 'db.setPassword', { id: ask.id, password: PG_PASSWORD });
    expect(await call(test, windowId, 'db.schemas', { id: ask.id })).toContain('crm');
    await call(test, windowId, 'db.saveConnection', { id: ask.id, connection: input({ name: 'Ask (renamed)', askPassword: true }) });
    await expect(call(test, windowId, 'db.schemas', { id: ask.id })).rejects.toMatchObject({ code: 'DB_PASSWORD_REQUIRED' });
    // „Test Connection“ mit „Ask for password every time“: mit eingegebenem Passwort, ohne es zu speichern.
    expect((await call(test, windowId, 'db.testConnection', { connection: input({ askPassword: true }), password: PG_PASSWORD })).serverVersion).toMatch(/^\d+/);

    // Gleichzeitige erste Anfragen: ein Pool. Ein gespeichertes Passwort lässt sich entfernen.
    const saved = await call(test, windowId, 'db.saveConnection', { connection: input({ name: 'Saved' }), password: PG_PASSWORD });
    const service = test.core.projectCore(windowId)!.database;
    const before2 = service.openPools;
    await Promise.all([1, 2, 3].map(() => call(test, windowId, 'db.schemas', { id: saved.id })));
    expect(service.openPools).toBe(before2 + 1);
    expect((await call(test, windowId, 'db.saveConnection', { id: saved.id, connection: input({ name: 'Saved' }), password: '' })).hasPassword).toBe(false);
  });

  it('Verbindungen überstehen einen Neustart und gehören nur zu ihrem Projekt; der Abbau baut die Pools ab', async () => {
    const dataDir = tempDir();
    const alpha = projectDir('alpha');
    const beta = projectDir('beta');
    const first = await open(dataDir, alpha);
    const saved = await call(first.test, first.windowId, 'db.saveConnection', { connection: input(), password: PG_PASSWORD });
    expect(await call(first.test, first.windowId, 'db.schemas', { id: saved.id })).toContain('crm');
    const service = first.test.core.projectCore(first.windowId)!.database;
    expect(service.openPools).toBe(1);
    const sessions = async () =>
      Number((await server.sql("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'Codium'")).rows[0].n);
    expect(await sessions()).toBeGreaterThan(0);

    const second = await restart(first.test, { dbConnectTimeoutMs: 5000 });
    // Der Abbau des Projekt-Kerns hat den Pool abgebaut: keine Sitzung von Codium mehr.
    expect(service.openPools).toBe(0);
    await expect.poll(sessions, { timeout: 10_000 }).toBe(0);

    await second.core.start();
    const alphaWindow = second.ports.windows.windowTitled('alpha – Codium');
    const connections = await call(second, alphaWindow, 'db.connections');
    expect(connections).toEqual([{ ...input(), id: saved.id, hasPassword: true }]);
    // Ohne erneute Eingabe des Passworts.
    expect(await call(second, alphaWindow, 'db.schemas', { id: saved.id })).toContain('crm');

    await call(second, alphaWindow, 'app.openProject', { path: beta });
    const betaWindow = second.ports.windows.windowTitled('beta – Codium');
    expect(await call(second, betaWindow, 'db.connections')).toEqual([]);
  });
});
