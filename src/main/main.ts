// Muss der erste Import bleiben: Fehlerbehandlung im Testmodus und Grösse des Threadpools (siehe earlyStart.ts).
import './earlyStart';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session } from 'electron';
import * as path from 'node:path';
import { IPC, type EventMessage, type EventName, type RequestMessage, type ResponseMessage } from '../shared/types';
import { AppCore } from './core/appCore';
import type { EventSink } from './core/ports';
import { appIconPath } from './appIcon';
import { dataFolder } from './dataFolder';
import { DEV_MENU } from './devMenu';
import { ElectronFolderPicker, ElectronSecrets, ElectronShellActions } from './electron/otherPorts';
import { ElectronWindowPort } from './electron/windowPort';
import { isAllowedPageRequest } from './pageRequests';
import { ripgrepPath } from './ripgrepPath';
import { bundledTypeScript } from './typescriptPaths';
import { javaTools } from './javaToolsPaths';
import { NodeSystem } from './system/nodeSystem';
import { killDescendants } from './core/processTree';
import { watchTestGuard } from './testGuard';
import { readTestMode, TEST_HOOKS_GLOBAL, TEST_RECORDER_GLOBAL, TestRecorder, type TestHooks } from './testMode';

// Testmodus für automatische Prüfungen (siehe testMode.ts). Gilt auch für die gebaute App. Den Handler für nicht
// abgefangene Ausnahmen im Testmodus meldet schon earlyStart.ts an.
const testMode = readTestMode(process.env);
const recorder = new TestRecorder(testMode.hidden);
if (testMode.hidden) (globalThis as Record<string, unknown>)[TEST_RECORDER_GLOBAL] = recorder;
// Wächter: Endet der Testprozess, der Codium gestartet hat, beendet sich Codium samt Kindprozessen (Sprachserver,
// Shells) binnen weniger Sekunden, hart und ohne das geordnete Beenden, das gerade dann hängen kann (testGuard.ts).
if (testMode.hidden && testMode.guardPipe) {
  watchTestGuard(testMode.guardPipe, (reason) => {
    console.error(`Wächter im Testmodus: ${reason}. Codium beendet sich samt Kindprozessen.`);
    void killDescendants(process.pid).finally(() => app.exit(1));
  });
}
process.on('unhandledRejection', (reason) => console.error('Nicht behandelte Ablehnung:', reason));

// Datenordner %APPDATA%\Codium, unpaketiert (npm start) %APPDATA%\Codium-dev, damit die Entwicklung eine
// installierte App nie berührt. Im Testmodus ersetzt CODIUM_TEST_DATA_DIR die Wurzel %APPDATA%; Electron selbst
// ignoriert ein umgeleitetes APPDATA. Muss vor dem ersten Zugriff auf userData und vor der
// Einzelinstanz-Sperre passieren: Die hängt am Datenordner, so hat jede Umgebung ihre eigene.
const dataDir = dataFolder(testMode.dataDir ?? app.getPath('appData'), app.isPackaged);
app.setPath('userData', dataDir);

let core: AppCore | null = null;
let quitState: 'running' | 'stopping' | 'done' = 'running';

// Nur eine Instanz: Ein zweiter Start gibt sofort auf, die laufende holt ihr zuletzt benutztes Fenster nach vorne.
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => core?.secondInstanceStarted());
  app.whenReady().then(start);
  // Wann Codium endet, entscheidet der Kern (letztes Fenster zu, „Exit“, Abmelden von Windows). Sind alle
  // Fenster zu, hat er das Beenden schon verlangt; das hier ist nur die Absicherung.
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', onBeforeQuit);
} else {
  app.quit();
}

async function start(): Promise<void> {
  try {
    await startCore();
  } catch (err) {
    // Ohne Kern gibt es kein Fenster; statt eines unsichtbaren, hängenden Prozesses melden und beenden.
    console.error('Codium konnte nicht starten:', err);
    if (!testMode.hidden) dialog.showErrorBox('Codium konnte nicht starten', String(err));
    app.exit(1);
  }
}

function javaToolsFor() {
  // Im Testmodus nur mit eigenen Maven-Einstellungen; sonst nähme jdtls still die des Nutzers (Review von Ticket 14).
  if (testMode.hidden && (process.env.CODIUM_TEST_JAVA !== '1' || !process.env.CODIUM_TEST_MAVEN_SETTINGS)) return null;
  return javaTools(app.getAppPath(), app.isPackaged);
}

