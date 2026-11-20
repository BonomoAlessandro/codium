// Starthilfe für die echte App in Playwright-Tests (Teststelle 2). Startet `dist/` mit dem Electron aus den
// Entwicklungsabhängigkeiten, immer im Testmodus, mit abgeschirmter Git-Konfiguration und cmd als Shell.

import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { _electron, type ElectronApplication } from 'playwright-core';
import { dataFolder } from '../../src/main/dataFolder';
import { APP_STATE_FILE, emptyAppState } from '../../src/main/core/schema';
import type { TestEvent } from '../../src/main/testMode';
import { shieldedGitEnv } from './git';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** Wirft, wenn die Umgebung den Testmodus nicht einschaltet. Ohne Testmodus startet kein Test die App. */
export function assertTestModeEnv(env: Record<string, string | undefined>): void {
  if (env.CODIUM_TEST_HIDDEN !== '1' || !env.CODIUM_TEST_DATA_DIR) {
    throw new Error(
      'Codium startet in Tests nur im Testmodus: CODIUM_TEST_HIDDEN=1 und CODIUM_TEST_DATA_DIR müssen gesetzt sein.',
    );
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
  seedTestSettings(options.dataRoot);

  const electronPath = createRequire(__filename)('electron') as string;
  const app = await _electron.launch({ executablePath: electronPath, args: [PROJECT_ROOT], cwd: PROJECT_ROOT, env });
  return {
    app,
    recorded: () => app.evaluate(() => (globalThis as { __codiumTest?: { events: TestEvent[] } }).__codiumTest?.events ?? []),
    close: () => app.close(),
  };
}

/** Stellt cmd als Shell ein, damit keine PowerShell mit dem Profil des Nutzers startet (Spielregeln). */
function seedTestSettings(dataRoot: string): void {
  const file = path.join(dataFolder(dataRoot, false), APP_STATE_FILE);
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const state = emptyAppState();
  state.settings.terminalShell = 'cmd';
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
