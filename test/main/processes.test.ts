// Auswahl von Prozessen für das Aufräumen (Ticket 27): reine Logik an vorgegebenen Prozesstabellen, ohne echte Prozesse.

import { describe, expect, it } from 'vitest';
import { descendantsIn } from '../../src/main/core/processTree';
import { serverProcesses } from '../support/postgresReaper';
import type { ProcessInfo } from '../support/processes';

function proc(pid: number, ppid: number, created: number, extra: Partial<ProcessInfo> = {}): ProcessInfo {
  return { pid, ppid, created, name: 'x.exe', exe: '', cmd: '', ...extra };
}

describe('Nachkommen in einer Prozesstabelle', () => {
  it('findet Kinder und Enkel, ohne die Wurzel', () => {
    const table = [proc(10, 1, 100), proc(11, 10, 110), proc(12, 11, 120), proc(13, 1, 130)];
    expect(descendantsIn(table, [table[0]]).map((p) => p.pid)).toEqual([11, 12]);
  });

  it('nimmt keinen älteren Prozess, der nur die neu vergebene Nummer seines toten Elternprozesses trägt', () => {
    // 20 wurde nach dem Ende eines früheren Prozesses 20 neu vergeben; 21 stammt vom früheren und ist älter.
    const table = [proc(20, 1, 500), proc(21, 20, 300), proc(22, 20, 600)];
    expect(descendantsIn(table, [table[0]]).map((p) => p.pid)).toEqual([22]);
  });

  it('läuft bei Kreisen in den Elternnummern nicht endlos', () => {
    const table = [proc(30, 31, 100), proc(31, 30, 100)];
    expect(descendantsIn(table, [table[0]]).map((p) => p.pid)).toEqual([31]);
  });
});

describe('Prozesse eines Test-PostgreSQL', () => {
  const dataDir = 'C:\\Users\\Test\\AppData\\Local\\Temp\\codium-pg-abc\\data';
  const pgExe = 'C:\\repo\\node_modules\\@embedded-postgres\\windows-x64\\native\\bin\\postgres.exe';
  const postmaster = proc(100, 50, 1000, { name: 'postgres.exe', exe: pgExe, cmd: `${pgExe} -D ${dataDir} -p 54321` });
  const ioWorker = proc(101, 100, 1001, { name: 'postgres.exe', exe: pgExe, cmd: `"postgres" "--forkchild=io_worker" "1234"` });
  const backend = proc(102, 100, 1002, { name: 'postgres.exe', exe: pgExe, cmd: `"postgres" "--forkchild=backend" "1235"` });

  it('findet den Hauptprozess über den Datenordner, auch in anderer Schreibweise, und seine Hilfsprozesse', () => {
    const table = [postmaster, ioWorker, backend];
    expect(serverProcesses(table, { dataDir: dataDir.toUpperCase().replace(/\\/g, '/') }).map((p) => p.pid)).toEqual([100, 101, 102]);
  });

  it('findet gemerkte Hilfsprozesse, deren Hauptprozess fort ist, aber keine mit neu vergebener Nummer', () => {
    const reused = proc(102, 7, 5000, { name: 'postgres.exe', exe: pgExe });
    const table = [ioWorker, reused];
    const known = [ioWorker, backend].map(({ pid, created }) => ({ pid, created }));
    expect(serverProcesses(table, { dataDir }, known).map((p) => p.pid)).toEqual([101]);
  });

  it('lässt andere Server in Ruhe: einen anderen Datenordner, ein PostgreSQL ausserhalb von embedded-postgres, den Port allein', () => {
    const otherTest = proc(200, 50, 2000, { name: 'postgres.exe', exe: pgExe, cmd: `${pgExe} -D C:\\Temp\\codium-pg-xyz\\data -p 54321` });
    const users = proc(300, 4, 10, {
      name: 'postgres.exe',
      exe: 'C:\\Program Files\\PostgreSQL\\18\\bin\\postgres.exe',
      cmd: `"C:\\Program Files\\PostgreSQL\\18\\bin\\postgres.exe" -D "${dataDir}"`,
    });
    expect(serverProcesses([otherTest, users], { dataDir })).toEqual([]);
  });
});
