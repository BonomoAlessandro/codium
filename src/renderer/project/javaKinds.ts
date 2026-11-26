// Art von Java-Dateien in der Oberfläche (Ticket 32): Dateibaum, Datei-Tabs, „Recent Files“ und „Go to File“ zeigen das
// Symbol der Art, der Baum dazu den Namen ohne `.java`. Die Art bestimmt der Kern (`files.javaKinds`); dieses Modul merkt
// sie sich je Pfad für das Projektfenster, ohne DOM.
//
// - Angefragt wird gebündelt (`ensure`): der Baum je gelesenem Ordner, die Tabs und die Suchfenster je Liste. Was schon
//   bekannt oder unterwegs ist, wird nicht noch einmal angefragt, auch nicht nach dem Zu- und Wiederaufklappen eines
//   Ordners: Änderungen meldet der Kern selbst. (Ein neues Anfragen aller Dateien bei jedem Aufklappen staute sich in der
//   Messung vor dem nächsten Ordner, siehe Ticket.)
// - Solange eine Art nicht feststeht, zeigt die Oberfläche das allgemeine Symbol und den vollen Namen.
// - Bekannt ist eine Art samt der Schreibweise des Dateinamens, für den sie gilt: Die Art hängt vom Namen ab, und unter
//   Windows behält ein Umbenennen nur in der Schreibweise (etwa `git mv`) denselben Schlüssel. Weicht der Name ab, gilt
//   die Art als unbekannt und wird neu angefragt (Review).
// - Geänderte Arten meldet der Kern (`files.javaKindsChanged`); eine Antwort, die danach noch eintrifft, zählt für diese
//   Pfade nicht mehr. Gelöschtes wird vergessen, die Pfade eines Ereignisses in einem Durchlauf (Review). Unter einem
//   umbenannten Ordner wandert das Bekannte mit, eine umbenannte Datei wird neu angefragt.

import { createContext, useContext, useSyncExternalStore } from 'react';
import { ancestorIn, FolderIndex, windowsParent } from '../../shared/folderIndex';
import type { CodiumApi, JavaKind, JavaKindEntry } from '../../shared/types';
import { baseName, movedPath, pathKey } from './filePaths';

/** Höchstens so viele Pfade je Anfrage: Bei einem grossen Ordner kommen die ersten Arten so früher an. */
export const JAVA_KINDS_CHUNK = 200;

/** Ob ein Name (oder Pfad) eine Java-Datei ist. */
export function isJavaFileName(name: string): boolean {
  return /\.java$/i.test(name);
}

/** Der Name im Dateibaum: ohne `.java`, sobald eine eindeutige Art feststeht (Ticket 32); sonst der volle Name. */
export function treeName(name: string, kind: JavaKind | undefined): string {
  return kind !== undefined && kind !== 'java' && isJavaFileName(name) ? name.slice(0, -'.java'.length) : name;
}

interface Known {
  /** Der Dateiname in der Schreibweise, für die die Art gilt. */
  name: string;
  kind: JavaKind;
}

export class JavaKindStore {
  private readonly kinds = new Map<string, Known>();
  /** Je Ordner, wie viele bekannte Dateien darunter liegen (zum Vergessen ganzer Ordner). */
  private readonly folders = new FolderIndex(windowsParent);
  /** Unterwegs angefragte Pfade (Schlüssel → Kennung der Anfrage); eine Antwort zählt nur, solange die Kennung gilt. */
  private readonly requested = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private nextRequest = 1;
  /** Zählt jede Änderung, für `useSyncExternalStore`. */
  version = 0;

  constructor(
    private readonly request: (paths: string[]) => Promise<JavaKindEntry[]>,
    private readonly onError: (err: unknown) => void = () => {},
  ) {}

  /** Die bekannte Art einer Datei; `undefined`, solange sie nicht feststeht oder nur für eine andere Schreibweise. */
  kindOf(path: string): JavaKind | undefined {
    const known = this.kinds.get(pathKey(path));
    return known && known.name === baseName(path) ? known.kind : undefined;
  }

  /** Fragt die Art der Java-Dateien unter den Pfaden an, die noch nicht bekannt und nicht unterwegs sind. */
  ensure(paths: readonly string[]): void {
    const wanted = new Map<string, string>();
    for (const path of paths) {
      if (!isJavaFileName(path)) continue;
      const key = pathKey(path);
      if (this.requested.has(key) || wanted.has(key) || this.kindOf(path) !== undefined) continue;
      wanted.set(key, path);
    }
    if (wanted.size === 0) return;
    // Die Teile gehen nacheinander, in der Reihenfolge der Pfade: Die obersten Zeilen eines grossen Ordners bekommen ihr
    // Symbol zuerst. Gleichzeitig abgeschickt reihten sie sich im Kern in zufälliger Folge ein (Messung im Ticket).
    const id = this.nextRequest++;
    for (const key of wanted.keys()) this.requested.set(key, id);
    const all = [...wanted];
    void (async () => {
      for (let start = 0; start < all.length; start += JAVA_KINDS_CHUNK) {
        // Was inzwischen vergessen oder vom Kern gemeldet ist, wird nicht mehr angefragt.
        const chunk = all.slice(start, start + JAVA_KINDS_CHUNK).filter(([key]) => this.requested.get(key) === id);
        if (chunk.length > 0) await this.send(chunk, id);
      }
    })();
  }

