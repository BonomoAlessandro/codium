// Testhilfe (Ticket 20): ein PostgreSQL aus embedded-postgres auf einem freien Zufallsport (nie 5432), mit Daten in
// einem Temp-Ordner. Nach `stop` läuft kein PostgreSQL-Prozess dieses Servers mehr, ebenso wenn der Testprozess vorher
// endet (Wächter, postgresReaper.ts, Ticket 27). Auch der Test des Wächters lädt die Datei direkt mit Node (siehe
// processes.ts).
//
// embedded-postgres legt nur den Datenordner an (initdb). Starten und beenden tut die Testhilfe selbst: Das `stop` von
// embedded-postgres beendet den Server mit `taskkill /T` über die blosse Prozessnummer, das träfe auch ältere Prozesse
// mit veralteter Elternnummer (Review von Ticket 27). Beendet wird über den Wächter, nach Nummer und Startzeit.

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import { postgres as POSTGRES_BINARY } from '@embedded-postgres/windows-x64';
import pg from 'pg';
import { listProcesses } from './processes.ts';
import { serverProcesses, type ServerIdentity } from './postgresReaper.ts';
import { tempPrefix } from './testRun.ts';

export const PG_USER = 'codium';
export const PG_PASSWORD = 'geheim-und-lang';
export const PG_DATABASE = 'shop';

const REAPER = fileURLToPath(new URL('./postgresReaper.ts', import.meta.url));

export interface TestPostgres {
  port: number;
  /** Zahl der noch laufenden PostgreSQL-Prozesse dieses Servers, Hilfsprozesse eingeschlossen. */
  processes(): number;
  dataDir: string;
  /** Führt SQL als Verwalter in der Testdatenbank aus. */
  sql(text: string, values?: unknown[]): Promise<pg.QueryResult>;
  stop(): Promise<void>;
}

/** Ein freier Port; 5432 (ein echter Server des Nutzers) nie. */
async function freePort(): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as net.AddressInfo;
        server.close(() => resolve(address.port));
      });
    });
    if (port !== 5432) return port;
  }
}

export async function startPostgres(): Promise<TestPostgres> {
  const port = await freePort();
  // Der echte (lange) Pfad: PostgreSQL nennt ihn so in der Befehlszeile, auch wenn TEMP ein Kurzname ist (Review).
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), tempPrefix('pg'))));
  const dataDir = path.join(base, 'data');
  // Der Wächter läuft schon während der Vorbereitung: Endet der Testprozess mittendrin, räumt er trotzdem auf.
  const reaper = startReaper({ dataDir, base });
  const cluster = new EmbeddedPostgres({ databaseDir: dataDir, user: PG_USER, password: PG_PASSWORD, port, persistent: false, onLog: () => {}, onError: () => {} });
  const admin = new pg.Client({ host: '127.0.0.1', port, user: PG_USER, password: PG_PASSWORD, database: PG_DATABASE });
  let server: ChildProcess | undefined;
  try {
    await cluster.initialise();
    // Wie embedded-postgres, aber ohne dessen `start`/`stop` (siehe oben). Ein direktes Kind des Testprozesses: Endet
    // dieser hart, beendet Windows den Hauptprozess mit ihm (Job-Objekt von Node), den Rest der Wächter.
    server = spawn(POSTGRES_BINARY, ['-D', dataDir, '-p', String(port)], { stdio: 'ignore', windowsHide: true });
    await untilAccepting(server, port);
    const setup = new pg.Client({ host: '127.0.0.1', port, user: PG_USER, password: PG_PASSWORD, database: 'postgres' });
    await setup.connect();
    try {
      await setup.query(`CREATE DATABASE ${setup.escapeIdentifier(PG_DATABASE)}`);
    } finally {
      await setup.end().catch(() => {});
    }
    await admin.connect();
  } catch (err) {
    // Scheitert die Vorbereitung, darf kein Server liegen bleiben (Review).
    await admin.end().catch(() => {});
    await reaper.finish();
    throw err;
  }
  reaper.watch();
  // Alle Prozesse des Servers mit Startzeit, auch die Hilfsprozesse, die ihren Hauptprozess überleben können.
  const known = serverProcesses(listProcesses(['postgres.exe']), { dataDir }).map(({ pid, created }) => ({ pid, created }));
  return {
    port,
    dataDir,
    processes: () => serverProcesses(listProcesses(['postgres.exe']), { dataDir }, known).length,
    sql: (text, values) => admin.query(text, values),
    stop: async () => {
      await admin.end().catch(() => {});
      // Der Wächter beendet alle Prozesse des Servers nach Nummer und Startzeit, den Hauptprozess zuerst, und löscht den
      // Ordner.
      await reaper.finish();
    },
  };
}

/** Wartet, bis der Server Verbindungen annimmt; scheitert, wenn er vorher endet oder nach 60 s. */
async function untilAccepting(server: ChildProcess, port: number): Promise<void> {
  let exited = false;
  server.once('exit', () => (exited = true));
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (exited) throw new Error('PostgreSQL endete beim Start.');
    const probe = new pg.Client({ host: '127.0.0.1', port, user: PG_USER, password: PG_PASSWORD, database: 'postgres' });
    try {
      await probe.connect();
      await probe.end();
      return;
    } catch (err) {
      await probe.end().catch(() => {});
      if (Date.now() > deadline) throw new Error(`PostgreSQL nimmt keine Verbindungen an: ${(err as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/** Startet den Wächter eines Servers (postgresReaper.ts). Er hält den Testprozess nicht am Leben. */
function startReaper(server: ServerIdentity & { base: string }): { watch(): void; finish(): Promise<void> } {
  // Eigene Prozessgruppe ohne Konsole: Ein Ctrl + C im Terminal des Testlaufs beendet ihn nicht vor seiner Arbeit.
  const child = spawn(process.execPath, [REAPER, JSON.stringify(server)], { detached: true, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });
  child.stdin!.on('error', () => {});
  child.unref();
  (child.stdin as unknown as net.Socket).unref();
  return {
    watch: () => child.stdin!.write('watch\n'),
    async finish() {
      child.stdin!.end();
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([exited, new Promise<void>((resolve) => (timer = setTimeout(resolve, 60_000)))]);
      clearTimeout(timer);
    },
  };
}
