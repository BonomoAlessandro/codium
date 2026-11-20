import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import * as path from 'node:path';
import { IPC, type EventMessage, type RequestMessage, type ResponseMessage } from '../shared/types';
import { AppCore } from './core/appCore';
import type { EventSink } from './core/ports';
import { dataFolder } from './dataFolder';
import { DEV_MENU } from './devMenu';
import { ElectronFolderPicker, ElectronSecrets, ElectronShellActions } from './electron/otherPorts';
import { ElectronWindowPort } from './electron/windowPort';
import { NodeSystem } from './system/nodeSystem';
import { readTestMode, TEST_RECORDER_GLOBAL, TestRecorder } from './testMode';

// Testmodus für automatische Prüfungen (siehe testMode.ts). Gilt auch für die gebaute App.
const testMode = readTestMode(process.env);
const recorder = new TestRecorder(testMode.hidden);
if (testMode.hidden) {
  (globalThis as Record<string, unknown>)[TEST_RECORDER_GLOBAL] = recorder;
  // Electron zeigt bei einer nicht abgefangenen Ausnahme einen Dialog auf dem Desktop, der den Hauptprozess
  // blockiert. Im Testmodus stattdessen protokollieren und beenden.
  process.on('uncaughtException', (err) => {
    console.error('Nicht abgefangene Ausnahme im Testmodus:', err);
    app.exit(1);
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

async function startCore(): Promise<void> {
  // Im Dev-Modus ein Menü mit DevTools und Neu laden; die installierte App hat keines.
  Menu.setApplicationMenu(app.isPackaged ? null : Menu.buildFromTemplate(DEV_MENU));

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
    ports: {
      windows: new ElectronWindowPort({
        preloadFile: path.join(__dirname, '..', 'preload', 'preload.js'),
        indexFile: path.join(__dirname, '..', 'renderer', 'index.html'),
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
