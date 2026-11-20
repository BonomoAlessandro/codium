// Starthilfe für die echte App in Playwright-Tests (Teststelle 2). Startet `dist/` mit dem Electron aus den
// Entwicklungsabhängigkeiten, immer im Testmodus, mit abgeschirmter Git-Konfiguration und cmd als Shell.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import { dataFolder } from '../../src/main/dataFolder';
import { APP_STATE_FILE, emptyAppState, type AppState } from '../../src/main/core/schema';
import type { TestEvent } from '../../src/main/testMode';
import { shieldedGitEnv } from './git';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

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
   * Startet Codium ein zweites Mal mit derselben Umgebung, ohne Playwright. Der zweite Start muss sich wegen der
   * Einzelinstanz-Sperre sofort beenden; tut er das nicht, wird er beendet und der Aufruf scheitert.
   */
  startSecondInstance(): Promise<void>;
  /** Wartet, bis sich die App von selbst beendet hat (etwa nach „Exit“). */
  exited(): Promise<void>;
  close(): Promise<void>;
}

export async function launchCodium(options: LaunchOptions): Promise<LaunchedApp> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(shieldedGitEnv(path.join(options.dataRoot, 'gitconfig-global')))) {
    // Nichts aus einer laufenden Codium-Instanz erben (etwa wenn der Testlauf selbst in Codium läuft).
    if (value !== undefined && !/^CODIUM_/i.test(key) && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  Object.assign(env, { CODIUM_TEST_HIDDEN: '1', CODIUM_TEST_DATA_DIR: options.dataRoot }, options.env);
  assertTestModeEnv(env);
  useCmdAsShell(options.dataRoot);

  const electronPath = createRequire(__filename)('electron') as string;
  const app = await _electron.launch({ executablePath: electronPath, args: [PROJECT_ROOT], cwd: PROJECT_ROOT, env });
  let hasExited = false;
  const closed = new Promise<void>((resolve) =>
    app.once('close', () => {
      hasExited = true;
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
  return {
    app,
    recorded: () => app.evaluate(() => (globalThis as { __codiumTest?: { events: TestEvent[] } }).__codiumTest?.events ?? []),
    windowTitles,
    async windowId(title) {
      const id = await app.evaluate(
        ({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.getTitle() === wanted)?.id,
        title,
      );
      if (id === undefined) throw new Error(`Kein Fenster mit dem Titel ${title}; offen: ${(await windowTitles()).join(', ')}`);
      return id;
    },
    page: (title) => findPage(app, title),
    startSecondInstance: () => runSecondInstance(electronPath, env),
    exited: () => closed,
    close: async () => {
      if (hasExited) return;
      // Die Schutzversprechen des Testmodus gelten für jedes Fenster, das bis hierher offen ist.
      const violations = await testModeViolations(app).catch((err: unknown) => [
        `Prüfung der Fenster nicht möglich: ${(err as Error).message}`,
      ]);
      await app.close();
      if (violations.length > 0) throw new Error(`Testmodus verletzt: ${violations.join('; ')}`);
    },
  };
}

/**
 * Prüft alle offenen Fenster: Keines liegt auf einem Bildschirm, keines hat den Fokus. Windows setzt die Lage nicht
 * genau auf die verlangten -32000, deshalb wird gegen alle Bildschirme geprüft.
 */
async function testModeViolations(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ BrowserWindow, screen }) => {
    const displays = screen.getAllDisplays().map((d) => d.bounds);
    return BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed())
      .flatMap((w) => {
        const b = w.getBounds();
        const onSomeDisplay = displays.some(
          (d) => b.x < d.x + d.width && b.x + b.width > d.x && b.y < d.y + d.height && b.y + b.height > d.y,
        );
        const problems: string[] = [];
        if (onSomeDisplay) problems.push(`„${w.getTitle()}“ liegt auf einem Bildschirm (${JSON.stringify(b)})`);
        if (w.isFocused()) problems.push(`„${w.getTitle()}“ hat den Fokus`);
        return problems;
      });
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
