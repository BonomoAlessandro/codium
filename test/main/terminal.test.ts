// Teststelle 1: Shells fürs Terminal mit nachgemachtem System (Ticket 11): Erkennung, Standard, Einstellung und die
// Umgebung der Shell. Echte Shells über node-pty laufen im langsamen Lauf (test/slow/terminal.test.ts).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectShells, shellArgs, shellEnvironment, shellFor } from '../../src/main/core/shells';
import { ErrorCode, type CommandArgs, type CommandName, type CommandResult } from '../../src/shared/types';
import { createTestCore, restart, type TestCore } from '../support/core';
import { FakeSystem } from '../support/fakePorts';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';

describe('Shells fürs Terminal', () => {
  const tempDir = useTempDirs();

  /** Ein nachgemachtes Windows mit den gewünschten Shells als leere Dateien. */
  function fakeWindows(shells: { pwsh?: boolean; powershell?: boolean; cmd?: boolean; git?: 'cmd' | 'mingw64' | false }) {
    const root = tempDir();
    const windows = path.join(root, 'Windows');
    const programFiles = path.join(root, 'Program Files');
    const touch = (...parts: string[]) => {
      const file = path.join(...parts);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '');
      return file;
    };
    // Das bash.exe von WSL unter System32 ist kein Git Bash.
    touch(windows, 'System32', 'bash.exe');
    const files: Record<string, string> = {};
    if (shells.pwsh) files.pwsh = touch(programFiles, 'PowerShell', '7', 'pwsh.exe');
    if (shells.powershell) files.powershell = touch(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (shells.cmd) files.cmd = touch(windows, 'System32', 'cmd.exe');
    const programs: Record<string, string> = {};
    if (shells.git) {
      const gitRoot = path.join(root, 'Tools', 'Git');
      programs.git = touch(gitRoot, shells.git === 'cmd' ? 'cmd' : path.join('mingw64', 'bin'), 'git.exe');
      files.gitbash = touch(gitRoot, 'bin', 'bash.exe');
    }
    const env = { SystemRoot: windows, ProgramFiles: programFiles, ...(shells.cmd ? { ComSpec: files.cmd } : {}) };
    return { root, files, system: { env, programs, home: path.join(root, 'home') } };
  }

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  it('findet PowerShell 7, Windows PowerShell, cmd und Git Bash; Standard ist PowerShell 7', async () => {
    const { root, files, system } = fakeWindows({ pwsh: true, powershell: true, cmd: true, git: 'cmd' });
    const test = createTestCore(path.join(root, 'data'), { system });
    await test.core.start();
    const welcome = test.ports.windows.windowTitled(WELCOME);
    expect(await call(test, welcome, 'app.shells')).toEqual({
      shells: [
        { id: 'pwsh', name: 'PowerShell 7', path: files.pwsh },
        { id: 'powershell', name: 'Windows PowerShell', path: files.powershell },
        { id: 'cmd', name: 'cmd', path: files.cmd },
        { id: 'gitbash', name: 'Git Bash', path: files.gitbash },
      ],
      standard: 'pwsh',
    });
    // Git aus mingw64\bin findet sein Git Bash ebenso.
    const mingw = fakeWindows({ git: 'mingw64' });
    expect(detectShells(new FakeSystem(mingw.system))).toEqual([{ id: 'gitbash', name: 'Git Bash', path: mingw.files.gitbash }]);
  });

  it('nimmt ohne PowerShell 7 Windows PowerShell, sonst die eingestellte Shell', async () => {
    const { root, system } = fakeWindows({ powershell: true, cmd: true });
    const shells = detectShells(new FakeSystem(system));
    expect(shells.map((s) => s.id)).toEqual(['powershell', 'cmd']);
    expect(shellFor(shells, undefined)?.id).toBe('powershell');
    expect(shellFor(shells, 'cmd')?.id).toBe('cmd');
    // Eine eingestellte, inzwischen fehlende Shell: der Standard.
    expect(shellFor(shells, 'gitbash')?.id).toBe('powershell');
    expect(shellFor([], undefined)).toBeNull();

    const first = createTestCore(path.join(root, 'data'), { system });
    await first.core.start();
    const welcome = first.ports.windows.windowTitled(WELCOME);
    expect(await call(first, welcome, 'app.shells')).toMatchObject({ standard: 'powershell' });
    expect(await call(first, welcome, 'app.updateSettings', { terminalShell: 'cmd' })).toMatchObject({ terminalShell: 'cmd' });
    // Nur gefundene Shells lassen sich einstellen.
    for (const terminalShell of ['gitbash', 'bash', 42]) {
      await expect(call(first, welcome, 'app.updateSettings', { terminalShell: terminalShell as never })).rejects.toMatchObject({
        code: ErrorCode.invalidParams,
      });
    }
    const test = await restart(first, { system });
    await test.core.start();
    const again = test.ports.windows.windowTitled(WELCOME);
    expect(await call(test, again, 'app.settings')).toMatchObject({ terminalShell: 'cmd' });
    expect(await call(test, again, 'app.updateSettings', { terminalShell: null })).toMatchObject({ terminalShell: null });
  });

  it('startet PowerShell ohne Logo und Git Bash als Login-Shell', () => {
    expect(shellArgs({ id: 'pwsh', name: '', path: '' })).toEqual(['-NoLogo']);
    expect(shellArgs({ id: 'powershell', name: '', path: '' })).toEqual(['-NoLogo']);
    expect(shellArgs({ id: 'cmd', name: '', path: '' })).toEqual([]);
    expect(shellArgs({ id: 'gitbash', name: '', path: '' })).toEqual(['--login', '-i']);
  });

  it('gibt der Shell die eigene Umgebung ohne Interna von Codium, Electron und npm', () => {
    const env = shellEnvironment({
      PATH: 'C:\\bin',
      CODIUM_TEST_HIDDEN: '1',
      ELECTRON_RUN_AS_NODE: '1',
      npm_lifecycle_event: 'test',
      PSModulePath: 'C:\\Users\\a\\Documents\\PowerShell\\Modules;C:\\Program Files\\PowerShell\\7\\Modules;C:\\Windows\\system32\\WindowsPowerShell\\v1.0\\Modules',
      EMPTY: undefined,
    });
    expect(env).toEqual({
      PATH: 'C:\\bin',
      PSModulePath: 'C:\\Windows\\system32\\WindowsPowerShell\\v1.0\\Modules',
      TERM_PROGRAM: 'Codium',
    });
  });

  it('lehnt einen Startordner ausserhalb des Projekts ab, bevor eine Shell startet', async () => {
    const { root, system } = fakeWindows({});
    const project = path.join(root, 'Alpha');
    fs.mkdirSync(project);
    const test = createTestCore(path.join(root, 'data'), { system });
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    const windowId = test.ports.windows.windowTitled('Alpha – Codium');
    await expect(call(test, windowId, 'terminal.start', { cwd: root, cols: 80, rows: 24 })).rejects.toMatchObject({
      code: ErrorCode.pathOutsideProject,
    });
    await expect(call(test, windowId, 'terminal.start', { cols: 0, rows: 24 })).rejects.toMatchObject({ code: ErrorCode.invalidParams });
    // Ohne Shell: eine klare Meldung.
    await expect(call(test, windowId, 'terminal.start', { cols: 80, rows: 24 })).rejects.toMatchObject({ code: ErrorCode.shellNotFound });
  });
});
