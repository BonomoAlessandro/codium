// Langsamer Lauf: echte Shells über node-pty (Ticket 11). Jede gefundene Shell startet im Projektordner und in einem
// Unterordner mit Leerzeichen und Umlauten; Schliessen und der Abbau des Projekt-Kerns beenden Shell und Kindprozesse.
// Benutzerprofil und Verlauf der Shells liegen in Temp-Ordnern (APPDATA, USERPROFILE, HOME), damit nichts im Verlauf
// des Nutzers landet.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectShells } from '../../src/main/core/shells';
import { NodeSystem } from '../../src/main/system/nodeSystem';
import type { CommandArgs, CommandName, CommandResult, ShellId } from '../../src/shared/types';
import { createTestCore, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const realSystem = new NodeSystem(process.env);
const shells = detectShells(realSystem);

/** Ein Befehl, der den aktuellen Ordner in eckigen Klammern ausgibt (anders geschrieben als die Ausgabe). */
const PRINT_CWD: Record<ShellId, string> = {
  cmd: 'echo [%CD%]',
  pwsh: 'Write-Output ("[" + (Get-Location).Path + "]")',
  powershell: 'Write-Output ("[" + (Get-Location).Path + "]")',
  gitbash: 'echo "[$(cygpath -w "$PWD")]"',
};

/** Ohne Steuerzeichen der Konsole (Farben, Cursor, Titel). */
function plain(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '')
    .replace(/\r/g, '');
}

