// Langsamer Lauf: der Java-Sprachserver jdtls (Ticket 14) mit echten Beispielprojekten. Übersprungen ohne JDK 25, ohne
// jdtls/Lombok (scripts/fetch-java-tools.mjs) oder ohne Netz. Maven nimmt eigene Einstellungen mit Maven Central und
// einem lokalen Repository im Test-Zwischenspeicher, Gradle einen eigenen Benutzerordner dort (Spielregeln).

import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { detectJdks } from '../../src/main/core/jdks';
import { gradleJdkFor } from '../../src/main/core/language/javaServer';
import { isAlive } from '../../src/main/core/processTree';
import { NodeSystem } from '../../src/main/system/nodeSystem';
import { javaTools } from '../../src/main/javaToolsPaths';
import { SEMANTIC_TOKEN_MODIFIERS, SEMANTIC_TOKEN_TYPES, type CommandArgs, type CommandName, type CommandResult, type LanguageDiagnostic } from '../../src/shared/types';
import { createTestCore, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const REPO = path.resolve(__dirname, '..', '..');
const TOOLS = javaTools(REPO, false);
const JDKS = detectJdks(new NodeSystem(process.env));
const JDK25 = JDKS.find((j) => j.major >= 25);
const CACHE = path.join(REPO, '.test-cache', 'java');
const GRADLE_HOME = path.join(CACHE, 'gradle');
const MAVEN_SETTINGS = path.join(CACHE, 'maven-settings.xml');
const online = spawnSync(process.execPath, ['-e', "fetch('https://repo1.maven.org/maven2/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"], { timeout: 20_000 }).status === 0;
const skip = !TOOLS ? 'jdtls/Lombok fehlen (npm run fetch:java)' : !JDK25 ? 'kein JDK 25' : !online ? 'kein Netz' : null;
if (skip) console.warn(`Java-Tests übersprungen: ${skip}`);

fs.mkdirSync(CACHE, { recursive: true });
fs.writeFileSync(
  MAVEN_SETTINGS,
  `<settings><localRepository>${path.join(CACHE, 'maven-repository')}</localRepository><mirrors><mirror><id>central</id><mirrorOf>*</mirrorOf><url>https://repo1.maven.org/maven2</url></mirror></mirrors></settings>\n`,
);

/** Zeile und Zeichen (ab 0) des ersten Vorkommens, plus Versatz. */
function pos(text: string, needle: string, offset = 0): { line: number; character: number } {
  const index = text.indexOf(needle);
  if (index < 0) throw new Error(`nicht gefunden: ${needle}`);
  const before = text.slice(0, index + offset);
  const line = before.split('\n').length - 1;
  return { line, character: before.length - before.lastIndexOf('\n') - 1 };
}

async function until<T>(get: () => T | Promise<T>, ok: (v: T) => boolean, what: string, ms = 240_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await get();
    if (ok(value)) return value;
    if (Date.now() > end) throw new Error(`Zeitüberschreitung: ${what} (zuletzt ${JSON.stringify(value)?.slice(0, 300)})`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Prozesse, deren Befehlszeile den Text enthält (Windows). */
function processesWith(text: string): Array<{ pid: number; commandLine: string }> {
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Where-Object CommandLine | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return out
    .split(/\r?\n/)
    .map((l) => l.split('\t'))
    .filter(([id, cmd]) => Number(id) > 0 && cmd?.includes(text) && !cmd.includes('Get-CimInstance'))
    .map(([id, commandLine]) => ({ pid: Number(id), commandLine }));
}

const pom = (release: number, extra = '') =>
  `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>ch.codium</groupId><artifactId>sample</artifactId><version>1.0</version>` +
  `<properties><maven.compiler.release>${release}</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>${extra}</project>\n`;

describe.skipIf(skip !== null)('Java-Sprachserver (jdtls)', () => {
  const tempDir = useTempDirs();

  afterAll(async () => {
    // Gradle-Daemons dieses Testlaufs (im eigenen Benutzerordner) beenden; sie laufen sonst stundenlang weiter.
    const daemons = processesWith(GRADLE_HOME).filter((p) => p.commandLine.includes('GradleDaemon'));
    for (const daemon of daemons) {
      try {
        process.kill(daemon.pid);
      } catch {
        // Schon weg.
      }
    }
    await until(() => daemons.some((d) => isAlive(d.pid)), (alive) => !alive, 'Gradle-Daemons beendet', 20_000);
    // Am Ende läuft nichts mehr aus jdtls oder dem Gradle-Benutzerordner der Tests.
    expect(processesWith(path.join('.cache', 'java-tools')).map((p) => p.commandLine)).toEqual([]);
    expect(processesWith(GRADLE_HOME).map((p) => p.commandLine)).toEqual([]);
  });

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  async function openJava(name: string, files: Record<string, string>) {
    const root = tempDir();
    const project = path.join(root, name);
    for (const [relative, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(project, relative)), { recursive: true });
      fs.writeFileSync(path.join(project, relative), text);
    }
    const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
    const test = createTestCore(path.join(root, 'data'), {
      system: { env },
      java: TOOLS!,
      mavenUserSettings: MAVEN_SETTINGS,
      processEnv: { ...process.env, GRADLE_USER_HOME: GRADLE_HOME },
      cleanupTimeoutMs: 20_000,
    });
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    const windowId = test.ports.windows.windowTitled(`${name} – Codium`);
    const language = () => test.core.projectCore(windowId)!.language;
    // Mit Baudatei startet jdtls gleich; der Import dauert beim ersten Mal (Downloads).
    await until(() => language().javaReady, (r) => r, 'jdtls bereit');
    const at = (...p: string[]) => path.join(project, ...p);
    const open = async (relative: string) => {
      await call(test, windowId, 'language.didOpen', { path: at(relative), text: files[relative], version: 1 });
    };
    const diagnostics = (relative: string): LanguageDiagnostic[] | undefined => {
      const events = test.events
        .forWindow(windowId)
        .filter((e) => e.name === 'language.diagnostics' && (e.payload as { path: string }).path.toLowerCase() === at(relative).toLowerCase());
      return (events.at(-1)?.payload as { diagnostics: LanguageDiagnostic[] } | undefined)?.diagnostics;
    };
    return { test, windowId, language, at, open, diagnostics };
  }

  async function closeAndCheck(test: TestCore, windowId: number, language: () => { javaPid: number | undefined }) {
    const pid = language().javaPid;
    test.ports.windows.close(windowId);
    await test.core.shutdown();
    // Kein jdtls mehr.
    // Nach Prozessnummer, nicht nach Befehlszeile (Review von Ticket 14).
    if (pid !== undefined) await until(() => isAlive(pid), (alive) => !alive, 'jdtls beendet', 20_000);
  }

  const SHAPE = 'package demo;\n\npublic interface Shape {\n  /** The area of the shape. */\n  double area();\n}\n';
  const SQUARE =
    'package demo;\n\n/** A square. */\npublic class Square implements Shape {\n  public static int created = 0;\n  private final double side;\n\n  public Square(double side) {\n    this.side = side;\n    created++;\n  }\n\n  /** The area of the square. */\n  @Override\n  public double area() {\n    return side * side;\n  }\n}\n';
  const MAIN = 'package demo;\n\npublic class Main {\n  public static void main(String[] args) {\n    Shape s = new Square(2);\n    System.out.println(s.area());\n  }\n}\n';

  it('Maven: Definition, Verwendungen, Implementierungen, Hover, Fehler, Vervollständigung, Token, Symbolsuche, JDK-Klasse', { timeout: 600_000 }, async () => {
    const files = {
      'pom.xml': pom(21),
      'src/main/java/demo/Shape.java': SHAPE,
      'src/main/java/demo/Square.java': SQUARE,
      'src/main/java/demo/Main.java': MAIN,
    };
    const { test, windowId, language, at, open, diagnostics } = await openJava('Shapes', files);
    const main = 'src/main/java/demo/Main.java';
    await open(main);
    await open('src/main/java/demo/Square.java');

    // Definition über Dateigrenzen: new Square(…) → Square.java.
    const definition = await until(() => call(test, windowId, 'language.definition', { path: at(main), ...pos(MAIN, 'Square(2)', 1) }), (r) => r.length > 0, 'Definition');
    expect(definition[0].path).toBe(at('src/main/java/demo/Square.java'));
    // Verwendungen von area() (Deklaration im Interface) und Implementierungen von Shape.
    const references = await until(
      () => call(test, windowId, 'language.references', { path: at('src/main/java/demo/Shape.java'), ...pos(SHAPE, 'area()', 1) }),
      (r) => r.some((l) => l.path === at(main)),
      'Verwendungen',
    );
    expect(references.find((l) => l.path === at(main))?.lineText).toContain('s.area()');
    const implementations = await call(test, windowId, 'language.implementations', { path: at('src/main/java/demo/Shape.java'), ...pos(SHAPE, 'Shape {', 1) });
    expect(implementations.map((l) => path.basename(l.path))).toContain('Square.java');
    // Hover mit Javadoc.
    const hover = await call(test, windowId, 'language.hover', { path: at(main), ...pos(MAIN, 'area()', 1) });
    // Am Aufruf über das Interface: die Javadoc von Shape.area().
    expect(hover?.markdown).toContain('The area of the shape.');

    // JDK-Klasse: ein Sprung auf String liefert ein schreibgeschütztes Ziel mit Quelltext.
    const string = await call(test, windowId, 'language.definition', { path: at(main), ...pos(MAIN, 'String[]', 1) });
    expect(string[0]).toMatchObject({ readOnly: true });
    expect(string[0].path).toMatch(/^jdt:\/\/contents\/java\.base\/java\.lang\/String\.(class|java)/);
    expect((await call(test, windowId, 'language.readTarget', { path: string[0].path })).text).toMatch(/public final class String/);
    // Ctrl + Linksklick auch innerhalb dieses Tabs: eine Anfrage in der Klassendatei wird beantwortet.
    expect(await call(test, windowId, 'language.hover', { path: string[0].path, line: string[0].range.start.line, character: string[0].range.start.character + 1 })).not.toBeNull();

    // Fehler nach einer ungespeicherten Änderung.
    await call(test, windowId, 'language.didChange', { path: at(main), text: MAIN.replace('s.area()', 's.volume()'), version: 2 });
    await until(() => diagnostics(main), (d) => (d ?? []).some((x) => x.severity === 'error' && /volume/.test(x.message)), 'Fehler');
    await call(test, windowId, 'language.didChange', { path: at(main), text: MAIN, version: 3 });
    await until(() => diagnostics(main), (d) => d !== undefined && !d.some((x) => x.severity === 'error'), 'ohne Fehler');

    // Vervollständigung nach „s.“.
    const typed = MAIN.replace('System.out.println(s.area());', 's.');
    await call(test, windowId, 'language.didChange', { path: at(main), text: typed, version: 4 });
    const completion = await until(
      () => call(test, windowId, 'language.completion', { path: at(main), ...pos(typed, 's.', 2), triggerCharacter: '.' }),
      (r) => r.items.some((i) => i.label.startsWith('area')),
      'Vorschläge',
    );
    expect(completion.items.length).toBeGreaterThan(0);
    await call(test, windowId, 'language.didChange', { path: at(main), text: MAIN, version: 5 });

    // Semantische Token: Feld, statisches Feld, Parameter.
    const tokens = await until(() => call(test, windowId, 'language.semanticTokens', { path: at('src/main/java/demo/Square.java') }), (r) => (r?.data.length ?? 0) > 0, 'Token');
    const lines = SQUARE.split('\n');
    const decoded: string[] = [];
    let line = 0;
    let char = 0;
    for (let i = 0; i + 4 < tokens!.data.length; i += 5) {
      line += tokens!.data[i];
      char = tokens!.data[i] === 0 ? char + tokens!.data[i + 1] : tokens!.data[i + 1];
      const modifiers = SEMANTIC_TOKEN_MODIFIERS.filter((_, bit) => (tokens!.data[i + 4] & (1 << bit)) !== 0);
      decoded.push(`${line}:${lines[line].slice(char, char + tokens!.data[i + 2])}:${[SEMANTIC_TOKEN_TYPES[tokens!.data[i + 3]], ...modifiers].join('.')}`);
    }
    const kind = (l: number, word: string) => decoded.find((t) => t.startsWith(`${l}:${word}:`))?.split(':')[2];
    expect(kind(15, 'side')).toMatch(/^property/);
    expect(kind(9, 'created')).toMatch(/^property.*\.static/);
    expect(kind(7, 'side')).toMatch(/^parameter/);
    expect(kind(14, 'area')).toMatch(/^method.*\.declaration/);

    // Symbolsuche: Klasse und Methode.
    const types = await until(() => call(test, windowId, 'language.symbols', { query: 'Squa', kinds: 'types' }), (r) => r.length > 0, 'Klasse');
    expect(types.some((s) => s.name === 'Square')).toBe(true);
    const all = await until(() => call(test, windowId, 'language.symbols', { query: 'area', kinds: 'all' }), (r) => r.some((s) => s.name.startsWith('area')), 'Methode');
    expect(all.some((s) => s.name.startsWith('area') && s.path.endsWith('Square.java'))).toBe(true);

    // Ausdrücklich dasselbe JDK wie „Newest detected“: kein Neustart (der kostete einen vollen Import). Den Neustart bei
    // einem wirklich anderen JDK prüft test/main/javaRestart.test.ts mit nachgemachten JDKs; hier gibt es nur eines ab 25.
    const before = language().javaPid;
    const newest = JDKS.filter((j) => j.major >= 25).sort((a, b) => b.major - a.major)[0];
    await call(test, windowId, 'app.updateSettings', { jdk: newest.path });
    await new Promise((r) => setTimeout(r, 3000));
    expect(language().javaPid).toBe(before);
    await closeAndCheck(test, windowId, language);
  });

  it('Lombok: ein Getter aus @Getter ist Sprungziel, kein falscher Fehler', { timeout: 600_000 }, async () => {
    const person = 'package demo;\n\nimport lombok.Getter;\n\n@Getter\npublic class Person {\n  private String name = "Ada";\n}\n';
    const use = 'package demo;\n\npublic class Use {\n  String run() {\n    return new Person().getName();\n  }\n}\n';
    const files = {
      'pom.xml': pom(
        21,
        '<dependencies><dependency><groupId>org.projectlombok</groupId><artifactId>lombok</artifactId><version>1.18.48</version><scope>provided</scope></dependency></dependencies>',
      ),
      'src/main/java/demo/Person.java': person,
      'src/main/java/demo/Use.java': use,
    };
    const { test, windowId, language, at, open, diagnostics } = await openJava('Lomboked', files);
    await open('src/main/java/demo/Use.java');
    const definition = await until(
      () => call(test, windowId, 'language.definition', { path: at('src/main/java/demo/Use.java'), ...pos(use, 'getName', 1) }),
      (r) => r.length > 0,
      'Getter als Ziel',
    );
    expect(definition[0].path).toBe(at('src/main/java/demo/Person.java'));
    await until(() => diagnostics('src/main/java/demo/Use.java'), (d) => d !== undefined, 'Fehlerliste');
    await new Promise((r) => setTimeout(r, 3000));
    expect((diagnostics('src/main/java/demo/Use.java') ?? []).filter((d) => d.severity === 'error')).toEqual([]);
    // Keine Eclipse-Dateien im Projekt: Die Arbeitsdaten liegen im Datenordner (Review von Ticket 14).
    for (const name of ['.project', '.classpath', '.factorypath', '.settings']) expect(fs.existsSync(at(name)), name).toBe(false);
    await closeAndCheck(test, windowId, language);
  });

  const JDK17 = JDKS.find((j) => j.major === 17);
  it.skipIf(!JDK17)('Älterer Java-Stand: eine spätere API ist gegen Java 17 ein Fehler', { timeout: 600_000 }, async () => {
    const code = 'package demo;\n\nimport java.util.List;\n\npublic class Old {\n  Integer first() {\n    return List.of(1, 2).getFirst();\n  }\n}\n';
    const files = { 'pom.xml': pom(17), 'src/main/java/demo/Old.java': code };
    const { test, windowId, language, open, diagnostics } = await openJava('Older', files);
    await open('src/main/java/demo/Old.java');
    await until(() => diagnostics('src/main/java/demo/Old.java'), (d) => (d ?? []).some((x) => x.severity === 'error' && /getFirst/.test(x.message)), 'getFirst ist ein Fehler');
    await closeAndCheck(test, windowId, language);
  });

  it('Gradle 8: Import mit dem Wrapper, Daemon mit passendem JDK, Definition', { timeout: 900_000 }, async () => {
    const lib = 'package demo;\n\npublic class Lib {\n  public static int answer() {\n    return 42;\n  }\n}\n';
    const app = 'package demo;\n\npublic class App {\n  int value() {\n    return Lib.answer();\n  }\n}\n';
    const files = {
      'settings.gradle': "rootProject.name = 'gradled'\n",
      'build.gradle': "plugins { id 'java' }\njava { toolchain { languageVersion = JavaLanguageVersion.of(21) } }\nrepositories { mavenCentral() }\n",
      'gradle/wrapper/gradle-wrapper.properties':
        'distributionBase=GRADLE_USER_HOME\ndistributionPath=wrapper/dists\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-bin.zip\ndistributionSha256Sum=bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531\nzipStoreBase=GRADLE_USER_HOME\nzipStorePath=wrapper/dists\n',
      'src/main/java/demo/Lib.java': lib,
      'src/main/java/demo/App.java': app,
    };
    const { test, windowId, language, at, open } = await openJava('Gradled', files);
    await open('src/main/java/demo/App.java');
    const definition = await until(
      () => call(test, windowId, 'language.definition', { path: at('src/main/java/demo/App.java'), ...pos(app, 'answer', 1) }),
      (r) => r.length > 0,
      'Definition',
    );
    expect(definition[0].path).toBe(at('src/main/java/demo/Lib.java'));
    // Gradle 8.14 läuft bis Java 24: Der Daemon nimmt das JDK 21, nicht das JDK 25 von jdtls.
    const daemons = processesWith(GRADLE_HOME).filter((p) => p.commandLine.includes('GradleDaemon'));
    expect(daemons.length).toBeGreaterThan(0);
    // Das erwartete JDK nach der Verträglichkeitstabelle; es ist nicht das JDK 25 von jdtls (Review von Ticket 14).
    const expected = gradleJdkFor(at(''), JDKS);
    expect(expected).not.toBeNull();
    expect(expected!.major).toBeLessThan(25);
    expect(daemons.some((d) => d.commandLine.toLowerCase().includes(expected!.path.toLowerCase()))).toBe(true);
    await closeAndCheck(test, windowId, language);
  });
});

describe('Beschaffung von jdtls und Lombok', () => {
  const tempDir = useTempDirs();

  it.skipIf(!online)('bricht bei einer falschen Prüfsumme ab und behält nichts', { timeout: 120_000 }, async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'java-tools.json'), 'utf8'));
    manifest.lombok.sha256 = '0'.repeat(64);
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    const cache = path.join(dir, 'cache');
    const result = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'fetch-java-tools.mjs'), '--manifest', path.join(dir, 'manifest.json'), '--cache', cache], {
      encoding: 'utf8',
      timeout: 100_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Lombok: Prüfsumme weicht ab/);
    expect(fs.readdirSync(cache)).toEqual([]);
  });

  it.skipIf(!online)('bricht bei einem HTTP-Fehler ab (etwa einem Tippfehler im Manifest), statt „ohne Netz“ weiterzumachen', { timeout: 120_000 }, async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'java-tools.json'), 'utf8'));
    manifest.lombok.url = manifest.lombok.url.replace('1.18.48', '0.0.0-gibt-es-nicht');
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    const result = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'fetch-java-tools.mjs'), '--manifest', path.join(dir, 'manifest.json'), '--cache', path.join(dir, 'cache')], {
      encoding: 'utf8',
      timeout: 100_000,
    });
    expect(result.status).toBe(1);
  });
});
