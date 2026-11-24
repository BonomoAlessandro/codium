// Teststelle 1 (Ticket 27): Nach einem Neustart des Sprachservers geht nichts an ihn, bevor Codium `initialized` gemeldet
// hat. Der native TypeScript-Server (tsgo) stürzte sonst ab (Go-Panic, seine Sitzung fehlt noch): Ein geplantes Abholen
// der Fehler traf den neu gestarteten Server mitten in `initialize`, das zählte als weiterer Absturz, und nach drei
// solchen gab Codium den Server auf. Der nachgemachte Server (fakeLspServer.ts) verhält sich dabei wie tsgo.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CommandArgs, CommandName, CommandResult } from '../../src/shared/types';
import { createTestCore, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const FAKE_SERVER = path.join(__dirname, '..', 'support', 'fakeLspServer.ts');

describe('Neustart eines Sprachservers (Ticket 27)', () => {
  const tempDir = useTempDirs();

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  /** Ein Projekt mit TypeScript bis 6, für das Codium den nachgemachten Server startet; `initialize` dauert 800 ms. */
  async function openShapes() {
    const root = tempDir();
    const project = path.join(root, 'Shapes');
    // Ein TypeScript bis 6 im Projekt: Codium startet dafür typescript-language-server, hier den nachgemachten Server.
    fs.mkdirSync(path.join(project, 'node_modules', 'typescript', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(project, 'node_modules', 'typescript', 'package.json'), JSON.stringify({ name: 'typescript', version: '5.9.3' }));
    fs.writeFileSync(path.join(project, 'node_modules', 'typescript', 'lib', 'tsserver.js'), '');
    fs.writeFileSync(path.join(project, 'tsconfig.json'), '{}');
    const log = path.join(root, 'server.log');
    const test = createTestCore(path.join(root, 'data'), {
      // Beim Abbau fragt der Dienst für typescript-language-server erst die Kindprozesse ab (PowerShell, unter Last
      // mehrere Sekunden) und beendet dann den Server; der läuft im Projektordner. Wie die langsamen TypeScript-Tests.
      cleanupTimeoutMs: 10_000,
      typescript: {
        nativeTsc: path.join(root, 'nicht-benutzt.exe'),
        languageServerCli: FAKE_SERVER,
        // Der Server beantwortet `initialize` erst nach 800 ms; das Abholen der Fehler kommt 250 ms nach einer Eingabe.
        node: { execPath: process.execPath, env: { FAKE_LSP_LOG: log, FAKE_LSP_INIT_DELAY_MS: '800' } },
      },
    });
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    const windowId = test.ports.windows.windowTitled('Shapes – Codium');
    const language = () => test.core.projectCore(windowId)!.language;
    /** Was die Server bekommen haben, je Zeile „PID Methode“ (bei Dateiänderungen mit den Namen). */
    const received = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(/\r?\n/).filter((l) => l !== '') : []);
    return { project, test, windowId, language, received };
  }

  it('schickt dem neu gestarteten Server Anfragen und Dateiänderungen erst nach „initialized“', async () => {
    const { project, test, windowId, language, received } = await openShapes();
    const file = path.join(project, 'a.ts');

    await call(test, windowId, 'language.didOpen', { path: file, text: 'export const a = 1;\n', version: 1 });
    await expect.poll(() => received().filter((l) => l.endsWith(' textDocument/diagnostic')).length, { timeout: 15_000 }).toBeGreaterThan(0);
    const first = language().typescriptPid;
    expect(first).toBeDefined();

    // Eine Eingabe plant das Abholen der Fehler; gleich danach stürzt der Server ab, und eine neue Datei kommt dazu.
    await call(test, windowId, 'language.didChange', { path: file, text: 'export const a = 2;\n', version: 2 });
    process.kill(first!);
    await expect.poll(() => language().typescriptPid, { timeout: 15_000 }).not.toBe(first);
    await expect.poll(() => language().typescriptPid, { timeout: 15_000 }).toBeDefined();
    const second = language().typescriptPid!;
    await call(test, windowId, 'files.createFile', { parent: project, name: 'b.ts' });

    // Der neue Server ist bereit, hat nichts zu früh bekommen und läuft weiter; danach holt Codium die Fehler bei ihm.
    await expect
      .poll(() => received().filter((l) => l.startsWith(`${second} `) && l.endsWith(' textDocument/diagnostic')).length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(received().filter((l) => l.includes('verfrüht'))).toEqual([]);
    expect(language().typescriptPid).toBe(second);
    expect(test.logs.filter((l) => /abgestürzt/.test(l))).toHaveLength(1);
  });

  it('puffert Dateiänderungen während des Starts und schickt sie nach „initialized“ in derselben Reihenfolge', async () => {
    const { project, test, windowId, language, received } = await openShapes();
    // Ein Dokument startet den Server (`didOpen` kehrt erst zurück, wenn er bereit ist); während er noch in `initialize`
    // steckt, kommen zwei Dateien dazu.
    const opening = call(test, windowId, 'language.didOpen', { path: path.join(project, 'a.ts'), text: 'export const a = 1;\n', version: 1 });
    await expect.poll(() => language().typescriptPid, { timeout: 15_000 }).toBeDefined();
    const pid = language().typescriptPid!;
    await call(test, windowId, 'files.createFile', { parent: project, name: 'b.ts' });
    await call(test, windowId, 'files.createFile', { parent: project, name: 'c.ts' });
    await opening;

    await expect.poll(() => received().some((l) => l === `${pid} workspace/didChangeWatchedFiles b.ts,c.ts`), { timeout: 15_000 }).toBe(true);
    const mine = received().filter((l) => l.startsWith(`${pid} `));
    expect(mine.indexOf(`${pid} workspace/didChangeWatchedFiles b.ts,c.ts`)).toBeGreaterThan(mine.indexOf(`${pid} initialized`));
    expect(received().filter((l) => l.includes('verfrüht'))).toEqual([]);
    expect(language().typescriptPid).toBe(pid);
  });

  it('verwirft gepufferte Dateiänderungen, wenn der Server vor „initialized“ endet', async () => {
    const { project, test, windowId, language, received } = await openShapes();
    const opening = call(test, windowId, 'language.didOpen', { path: path.join(project, 'a.ts'), text: 'export const a = 1;\n', version: 1 });
    await expect.poll(() => language().typescriptPid, { timeout: 15_000 }).toBeDefined();
    const first = language().typescriptPid!;
    // Die Änderung landet im Puffer des ersten Servers; er endet, bevor er `initialize` beantwortet hat.
    await call(test, windowId, 'files.createFile', { parent: project, name: 'b.ts' });
    process.kill(first);
    await opening;
    await expect.poll(() => language().typescriptPid, { timeout: 15_000 }).not.toBe(first);
    await expect.poll(() => language().typescriptPid, { timeout: 15_000 }).toBeDefined();
    const second = language().typescriptPid!;

    // Der zweite Server ist bereit und hat die Fehler geliefert, aber die alte Änderung nie bekommen.
    await expect
      .poll(() => received().filter((l) => l.startsWith(`${second} `) && l.endsWith(' textDocument/diagnostic')).length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(received().filter((l) => l.includes('didChangeWatchedFiles'))).toEqual([]);
    expect(received().filter((l) => l.includes('verfrüht'))).toEqual([]);
  });
});
