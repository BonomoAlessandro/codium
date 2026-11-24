// Teststelle 1: Java im Sprach-Dienst ohne echten Server (Ticket 14): ohne JDK 25 startet kein Java-Server, und das gilt
// nicht als Absturz; dazu die reinen Regeln für Laufzeiten und das JDK des Gradle-Daemons.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gradleJavaRange, gradleJdkFor, javaRuntimes, wrapperGradleVersion, writableConfiguration } from '../../src/main/core/language/javaServer';
import { askUntilPrecise, hasCoarseClassFileTarget } from '../../src/main/core/language/languageService';
import type { CommandArgs, CommandName, CommandResult, JdkInfo } from '../../src/shared/types';
import { createTestCore, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const jdk = (major: number, version = `${major}.0.1`): JdkInfo => ({ path: `C:\\jdks\\jdk-${version}`, version, major, vendor: 'Test' });

describe('Java im Sprach-Dienst', () => {
  const tempDir = useTempDirs();

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  it('startet ohne JDK 25 keinen Java-Server, und das ist kein Absturz', async () => {
    const root = tempDir();
    const tools = path.join(root, 'tools');
    fs.mkdirSync(path.join(tools, 'jdtls', 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(tools, 'jdtls', 'config_win'), { recursive: true });
    // Ein vollständiges nachgemachtes jdtls: Fehlte nur der Launcher, entstünde aus anderem Grund kein Server (Review).
    fs.writeFileSync(path.join(tools, 'jdtls', 'plugins', 'org.eclipse.equinox.launcher_1.0.0.jar'), '');
    fs.writeFileSync(path.join(tools, 'jdtls', 'config_win', 'config.ini'), 'x=1\n');
    fs.writeFileSync(path.join(tools, 'lombok.jar'), '');
    const project = path.join(root, 'Shapes');
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    fs.writeFileSync(path.join(project, 'pom.xml'), '<project/>');
    fs.writeFileSync(path.join(project, 'src', 'A.java'), 'class A {}\n');
    // Ein nachgemachtes System ohne JDKs (leere Umgebung, keine Installationsordner).
    const test = createTestCore(path.join(root, 'data'), {
      system: { env: {}, home: path.join(root, 'home') },
      java: { jdtls: path.join(tools, 'jdtls'), lombok: path.join(tools, 'lombok.jar') },
    });
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    const windowId = test.ports.windows.windowTitled('Shapes – Codium');
    await call(test, windowId, 'language.didOpen', { path: path.join(project, 'src', 'A.java'), text: 'class A {}\n', version: 1 });
    expect(await call(test, windowId, 'language.definition', { path: path.join(project, 'src', 'A.java'), line: 0, character: 6 })).toEqual([]);
    await new Promise((r) => setTimeout(r, 300));
    expect(test.core.projectCore(windowId)!.language.javaPid).toBeUndefined();
    // Kein Fehlerhinweis über einen abgestürzten Server (der Hinweis auf das fehlende JDK kommt aus Ticket 09).
    const notices = test.events.forWindow(windowId).filter((e) => e.name === 'app.notice').map((e) => (e.payload as { text: string }).text);
    expect(notices.some((t) => /language server stopped/.test(t))).toBe(false);
    // Kein Startversuch (der schlüge mit dem nachgemachten jdtls fehl und stünde im Protokoll), dafür der JDK-Hinweis.
    expect(test.logs.filter((l) => /Java-Sprachserver|starten/.test(l))).toEqual([]);
    expect(notices.some((t) => /JDK/.test(t))).toBe(true);
  });

  it('erneuert die Kopie der Konfiguration, wenn sich jdtls am selben Ort ändert', () => {
    const root = tempDir();
    const jdtls = path.join(root, 'jdtls');
    fs.mkdirSync(path.join(jdtls, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(jdtls, 'config_win'), { recursive: true });
    fs.writeFileSync(path.join(jdtls, 'plugins', 'org.eclipse.equinox.launcher_1.0.0.jar'), '');
    fs.writeFileSync(path.join(jdtls, 'config_win', 'config.ini'), 'osgi.framework=org.eclipse.osgi_1.jar\n');
    const data = path.join(root, 'data');
    const config = writableConfiguration(jdtls, data);
    expect(fs.readFileSync(path.join(config, 'config.ini'), 'utf8')).toContain('osgi_1');
    // Ein Update von jdtls am selben Pfad (wie im Paket): neue config.ini.
    fs.writeFileSync(path.join(jdtls, 'config_win', 'config.ini'), 'osgi.framework=org.eclipse.osgi_2.jar\n');
    expect(fs.readFileSync(path.join(writableConfiguration(jdtls, data), 'config.ini'), 'utf8')).toContain('osgi_2');
  });
});

describe('Laufzeiten und Gradle', () => {
  const tempDir = useTempDirs();

  it('meldet je Java-Version das neueste JDK als Laufzeit', () => {
    expect(javaRuntimes([jdk(25), jdk(21, '21.0.3'), jdk(21, '21.0.13'), jdk(8, '1.8.0_412')].map((j, i) => (i === 3 ? { ...j, major: 8 } : j)))).toEqual([
      { name: 'JavaSE-25', path: 'C:\\jdks\\jdk-25.0.1' },
      { name: 'JavaSE-21', path: 'C:\\jdks\\jdk-21.0.13' },
      { name: 'JavaSE-1.8', path: 'C:\\jdks\\jdk-1.8.0_412' },
    ]);
  });

  it('wählt für den Gradle-Daemon das neueste JDK, das die Gradle-Version verträgt', () => {
    expect(gradleJavaRange('8.14.3')).toEqual([8, 24]);
    expect(gradleJavaRange('8.5')).toEqual([8, 21]);
    expect(gradleJavaRange('7.6.4')).toEqual([8, 19]);
    expect(gradleJavaRange('9.2.0')).toEqual([17, 25]);
    const project = tempDir();
    fs.mkdirSync(path.join(project, 'gradle', 'wrapper'), { recursive: true });
    const write = (version: string) =>
      fs.writeFileSync(
        path.join(project, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
        `distributionUrl=https\\://services.gradle.org/distributions/gradle-${version}-bin.zip\n`,
      );
    write('8.14.3');
    expect(wrapperGradleVersion(project)).toBe('8.14.3');
    const jdks = [jdk(25), jdk(21), jdk(17), jdk(11)];
    expect(gradleJdkFor(project, jdks)?.major).toBe(21);
    write('7.4.2');
    expect(gradleJdkFor(project, jdks)?.major).toBe(17);
    write('9.1.0');
    expect(gradleJdkFor(project, jdks)?.major).toBe(25);
    expect(gradleJdkFor(tempDir(), jdks)).toBeNull();
    // Der Wrapper in einem Unterordner (Review von Ticket 14).
    const nested = tempDir();
    fs.mkdirSync(path.join(nested, 'backend', 'gradle', 'wrapper'), { recursive: true });
    fs.writeFileSync(path.join(nested, 'backend', 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'distributionUrl=https\\://x/gradle-8.5-bin.zip\n');
    expect(gradleJdkFor(nested, jdks)?.major).toBe(21);
  });
});

describe('Grobe Ziele in Klassendateien (Ticket 27)', () => {
  const STRING = 'jdt://contents/java.base/java.lang/String.java?=hello/x%3Cjava.lang%28String.class';
  const range = (startLine: number, startCharacter: number, endLine: number, endCharacter: number) => ({
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  });

  it('erkennt die ganze Klassendatei als grobes Ziel, den Namen und Ziele in Projektdateien nicht', () => {
    // So antwortet jdtls kurz nach dem Import für String: die ganze Datei statt des Namens auf Zeile 142.
    expect(hasCoarseClassFileTarget([{ uri: STRING, range: range(0, 0, 4917, 0) }])).toBe(true);
    expect(hasCoarseClassFileTarget({ targetUri: STRING, targetSelectionRange: range(3, 0, 9, 1) })).toBe(true);
    expect(hasCoarseClassFileTarget([{ uri: STRING, range: range(141, 19, 141, 25) }])).toBe(false);
    // Eine Deklaration über mehrere Zeilen in einer Projektdatei ist kein Grund, neu zu fragen.
    expect(hasCoarseClassFileTarget([{ uri: 'file:///C:/p/Main.java', range: range(2, 0, 8, 1) }])).toBe(false);
    expect(hasCoarseClassFileTarget(null)).toBe(false);
    expect(hasCoarseClassFileTarget([])).toBe(false);
  });

  it('fragt neu, bis die Antwort genau ist, und behält sonst nach den Versuchen die letzte', async () => {
    const answers = ['grob', 'grob', 'genau', 'später'];
    let asked = 0;
    const ask = async () => answers[asked++];
    expect(await askUntilPrecise(ask, (a) => a === 'grob', { attempts: 10, delayMs: 1 })).toBe('genau');
    expect(asked).toBe(3);

    asked = 0;
    expect(await askUntilPrecise(async () => (asked++, 'grob'), (a) => a === 'grob', { attempts: 4, delayMs: 1 })).toBe('grob');
    expect(asked).toBe(4);

    // Ein genaues Ziel gleich beim ersten Mal: keine weitere Frage.
    asked = 0;
    expect(await askUntilPrecise(async () => (asked++, 'genau'), (a) => a === 'grob', { attempts: 4, delayMs: 1 })).toBe('genau');
    expect(asked).toBe(1);
  });

  it('hört auf zu fragen, sobald der Server endet oder das Projekt schliesst', async () => {
    let asked = 0;
    let stopped = false;
    const ask = async () => {
      asked++;
      if (asked === 2) stopped = true;
      return 'grob';
    };
    expect(await askUntilPrecise(ask, () => true, { attempts: 10, delayMs: 1, stop: () => stopped })).toBe('grob');
    expect(asked).toBe(2);
  });
});
