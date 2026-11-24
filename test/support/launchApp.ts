// Starthilfe für die echte App in Playwright-Tests (Teststelle 2). Startet `dist/` mit dem Electron aus den
// Entwicklungsabhängigkeiten, immer im Testmodus, mit abgeschirmter Git-Konfiguration und cmd als Shell.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import { dataFolder } from '../../src/main/dataFolder';
import { APP_STATE_FILE, emptyAppState, PROJECT_STATE_DIR, type AppState, type ProjectState } from '../../src/main/core/schema';
import { lexicalProjectKey, projectStateFileName } from '../../src/main/core/projectPath';
import type { TestEvent, TestHooks } from '../../src/main/testMode';
import type { EventName, Events } from '../../src/shared/types';
import { shieldedGitEnv } from './git';
import { beforeTempDirRemoval } from './tempDir';
import { killDescendants } from '../../src/main/core/processTree';

/**
 * Laufende Instanzen. Läuft ein Test ins Zeitlimit, erreicht er sein `codium.close()` womöglich nicht; die Instanz
 * bliebe liegen und belastete alle folgenden Tests. Vor dem Löschen der Temp-Ordner werden übrige deshalb beendet,
 * notfalls samt Prozessbaum.
 */
const running = new Set<ElectronApplication>();
beforeTempDirRemoval(async () => {
  for (const app of [...running]) await stopApp(app);
});

async function stopApp(app: ElectronApplication): Promise<void> {
  running.delete(app);
  const child = app.process();
  const pid = child.pid;
  let timer: NodeJS.Timeout | undefined;
  const closed = await Promise.race([
    app.close().then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), 15_000))),
  ]);
  clearTimeout(timer);
  // Solange Node den Ausgang nicht gesehen hat, hält es den Handle offen, und Windows vergibt die Nummer nicht neu. Endet
  // Codium während der Abfrage der Prozesstabelle doch noch, wird nichts über die blosse Nummer beendet (Review).
  const alive = () => child.exitCode === null && child.signalCode === null;
  if (!closed && pid !== undefined && alive()) {
    await killDescendants(pid, alive);
    if (alive()) child.kill();
  }
}

/** Das Projekt mit `package.json` und `dist/`; Electron startet die App aus diesem Ordner. */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** Das Electron aus den Entwicklungsabhängigkeiten. */
export const ELECTRON_PATH = createRequire(__filename)('electron') as string;

/**
 * Die Pipe für den Wächter im Testmodus (`CODIUM_TEST_GUARD_PIPE`, src/main/testGuard.ts). Solange dieser Prozess
 * läuft und `close` nicht aufgerufen ist, bleibt sie offen; endet er, schliesst Windows sie, und Codium beendet sich.
 * Sie hält diesen Prozess nicht am Leben.
 */
