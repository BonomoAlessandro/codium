// Nachgemachte Ports für Tests des Kerns (Teststelle 1). Sie zeichnen auf, was der Kern tut, und lassen den
// Test Antworten vorgeben. Dateisystem-Abfragen des Systems laufen echt, damit Tests in Temp-Ordnern Bäume
// aufbauen können.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  Bounds,
  DisplayInfo,
  EventSink,
  FolderPickerPort,
  Ports,
  SecretsPort,
  ShellActionsPort,
  SystemPort,
  WindowOpenOptions,
  WindowPort,
} from '../../src/main/core/ports';
import { NodeSystem } from '../../src/main/system/nodeSystem';

export const PRIMARY_DISPLAY: DisplayInfo = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  primary: true,
};

export class FakeWindowPort implements WindowPort {
  readonly opened: Array<{ windowId: number } & WindowOpenOptions> = [];
  readonly focused: number[] = [];
  readonly closed: number[] = [];
  displayList: DisplayInfo[] = [PRIMARY_DISPLAY];
  private nextId = 1;
  private readonly bounds = new Map<number, Bounds>();
  private readonly closedListeners: Array<(windowId: number) => void> = [];

  open(options: WindowOpenOptions): number {
    const windowId = this.nextId++;
    this.opened.push({ windowId, ...options });
    this.bounds.set(windowId, options.bounds ?? { x: 100, y: 100, width: 1280, height: 800 });
    return windowId;
  }

  focus(windowId: number): void {
    this.focused.push(windowId);
  }

  /** Schliesst ein Fenster so, wie der Nutzer es täte: Die Abmeldung kommt über `onClosed`. */
  close(windowId: number): void {
    if (!this.bounds.has(windowId)) return;
    this.closed.push(windowId);
    this.bounds.delete(windowId);
    for (const listener of this.closedListeners) listener(windowId);
  }

  getBounds(windowId: number): Bounds | null {
    return this.bounds.get(windowId) ?? null;
  }

  setBounds(windowId: number, bounds: Bounds): void {
    if (this.bounds.has(windowId)) this.bounds.set(windowId, bounds);
  }

  displays(): DisplayInfo[] {
    return this.displayList;
  }

  onClosed(listener: (windowId: number) => void): void {
    this.closedListeners.push(listener);
  }

  /** Die offenen Fenster. */
  get openWindowIds(): number[] {
    return [...this.bounds.keys()];
  }
}

export class FakeFolderPicker implements FolderPickerPort {
  /** Vorgegebene Antworten, der Reihe nach; fehlt eine, gilt die Auswahl als abgebrochen. */
  readonly answers: Array<string | null> = [];
  readonly calls: Array<{ windowId?: number; title: string }> = [];

  async pickFolder(options: { windowId?: number; title: string }): Promise<string | null> {
    this.calls.push(options);
    return this.answers.shift() ?? null;
  }
}

/** Umkehrbare Testverschlüsselung: erkennbar, aber nie der Klartext. */
export class FakeSecrets implements SecretsPort {
  async available(): Promise<boolean> {
    return true;
  }

  async encrypt(plain: string): Promise<string> {
    return `fake:${Buffer.from([...plain].reverse().join(''), 'utf8').toString('base64')}`;
  }

  async decrypt(encrypted: string): Promise<string> {
    if (!encrypted.startsWith('fake:')) throw new Error('Nicht mit FakeSecrets verschlüsselt.');
    return [...Buffer.from(encrypted.slice(5), 'base64').toString('utf8')].reverse().join('');
  }
}

/** Papierkorb als Ordner, Explorer aufgezeichnet, Zwischenablage im Speicher. */
export class FakeShellActions implements ShellActionsPort {
  readonly trashed: Array<{ path: string; movedTo: string }> = [];
  readonly shownInExplorer: string[] = [];
  clipboard = '';

  constructor(private readonly trashDir: string) {}

  async trash(targetPath: string): Promise<void> {
    fs.mkdirSync(this.trashDir, { recursive: true });
    const movedTo = path.join(this.trashDir, `${this.trashed.length}-${path.basename(targetPath)}`);
    fs.renameSync(targetPath, movedTo);
    this.trashed.push({ path: targetPath, movedTo });
  }

  showInExplorer(targetPath: string): void {
    this.shownInExplorer.push(targetPath);
  }

  async writeClipboard(text: string): Promise<void> {
    this.clipboard = text;
  }

  async readClipboard(): Promise<string> {
    return this.clipboard;
  }
}

export interface FakeSystemOptions {
  /** Umgebung; ohne Angabe eine leere Umgebung (kein PATH). */
  env?: Record<string, string>;
  /** Programme, die `findProgram` findet: Name ohne Endung → Pfad. */
  programs?: Record<string, string>;
  home?: string;
}

/** System mit vorgegebener Umgebung und vorgegebenen Programmen; Dateisystem-Abfragen laufen echt. */
export class FakeSystem implements SystemPort {
  private readonly real: NodeSystem;
  private readonly programs: Record<string, string>;

  constructor(private readonly options: FakeSystemOptions = {}) {
    this.real = new NodeSystem(options.env ?? {});
    this.programs = Object.fromEntries(
      Object.entries(options.programs ?? {}).map(([name, file]) => [name.toLowerCase(), file]),
    );
  }

  getEnv(name: string): string | undefined {
    return this.real.getEnv(name);
  }

  findProgram(name: string): string | null {
    return this.programs[path.parse(name).name.toLowerCase()] ?? null;
  }

  homeDir(): string {
    return this.options.home ?? 'C:\\Users\\test';
  }

  listDirectories(dir: string): string[] {
    return this.real.listDirectories(dir);
  }

  exists(targetPath: string): boolean {
    return this.real.exists(targetPath);
  }

  readTextFile(file: string): string | null {
    return this.real.readTextFile(file);
  }
}

/** Zeichnet alle Ereignisse an Fenster auf. */
export class FakeEventSink implements EventSink {
  readonly sent: Array<{ windowId: number; name: string; payload: unknown }> = [];

  send(windowId: number, name: string, payload: unknown): void {
    this.sent.push({ windowId, name, payload });
  }

  /** Die Ereignisse, die ein bestimmtes Fenster bekommen hat. */
  forWindow(windowId: number): Array<{ name: string; payload: unknown }> {
    return this.sent.filter((e) => e.windowId === windowId).map(({ name, payload }) => ({ name, payload }));
  }
}

export interface FakePorts extends Ports {
  windows: FakeWindowPort;
  folderPicker: FakeFolderPicker;
  secrets: FakeSecrets;
  shell: FakeShellActions;
  system: FakeSystem;
}

/** Alle Ports nachgemacht. Der Papierkorb liegt im angegebenen Ordner. */
export function createFakePorts(trashDir: string, system: FakeSystemOptions = {}): FakePorts {
  return {
    windows: new FakeWindowPort(),
    folderPicker: new FakeFolderPicker(),
    secrets: new FakeSecrets(),
    shell: new FakeShellActions(trashDir),
    system: new FakeSystem({ programs: { git: 'C:\\Program Files\\Git\\cmd\\git.exe' }, ...system }),
  };
}
