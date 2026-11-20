// Echter Port „Fenster“ mit Electron. Im Testmodus öffnen Fenster ausserhalb des Bildschirms, ohne
// Aktivierung und ohne Taskleisten-Eintrag; „nach vorne holen“ wird nur aufgezeichnet.

import { BrowserWindow, nativeTheme, screen } from 'electron';
import type { Bounds, DisplayInfo, WindowOpenOptions, WindowPort } from '../core/ports';
import type { TestMode, TestRecorder } from '../testMode';

const DEFAULT_SIZE = { width: 1280, height: 800 };

export interface ElectronWindowPortOptions {
  preloadFile: string;
  indexFile: string;
  testMode: TestMode;
  recorder: TestRecorder;
}

export class ElectronWindowPort implements WindowPort {
  private readonly closedListeners: Array<(windowId: number) => void> = [];

  constructor(private readonly options: ElectronWindowPortOptions) {}

  open(options: WindowOpenOptions): number {
    const hidden = this.options.testMode.hidden;
    const win = new BrowserWindow({
      ...(options.bounds ?? DEFAULT_SIZE),
      // Testmodus: ausserhalb des Bildschirms und ohne Taskleisten-Eintrag.
      ...(hidden ? { x: -32000, y: -32000, skipTaskbar: true } : {}),
      minWidth: 720,
      minHeight: 400,
      show: false,
      // Deckende Fensterfarbe, damit beim Öffnen nichts aufblitzt (das dunkle Schema folgt mit Ticket 03).
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#ffffff',
      title: options.title,
      webPreferences: {
        preload: this.options.preloadFile,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const id = win.id;

    // Das Fenster zeigt nur die eigene Oberfläche. Ein auf das Fenster gezogener Link oder eine Datei würde
    // sonst wegnavigieren, und eine fremde Seite bekäme Zugriff auf die API aus dem Preload.
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.on('will-redirect', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => {
      for (const listener of this.closedListeners) listener(id);
    });

    win.once('ready-to-show', () => {
      if (hidden) win.showInactive();
      else win.show();
    });
    void win.loadFile(this.options.indexFile);
    this.options.recorder.record('window-opened', { windowId: id, kind: options.kind, title: options.title });
    return id;
  }

  focus(windowId: number): void {
    const win = BrowserWindow.fromId(windowId);
    if (!win || win.isDestroyed()) return;
    if (this.options.testMode.hidden) {
      this.options.recorder.record('window-focused', { windowId });
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  close(windowId: number): void {
    const win = BrowserWindow.fromId(windowId);
    if (win && !win.isDestroyed()) win.close();
  }

  getBounds(windowId: number): Bounds | null {
    const win = BrowserWindow.fromId(windowId);
    if (!win || win.isDestroyed()) return null;
    return win.getNormalBounds();
  }

  setBounds(windowId: number, bounds: Bounds): void {
    const win = BrowserWindow.fromId(windowId);
    if (!win || win.isDestroyed()) return;
    // Im Testmodus bleibt das Fenster ausserhalb des Bildschirms; nur die Grösse wird übernommen.
    if (this.options.testMode.hidden) win.setSize(bounds.width, bounds.height);
    else win.setBounds(bounds);
  }

  displays(): DisplayInfo[] {
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      bounds: d.bounds,
      workArea: d.workArea,
      primary: d.id === primaryId,
    }));
  }

  onClosed(listener: (windowId: number) => void): void {
    this.closedListeners.push(listener);
  }
}
