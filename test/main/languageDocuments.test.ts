// Teststelle 1 (Ticket 36): Jeder Sprachserver bekommt nur die Dokumente seiner Sprachen, beim Start, nach einem
// Absturz und nach „Restart“. Vorher meldete Codium einem startenden Server alle offenen Dokumente; der native
// TypeScript-Server bekam so offene Java-Dateien und stürzte daran ab („ScriptKind must be specified“), nach jedem
// Neustart wieder. Zwei nachgemachte Server (fakeLspServer.ts) schreiben auf, welche Dokumente sie geöffnet bekommen:
// einer als TypeScript-Server, einer statt jdtls (`javaServerForTests`).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CommandArgs, CommandName, CommandResult } from '../../src/shared/types';
import { createTestCore, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const FAKE_SERVER = path.join(__dirname, '..', 'support', 'fakeLspServer.ts');

describe('Dokumente je Sprachserver (Ticket 36)', () => {
  const tempDir = useTempDirs();

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  /**
   * Ein Java-Projekt mit Web-Oberfläche. Für TypeScript gibt es kein Kennzeichen (kein package.json, tsconfig.json oder
   * jsconfig.json); der Server startet also mit der ersten JavaScript-Datei. Ein TypeScript 5 im Projekt lässt Codium
   * dafür den nachgemachten Server nehmen. Mit `pom` startet der Java-Server mit dem Projekt, sonst mit der ersten
   * Java-Datei.
   */
  async function openShop(options: { pom: boolean }) {
    const root = tempDir();
    const project = path.join(root, 'Shop');
    const java = path.join(project, 'src', 'main', 'java', 'shop');
    const web = path.join(project, 'src', 'main', 'webapp');
    fs.mkdirSync(java, { recursive: true });
    fs.mkdirSync(web, { recursive: true });
    if (options.pom) fs.writeFileSync(path.join(project, 'pom.xml'), '<project/>');
    const files = {
      cart: path.join(java, 'Cart.java'),
      price: path.join(java, 'Price.java'),
      app: path.join(web, 'app.jsx'),
      util: path.join(web, 'util.js'),
      model: path.join(web, 'model.ts'),
    };
    const texts: Record<keyof typeof files, string> = {
      cart: 'package shop;\n\npublic class Cart {\n  int total() { return 0; }\n}\n',
      price: 'package shop;\n\npublic record Price(int cents) {}\n',
      app: "import { total } from './util.js';\n\nexport function App() {\n  return <div className=\"cart\">{total(1, 2)}</div>;\n}\n",
      util: 'export function total(a, b) {\n  return a + b;\n}\n',
      model: 'export interface Item {\n  name: string;\n}\n',
    };
    for (const name of Object.keys(files) as Array<keyof typeof files>) fs.writeFileSync(files[name], texts[name]);
    fs.mkdirSync(path.join(project, 'node_modules', 'typescript', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(project, 'node_modules', 'typescript', 'package.json'), JSON.stringify({ name: 'typescript', version: '5.9.3' }));
    fs.writeFileSync(path.join(project, 'node_modules', 'typescript', 'lib', 'tsserver.js'), '');

    // Ein nachgemachtes jdtls (nur der Ordner) und ein JDK 25, damit der Java-Server gestartet wird.
    const tools = path.join(root, 'tools');
    fs.mkdirSync(path.join(tools, 'jdtls'), { recursive: true });
    const programFiles = path.join(root, 'Program Files');
    const jdk = path.join(programFiles, 'Eclipse Adoptium', 'jdk-25.0.1');
    fs.mkdirSync(path.join(jdk, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(jdk, 'bin', 'java.exe'), '');
    fs.writeFileSync(path.join(jdk, 'release'), 'JAVA_VERSION="25.0.1"\nIMPLEMENTOR="Test"\n');

    const typescriptLog = path.join(root, 'typescript.log');
    const javaLog = path.join(root, 'java.log');
    const test = createTestCore(path.join(root, 'data'), {
      // Beim Abbau fragt der Dienst für typescript-language-server erst die Kindprozesse ab (wie languageRestart.test.ts).
      cleanupTimeoutMs: 10_000,
      system: { env: { ProgramFiles: programFiles }, home: path.join(root, 'home') },
      typescript: {
        nativeTsc: path.join(root, 'nicht-benutzt.exe'),
        languageServerCli: FAKE_SERVER,
        node: { execPath: process.execPath, env: { NODE_NO_WARNINGS: '1', FAKE_LSP_LOG: typescriptLog } },
      },
      java: { jdtls: path.join(tools, 'jdtls'), lombok: path.join(tools, 'lombok.jar') },
      javaServerForTests: { command: process.execPath, args: [FAKE_SERVER, '--stdio'], env: { NODE_NO_WARNINGS: '1', FAKE_LSP_LOG: javaLog } },
    });
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    const windowId = test.ports.windows.windowTitled('Shop – Codium');
    const language = () => test.core.projectCore(windowId)!.language;
    const open = (name: keyof typeof files) => call(test, windowId, 'language.didOpen', { path: files[name], text: texts[name], version: 1 });
    // Eine Anfrage auf eine Datei, die in der Oberfläche nicht offen ist: Der Dienst öffnet sie selbst beim Server.
    const askDefinition = (name: keyof typeof files) => call(test, windowId, 'language.definition', { path: files[name], line: 0, character: 1 });
    /** Die Dokumente, die ein Server geöffnet bekam, in der Reihenfolge; ohne `pid` die aller Server dieser Sprache. */
    const opened = (log: string, pid?: number) =>
      (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(/\r?\n/) : [])
        .map((line) => /^(\d+) textDocument\/didOpen (.+)$/.exec(line))
        .filter((m): m is RegExpExecArray => m !== null && (pid === undefined || Number(m[1]) === pid))
        .map((m) => m[2]);
    return { test, windowId, language, open, askDefinition, opened, typescriptLog, javaLog };
  }

  it('der TypeScript-Server bekommt bei offenen Java-Dateien nur JavaScript und TypeScript, auch nach Absturz und „Restart“', async () => {
    // Wie im Projekt des Nutzers: Der Java-Server läuft schon, Java-Dateien sind offen, dann kommt eine JSX-Datei.
    const { test, windowId, language, open, askDefinition, opened, typescriptLog, javaLog } = await openShop({ pom: true });
    await expect.poll(() => language().javaPid, { timeout: 15_000 }).toBeDefined();
    await open('cart');
    expect(await askDefinition('price')).toHaveLength(1);
    expect(language().typescriptPid).toBeUndefined();

    // Die JSX-Datei startet den TypeScript-Server.
    await open('app');
    const first = language().typescriptPid!;
    expect(first).toBeDefined();
    await open('util');
    expect(await askDefinition('model')).toHaveLength(1);
    expect(opened(typescriptLog, first)).toEqual(['app.jsx', 'util.js', 'model.ts']);

    // Absturz: Der neu gestartete Server bekommt die offenen Dokumente seiner Sprachen, keine Java-Datei. (Selbst
    // geöffnete Dokumente öffnet er erst bei der nächsten Anfrage wieder.)
    process.kill(first);
    await expect.poll(() => language().typescriptPid, { timeout: 15_000 }).not.toBe(first);
    await expect.poll(() => language().typescriptPid, { timeout: 15_000 }).toBeDefined();
    const second = language().typescriptPid!;
    await expect.poll(() => opened(typescriptLog, second), { timeout: 15_000 }).toContain('util.js');
    expect(opened(typescriptLog, second)).toEqual(['app.jsx', 'util.js']);

    // „Restart“ (derselbe Weg wie der Knopf nach dem Aufgeben): dasselbe.
    await call(test, windowId, 'language.restart', { server: 'typescript' });
    const third = language().typescriptPid!;
    expect(third).toBeDefined();
    expect(third).not.toBe(second);
    await expect.poll(() => opened(typescriptLog, third), { timeout: 15_000 }).toContain('util.js');
    expect(opened(typescriptLog, third)).toEqual(['app.jsx', 'util.js']);

    // Der Java-Server hat nur seine Dokumente bekommen, und kein Server eine fremde Datei.
    expect(opened(javaLog)).toEqual(['Cart.java', 'Price.java']);
    expect(opened(typescriptLog).filter((name) => name.endsWith('.java'))).toEqual([]);
  });

  it('der Java-Server bekommt bei offenen JavaScript- und TypeScript-Dateien nur Java, auch nach Absturz und „Restart“', async () => {
    // Umgekehrt: Der TypeScript-Server läuft, JavaScript- und TypeScript-Dateien sind offen, dann kommt eine Java-Datei.
    const { test, windowId, language, open, askDefinition, opened, typescriptLog, javaLog } = await openShop({ pom: false });
    await open('app');
    await open('util');
    expect(await askDefinition('model')).toHaveLength(1);
    expect(language().typescriptPid).toBeDefined();
    expect(language().javaPid).toBeUndefined();

    // Die Java-Datei startet den Java-Server.
    await open('cart');
    const first = language().javaPid!;
    expect(first).toBeDefined();
    expect(await askDefinition('price')).toHaveLength(1);
    expect(opened(javaLog, first)).toEqual(['Cart.java', 'Price.java']);

    // Absturz: Der neu gestartete Server bekommt nur die offene Java-Datei.
    process.kill(first);
    await expect.poll(() => language().javaPid, { timeout: 15_000 }).not.toBe(first);
    await expect.poll(() => language().javaPid, { timeout: 15_000 }).toBeDefined();
    const second = language().javaPid!;
    await expect.poll(() => opened(javaLog, second), { timeout: 15_000 }).toContain('Cart.java');
    expect(opened(javaLog, second)).toEqual(['Cart.java']);

    // „Restart“: dasselbe.
    await call(test, windowId, 'language.restart', { server: 'java' });
    const third = language().javaPid!;
    expect(third).toBeDefined();
    expect(third).not.toBe(second);
    await expect.poll(() => opened(javaLog, third), { timeout: 15_000 }).toContain('Cart.java');
    expect(opened(javaLog, third)).toEqual(['Cart.java']);

    // Der TypeScript-Server hat nur seine Dokumente bekommen, und kein Server eine fremde Datei.
    expect(opened(typescriptLog)).toEqual(['app.jsx', 'util.js', 'model.ts']);
    expect(opened(javaLog).filter((name) => !name.endsWith('.java'))).toEqual([]);
  });
});
