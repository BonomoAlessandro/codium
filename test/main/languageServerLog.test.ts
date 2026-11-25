// Teststelle 1 (Ticket 30): Endet ein Sprachserver unerwartet, steht im Protokoll der Sprachserver, was passiert ist
// (Server, Art, Programm, Exit-Code, das Ende von stderr). Nach dem Aufgeben trägt die Meldung die Knöpfe „Show Log“ und
// „Restart“; „Restart“ startet den Server neu, ohne das Projekt neu zu öffnen. Der nachgemachte Server
// (fakeLspServer.ts) stürzt auf Bestellung ab, solange eine Marker-Datei existiert.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_RESTARTS } from '../../src/main/core/language/languageService';
import type { ServerStopEntry } from '../../src/main/core/language/serverLog';
import type { CommandArgs, CommandName, CommandResult, Notice } from '../../src/shared/types';
import { createTestCore, quitApp, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const FAKE_SERVER = path.join(__dirname, '..', 'support', 'fakeLspServer.ts');

describe('Protokoll der Sprachserver und Neustart nach dem Aufgeben (Ticket 30)', () => {
  const tempDir = useTempDirs();

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  /** TypeScript bis 6 im Projekt: Codium startet dafür den nachgemachten Server (`project-tsserver`). */
  function withTypeScript5(project: string): void {
    fs.mkdirSync(path.join(project, 'node_modules', 'typescript', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(project, 'node_modules', 'typescript', 'package.json'), JSON.stringify({ name: 'typescript', version: '5.9.3' }));
    fs.writeFileSync(path.join(project, 'node_modules', 'typescript', 'lib', 'tsserver.js'), '');
  }

  /** Ein Projekt mit TypeScript bis 6 und tsconfig.json (Kennzeichen): Der nachgemachte Server startet mit dem Projekt. */
  async function openShapes(server: Record<string, string>) {
    const root = tempDir();
    const project = path.join(root, 'Shapes');
    withTypeScript5(project);
    fs.writeFileSync(path.join(project, 'tsconfig.json'), '{}');
    const crashFile = path.join(root, 'crash');
    fs.writeFileSync(crashFile, '');
    const test = createTestCore(path.join(root, 'data'), {
      cleanupTimeoutMs: 10_000,
      typescript: {
        nativeTsc: path.join(root, 'nicht-benutzt.exe'),
        languageServerCli: FAKE_SERVER,
        // Ohne Warnungen von Node (etwa zum Modultyp der .ts-Datei) steht auf stderr nur, was der Server schreibt.
        node: { execPath: process.execPath, env: { NODE_NO_WARNINGS: '1', FAKE_LSP_CRASH_FILE: crashFile, ...server } },
      },
    });
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    const windowId = test.ports.windows.windowTitled('Shapes – Codium');
    const language = () => test.core.projectCore(windowId)!.language;
    const notices = () => test.events.forWindow(windowId).filter((e) => e.name === 'app.notice').map((e) => e.payload as Notice);
    const logFile = path.join(test.dataDir, 'logs', 'language-servers.log');
    return { root, project, test, windowId, language, notices, crashFile, logFile };
  }

  it('schreibt beim Absturz Server, Art, Programm, Exit-Code und die letzten Zeilen von stderr ins Protokoll', async () => {
    // Der Server stürzt bei der ersten Anfrage nach einem Hover ab (Exit-Code 3) und schreibt vorher 4000 Zeilen
    // (über 100 KB) auf stderr: Das Protokoll hat nur das Ende davon, abgeschnitten an einer ganzen Zeile.
    const { project, test, windowId, language, crashFile, logFile } = await openShapes({
      FAKE_LSP_CRASH_ON: 'textDocument/hover',
      FAKE_LSP_EXIT_CODE: '3',
      FAKE_LSP_STDERR_LINES: '4000',
    });
    await expect.poll(() => language().typescriptPid, { timeout: 15_000 }).toBeDefined();
    const first = language().typescriptPid!;
    const file = path.join(project, 'a.ts');
    await call(test, windowId, 'language.didOpen', { path: file, text: 'export const a = 1;\n', version: 1 });
    await call(test, windowId, 'language.hover', { path: file, line: 0, character: 13 });
    // Ohne Marker stürzt der neu gestartete Server nicht wieder ab.
    fs.rmSync(crashFile);

    await expect.poll(() => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''), { timeout: 15_000 }).toContain('--- end of stderr ---');
    const text = fs.readFileSync(logFile, 'utf8');
    expect(text).toMatch(/^=== \d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} – TypeScript language server stopped unexpectedly ===$/m);
    expect(text).toContain(`Project: ${project}`);
    expect(text).toContain('Server:  TypeScript (project-tsserver)');
    expect(text).toContain(`Program: ${process.execPath} ${FAKE_SERVER} --stdio`);
    expect(text).toContain('Exit:    code 3');
    expect(text).toContain(`Then:    Restarting (restart 1 of ${MAX_RESTARTS} within three minutes).`);
    expect(text).toContain('--- stderr (last 64 KB) ---\nstderr line ');
    expect(text).toContain(`stderr line 004000 of 4000\npanic: fake crash after textDocument/hover [pid ${first}]\n--- end of stderr ---`);
    expect(text).not.toContain('stderr line 000001 of 4000');
    expect(Buffer.byteLength(text)).toBeLessThan(70 * 1024);
    // Der Server läuft danach wieder (neu gestartet), und Codium führt das Protokoll im Datenordner des Tests.
    await expect.poll(() => language().typescriptPid, { timeout: 15_000 }).not.toBe(first);
    expect(logFile.startsWith(test.dataDir)).toBe(true);
    expect((await call(test, windowId, 'app.languageServerLog')).text).toBe(text);
  });

  it('nach dem Aufgeben: Meldung mit „Show Log“ und „Restart“; „Restart“ startet neu, die Definition geht wieder', async () => {
    // Der Server stürzt bei jedem `didOpen` ab, also auch nach jedem Neustart, sobald Codium ihm das offene Dokument
    // meldet; so wie ein Server, den ein Zustand im Projekt immer wieder zum Absturz bringt.
    const { project, test, windowId, language, notices, crashFile, logFile } = await openShapes({});
    const file = path.join(project, 'a.ts');
    await call(test, windowId, 'language.didOpen', { path: file, text: 'export const a = 1;\n', version: 1 });
    await expect.poll(() => notices().filter((n) => n.level === 'error').length, { timeout: 30_000 }).toBe(1);
    const notice = notices().find((n) => n.level === 'error')!;
    expect(notice.text).toBe(`The TypeScript language server stopped ${MAX_RESTARTS + 1} times within three minutes and was not restarted. Click Restart to start it again.`);
    expect(notice.actions).toEqual([
      { label: 'Show Log', action: 'languageServers.showLog', params: {}, keepOpen: true },
      { label: 'Restart', action: 'language.restart', params: { server: 'typescript' } },
    ]);
    expect(language().typescriptPid).toBeUndefined();
    expect(await call(test, windowId, 'language.definition', { path: file, line: 0, character: 13 })).toEqual([]);

    // „Show Log“ zeigt alle vier Enden, das letzte mit „Not restarted“. (Das Ersetzen bei der Grössengrenze und die
    // Reihenfolge von altem und aktuellem Protokoll prüft serverLog.test.ts.)
    const { text, path: logPath } = await call(test, windowId, 'app.languageServerLog');
    expect(logPath).toBe(logFile);
    expect(text).toBe(fs.readFileSync(logFile, 'utf8'));
    expect(text.match(/stopped unexpectedly/g)).toHaveLength(MAX_RESTARTS + 1);
    expect(text.match(/panic: fake crash after textDocument\/didOpen/g)).toHaveLength(MAX_RESTARTS + 1);
    expect(text.split('\n=== ').at(-1)).toContain(`Then:    Not restarted: it stopped ${MAX_RESTARTS + 1} times within three minutes.`);

    // „Restart“: Die Ursache ist weg, der Server startet neu, bekommt das offene Dokument und beantwortet die Definition.
    fs.rmSync(crashFile);
    await call(test, windowId, 'language.restart', { server: 'typescript' });
    expect(language().typescriptPid).toBeDefined();
    expect(await call(test, windowId, 'language.definition', { path: file, line: 0, character: 13 })).toEqual([
      { path: file, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
    ]);
    // Die Zählung beginnt von vorn: Ein weiterer Absturz startet wieder neu, statt aufzugeben.
    const pid = language().typescriptPid!;
    process.kill(pid);
    await expect.poll(() => language().typescriptPid, { timeout: 15_000 }).not.toBe(pid);
    await expect.poll(() => language().typescriptPid, { timeout: 15_000 }).toBeDefined();
    expect(notices().filter((n) => n.level === 'error')).toHaveLength(1);
  });

  it('prüft die Parameter von „language.restart“ und startet ohne Dokument und Kennzeichen keinen Server', async () => {
    const { root, test, windowId, logFile } = await openShapes({});
    await expect(call(test, windowId, 'language.restart', { server: 'cobol' as never })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    // Ein Projekt ohne Kennzeichen (kein tsconfig.json, jsconfig.json, package.json) und ohne offenes Dokument, aber mit
    // TypeScript 5: Ein Start nähme den nachgemachten Server. „Restart“ startet trotzdem nichts.
    const plain = path.join(root, 'Plain');
    withTypeScript5(plain);
    await call(test, windowId, 'app.openProject', { path: plain });
    const plainWindow = test.ports.windows.windowTitled('Plain – Codium');
    const plainLanguage = test.core.projectCore(plainWindow)!.language;
    expect(plainLanguage.typescriptPid).toBeUndefined();
    await call(test, plainWindow, 'language.restart', { server: 'typescript' });
    expect(plainLanguage.typescriptPid).toBeUndefined();
    expect(plainLanguage.typescriptKind).toBeNull();
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('meldet einen Eintrag, der noch auf den Rest von stderr wartet, beim Kern an; er steht nach dem Beenden im Protokoll', async () => {
    // Nach dem Absturz hält ein Hilfsprozess stderr 1,5 s offen: Der Eintrag wartet bis 1 s darauf und wird erst danach
    // geschrieben. Bis dahin kennt ihn der Kern als „in Vorbereitung“ und wartet beim Beenden darauf.
    const { project, test, windowId, logFile } = await openShapes({ FAKE_LSP_CRASH_ON: 'textDocument/hover', FAKE_LSP_HOLD_STDERR_MS: '1500' });
    const file = path.join(project, 'a.ts');
    await call(test, windowId, 'language.didOpen', { path: file, text: 'export const a = 1;\n', version: 1 });
    await call(test, windowId, 'language.hover', { path: file, line: 0, character: 13 });
    await expect.poll(() => test.logs.some((l) => l.includes('abgestürzt')), { timeout: 15_000 }).toBe(true);
    expect(fs.existsSync(logFile)).toBe(false);
    expect(test.core.serverLog.preparingCount).toBe(1);
    await quitApp(test);
    expect(fs.readFileSync(logFile, 'utf8')).toContain('panic: fake crash after textDocument/hover');
    expect(test.core.serverLog.preparingCount).toBe(0);
  });

  it('wartet beim Beenden auf Einträge in Vorbereitung, höchstens bis zur Frist', async () => {
    // Ein Kern ohne Projekt beendet sich sofort; ein Eintrag, der erst nach 1,5 s geschrieben wird, fehlte sonst.
    const test = createTestCore(path.join(tempDir(), 'data'), { cleanupTimeoutMs: 10_000 });
    await test.core.start();
    const late: ServerStopEntry = {
      time: new Date(),
      project: 'C:\\Projekte\\Shapes',
      server: 'TypeScript',
      kind: 'bundled-native',
      command: 'tsc.exe',
      args: ['--lsp', '--stdio'],
      code: 2,
      signal: null,
      outcome: 'Restarting (restart 1 of 3 within three minutes).',
      stderr: { text: 'panic: spät\n', truncated: false },
    };
    test.core.serverLog.track(new Promise((resolve) => setTimeout(resolve, 1500)).then(() => test.core.serverLog.append(late)));
    await quitApp(test);
    expect(fs.readFileSync(test.core.serverLog.file, 'utf8')).toContain('panic: spät');
  });
});
