// Langsamer Testlauf (Ticket 27): Der Test-PostgreSQL hinterlässt keine Prozesse, weder nach `stop` noch wenn der
// Testprozess vorher endet. Gezählt wird jeder Prozess des Servers mit Startzeit, auch die Hilfsprozesse („io_worker“),
// die ihren Hauptprozess überleben können.

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { startPostgres } from '../support/postgres';
import { serverProcesses } from '../support/postgresReaper';
import { killProcesses, listProcesses, stillRunning, type ProcessInfo } from '../support/processes';

const HOLDER = path.join(__dirname, '..', 'support', 'postgresHolder.ts');

/** Welche der Prozesse noch laufen (gleiche Nummer und Startzeit). */
function running(processes: readonly ProcessInfo[]): ProcessInfo[] {
  const table = listProcesses(['postgres.exe']);
  return processes.filter((p) => stillRunning(p, table));
}

describe('Test-PostgreSQL räumt auf (Ticket 27)', () => {
  it('beendet mit stop alle Prozesse des Servers samt Hilfsprozessen und löscht seinen Ordner', async () => {
    const server = await startPostgres();
    let before: ProcessInfo[] = [];
    try {
      before = serverProcesses(listProcesses(['postgres.exe']), server);
      // Hauptprozess und Hilfsprozesse; sonst bewiese die Prüfung danach nichts.
      expect(before.length).toBeGreaterThan(1);
      expect(server.processes()).toBe(before.length);
    } finally {
      await server.stop();
    }
    expect(running(before)).toEqual([]);
    expect(server.processes()).toBe(0);
    expect(fs.existsSync(path.dirname(server.dataDir))).toBe(false);
  });

  it('beendet einen Server samt Hilfsprozessen, wenn sein Testprozess abrupt endet', async () => {
    // Ein eigener Node-Prozess spielt den Testprozess: Er startet den Server und wird dann hart beendet, ohne `stop`.
    const holder = spawn(process.execPath, [HOLDER], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let before: ProcessInfo[] = [];
    let dataDir = '';
    try {
      const line = await new Promise<string>((resolve, reject) => {
        let out = '';
        holder.stdout!.on('data', (chunk: Buffer) => {
          out += chunk.toString('utf8');
          if (out.includes('\n')) resolve(out.split('\n')[0]);
        });
        holder.once('exit', (code) => reject(new Error(`Der Testprozess endete vor dem Start des Servers (${code}).`)));
      });
      dataDir = (JSON.parse(line) as { dataDir: string }).dataDir;
      before = serverProcesses(listProcesses(['postgres.exe']), { dataDir });
      expect(before.length).toBeGreaterThan(1);

      const exited = new Promise<void>((resolve) => holder.once('exit', () => resolve()));
      holder.kill();
      await exited;

      await expect.poll(() => running(before).map((p) => p.pid), { timeout: 30_000, interval: 500 }).toEqual([]);
      expect(serverProcesses(listProcesses(['postgres.exe']), { dataDir })).toEqual([]);
      await expect.poll(() => fs.existsSync(path.dirname(dataDir)), { timeout: 30_000, interval: 500 }).toBe(false);
    } finally {
      // Sicherheitsnetz, falls der Wächter versagt: nur Prozesse dieses Servers.
      if (holder.exitCode === null) holder.kill();
      if (dataDir) killProcesses(serverProcesses(listProcesses(['postgres.exe']), { dataDir }, before).map((p) => p.pid));
    }
  });
});
