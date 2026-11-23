// Testhilfe (Ticket 20): ein PostgreSQL aus embedded-postgres auf einem freien Zufallsport (nie 5432), mit Daten in
// einem Temp-Ordner. Nach `stop` läuft kein PostgreSQL-Prozess dieses Servers mehr, ebenso wenn der Testprozess vorher
// endet (Wächter, postgresReaper.ts, Ticket 27). Auch der Test des Wächters lädt die Datei direkt mit Node (siehe
// processes.ts).

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
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
  const server = new EmbeddedPostgres({ databaseDir: dataDir, user: PG_USER, password: PG_PASSWORD, port, persistent: false, onLog: () => {}, onError: () => {} });
  const admin = new pg.Client({ host: '127.0.0.1', port, user: PG_USER, password: PG_PASSWORD, database: PG_DATABASE });
  try {
    await server.initialise();
    await server.start();
    await server.createDatabase(PG_DATABASE);
    await admin.connect();
  } catch (err) {
    // Scheitert die Vorbereitung, darf kein Server liegen bleiben (Review).
    await admin.end().catch(() => {});
    await server.stop().catch(() => {});
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
      // embedded-postgres beendet den Hauptprozess samt Baum mit `taskkill /T /F`; was dabei übrig bleibt (etwa
      // Hilfsprozesse ohne Hauptprozess) und den Ordner erledigt danach der Wächter.
      await server.stop().catch(() => {});
      await reaper.finish();
    },
  };
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
