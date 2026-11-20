// Ports: die schmalen Schnittstellen, über die der Kern Electron- und Systemfunktionen nutzt.
// Im Betrieb echt (Electron bzw. Node), in den Tests nachgemacht. Dieses Modul und der Kern laden nie Electron.

/** Lage und Grösse eines Fensters oder Bildschirmbereichs in Bildschirmpunkten. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Ein angeschlossener Bildschirm. */
export interface DisplayInfo {
  id: number;
  bounds: Bounds;
  /** Nutzbarer Bereich ohne Taskleiste. */
  workArea: Bounds;
  primary: boolean;
}

/** Was für ein Fenster geöffnet wird. */
export type WindowKind = 'welcome' | 'project';

export interface WindowOpenOptions {
  kind: WindowKind;
  /** Fenstertitel, etwa „Projektname – Codium“. */
  title: string;
  /** Gespeicherte Lage; ohne sie wählt das Fenster eine Standardgrösse. */
  bounds?: Bounds;
}

/** Fenster öffnen, nach vorne holen, schliessen; Lage; angeschlossene Bildschirme. */
export interface WindowPort {
  /** Öffnet ein Fenster und liefert seine Kennung. */
  open(options: WindowOpenOptions): number;
  /** Holt ein Fenster nach vorne (im Testmodus nur aufgezeichnet). */
  focus(windowId: number): void;
  /** Schliesst ein Fenster. */
  close(windowId: number): void;
  /** Normale Lage und Grösse (auch im maximierten Zustand), `null` für ein unbekanntes Fenster. */
  getBounds(windowId: number): Bounds | null;
  setBounds(windowId: number, bounds: Bounds): void;
  displays(): DisplayInfo[];
  /**
   * Meldet, wenn ein Fenster geschlossen wurde, mit seiner letzten normalen Lage (gelesen, solange es noch
   * existierte). Im Testmodus ist die Lage `null`, weil Fenster dort ihre Lage nicht speichern.
   */
  onClosed(listener: (windowId: number, lastBounds: Bounds | null) => void): void;
  /** Meldet, wenn ein Fenster den Fokus bekommt (für „zuletzt benutztes Fenster“). */
  onFocused(listener: (windowId: number) => void): void;
  /** Meldet, wenn die Seite eines Fensters geladen und bereit für Ereignisse ist (auch nach Neuladen). */
  onReady(listener: (windowId: number) => void): void;
  /** Meldet einmal, wenn Windows die Sitzung beendet (Abmelden, Herunterfahren). */
  onSessionEnd(listener: () => void): void;
}

/** Der Ordnerdialog von Windows (im Testmodus über `CODIUM_TEST_PICK_DIR`). */
export interface FolderPickerPort {
  /** Liefert den gewählten Ordner oder `null`, wenn die Auswahl abgebrochen wurde. */
  pickFolder(options: { windowId?: number; title: string }): Promise<string | null>;
}

/** Text mit der Verschlüsselung von Windows für das Benutzerkonto ver- und entschlüsseln. */
export interface SecretsPort {
  available(): Promise<boolean>;
  /** Verschlüsselt und liefert das Ergebnis als Base64. */
  encrypt(plain: string): Promise<string>;
  /** Entschlüsselt einen Base64-Wert aus `encrypt`. */
  decrypt(encrypted: string): Promise<string>;
}

/** Papierkorb, Explorer, Zwischenablage, Browser (im Testmodus nachgebildet bzw. aufgezeichnet). */
export interface ShellActionsPort {
  /** Öffnet eine Web-Adresse (http, https, mailto) im Standardbrowser bzw. Mailprogramm. */
  openExternal(url: string): Promise<void>;
  /** Verschiebt eine Datei oder einen Ordner in den Papierkorb. */
  trash(targetPath: string): Promise<void>;
  /** Zeigt eine Datei markiert im Explorer. */
  showInExplorer(targetPath: string): void;
  writeClipboard(text: string): Promise<void>;
  readClipboard(): Promise<string>;
}

/** Systemabfragen. Die echte Umsetzung kommt ohne Electron aus. */
export interface SystemPort {
  /** Umgebungsvariable, ohne Unterscheidung der Gross-/Kleinschreibung des Namens. */
  getEnv(name: string): string | undefined;
  /** Vollständiger Pfad eines Programms im PATH (mit den Endungen aus PATHEXT), sonst `null`. */
  findProgram(name: string): string | null;
  homeDir(): string;
  /** Namen der Unterordner eines Ordners; leer, wenn er fehlt oder nicht lesbar ist. */
  listDirectories(dir: string): string[];
  exists(targetPath: string): boolean;
  /** Inhalt einer Textdatei (UTF-8) oder `null`, wenn sie fehlt oder nicht lesbar ist. */
  readTextFile(file: string): string | null;
}

/** Alle Ports zusammen, so wie der Kern sie bekommt. */
export interface Ports {
  windows: WindowPort;
  folderPicker: FolderPickerPort;
  secrets: SecretsPort;
  shell: ShellActionsPort;
  system: SystemPort;
}

/** Zustellung von Ereignissen an genau ein Fenster. */
export interface EventSink {
  send(windowId: number, name: string, payload: unknown): void;
}