export async function openTestGuard(): Promise<{ pipe: string; close(): void }> {
  const pipe = `\\\\.\\pipe\\codium-test-guard-${process.pid}-${randomUUID()}`;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.unref();
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.resume();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipe, () => resolve());
  });
  server.unref();
  return {
    pipe,
    close() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

/**
 * Wirft, wenn die Umgebung den Testmodus nicht einschaltet oder der Datenordner nicht im Temp-Ordner liegt.
 * Ohne Testmodus startet kein Test die App.
 */
export function assertTestModeEnv(env: Record<string, string | undefined>): void {
  if (env.CODIUM_TEST_HIDDEN !== '1' || !env.CODIUM_TEST_DATA_DIR) {
    throw new Error(
      'Codium startet in Tests nur im Testmodus: CODIUM_TEST_HIDDEN=1 und CODIUM_TEST_DATA_DIR müssen gesetzt sein.',
    );
  }
  const tempRoot = realLower(os.tmpdir());
  if (!realLower(env.CODIUM_TEST_DATA_DIR).startsWith(tempRoot + path.sep)) {
    throw new Error(`Der Datenordner im Testmodus muss im Temp-Ordner liegen: ${env.CODIUM_TEST_DATA_DIR}`);
  }
}

export interface LaunchOptions {
  /** Wurzel des Datenordners (ersetzt %APPDATA%); ein Temp-Ordner des Tests. */
  dataRoot: string;
  /** Zusätzliche oder überschreibende Umgebungsvariablen, etwa `CODIUM_TEST_PICK_DIR`. */
  env?: Record<string, string>;
}

export interface LaunchedApp {
  app: ElectronApplication;
  /** Die Aufzeichnung des Testmodus aus dem Hauptprozess. */
  recorded(): Promise<TestEvent[]>;
  /** Die Titel der offenen Fenster, alphabetisch. */
  windowTitles(): Promise<string[]>;
  /** Die Kennung des offenen Fensters mit diesem Titel. */
  windowId(title: string): Promise<number>;
  /** Die Seite des Fensters mit diesem Titel, sobald es sie gibt. */
  page(title: string): Promise<Page>;
  /**
   * Schickt ein Ereignis an das Fenster mit diesem Titel, auf demselben Weg wie der Kern (über die Eingriffe des
   * Testmodus). Für Ereignisse, deren echte Quelle es noch nicht gibt, etwa Fortschritt vor den Git-Aktionen.
   */
  emit<K extends EventName>(title: string, name: K, payload: Events[K]): Promise<void>;
  /**
   * Startet Codium ein zweites Mal mit derselben Umgebung, ohne Playwright. Der zweite Start muss sich wegen der
   * Einzelinstanz-Sperre sofort beenden; tut er das nicht, wird er beendet und der Aufruf scheitert.
   */
  startSecondInstance(): Promise<void>;
  /** Wartet, bis sich die App von selbst beendet hat (etwa nach „Exit“). */
  exited(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Die Umgebung für Codium im Testmodus, ohne Wächter: abgeschirmte Git-Konfiguration, Testmodus, Datenordner und cmd
 * als Shell (die schreibt sie in den App-Zustand). Wirft wie `assertTestModeEnv`.
 */
export function codiumTestEnv(options: LaunchOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(shieldedGitEnv(path.join(options.dataRoot, 'gitconfig-global')))) {
    // Nichts aus einer laufenden Codium-Instanz erben (etwa wenn der Testlauf selbst in Codium läuft).
    if (value !== undefined && !/^CODIUM_/i.test(key) && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  Object.assign(env, { CODIUM_TEST_HIDDEN: '1', CODIUM_TEST_DATA_DIR: options.dataRoot }, options.env);
  assertTestModeEnv(env);
  useCmdAsShell(options.dataRoot);
  return env;
}

export async function launchCodium(options: LaunchOptions): Promise<LaunchedApp> {
  const guard = await openTestGuard();
  let app: ElectronApplication;
  let env: Record<string, string>;
  try {
    env = { ...codiumTestEnv(options), CODIUM_TEST_GUARD_PIPE: guard.pipe };
    app = await _electron.launch({ executablePath: ELECTRON_PATH, args: [PROJECT_ROOT], cwd: PROJECT_ROOT, env });
  } catch (err) {
    guard.close();
    throw err;
  }
  running.add(app);
  let hasExited = false;
  // Die Pipe des Wächters schliesst erst, wenn die App beendet ist; sonst bräche sie ein geordnetes Beenden ab.
  const closed = new Promise<void>((resolve) =>
    app.once('close', () => {
      hasExited = true;
      running.delete(app);
      guard.close();
      resolve();
    }),
  );
  const windowTitles = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => !w.isDestroyed())
        .map((w) => w.getTitle())
        .sort(),
    );
  const windowId = async (title: string): Promise<number> => {
    const id = await app.evaluate(
      ({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.getTitle() === wanted)?.id,
      title,
    );
    if (id === undefined) throw new Error(`Kein Fenster mit dem Titel ${title}; offen: ${(await windowTitles()).join(', ')}`);
    return id;
  };
  return {
    app,
    recorded: () => app.evaluate(() => (globalThis as { __codiumTest?: { events: TestEvent[] } }).__codiumTest?.events ?? []),
    windowTitles,
    windowId,
    page: (title) => findPage(app, title),
    async emit(title, name, payload) {
      const id = await windowId(title);
      await app.evaluate(
        (_electron, event) => {
          const hooks = (globalThis as { __codiumTestHooks?: TestHooks }).__codiumTestHooks;
          if (!hooks) throw new Error('Die Eingriffe des Testmodus fehlen.');
          hooks.emit(event.id, event.name, event.payload);
        },
        { id, name, payload: payload as unknown },
      );
    },
    startSecondInstance: () => runSecondInstance(ELECTRON_PATH, env),
    exited: () => closed,
    close: async () => {
      if (hasExited) return;
      // Die Schutzversprechen des Testmodus gelten für jedes Fenster, das bis hierher offen ist.
      const violations = await testModeViolations(app).catch((err: unknown) => [
        `Prüfung der Fenster nicht möglich: ${(err as Error).message}`,
      ]);
      await stopApp(app);
      if (violations.length > 0) throw new Error(`Testmodus verletzt: ${violations.join('; ')}`);
    },
  };
}

/**
 * Prüft alle offenen Fenster: Keines liegt auf einem Bildschirm, keines ist aktivierbar, keines hat den Fokus. Dazu
 * jede Aktivierung durch Windows, die der Testmodus seit dem Start aufgezeichnet hat, auch an inzwischen
 * geschlossenen Fenstern. Windows setzt die Lage nicht genau auf die verlangten -32000, deshalb wird gegen alle
 * Bildschirme geprüft.
 */
async function testModeViolations(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ BrowserWindow, screen }) => {
    const displays = screen.getAllDisplays().map((d) => d.bounds);
    const open = BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed())
      .flatMap((w) => {
        const b = w.getBounds();
        const onSomeDisplay = displays.some(
          (d) => b.x < d.x + d.width && b.x + b.width > d.x && b.y < d.y + d.height && b.y + b.height > d.y,
        );
        const problems: string[] = [];
        if (onSomeDisplay) problems.push(`„${w.getTitle()}“ liegt auf einem Bildschirm (${JSON.stringify(b)})`);
        if (w.isFocusable()) problems.push(`„${w.getTitle()}“ ist aktivierbar`);
        if (w.isFocused()) problems.push(`„${w.getTitle()}“ hat den Fokus`);
        return problems;
      });
    const events = (globalThis as { __codiumTest?: { events: Array<{ kind: string; detail?: unknown }> } }).__codiumTest?.events ?? [];
    const activated = events
      .filter((e) => e.kind === 'window-activated')
      .map((e) => `„${(e.detail as { title?: string } | undefined)?.title ?? '?'}“ wurde von Windows aktiviert`);
    return [...open, ...activated];
  });
}

