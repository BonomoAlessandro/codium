// Echter Port „Fenster“ mit Electron. Im Testmodus öffnen Fenster ausserhalb des Bildschirms, nicht aktivierbar
// und ohne Taskleisten-Eintrag; „nach vorne holen“ wird nur aufgezeichnet, und Fenster melden keine Lage zum
// Speichern.

import { app, BrowserWindow, screen } from 'electron';
import { HEADER_HEIGHT, PANEL_BACKGROUND, WINDOW_BACKGROUND, WINDOW_SYMBOL_COLOR } from '../../shared/theme';
import type { DisplayInfo, WindowKind, WindowOpenOptions, WindowPlacement, WindowPort } from '../core/ports';
import { isActivation, WM_ACTIVATE, type TestMode, type TestRecorder } from '../testMode';

/** Grösse eines Fensters ohne gespeicherte Lage; es öffnet dann zentriert auf dem Hauptbildschirm. */
const DEFAULT_SIZE: Record<WindowKind, { width: number; height: number }> = {
  project: { width: 1280, height: 800 },
  welcome: { width: 820, height: 560 },
};

export interface ElectronWindowPortOptions {
  preloadFile: string;
  indexFile: string;
  /** App-Symbol (ICO) für Taskleiste und Alt + Tab, auch in der Entwicklungsversion. */
  iconFile: string;
  testMode: TestMode;
  recorder: TestRecorder;
}

export class ElectronWindowPort implements WindowPort {
  private readonly closedListeners: Array<(windowId: number, lastPlacement: WindowPlacement | null) => void> = [];
  private readonly focusedListeners: Array<(windowId: number) => void> = [];
  private readonly readyListeners: Array<(windowId: number) => void> = [];
  private readonly sessionEndListeners: Array<() => void> = [];
  /** Ob ein Fenster maximiert ist; bleibt stehen, solange es minimiert ist (dann meldet Electron „nicht maximiert“). */
  private readonly maximized = new Map<number, boolean>();
  private sessionEnded = false;
  private closeRequestHandler: ((windowId: number) => Promise<void> | null) | null = null;

  onCloseRequested(handler: (windowId: number) => Promise<void> | null): void {
    this.closeRequestHandler = handler;
  }

  constructor(private readonly options: ElectronWindowPortOptions) {}