/** Pseudokonsolen (OpenConsole.exe bzw. conhost.exe) dieses Testprozesses. */
function consoleHosts(): number[] {
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid} AND (Name='OpenConsole.exe' OR Name='conhost.exe')" | ForEach-Object { $_.ProcessId }`],
    { encoding: 'utf8' },
  );
  return out.split(/\r?\n/).map((l) => Number(l.trim())).filter((n) => n > 0);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(condition: () => boolean, what: string, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error(`Zeitüberschreitung: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('Terminal mit echten Shells', () => {
  const tempDir = useTempDirs();

  async function openProject(windowsConpty = false) {
    const root = tempDir();
    const project = path.join(root, 'Alpha');
    const sub = path.join(project, 'Ordner mit Leerzeichen äöü');
    fs.mkdirSync(sub, { recursive: true });
    const profile = path.join(root, 'profile');
    for (const dir of ['AppData', 'Home']) fs.mkdirSync(path.join(profile, dir), { recursive: true });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      APPDATA: path.join(profile, 'AppData'),
      USERPROFILE: path.join(profile, 'Home'),
      HOME: path.join(profile, 'Home'),
      TEST_PIDFILE_DIR: root,
    };
    const systemEnv = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
    const programs = Object.fromEntries(
      ['pwsh', 'git', 'powershell'].map((name) => [name, realSystem.findProgram(name)]).filter((e): e is [string, string] => e[1] !== null),
    );
    const test = createTestCore(path.join(root, 'data'), { system: { env: systemEnv, programs }, processEnv: env, cleanupTimeoutMs: 10_000, windowsConpty });
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    return { root, project, sub, test, windowId: test.ports.windows.windowTitled('Alpha – Codium') };
  }

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  /** Die gesammelte Ausgabe eines Terminals. */
  function output(test: TestCore, windowId: number, terminalId: number): string {
    return plain(
      test.events
        .forWindow(windowId)
        .filter((e) => e.name === 'terminal.data' && (e.payload as { terminalId: number }).terminalId === terminalId)
        .map((e) => (e.payload as { data: string }).data)
        .join(''),
    );
  }

  it('hat Shells gefunden', () => {
    expect(shells.map((s) => s.id)).toContain('cmd');
  });

  for (const shell of shells) {
    it(`startet ${shell.name} im Projektordner und in einem Unterordner mit Leerzeichen und Umlauten`, async () => {
      const { project, sub, test, windowId } = await openProject();
      await call(test, windowId, 'app.updateSettings', { terminalShell: shell.id });
      for (const cwd of [undefined, sub]) {
        const started = await call(test, windowId, 'terminal.start', { ...(cwd ? { cwd } : {}), cols: 300, rows: 30 });
        expect(started).toMatchObject({ shell: shell.name, cwd: cwd ?? project });
        await call(test, windowId, 'terminal.write', { terminalId: started.terminalId, data: `${PRINT_CWD[shell.id]}\r` });
        const expected = `[${cwd ?? project}]`;
        await until(() => output(test, windowId, started.terminalId).includes(expected), `${shell.name}: ${expected}`);
        await call(test, windowId, 'terminal.close', { terminalId: started.terminalId });
      }
    });
  }

  it('beendet beim Schliessen die Shell samt einem Programm, das sie gestartet hat', async () => {
    const { root, test, windowId } = await openProject();
    await call(test, windowId, 'app.updateSettings', { terminalShell: 'cmd' });
    const { terminalId } = await call(test, windowId, 'terminal.start', { cols: 300, rows: 30 });
    const pidFile = path.join(root, 'child.pid');
    const script = `require('fs').writeFileSync(require('path').join(process.env.TEST_PIDFILE_DIR, 'child.pid'), String(process.pid)); setInterval(() => {}, 1000)`;
    await call(test, windowId, 'terminal.write', { terminalId, data: `"${process.execPath}" -e "${script}"\r` });
    await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8') !== '', 'Kindprozess gestartet');
    const child = Number(fs.readFileSync(pidFile, 'utf8'));
    const shell = test.core.projectCore(windowId)!.terminals.pidOf(terminalId)!;
    expect(alive(child)).toBe(true);
    expect(alive(shell)).toBe(true);

    await call(test, windowId, 'terminal.close', { terminalId });
    await until(() => !alive(child) && !alive(shell), 'Shell und Kindprozess beendet', 5000);
    await until(() => consoleHosts().length === 0, 'keine Pseudokonsole mehr', 10_000);
    const exit = test.events.forWindow(windowId).find((e) => e.name === 'terminal.exit');
    expect(exit?.payload).toMatchObject({ terminalId });
  });

  it('beendet beim Abbau des Projekt-Kerns alle Shells', async () => {
    const { root, test, windowId } = await openProject();
    await call(test, windowId, 'app.updateSettings', { terminalShell: 'cmd' });
    const children: string[] = [];
    const shells: number[] = [];
    for (const name of ['a', 'b']) {
      const { terminalId } = await call(test, windowId, 'terminal.start', { cols: 300, rows: 30 });
      shells.push(test.core.projectCore(windowId)!.terminals.pidOf(terminalId)!);
      const script = `require('fs').writeFileSync(require('path').join(process.env.TEST_PIDFILE_DIR, '${name}.pid'), String(process.pid)); setInterval(() => {}, 1000)`;
      await call(test, windowId, 'terminal.write', { terminalId, data: `"${process.execPath}" -e "${script}"\r` });
      children.push(path.join(root, `${name}.pid`));
    }
    await until(() => children.every((f) => fs.existsSync(f) && fs.readFileSync(f, 'utf8') !== ''), 'Kindprozesse gestartet');
    const pids = children.map((f) => Number(fs.readFileSync(f, 'utf8')));
    expect(pids.every(alive)).toBe(true);

    test.ports.windows.close(windowId);
    await test.core.shutdown();
    await until(() => ![...pids, ...shells].some(alive), 'alle Shells und Kindprozesse beendet', 5000);
    await until(() => consoleHosts().length === 0, 'keine Pseudokonsole mehr', 10_000);
  });

  for (const windowsConpty of [false, true]) it(`räumt hinter einer Shell auf, die selbst endet (exit), mit der ConPTY ${windowsConpty ? 'von Windows' : 'von node-pty'}`, async () => {
    const { test, windowId } = await openProject(windowsConpty);
    await call(test, windowId, 'app.updateSettings', { terminalShell: 'cmd' });
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const { terminalId } = await call(test, windowId, 'terminal.start', { cols: 120, rows: 30 });
      ids.push(terminalId);
    }
    await until(() => consoleHosts().length === 3, 'drei Pseudokonsolen', 15_000);
    // Erst nach der Eingabeaufforderung tippen: Bis dahin wartet die ConPTY auf die Antwort des Terminals.
    for (const terminalId of ids) await until(() => output(test, windowId, terminalId).includes('>'), 'Eingabeaufforderung', 15_000);
    for (const terminalId of ids) await call(test, windowId, 'terminal.write', { terminalId, data: 'exit\r' });
    await until(() => test.events.forWindow(windowId).filter((e) => e.name === 'terminal.exit').length === 3, 'drei Enden', 15_000);
    await until(() => consoleHosts().length === 0, 'Pseudokonsolen geschlossen', 10_000);
  });
});