/**
 * Schreibt einen App-Zustand vor dem Start, etwa zuletzt geöffnete oder beim Beenden offene Projekte. Die
 * Starthilfe mischt danach cmd als Shell hinein.
 */
export function prepareAppState(dataRoot: string, state: Partial<Omit<AppState, 'schemaVersion'>>): void {
  const file = path.join(dataFolder(dataRoot, false), APP_STATE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ ...emptyAppState(), ...state }, null, 2)}\n`, 'utf8');
}

/** Schreibt den Projekt-Zustand eines Projekts vor dem Start, etwa offene Tabs oder Werkzeugfenster. */
export function prepareProjectState(dataRoot: string, projectPath: string, state: Partial<Omit<ProjectState, 'schemaVersion' | 'path'>>): void {
  const file = path.join(dataFolder(dataRoot, false), PROJECT_STATE_DIR, projectStateFileName(lexicalProjectKey(projectPath)));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, path: projectPath, ...state }, null, 2)}\n`, 'utf8');
}

/** Wartet auf die Seite eines Fensters mit diesem Titel (die Oberfläche übernimmt den Titel vom Kern). */
async function findPage(app: ElectronApplication, title: string, timeoutMs = 15_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const page of app.windows()) {
      try {
        if ((await page.title()) === title) return page;
      } catch {
        // Die Seite schliesst sich gerade.
      }
    }
    if (Date.now() > deadline) throw new Error(`Keine Seite mit dem Titel ${title}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function runSecondInstance(electronPath: string, env: Record<string, string>, timeoutMs = 30_000): Promise<void> {
  assertTestModeEnv(env);
  return new Promise((resolve, reject) => {
    const child = spawn(electronPath, [PROJECT_ROOT], { cwd: PROJECT_ROOT, env, stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Der zweite Start hat sich nicht von selbst beendet.'));
    }, timeoutMs);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Stellt cmd als Shell ein, damit keine PowerShell mit dem Profil des Nutzers startet (Spielregeln). Ein
 * vorbereiteter Zustand eines Tests bleibt erhalten; nur die Shell wird hineingemischt.
 */
function useCmdAsShell(dataRoot: string): void {
  const file = path.join(dataFolder(dataRoot, false), APP_STATE_FILE);
  let state: Record<string, unknown> = { ...emptyAppState() };
  if (fs.existsSync(file)) state = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as Record<string, unknown>;
  const settings = typeof state.settings === 'object' && state.settings !== null ? state.settings : {};
  state.settings = { ...settings, terminalShell: 'cmd' };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function realLower(dir: string): string {
  let resolved = path.resolve(dir);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    // Fehlt der Ordner, bleibt der aufgelöste Pfad.
  }
  return resolved.toLowerCase();
}