  open(options: WindowOpenOptions): number {
    const hidden = this.options.testMode.hidden;
    const win = new BrowserWindow({
      ...(options.placement?.bounds ?? DEFAULT_SIZE[options.kind]),
      // Testmodus: ausserhalb des Bildschirms, ohne Taskleisten-Eintrag und nicht aktivierbar. Ein neues Fenster liegt
      // in der Z-Reihenfolge gleich unter dem Vordergrundfenster; schliesst oder minimiert der Nutzer dieses, aktiviert
      // Windows das nächste aktivierbare Fenster, also das unsichtbare Testfenster, und Eingaben des Nutzers landen
      // dort. `focusable: false` setzt WS_EX_NOACTIVATE: Windows aktiviert das Fenster dann weder so noch über
      // Alt + Tab. Fokus in der Seite geht für Playwright weiter (es emuliert ihn über die Entwicklerwerkzeuge).
      ...(hidden ? { x: -32000, y: -32000, skipTaskbar: true, focusable: false } : {}),
      minWidth: 720,
      minHeight: 400,
      show: false,
      // Deckende Fensterfarbe des dunklen Schemas, damit beim Öffnen nichts aufblitzt; immer dunkel, auch bei hellem
      // Windows-Design.
      backgroundColor: WINDOW_BACKGROUND,
      // Ohne Windows-Rahmen: Die Oberfläche zeichnet die Kopfzeile selbst und macht sie zur Zieh-Fläche. Die
      // Fensterknöpfe von Windows bleiben als Überlagerung rechts darüber, mit ihnen die Andock-Layouts von Windows 11.
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: PANEL_BACKGROUND, symbolColor: WINDOW_SYMBOL_COLOR, height: HEADER_HEIGHT },
      title: options.title,
      icon: this.options.iconFile,
      webPreferences: {
        preload: this.options.preloadFile,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const id = win.id;
    // Im Testmodus wird nie maximiert: Das holte das Fenster auf den Bildschirm.
    const maximize = !hidden && options.placement?.maximized === true;
    this.maximized.set(id, maximize);

    // Das Fenster zeigt nur die eigene Oberfläche. Ein auf das Fenster gezogener Link oder eine Datei würde
    // sonst wegnavigieren, und eine fremde Seite bekäme Zugriff auf die API aus dem Preload.
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.on('will-redirect', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Im Testmodus landen Warnungen und Fehler der Seite (etwa Verstösse gegen die Sicherheitsrichtlinie) in der
    // Aufzeichnung, auch die vor dem ersten Zugriff eines Tests.
    if (hidden) {
      win.webContents.on('console-message', (event) => {
        if (event.level === 'warning' || event.level === 'error') {
          this.options.recorder.record('console-message', { windowId: id, level: event.level, message: event.message, source: event.sourceId });
        }
      });
      // Jede Aktivierung durch Windows landet in der Aufzeichnung; die Starthilfe der Tests meldet sie als Verletzung.
      // `isFocused()` allein genügt dafür nicht mehr: Es fragt die Aktivierung in Chromium ab, und Chromium führt ein
      // nicht aktivierbares Fenster nie als aktiv, auch wenn Windows es doch aktivieren sollte.
      if (process.platform === 'win32') {
        win.hookWindowMessage(WM_ACTIVATE, (wParam) => {
          if (isActivation(wParam)) this.options.recorder.record('window-activated', { windowId: id, title: win.isDestroyed() ? '' : win.getTitle() });
        });
      }
    }
    // Den Titel bestimmt der Kern („Projektname – Codium“), nicht das <title> der Seite.
    win.on('page-title-updated', (event) => event.preventDefault());

    win.on('maximize', () => this.maximized.set(id, true));
    win.on('unmaximize', () => this.maximized.set(id, false));
    // Die Lage wird gelesen, solange das Fenster noch existiert; im Testmodus wird keine Lage gemeldet.
    let lastPlacement: WindowPlacement | null = null;
    // Vor dem Schliessen die Arbeit des Kerns (Tabs speichern); danach schliesst sich das Fenster wirklich.
    let closeState: 'open' | 'preparing' | 'ready' = 'open';
    win.on('close', (event) => {
      const handler = this.closeRequestHandler;
      if (handler && closeState !== 'ready') {
        const work = closeState === 'open' ? handler(id) : null;
        // Ohne Arbeit (etwa während Codium endet) schliesst das Fenster sofort; aufgehalten würde das Beenden abbrechen.
        if (closeState === 'open' && work === null) {
          closeState = 'ready';
          lastPlacement = this.placement(id);
          return;
        }
        event.preventDefault();
        if (work !== null) {
          closeState = 'preparing';
          void work
            .catch(() => {})
            .finally(() => {
              closeState = 'ready';
              if (!win.isDestroyed()) win.close();
            });
        }
        return;
      }
      lastPlacement = this.placement(id);
    });
    win.on('closed', () => {
      this.maximized.delete(id);
      for (const listener of this.closedListeners) listener(id, lastPlacement);
    });
    win.on('focus', () => {
      for (const listener of this.focusedListeners) listener(id);
    });
    win.webContents.on('dom-ready', () => {
      for (const listener of this.readyListeners) listener(id);
    });
    win.on('session-end', () => {
      if (this.sessionEnded) return;
      this.sessionEnded = true;
      for (const listener of this.sessionEndListeners) listener();
    });

    win.once('ready-to-show', () => {
      if (hidden) {
        win.showInactive();
        return;
      }
      // Maximiert öffnen: Darunter bleibt die gespeicherte normale Lage, „Wiederherstellen“ führt dorthin.
      if (maximize) win.maximize();
      win.show();
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

  isOpen(windowId: number): boolean {
    const win = BrowserWindow.fromId(windowId);
    return win !== null && !win.isDestroyed();
  }

  placement(windowId: number): WindowPlacement | null {
    if (this.options.testMode.hidden) return null;
    const win = BrowserWindow.fromId(windowId);
    if (!win || win.isDestroyed()) return null;
    // Ein noch nicht gezeigtes oder minimiertes Fenster meldet „nicht maximiert“; dann gilt der gemerkte Zustand.
    const maximized =
      win.isVisible() && !win.isMinimized() ? win.isMaximized() : (this.maximized.get(windowId) ?? false);
    return { bounds: win.getNormalBounds(), maximized };
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

  quit(options: { relaunch?: boolean } = {}): void {
    if (options.relaunch) {
      // Im Testmodus startet nie ein Prozess ausserhalb der Kontrolle des Tests; der Neustart wird nur aufgezeichnet.
      if (this.options.testMode.hidden) this.options.recorder.record('relaunch');
      // app.relaunch merkt nur vor: Gestartet wird erst, wenn dieser Prozess endet und die Sperre freigibt.
      else app.relaunch();
    }
    app.quit();
  }

  onClosed(listener: (windowId: number, lastPlacement: WindowPlacement | null) => void): void {
    this.closedListeners.push(listener);
  }

  onFocused(listener: (windowId: number) => void): void {
    this.focusedListeners.push(listener);
  }

  onReady(listener: (windowId: number) => void): void {
    this.readyListeners.push(listener);
  }

  onSessionEnd(listener: () => void): void {
    this.sessionEndListeners.push(listener);
  }
}
