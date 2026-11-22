// Testhilfe (Ticket 20): ein PostgreSQL aus embedded-postgres auf einem freien Zufallsport (nie 5432), mit Daten in
// einem Temp-Ordner. Nach `stop` läuft kein PostgreSQL-Prozess dieses Servers mehr.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

export const PG_USER = 'codium';
export const PG_PASSWORD = 'geheim-und-lang';
export const PG_DATABASE = 'shop';

export interface TestPostgres {
  port: number;
  /** Zahl der noch laufenden PostgreSQL-Prozesse dieses Servers. */
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
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'codium-pg-')));
  const dataDir = path.join(base, 'data');
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
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    throw err;
  }
  return {
    port,
    dataDir,
    processes: () => postgresProcessesFor(dataDir, port),
    sql: (text, values) => admin.query(text, values),
    stop: async () => {
      await admin.end().catch(() => {});
      await server.stop().catch(() => {});
      // Erst wenn die Prozesse fort sind, ist der Datenordner frei.
      for (let i = 0; i < 50 && postgresProcessesFor(dataDir, port) > 0; i++) await new Promise((resolve) => setTimeout(resolve, 200));
      try {
        fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch {
        // Ein Rest im Temp-Ordner stört keinen Test; die Prozesse prüft der Test selbst.
      }
    },
  };
}

/**
 * Laufende PostgreSQL-Prozesse dieses Servers: der Hauptprozess (Datenordner oder Port in der Befehlszeile) und seine
 * Kindprozesse (die tragen beides nicht).
 */
export function postgresProcessesFor(dataDir: string, port?: number): number {
  if (process.platform !== 'win32') throw new Error('Die Prüfung auf PostgreSQL-Prozesse gibt es nur unter Windows.');
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CommandLine)\" }"],
    { encoding: 'utf8' },
  );
  const needle = dataDir.toLowerCase().replace(/\\/g, '/');
  const rows = out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [pid, parent, ...rest] = line.split('\t');
      return { pid, parent, command: rest.join('\t').toLowerCase().replace(/\\/g, '/') };
    });
  const mains = new Set(rows.filter((r) => r.command.includes(needle) || (port !== undefined && new RegExp(`(^|\\s)-p\\s+"?${port}"?(\\s|$)`).test(r.command))).map((r) => r.pid));
  return rows.filter((r) => mains.has(r.pid) || mains.has(r.parent)).length;
}
