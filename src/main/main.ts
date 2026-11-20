import { app, BrowserWindow, ipcMain, Menu, nativeTheme } from 'electron';
import * as path from 'node:path';
import { IPC, type AppInfo } from '../shared/types';
import { dataFolder } from './dataFolder';
import { DEV_MENU } from './devMenu';

// Datenordner %APPDATA%\Codium, unpaketiert (npm start) %APPDATA%\Codium-dev, damit die Entwicklung eine
// installierte App nie berührt. Muss vor dem ersten Zugriff auf userData und vor der Einzelinstanz-Sperre
// passieren: Die hängt am Datenordner, so hat die Entwicklung ihre eigene.
app.setPath('userData', dataFolder(app.getPath('appData'), app.isPackaged));

let mainWindow: BrowserWindow | null = null;

// Nur eine Instanz: Ein zweiter Start gibt sofort auf, die laufende holt ihr Fenster nach vorne.
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', bringWindowToFront);
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
} else {
  app.quit();
}

function start(): void {
  // Im Dev-Modus ein Menü mit DevTools und Neu laden; die installierte App hat keines.
  Menu.setApplicationMenu(app.isPackaged ? null : Menu.buildFromTemplate(DEV_MENU));
  registerIpc();
  createWindow();
}

function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({ name: app.getName(), version: app.getVersion() }));
}

function bringWindowToFront(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 400,
    show: false,
    // Deckende Fensterfarbe passend zum Design von Windows, damit beim Öffnen nichts aufblitzt.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#ffffff',
    title: 'Codium',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  // Das Fenster zeigt nur die eigene Oberfläche. Ein auf das Fenster gezogener Link oder eine Datei würde
  // sonst wegnavigieren, und eine fremde Seite bekäme Zugriff auf die API aus dem Preload.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-redirect', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('closed', () => {
    mainWindow = null;
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}