  private async send(chunk: Array<[string, string]>, id: number): Promise<void> {
    let entries: JavaKindEntry[];
    try {
      entries = await this.request(chunk.map(([, path]) => path));
    } catch (err) {
      this.onError(err);
      // Nicht immer wieder anfragen: Es gilt das allgemeine Symbol, bis die Datei umbenannt oder gelöscht wird oder das
      // Fenster neu öffnet.
      entries = chunk.map(([, path]) => ({ path, kind: 'java' }));
    }
    const valid = entries.filter((e) => this.requested.get(pathKey(e.path)) === id);
    for (const [key] of chunk) if (this.requested.get(key) === id) this.requested.delete(key);
    this.apply(valid);
  }

  /** Übernimmt Arten (Antwort des Kerns oder `files.javaKindsChanged`). */
  apply(entries: readonly JavaKindEntry[]): void {
    let changed = false;
    for (const { path, kind } of entries) {
      const key = pathKey(path);
      const name = baseName(path);
      const known = this.kinds.get(key);
      if (known?.kind === kind && known.name === name) continue;
      if (!known) this.folders.add(key);
      this.kinds.set(key, { name, kind });
      changed = true;
    }
    if (changed) this.notify();
  }

  /** Vergisst einen Pfad samt allem darunter; eine laufende Anfrage dafür zählt nicht mehr. */
  forget(target: string): void {
    this.forgetAll([target]);
  }

  /**
   * Vergisst Pfade samt allem darunter, in einem Durchlauf: Dateien direkt, Ordner mit bekanntem Inhalt über ihre
   * Elternordner (Einträge × Tiefe, nicht Pfade × Einträge). Laufende Anfragen dafür zählen nicht mehr.
   */
  forgetAll(targets: readonly string[]): void {
    const keys = new Set(targets.map(pathKey));
    if (keys.size === 0) return;
    let changed = false;
    const folders = new Set<string>();
    for (const key of keys) {
      if (this.kinds.delete(key)) {
        this.folders.remove(key);
        changed = true;
      }
      if (this.folders.hasEntriesBelow(key)) folders.add(key);
    }
    if (folders.size > 0) {
      for (const key of [...this.kinds.keys()]) {
        if (this.folders.ancestorIn(key, folders) === null) continue;
        this.kinds.delete(key);
        this.folders.remove(key);
        changed = true;
      }
    }
    for (const key of [...this.requested.keys()]) {
      if (keys.has(key) || ancestorIn(key, keys, windowsParent) !== null) this.requested.delete(key);
    }
    if (changed) this.notify();
  }

  /** Nach dem Umbenennen: Unter einem Ordner wandert das Bekannte mit, eine Datei selbst wird vergessen. */
  moved(from: string, to: string, isDirectory: boolean): void {
    if (!isDirectory) {
      this.forget(from);
      return;
    }
    const fromKey = pathKey(from);
    const within = new Set([fromKey]);
    const moved: JavaKindEntry[] = [];
    for (const [key, known] of this.kinds) {
      if (this.folders.ancestorIn(key, within) === null) continue;
      // Der Schlüssel ist klein geschrieben; der Dateiname behält seine Schreibweise, denn nach ihr fragt `kindOf`.
      const target = movedPath(key, from, to);
      moved.push({ path: target.slice(0, target.length - known.name.length) + known.name, kind: known.kind });
    }
    this.forget(from);
    this.apply(moved);
  }

  /** Meldet sich bei den Ereignissen des Kerns an; liefert eine Funktion zum Abmelden. */
  connect(api: CodiumApi): () => void {
    const offs = [
      api.on('files.javaKindsChanged', (event) => {
        // Eine Antwort auf eine ältere Anfrage, die danach noch eintrifft, darf die Meldung nicht überschreiben.
        for (const entry of event.kinds) this.requested.delete(pathKey(entry.path));
        this.apply(event.kinds);
      }),
      api.on('files.operation', (op) => {
        if (op.kind === 'renamed') this.moved(op.from, op.to, op.isDirectory);
        else if (op.kind === 'deleted') this.forget(op.path);
      }),
      api.on('files.changed', (event) => this.forgetAll(event.changes.filter((c) => c.kind === 'deleted').map((c) => c.path))),
    ];
    return () => {
      for (const off of offs) off();
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify(): void {
    this.version++;
    for (const listener of [...this.listeners]) listener();
  }
}

/** Der Zwischenspeicher des Projektfensters; `null` ausserhalb (etwa in Tests einzelner Teile). */
export const JavaKindsContext = createContext<JavaKindStore | null>(null);

const noSubscription = () => () => {};

/** Der Zwischenspeicher des Projektfensters, ohne neu zu zeichnen, wenn sich eine Art ändert (etwa nur zum Anfragen). */
export function useJavaKindStore(): JavaKindStore | null {
  return useContext(JavaKindsContext);
}

/** Der Zwischenspeicher des Projektfensters; die Komponente zeichnet neu, sobald sich eine Art ändert. */
export function useJavaKinds(): JavaKindStore | null {
  const store = useContext(JavaKindsContext);
  useSyncExternalStore(store ? store.subscribe : noSubscription, () => store?.version ?? 0);
  return store;
}
