// Langsamer Lauf: echte TypeScript-Sprachserver (Ticket 12) an drei kleinen Beispielprojekten:
// - TypeScript 7 im Projekt (nativer Server des Projekts),
// - TypeScript 6 im Projekt (typescript-language-server mit dem tsserver des Projekts),
// - ohne eigenes TypeScript (nativer Server des mitgelieferten TypeScript 7).
// Das TypeScript der Beispielprojekte ist eine Junction auf die Pakete im Repository (typescript bzw. typescript6).

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_RESTARTS } from '../../src/main/core/language/languageService';
import { bundledTypeScript } from '../../src/main/typescriptPaths';
import type { CommandArgs, CommandName, CommandResult, LanguageDiagnostic } from '../../src/shared/types';
import { createTestCore, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const REPO = path.resolve(__dirname, '..', '..');
const BUNDLED = bundledTypeScript(REPO, false, { execPath: process.execPath, env: {} });

const SHAPE = 'export interface Shape {\n  area(): number;\n}\n\n/** Doubles a number. */\nexport function double(x: number): number {\n  return x * 2;\n}\n';
const MAIN =
  "import { double, type Shape } from './shape.js';\nimport { libValue } from 'lib-a';\n\nexport class Square implements Shape {\n  constructor(private side: number) {}\n  area(): number {\n    return double(this.side) + libValue;\n  }\n}\n";

type Variant = { name: string; typescript: 'typescript' | 'typescript6' | null; kind: string };
const VARIANTS: Variant[] = [
  { name: 'TypeScript 7 im Projekt', typescript: 'typescript', kind: 'project-native' },
  { name: 'TypeScript 6 im Projekt', typescript: 'typescript6', kind: 'project-tsserver' },
  { name: 'ohne eigenes TypeScript', typescript: null, kind: 'bundled-native' },
];

function descendants(pid: number): number[] {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'], {
    encoding: 'utf8',
  });
  const children = new Map<number, number[]>();
  for (const line of out.split(/\r?\n/)) {
    const [id, parent] = line.trim().split(' ').map(Number);
    if (!id) continue;
    children.set(parent, [...(children.get(parent) ?? []), id]);
  }
  const result: number[] = [];
  const queue = [pid];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      result.push(child);
      queue.push(child);
    }
  }
  return result;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until<T>(get: () => T | Promise<T>, ok: (v: T) => boolean, what: string, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await get();
    if (ok(value)) return value;
    if (Date.now() > end) throw new Error(`Zeitüberschreitung: ${what} (zuletzt ${JSON.stringify(value)?.slice(0, 300)})`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('TypeScript-Sprachserver', () => {
  const tempDir = useTempDirs();

  async function openProject(variant: Variant, clock?: () => number) {
    const root = tempDir();
    const project = path.join(root, 'Shapes');
    fs.mkdirSync(path.join(project, 'node_modules', 'lib-a'), { recursive: true });
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'shapes', type: 'module' }));
    fs.writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'es2022', module: 'nodenext', noEmit: true } }));
    fs.writeFileSync(path.join(project, 'shape.ts'), SHAPE);
    fs.writeFileSync(path.join(project, 'main.ts'), MAIN);
    fs.writeFileSync(path.join(project, 'node_modules', 'lib-a', 'package.json'), JSON.stringify({ name: 'lib-a', types: 'index.d.ts', main: 'index.js' }));
    fs.writeFileSync(path.join(project, 'node_modules', 'lib-a', 'index.d.ts'), 'export declare const libValue: number;\n');
    if (variant.typescript) fs.symlinkSync(path.join(REPO, 'node_modules', variant.typescript), path.join(project, 'node_modules', 'typescript'), 'junction');
    const test = createTestCore(path.join(root, 'data'), { typescript: BUNDLED, languageClock: clock, cleanupTimeoutMs: 10_000 });
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    const windowId = test.ports.windows.windowTitled('Shapes – Codium');
    return { project, test, windowId, at: (...p: string[]) => path.join(project, ...p) };
  }

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  function latestDiagnostics(test: TestCore, windowId: number, file: string): LanguageDiagnostic[] | undefined {
    const events = test.events.forWindow(windowId).filter((e) => e.name === 'language.diagnostics' && (e.payload as { path: string }).path.toLowerCase() === file.toLowerCase());
    return (events.at(-1)?.payload as { diagnostics: LanguageDiagnostic[] } | undefined)?.diagnostics;
  }

  for (const variant of VARIANTS) {
    it(`${variant.name}: Definition, Verwendungen, Implementierungen, Hover, Fehler, Bibliotheksziele, Dateiänderungen`, async () => {
      const { test, windowId, at } = await openProject(variant);
      // Mit Kennzeichen (package.json, tsconfig.json) startet der Server mit dem Projekt.
      await until(() => test.core.projectCore(windowId)?.language.typescriptKind, (k) => k === variant.kind, 'Server läuft');
      await call(test, windowId, 'language.didOpen', { path: at('main.ts'), text: MAIN, version: 1 });

      // Definition über Dateigrenzen: double(…) in main.ts → shape.ts.
      const definition = await until(
        () => call(test, windowId, 'language.definition', { path: at('main.ts'), line: 6, character: 12 }),
        // tsserver (TypeScript 6) liefert, solange es das Projekt noch lädt, den Import selbst als Ziel.
        (r) => r.some((l) => l.path !== at('main.ts')),
        'Definition',
      );
      expect(definition[0], JSON.stringify(definition)).toMatchObject({ path: at('shape.ts'), range: { start: { line: 5 } } });
      expect(definition[0].readOnly).toBeUndefined();

      // Verwendungen der Funktion, mit der Zeile.
      const references = await call(test, windowId, 'language.references', { path: at('shape.ts'), line: 5, character: 17 });
      expect(references.map((r) => [path.basename(r.path), r.range.start.line])).toEqual(expect.arrayContaining([['shape.ts', 5], ['main.ts', 0], ['main.ts', 6]]));
      expect(references.find((r) => r.path === at('main.ts') && r.range.start.line === 6)?.lineText).toContain('return double(this.side)');

      // Implementierungen des Interfaces.
      const implementations = await call(test, windowId, 'language.implementations', { path: at('shape.ts'), line: 0, character: 18 });
      expect(implementations.map((r) => path.basename(r.path))).toContain('main.ts');

      // Hover mit Typ und JSDoc.
      const hover = await call(test, windowId, 'language.hover', { path: at('main.ts'), line: 6, character: 12 });
      expect(hover?.markdown).toContain('double(x: number): number');
      expect(hover?.markdown).toContain('Doubles a number.');

      // Definition in eine Typdefinition unter node_modules: schreibgeschützt, Inhalt über readTarget.
      const lib = await call(test, windowId, 'language.definition', { path: at('main.ts'), line: 6, character: 33 });
      expect(lib[0]).toMatchObject({ path: at('node_modules', 'lib-a', 'index.d.ts'), readOnly: true });
      expect((await call(test, windowId, 'language.readTarget', { path: lib[0].path })).text).toContain('libValue');
      await expect(call(test, windowId, 'language.readTarget', { path: at('shape.ts') })).rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' });

      // Fehler nach einer ungespeicherten, fehlerhaften Änderung.
      await call(test, windowId, 'language.didChange', { path: at('main.ts'), text: `${MAIN}const wrong: number = 'text';\n`, version: 2 });
      await until(() => latestDiagnostics(test, windowId, at('main.ts')), (d) => (d ?? []).some((x) => x.severity === 'error' && x.range.start.line === 9), 'Fehler gemeldet');

      // Eine von aussen angelegte Datei wird berücksichtigt.
      await call(test, windowId, 'language.didChange', { path: at('main.ts'), text: `${MAIN}import { triple } from './extra.js';\nexport const t = triple(1);\n`, version: 3 });
      await until(() => latestDiagnostics(test, windowId, at('main.ts')), (d) => (d ?? []).some((x) => x.severity === 'error'), 'extra.ts fehlt');
      fs.writeFileSync(at('extra.ts'), 'export function triple(x: number): number {\n  return x * 3;\n}\n');
      await until(() => latestDiagnostics(test, windowId, at('main.ts')), (d) => d !== undefined && !d.some((x) => x.severity === 'error'), 'extra.ts bekannt');
      // … und eine von aussen geänderte: triple gibt es dort nicht mehr.
      fs.writeFileSync(at('extra.ts'), 'export function quadruple(x: number): number {\n  return x * 4;\n}\n');
      await until(() => latestDiagnostics(test, windowId, at('main.ts')), (d) => (d ?? []).some((x) => x.severity === 'error'), 'Änderung von aussen bekannt');
      fs.writeFileSync(at('extra.ts'), 'export function triple(x: number): number {\n  return x * 3;\n}\n');
      await until(() => latestDiagnostics(test, windowId, at('main.ts')), (d) => d !== undefined && !d.some((x) => x.severity === 'error'), 'wieder in Ordnung');

      // Eine ungespeicherte Änderung in einer anderen offenen Datei ändert die Fehler von main.ts (Review von Ticket 12).
      await call(test, windowId, 'language.didOpen', { path: at('shape.ts'), text: SHAPE, version: 1 });
      await call(test, windowId, 'language.didChange', { path: at('shape.ts'), text: SHAPE.replace('function double', 'function dbl'), version: 2 });
      await until(
        () => latestDiagnostics(test, windowId, at('main.ts')),
        (d) => (d ?? []).some((x) => x.severity === 'error' && /double/.test(x.message)),
        'Fehler in der anderen Datei',
      );
      await call(test, windowId, 'language.didChange', { path: at('shape.ts'), text: SHAPE, version: 3 });
      await until(() => latestDiagnostics(test, windowId, at('main.ts')), (d) => d !== undefined && !d.some((x) => x.severity === 'error'), 'wieder ohne Fehler');
      // Wie die Oberfläche beim Umbenennen eines offenen Tabs: das alte Dokument schliessen, das neue öffnen.
      await call(test, windowId, 'language.didClose', { path: at('shape.ts') });

      // Eine in Codium umbenannte Datei: Der alte Name fehlt jetzt.
      await call(test, windowId, 'files.rename', { path: at('shape.ts'), newName: 'geometry.ts' });
      await until(
        () => latestDiagnostics(test, windowId, at('main.ts')),
        (d) => (d ?? []).some((x) => x.severity === 'error' && x.range.start.line === 0),
        'Umbenennung bekannt',
      );

      // Abbau beendet den Server samt Kindprozessen.
      const pid = test.core.projectCore(windowId)!.language.typescriptPid!;
      const tree = [pid, ...descendants(pid)];
      test.ports.windows.close(windowId);
      await test.core.shutdown();
      // Der Server endet geordnet auf shutdown/exit und wird nicht hart beendet (Review von Ticket 12). Geprüft über das
      // Protokoll statt über die Dauer: Die hängt unter Last auch an anderen Diensten.
      // Nur beim nativen Server; typescript-language-server (TypeScript 6) endet unter Last nicht immer binnen 1 s.
      if (variant.kind !== 'project-tsserver') expect(test.logs.filter((l) => /hart beendet/.test(l))).toEqual([]);
      await until(() => tree.filter(alive), (a) => a.length === 0, 'Server und Kindprozesse beendet', 10_000);
    });
  }

  it('startet ohne Kennzeichen erst mit der ersten TypeScript-Datei', async () => {
    const root = tempDir();
    const project = path.join(root, 'Plain');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'a.ts'), 'export const a: number = 1;\n');
    const test = createTestCore(path.join(root, 'data'), { typescript: BUNDLED, cleanupTimeoutMs: 10_000 });
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    const windowId = test.ports.windows.windowTitled('Plain – Codium');
    await new Promise((r) => setTimeout(r, 1500));
    expect(test.core.projectCore(windowId)?.language.typescriptKind).toBeNull();
    await call(test, windowId, 'language.didOpen', { path: path.join(project, 'notes.txt'), text: 'x', version: 1 });
    expect(test.core.projectCore(windowId)?.language.typescriptKind).toBeNull();
    await call(test, windowId, 'language.didOpen', { path: path.join(project, 'a.ts'), text: 'export const a: number = 1;\n', version: 1 });
    expect(test.core.projectCore(windowId)?.language.typescriptKind).toBe('bundled-native');
  });

  it(`startet nach einem Absturz neu und gibt nach ${MAX_RESTARTS} Neustarts in drei Minuten auf`, async () => {
    let now = 1_000_000;
    const { test, windowId, at } = await openProject(VARIANTS[2], () => now);
    const language = () => test.core.projectCore(windowId)!.language;
    await until(() => language().typescriptPid, (p) => p !== undefined, 'Server läuft');
    await call(test, windowId, 'language.didOpen', { path: at('main.ts'), text: MAIN, version: 1 });
    for (let crash = 1; crash <= MAX_RESTARTS; crash++) {
      const pid = language().typescriptPid!;
      process.kill(pid);
      now += 10_000;
      const next = await until(() => language().typescriptPid, (p) => p !== undefined && p !== pid, `Neustart ${crash}`);
      expect(next).not.toBe(pid);
    }
    // Nach dem Neustart kennt der Server das offene Dokument wieder.
    await until(() => call(test, windowId, 'language.definition', { path: at('main.ts'), line: 6, character: 12 }), (r) => r.length > 0, 'Definition nach Neustart');
    // Nach Ablauf der drei Minuten zählen alte Abstürze nicht mehr: wieder ein Neustart.
    now += 3 * 60_000;
    const before = language().typescriptPid!;
    process.kill(before);
    await until(() => language().typescriptPid, (p) => p !== undefined && p !== before, 'Neustart nach Ablauf des Zeitfensters');
    for (let crash = 2; crash <= MAX_RESTARTS; crash++) {
      const pid = language().typescriptPid!;
      process.kill(pid);
      now += 10_000;
      await until(() => language().typescriptPid, (p) => p !== undefined && p !== pid, `erneuter Neustart ${crash}`);
    }
    // Der nächste Absturz im selben Zeitfenster: kein Neustart, ein Fehlerhinweis.
    process.kill(language().typescriptPid!);
    await until(
      () => test.events.forWindow(windowId).filter((e) => e.name === 'app.notice' && (e.payload as { level: string }).level === 'error'),
      (n) => n.length === 1,
      'Fehlerhinweis',
    );
    await new Promise((r) => setTimeout(r, 1000));
    expect(language().typescriptPid).toBeUndefined();
  });
});
