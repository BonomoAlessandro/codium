// Auswahl von Prozessen für das Aufräumen (Ticket 27): reine Logik an vorgegebenen Prozesstabellen, ohne echte Prozesse.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { descendantsIn } from '../../src/main/core/processTree';
import { leftoverTempDirs } from '../support/finalCheck';
import { serverProcesses } from '../support/postgresReaper';
import { fromCheckout, isOrphan, programOf, strayProcesses, type ProcessInfo } from '../support/processes';
import { useTempDirs } from '../support/tempDir';

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

  it('nimmt keinen Prozess mit unbekannter Startzeit als Kind, und keine Kinder einer Wurzel ohne Startzeit (Review)', () => {
    const root = proc(40, 1, 100);
    expect(descendantsIn([root, proc(41, 40, 0)], [root])).toEqual([]);
    const unknownRoot = proc(50, 1, 0);
    expect(descendantsIn([unknownRoot, proc(51, 50, 200)], [unknownRoot])).toEqual([]);
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

  it('findet einen Hilfsprozess, den der gemerkte Hauptprozess kurz vor seinem Ende noch neu gestartet hat (Ticket 27)', () => {
    // Windows nennt für Kindprozesse von PostgreSQL keinen Pfad; der neue io_worker ist nicht gemerkt.
    const respawned = proc(110, 100, 1500, { name: 'postgres.exe', cmd: `"${pgExe}" "--forkchild=io_worker" "999"` });
    const known = [postmaster, ioWorker].map(({ pid, created }) => ({ pid, created }));
    expect(serverProcesses([respawned], { dataDir }, known).map((p) => p.pid)).toEqual([110]);
  });

  it('nimmt keine Kinder einer neu vergebenen Nummer des Hauptprozesses und keinen fremden Hauptprozess', () => {
    const known = [postmaster].map(({ pid, created }) => ({ pid, created }));
    // Ein anderer Server bekam die Nummer 100 später; sein Hilfsprozess entstand danach.
    const otherPostmaster = proc(100, 50, 3000, { name: 'postgres.exe', exe: pgExe, cmd: `${pgExe} -D C:\\Temp\\codium-pg-xyz\\data -p 5555` });
    const otherWorker = proc(111, 100, 3001, { name: 'postgres.exe', cmd: `"${pgExe}" "--forkchild=io_worker" "1"` });
    // Älter als der gemerkte Hauptprozess: kann nicht sein Kind sein.
    const older = proc(112, 100, 500, { name: 'postgres.exe', cmd: `"${pgExe}" "--forkchild=io_worker" "2"` });
    // Ein Hauptprozess (kein Hilfsprozess), dessen Elternnummer zufällig passt.
    const unrelated = proc(113, 100, 1600, { name: 'postgres.exe', exe: pgExe, cmd: `${pgExe} -D C:\\Temp\\codium-pg-abc\\data -p 6666` });
    expect(serverProcesses([otherPostmaster, otherWorker], { dataDir }, known)).toEqual([]);
    expect(serverProcesses([older, unrelated], { dataDir }, known)).toEqual([]);
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

describe('Schlussprüfung: verwaiste Prozesse aus diesem Checkout', () => {
  const root = 'C:\\workspace\\custom\\codium';
  const electron = `${root}\\node_modules\\electron\\dist\\electron.exe`;
  // Elternprozesse, die noch laufen: der Testlauf (Node) und das installierte Codium des Nutzers.
  const vitest = proc(50, 4, 100, { name: 'node.exe', exe: 'C:\\Program Files\\nodejs\\node.exe', cmd: `node ${root}\\node_modules\\vitest\\vitest.mjs run` });
  const installed = proc(60, 4, 100, { name: 'Codium.exe', exe: 'C:\\Users\\Test\\AppData\\Local\\Programs\\Codium\\Codium.exe' });

  function pick(...candidates: ProcessInfo[]): number[] {
    return strayProcesses([vitest, installed, ...candidates], root).map((p) => p.pid);
  }

  it('wählt verwaiste Codium-Testinstanzen, PostgreSQL, Sprachserver, jdtls und Gradle-Daemons aus dem Checkout', () => {
    const app = proc(100, 999, 1000, { name: 'electron.exe', exe: electron, cmd: `"${electron}" --inspect=0 --remote-debugging-port=0 ${root}` });
    const postgres = proc(101, 998, 1000, { name: 'postgres.exe', exe: `${root}\\node_modules\\@embedded-postgres\\windows-x64\\native\\bin\\postgres.exe` });
    const tsServer = proc(102, 997, 1000, { name: 'node.exe', exe: 'C:\\Program Files\\nodejs\\node.exe', cmd: `node ${root}/node_modules/typescript-language-server/lib/cli.mjs --stdio` });
    const jdtls = proc(103, 996, 1000, { name: 'java.exe', exe: 'C:\\Java\\jdk-25\\bin\\java.exe', cmd: `java -jar ${root}\\.cache\\java-tools\\jdtls\\plugins\\launcher.jar -data C:\\Temp\\x` });
    const daemon = proc(104, 995, 1000, { name: 'java.exe', exe: 'C:\\Java\\jdk-17\\bin\\java.exe', cmd: `java -cp ${root}\\.test-cache\\gradle\\wrapper\\dists\\gradle-8.14\\lib\\gradle-daemon-main.jar GradleDaemon` });
    expect(pick(app, postgres, tsServer, jdtls, daemon)).toEqual([100, 101, 102, 103, 104]);
  });

  it('nimmt nie einen Prozess mit lebendem Elternprozess, auch nicht aus dem Checkout', () => {
    const app = proc(100, 50, 1000, { name: 'electron.exe', exe: electron });
    const renderer = proc(101, 100, 1001, { name: 'electron.exe', exe: electron, cmd: `"${electron}" --type=renderer` });
    expect(pick(app, renderer)).toEqual([]);
  });

  it('nimmt nichts aus anderen Ordnern: das installierte Codium samt Java, andere Checkouts, Sprachserver anderer Programme', () => {
    const installedJava = proc(200, 990, 1000, {
      name: 'java.exe',
      exe: 'C:\\Java\\jdk-25\\bin\\java.exe',
      cmd: 'java -jar C:\\Users\\Test\\AppData\\Local\\Programs\\Codium\\resources\\jdtls\\plugins\\launcher.jar',
    });
    const installedHelper = proc(201, 991, 1000, { name: 'Codium.exe', exe: 'C:\\Users\\Test\\AppData\\Local\\Programs\\Codium\\Codium.exe', cmd: 'Codium.exe --type=renderer' });
    const otherCheckout = proc(202, 992, 1000, { name: 'electron.exe', exe: 'C:\\workspace\\custom\\codium-2\\node_modules\\electron\\dist\\electron.exe' });
    const globalTsServer = proc(203, 993, 1000, {
      name: 'node.exe',
      exe: 'C:\\Program Files\\nodejs\\node.exe',
      cmd: 'node "C:\\Program Files\\nodejs\\node_modules\\typescript-language-server\\lib\\cli.mjs" --stdio',
    });
    // Nennen den Checkout nur als Projekt, starten aber nichts daraus (etwa ein Editor oder ein Werkzeug des Nutzers).
    const editor = proc(204, 994, 1000, { name: 'Code.exe', exe: 'C:\\Programs\\Code\\Code.exe', cmd: `Code.exe ${root}` });
    const javaOtherTool = proc(205, 995, 1000, { name: 'java.exe', exe: 'C:\\Java\\jdk-25\\bin\\java.exe', cmd: `java -jar C:\\tools\\app.jar ${root}\\pom.xml` });
    expect(pick(installedJava, installedHelper, otherCheckout, globalTsServer, editor, javaOtherTool)).toEqual([]);
  });

  it('erkennt einen fortgegangenen Elternprozess auch, wenn ein deutlich jüngerer Prozess seine Nummer trägt', () => {
    const youngerWithSameNumber = proc(70, 4, 1000 + 10 * 60_000, { name: 'svchost.exe', exe: 'C:\\Windows\\System32\\svchost.exe' });
    const app = proc(100, 70, 1000, { name: 'electron.exe', exe: electron });
    expect(isOrphan(app, [youngerWithSameNumber, app])).toBe(true);
    expect(pick(youngerWithSameNumber, app)).toEqual([100]);
  });

  it('hält im Zweifel nichts für verwaist: unbekannte Startzeiten, ein Sprung der Systemuhr (Review)', () => {
    const parent = proc(70, 4, 5000, { name: 'node.exe' });
    // Das Kind scheint wenige Sekunden älter als sein Elternprozess: Das erklärt auch eine zurückgestellte Uhr.
    const afterClockJump = proc(100, 70, 2000, { name: 'electron.exe', exe: electron });
    expect(isOrphan(afterClockJump, [parent, afterClockJump])).toBe(false);
    expect(isOrphan(proc(101, 70, 0, { exe: electron }), [parent])).toBe(false);
    expect(isOrphan(proc(102, 70, 2000, { exe: electron }), [proc(70, 4, 0)])).toBe(false);
    expect(pick(parent, afterClockJump)).toEqual([]);
    // Fehlt die Elternnummer ganz in der Tabelle, ist der Elternprozess sicher fort, auch bei unbekannter Startzeit.
    expect(isOrphan(proc(103, 999, 0, { exe: electron }), [parent])).toBe(true);
  });

  it('vergleicht Pfade ohne Gross-/Kleinschreibung und mit beiden Trennzeichen, aber nicht als blossen Namensanfang', () => {
    expect(fromCheckout(proc(1, 0, 0, { exe: 'c:/WORKSPACE/custom/Codium/node_modules/electron/dist/electron.exe' }), root)).toBe(true);
    expect(fromCheckout(proc(1, 0, 0, { exe: 'C:\\workspace\\custom\\codium-alt\\node_modules\\electron\\dist\\electron.exe' }), root)).toBe(false);
    expect(fromCheckout(proc(1, 0, 0, { exe: electron }), `${root}\\`)).toBe(true);
  });

  it('nimmt das Programm aus der Befehlszeile, wenn Windows keinen Pfad nennt (Kindprozesse von PostgreSQL, Ticket 27)', () => {
    const pg = 'C:/workspace/custom/codium/node_modules/@embedded-postgres/windows-x64/native/bin/postgres.exe';
    const worker = proc(120, 999, 1000, { name: 'postgres.exe', cmd: `"${pg}" --forkchild="io_worker" 5848` });
    expect(programOf(worker)).toBe(pg);
    expect(fromCheckout(worker, root)).toBe(true);
    expect(pick(worker)).toEqual([120]);
    expect(programOf(proc(1, 0, 0, { cmd: `${root}\\node_modules\\x\\rg.exe --files` }))).toBe(`${root}\\node_modules\\x\\rg.exe`);
    // Die Befehlszeile nennt den Checkout nur als Argument: nicht aus dem Checkout.
    expect(fromCheckout(proc(1, 0, 0, { name: 'postgres.exe', cmd: `"C:\\PG\\postgres.exe" -D ${root}\\data` }), root)).toBe(false);
    expect(fromCheckout(proc(1, 0, 0, { cmd: '' }), root)).toBe(false);
  });
});

describe('Schlussprüfung: Temp-Ordner dieses Laufs', () => {
  const tempDir = useTempDirs();

  it('findet nur Ordner mit der Kennung dieses Laufs', () => {
    const root = tempDir();
    for (const name of ['codium-test-1a2b3c4d-x1', 'codium-pg-1a2b3c4d-x2', 'codium-test-99999999-x3', 'codium-test-x4', 'anders-1a2b3c4d-x5']) {
      fs.mkdirSync(path.join(root, name));
    }
    fs.writeFileSync(path.join(root, 'codium-test-1a2b3c4d-datei'), '');
    expect(leftoverTempDirs(root, '1a2b3c4d').map((d) => path.basename(d)).sort()).toEqual(['codium-pg-1a2b3c4d-x2', 'codium-test-1a2b3c4d-x1']);
    expect(() => leftoverTempDirs(root, '.*')).toThrow(/Kennung/);
  });
});
