// Teststelle 1: Einstellungen, JDK-Erkennung und Prüfung der Voraussetzungen am Vertrag, mit nachgemachtem System
// (vorgegebene Umgebung und Programme) und echten Ordnern in Temp-Ordnern.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { majorVersion } from '../../src/main/core/jdks';
import { ErrorCode, type CommandArgs, type CommandName, type CommandResult, type Notice } from '../../src/shared/types';
import { createTestCore, restart, type TestCore, type TestCoreOptions } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const title = (name: string) => `${name} – Codium`;

describe('Einstellungen und Voraussetzungen', () => {
  const tempDir = useTempDirs();

  /** Legt ein JDK-Ordner mit `bin\java.exe` und `release` an. */
  function makeJdk(dir: string, version: string, vendor = 'Eclipse Adoptium'): string {
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'bin', 'java.exe'), '');
    fs.writeFileSync(path.join(dir, 'release'), `IMPLEMENTOR="${vendor}"\nJAVA_VERSION="${version}"\n`);
    return dir;
  }

  /** Ein Rechner mit JDKs in den üblichen Ordnern; liefert Umgebung und Pfade. */
  function machine(root: string) {
    const programFiles = path.join(root, 'Program Files');
    const localAppData = path.join(root, 'AppData', 'Local');
    const home = path.join(root, 'home');
    const jdk21 = makeJdk(path.join(programFiles, 'Eclipse Adoptium', 'jdk-21.0.13.9-hotspot'), '21.0.13');
    const jdk25 = makeJdk(path.join(localAppData, 'Programs', 'Temurin', 'jdk-25.0.5.1+2'), '25.0.5.1');
    const jdk25old = makeJdk(path.join(home, '.jdks', 'openjdk-25'), '25', 'Oracle Corporation');
    const jdk8 = makeJdk(path.join(programFiles, 'Java', 'jdk1.8.0_392'), '1.8.0_392', 'Oracle Corporation');
    fs.mkdirSync(path.join(programFiles, 'Java', 'not-a-jdk'), { recursive: true });
    const env = { ProgramFiles: programFiles, LOCALAPPDATA: localAppData, JAVA_HOME: `${jdk21}\\` };
    return { env, home, jdk21, jdk25, jdk25old, jdk8 };
  }

  async function start(options: TestCoreOptions, root = tempDir()) {
    const test = createTestCore(path.join(root, 'data'), options);
    await test.core.start();
    return { test, root, welcome: test.ports.windows.windowTitled(WELCOME) };
  }

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  async function openProject(test: TestCore, from: number, dir: string): Promise<number> {
    await call(test, from, 'app.openProject', { path: dir });
    return test.ports.windows.windowTitled(title(path.basename(dir)));
  }

  function notices(test: TestCore, windowId: number): Notice[] {
    return test.events
      .forWindow(windowId)
      .filter((e) => e.name === 'app.notice')
      .map((e) => e.payload as Notice);
  }

  function project(root: string, name: string, files: Record<string, string> = {}): string {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content);
    return dir;
  }

  it('erkennt JDKs samt Version und JAVA_HOME; „Newest detected“ nimmt das neueste ab 25, auch wenn JAVA_HOME auf 21 zeigt', async () => {
    const root = tempDir();
    const m = machine(root);
    const { test, welcome } = await start({ system: { env: m.env, home: m.home } }, root);
    const { jdks, forLanguageServer } = await call(test, welcome, 'app.jdks');
    expect(jdks.map((j) => [j.path, j.version, j.major])).toEqual([
      [m.jdk25, '25.0.5.1', 25],
      [m.jdk25old, '25', 25],
      [m.jdk21, '21.0.13', 21],
      [m.jdk8, '1.8.0_392', 8],
    ]);
    expect(jdks[0].vendor).toBe('Eclipse Adoptium');
    expect(forLanguageServer?.path).toBe(m.jdk25);

    // Ein eingestelltes JDK ab 25 gilt; eines unter 25 oder ein fehlendes lässt sich nicht einstellen.
    await call(test, welcome, 'app.updateSettings', { jdk: m.jdk25old });
    expect((await call(test, welcome, 'app.jdks')).forLanguageServer?.path).toBe(m.jdk25old);
    for (const jdk of [m.jdk21, path.join(root, 'gone')]) {
      await expect(call(test, welcome, 'app.updateSettings', { jdk })).rejects.toMatchObject({ code: ErrorCode.invalidParams });
    }
    expect(await call(test, welcome, 'app.settings')).toMatchObject({ jdk: m.jdk25old });
    // Eine andere Schreibweise desselben JDK wird in der Schreibweise der Erkennung gespeichert.
    expect(await call(test, welcome, 'app.updateSettings', { jdk: `${m.jdk25.toUpperCase().replaceAll('\\', '/')}/` })).toMatchObject({ jdk: m.jdk25 });
  });

  it('findet ein JDK nur über JAVA_HOME, auch mit Anführungszeichen und „/“ (Review von Ticket 09)', async () => {
    const root = tempDir();
    const tools = makeJdk(path.join(root, 'tools', 'jdk-25'), '25.0.1');
    for (const javaHome of [tools, `"${tools}"`, ` ${tools.replaceAll('\\', '/')}/ `]) {
      const { test, welcome } = await start({ system: { env: { JAVA_HOME: javaHome }, home: path.join(root, 'home') } }, tempDir());
      const { jdks, forLanguageServer } = await call(test, welcome, 'app.jdks');
      expect(jdks.map((j) => j.path), javaHome).toEqual([tools]);
      expect(forLanguageServer?.path).toBe(tools);
    }
  });

  it('findet ein als Junction verlinktes JDK und nimmt kein Early-Access-Build, wenn es ein fertiges gibt', async () => {
    const root = tempDir();
    const home = path.join(root, 'home');
    const elsewhere = makeJdk(path.join(root, 'elsewhere', 'jdk-25'), '25.0.2');
    const ea = makeJdk(path.join(home, '.jdks', 'jdk-26-ea'), '26-ea');
    fs.symlinkSync(elsewhere, path.join(home, '.jdks', 'linked-25'), 'junction');
    const { test, welcome } = await start({ system: { env: {}, home } }, root);
    const { jdks, forLanguageServer } = await call(test, welcome, 'app.jdks');
    expect(jdks.map((j) => j.version)).toEqual(['26-ea', '25.0.2']);
    expect(forLanguageServer?.path).toBe(path.join(home, '.jdks', 'linked-25'));
    void ea;
  });

  it('speichert die Einstellungen über einen Neustart und schickt Änderungen an alle offenen Fenster', async () => {
    const root = tempDir();
    const m = machine(root);
    const { test: first, welcome } = await start({ system: { env: m.env, home: m.home } }, root);
    const alpha = await openProject(first, welcome, project(root, 'Alpha'));
    const beta = await openProject(first, alpha, project(root, 'Beta'));
    expect(await call(first, alpha, 'app.updateSettings', { fontSize: 15, jdk: m.jdk25old })).toEqual({ fontSize: 15, jdk: m.jdk25old });
    for (const windowId of [alpha, beta]) {
      expect(first.events.forWindow(windowId).filter((e) => e.name === 'app.settingsChanged').map((e) => e.payload)).toEqual([
        { fontSize: 15, jdk: m.jdk25old },
      ]);
    }
    const test = await restart(first, { system: { env: m.env, home: m.home } });
    await test.core.start();
    const windowId = test.ports.windows.windowTitled(title('Alpha'));
    expect(await call(test, windowId, 'app.settings')).toEqual({ fontSize: 15, jdk: m.jdk25old });
    // Zurück auf „Newest detected“.
    expect(await call(test, windowId, 'app.updateSettings', { jdk: null })).toEqual({ fontSize: 15, jdk: null });
    await expect(call(test, windowId, 'app.updateSettings', { jdk: 'jdk-25' })).rejects.toMatchObject({ code: ErrorCode.invalidParams });
  });

  it('zeigt ohne Git in jedem Projektfenster „Git not found“ mit „Open README“', async () => {
    const root = tempDir();
    const { test, welcome } = await start({ system: { programs: {} } }, root);
    expect(test.core.gitPath).toBeNull();
    const alpha = await openProject(test, welcome, project(root, 'Alpha'));
    const beta = await openProject(test, alpha, project(root, 'Beta'));
    for (const windowId of [alpha, beta]) {
      expect(notices(test, windowId)).toEqual([
        {
          level: 'error',
          text: 'Git not found. Git features are off until Git is installed.',
          actions: [{ label: 'Open README', action: 'readme.open', params: { section: 'prerequisites' } }],
        },
      ]);
    }
    // Mit Git kein Hinweis.
    const withGit = await start({}, tempDir());
    expect(withGit.test.core.gitPath).not.toBeNull();
    const gamma = await openProject(withGit.test, withGit.welcome, project(tempDir(), 'Gamma'));
    expect(notices(withGit.test, gamma)).toEqual([]);
  });

  it('meldet ein fehlendes JDK 25 nur bei Projekten mit Java-Kennzeichen', async () => {
    const root = tempDir();
    // Nur JDK 21.
    const jdk21 = makeJdk(path.join(root, 'Program Files', 'Java', 'jdk-21'), '21.0.2');
    const { test, welcome } = await start({ system: { env: { ProgramFiles: path.join(root, 'Program Files'), JAVA_HOME: jdk21 } } }, root);
    const plain = await openProject(test, welcome, project(root, 'Plain', { 'index.ts': '' }));
    const maven = await openProject(test, plain, project(root, 'Maven', { 'pom.xml': '<project/>' }));
    const gradle = await openProject(test, maven, project(root, 'Gradle', { 'build.gradle.kts': '' }));
    expect(notices(test, plain)).toEqual([]);
    for (const windowId of [maven, gradle]) {
      expect(notices(test, windowId)).toMatchObject([
        { level: 'error', text: 'No JDK 25 or newer found. Java language features are off until one is installed.', actions: [{ action: 'readme.open' }] },
      ]);
    }
  });

  it('meldet nichts, wenn JDK 21 und 25 installiert sind und JAVA_HOME auf 21 zeigt', async () => {
    const root = tempDir();
    const m = machine(root);
    const { test, welcome } = await start({ system: { env: m.env, home: m.home } }, root);
    const maven = await openProject(test, welcome, project(root, 'Maven', { 'pom.xml': '<project/>' }));
    expect(notices(test, maven)).toEqual([]);
  });

  it('liefert das mitgelieferte README mit dem Abschnitt „Voraussetzungen“', async () => {
    const { test, welcome } = await start({});
    const { text } = await call(test, welcome, 'app.readme');
    expect(text).toMatch(/^## Voraussetzungen\s*$/m);
    expect(text).toMatch(/^### Zum Benutzen\s*$/m);
    expect(text).toMatch(/^### Zum Entwickeln\s*$/m);
  });

  it('liest Hauptversionen alter und neuer Schreibweise', () => {
    expect(majorVersion('1.8.0_392')).toBe(8);
    expect(majorVersion('21.0.13')).toBe(21);
    expect(majorVersion('25')).toBe(25);
    expect(majorVersion('25.0.5.1+2')).toBe(25);
  });
});
