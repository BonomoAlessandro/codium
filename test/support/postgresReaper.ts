// Wächter eines Test-PostgreSQL (Ticket 27), ein eigener Node-Prozess neben dem Testprozess. `startPostgres` startet
// ihn vor dem Server und hält seine Standardeingabe offen:
//
// - „watch“ (nach dem Start des Servers): Er merkt sich alle Prozesse des Servers mit ihrer Startzeit.
// - Ende der Eingabe: Das geordnete `stop` ist fertig, oder der Testprozess ist fort, auch abrupt (Zeitlimit, Absturz,
//   abgebrochener Lauf); dann schliesst Windows die Eingabe. Der Wächter beendet alle Prozesse dieses Servers, auch
//   Hilfsprozesse, deren Hauptprozess schon fort ist, löscht den Ordner des Servers und endet.
//
// Node startet die Datei direkt (siehe processes.ts); `postgres.ts` lädt sie für `serverProcesses`.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { killProcesses, listProcesses, programOf, withDescendants, type ProcessIdentity, type ProcessInfo } from './processes.ts';

export interface ServerIdentity {
  /** Datenordner des Servers; ein eigener Temp-Ordner, den kein anderer Server hat. */
  dataDir: string;
}

/**
 * Die Prozesse eines Test-Servers in einer Tabelle von postgres.exe: der Hauptprozess (Programm aus embedded-postgres,
 * Datenordner in der Befehlszeile), seine Nachkommen und die früher gemerkten, die noch laufen. Hilfsprozesse wie
 * „io_worker“ nennen weder Datenordner noch Port und können ihren Hauptprozess überleben. Der Port allein zählt nicht:
 * Nach dem Ende dieses Servers kann ihn ein anderer Test-Server bekommen.
 */
export function serverProcesses(table: readonly ProcessInfo[], server: ServerIdentity, known: readonly ProcessIdentity[] = []): ProcessInfo[] {
  const dir = server.dataDir.replace(/\//g, '\\').toLowerCase();
  const roots = table.filter((p) => /[\\/]@embedded-postgres[\\/]/i.test(programOf(p)) && p.cmd.replace(/\//g, '\\').toLowerCase().includes(dir));
  const remembered = table.filter((p) => known.some((k) => k.pid === p.pid && k.created === p.created));
  return withDescendants(table, [...roots, ...remembered, ...childrenOfGone(table, known)]);
}

/**
 * Hilfsprozesse („--forkchild“) gemerkter Prozesse des Servers, die selbst schon fort sind. Beendet `taskkill /T` die
 * Hilfsprozesse vor dem Hauptprozess, startet dieser einen „io_worker“ noch neu, bevor er selbst endet; der neue ist
 * nirgends gemerkt und hat keinen Elternprozess mehr (Ticket 27, nach einem langsamen Lauf gefunden). Trägt inzwischen
 * ein jüngerer Prozess die Nummer des Gemerkten, gehören ihm die Kinder, die nach ihm entstanden.
 */
function childrenOfGone(table: readonly ProcessInfo[], known: readonly ProcessIdentity[]): ProcessInfo[] {
  const gone = known.filter((k) => !table.some((p) => p.pid === k.pid && p.created === k.created));
  return table.filter(
    (p) =>
      p.cmd.includes('--forkchild') &&
      gone.some((g) => p.ppid === g.pid && p.created >= g.created && !table.some((q) => q.pid === g.pid && q.created > g.created && q.created <= p.created)),
  );
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Beendet, was vom Server noch läuft, und löscht seinen Ordner; mit einigen Versuchen, falls Windows Dateien hält. */
function sweep(server: ServerIdentity & { base: string }, known: readonly ProcessIdentity[]): void {
  for (let attempt = 0; attempt < 20; attempt++) {
    const left = serverProcesses(listProcesses(['postgres.exe']), server, known);
    if (left.length === 0) break;
    killProcesses(left.map((p) => p.pid));
    sleep(250);
  }
  for (let attempt = 0; attempt < 20 && fs.existsSync(server.base); attempt++) {
    try {
      fs.rmSync(server.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      sleep(500);
    }
  }
}

async function main(arg: string): Promise<void> {
  const server = JSON.parse(arg) as ServerIdentity & { base: string };
  if (!server.dataDir || !server.base) throw new Error('Datenordner und Ordner des Servers fehlen.');
  let known: ProcessIdentity[] = [];
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    if (chunk.includes('watch')) known = serverProcesses(listProcesses(['postgres.exe']), server, known).map(({ pid, created }) => ({ pid, created }));
  });
  await new Promise<void>((resolve) => {
    process.stdin.once('end', resolve);
    process.stdin.once('close', resolve);
    process.stdin.once('error', () => resolve());
  });
  sweep(server, known);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv[2] ?? '{}').then(
    () => process.exit(0),
    () => process.exit(1),
  );
}