async function startCore(): Promise<void> {
  // Codium ist nur dunkel: Auch was Chromium und Electron selbst zeichnen (Bildlaufleisten, Entwicklerwerkzeuge,
  // Menü der Entwicklungsversion), folgt dem dunklen Design statt dem von Windows.
  nativeTheme.themeSource = 'dark';
  // Im Dev-Modus ein Menü mit DevTools und Neu laden; die installierte App hat keines.
  Menu.setApplicationMenu(app.isPackaged ? null : Menu.buildFromTemplate(DEV_MENU));
  // Die Seiten laden nur die eigenen Dateien der Oberfläche und data:-Adressen, nie etwas aus dem Netz oder sonst vom
  // Rechner (pageRequests.ts). Im Testmodus wird jeder Zugriff aufgezeichnet, auch ein abgewiesener, damit Tests das
  // prüfen können.
  const rendererDir = path.join(__dirname, '..', 'renderer');
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isAllowedPageRequest(details.url, rendererDir);
    if (testMode.hidden) recorder.record('web-request', { url: details.url, resourceType: details.resourceType, ...(allowed ? {} : { blocked: true }) });
    callback(allowed ? {} : { cancel: true });
  });

  const events: EventSink = {
    send(windowId, name, payload) {
      const win = BrowserWindow.fromId(windowId);
      if (win && !win.isDestroyed()) win.webContents.send(IPC.event, { name, payload } satisfies EventMessage);
    },
  };
  core = new AppCore({
    dataDir,
    events,
    appInfo: { name: app.getName(), version: app.getVersion() },
    ripgrepPath: ripgrepPath(app.getAppPath(), app.isPackaged),
    // typescript-language-server läuft mit Electron als Node; ein installiertes Node.js ist nicht nötig.
    typescript: bundledTypeScript(app.getAppPath(), app.isPackaged, { execPath: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }),
    // jdtls und Lombok (Ticket 14); fehlen sie, gibt es keinen Java-Server. Im Testmodus nur mit CODIUM_TEST_JAVA=1:
    // jdtls nähme sonst die Maven-Einstellungen des Nutzers und lüde Abhängigkeiten.
    ...(javaToolsFor() ? { java: javaToolsFor()! } : {}),
    // Im Testmodus eigene Maven-Einstellungen (Maven Central, lokales Repository im Test-Zwischenspeicher).
    ...(testMode.hidden && process.env.CODIUM_TEST_MAVEN_SETTINGS ? { mavenUserSettings: process.env.CODIUM_TEST_MAVEN_SETTINGS } : {}),
    // Das README liegt im Paket neben dem App-Archiv (`extraResources`), unpaketiert im Projekt.
    readmePath: app.isPackaged ? path.join(process.resourcesPath, 'README.md') : path.join(app.getAppPath(), 'README.md'),
    ports: {
      windows: new ElectronWindowPort({
        preloadFile: path.join(__dirname, '..', 'preload', 'preload.js'),
        indexFile: path.join(__dirname, '..', 'renderer', 'index.html'),
        iconFile: appIconPath(app.getAppPath(), app.isPackaged, process.resourcesPath),
        testMode,
        recorder,
      }),
      folderPicker: new ElectronFolderPicker(testMode, recorder),
      secrets: new ElectronSecrets(),
      shell: new ElectronShellActions(testMode, recorder, path.join(dataDir, 'test-trash')),
      system: new NodeSystem(process.env, { noGit: testMode.noGit }),
    },
  });
  const appCore = core;
  if (testMode.hidden) {
    const hooks: TestHooks = {
      emit: (windowId, name, payload) => appCore.emitToWindow(windowId, name as EventName, payload as never),
    };
    (globalThis as Record<string, unknown>)[TEST_HOOKS_GLOBAL] = hooks;
  }

  ipcMain.handle(IPC.request, (event, message: RequestMessage): Promise<ResponseMessage> => {
    const windowId = BrowserWindow.fromWebContents(event.sender)?.id ?? -1;
    return appCore.router.dispatch({ windowId }, message?.name, message?.params);
  });

  // Projekte, die beim Beenden offen waren, wieder öffnen; sonst das Willkommensfenster.
  await appCore.start();
}

/** Geordnetes Beenden: Der Kern baut die Projekt-Kerne ab und schreibt den Zustand, erst dann endet die App. */
function onBeforeQuit(event: Electron.Event): void {
  if (quitState === 'done' || !core) return;
  event.preventDefault();
  if (quitState === 'stopping') return;
  quitState = 'stopping';
  void core
    .shutdown()
    .catch((err: unknown) => console.error('Beenden des Kerns fehlgeschlagen:', err))
    .finally(() => {
      quitState = 'done';
      app.quit();
    });
}
