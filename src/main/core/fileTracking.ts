// Was der Datei-Dienst über den Projektordner weiss, um Dateiereignisse richtig zu deuten. Lädt nie Electron.
//
// - KnownDirs: der Inhalt der Ordner, die schon gelesen wurden (der Dateibaum liest nur aufgeklappte). Daraus folgt,
//   ob es einen Pfad vor einem Ereignis gab (angelegt oder geändert?), und nach einem Ereignis ohne Dateinamen lassen
//   sich genau diese Ordner neu einlesen und vergleichen.
// - OwnChanges: was Codium selbst gerade verändert. Die Überwachung sieht auch eigene Dateioperationen; die meldet
//   aber schon `files.operation`, als Änderung von aussen sollen sie nicht noch einmal erscheinen.

import type * as fs from 'node:fs';
import * as path from 'node:path';
import { isKeyWithin } from './projectPath';

/** Schlüssel eines schon normalisierten Pfads oder Namens: unter Windows ohne Gross-/Kleinschreibung. */
export function keyOf(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

export interface KnownEntry {
  name: string;
  isDirectory: boolean;
}

interface KnownDir {
  path: string;
  entries: Map<string, KnownEntry>;
}

/** Höchstzahl gemerkter Ordner; die am längsten nicht gelesenen fallen dann weg. */
const KNOWN_DIRS_LIMIT = 20_000;

export class KnownDirs {
  private readonly dirs = new Map<string, KnownDir>();

  /** Merkt sich den Inhalt eines Ordners, wie er gerade gelesen wurde. */
  remember(dir: string, entries: readonly KnownEntry[]): void {
    const key = keyOf(dir);
    this.dirs.delete(key);
    this.dirs.set(key, { path: dir, entries: new Map(entries.map((e) => [keyOf(e.name), { name: e.name, isDirectory: e.isDirectory }])) });
    if (this.dirs.size > KNOWN_DIRS_LIMIT) {
      const oldest = this.dirs.keys().next().value;
      if (oldest !== undefined) this.dirs.delete(oldest);
    }
  }

  /** Ob es den Pfad zuletzt gab: ja oder nein, wenn sein Ordner gelesen wurde, sonst `undefined`. */
  existed(target: string): boolean | undefined {
    return this.dirs.get(keyOf(path.dirname(target)))?.entries.has(keyOf(path.basename(target)));
  }

  /** Trägt ein, ob es einen Pfad jetzt gibt. Ein verschwundener Ordner wird mit allem darunter vergessen. */
  update(target: string, exists: boolean, isDirectory: boolean): void {
    const dir = this.dirs.get(keyOf(path.dirname(target)));
    const name = path.basename(target);
    const wasDirectory = dir?.entries.get(keyOf(name))?.isDirectory ?? false;
    if (dir && exists) dir.entries.set(keyOf(name), { name, isDirectory });
    else if (dir) dir.entries.delete(keyOf(name));
    if ((!exists || !isDirectory) && (wasDirectory || this.dirs.has(keyOf(target)))) this.forget(target);
  }

  /** Vergisst einen Ordner und alle gemerkten Ordner darunter. */
  forget(target: string): void {
    const key = keyOf(target);
    for (const dirKey of [...this.dirs.keys()]) if (isKeyWithin(dirKey, key)) this.dirs.delete(dirKey);
  }

  /** Die gemerkten Ordner mit ihrem zuletzt bekannten Inhalt. */
  all(): Array<{ path: string; entries: KnownEntry[] }> {
    return [...this.dirs.values()].map((d) => ({ path: d.path, entries: [...d.entries.values()] }));
  }
}

/** Was sich an einer Datei zuletzt geändert hat; gleiche Werte heissen: noch der eigene Stand. */
interface StatStamp {
  mtimeMs: number;
  size: number;
}

interface Expectation {
  key: string;
  /** Ob es den Pfad nach der eigenen Operation gibt. */
  exists: boolean;
  /** Gilt auch für alles darunter (Ordner). */
  subtree: boolean;
  stamp?: StatStamp;
  /** Bis wann Ereignisse dazu noch als eigene gelten; `Infinity`, solange die Operation läuft. */
  until: number;
}

/** Eine angemeldete eigene Änderung. */
export interface OwnChange {
  /** Die Operation ist fertig (oder gescheitert); ab jetzt läuft die Frist. Mit Stand der Datei, falls bekannt. */
  settle(stat?: fs.Stats | null): void;
}

/** So lange nach einer eigenen Operation gelten passende Ereignisse noch als eigene. */
export const OWN_CHANGE_WINDOW_MS = 3000;

export class OwnChanges {
  private expectations: Expectation[] = [];

  constructor(
    private readonly windowMs = OWN_CHANGE_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Meldet an, dass Codium einen Pfad gleich anlegt bzw. entfernt, wahlweise mit allem darunter. */
  expect(target: string, exists: boolean, subtree: boolean): OwnChange {
    const expectation: Expectation = { key: keyOf(target), exists, subtree, until: Number.POSITIVE_INFINITY };
    this.prune();
    this.expectations.push(expectation);
    return {
      settle: (stat) => {
        if (stat && stat.isFile()) expectation.stamp = { mtimeMs: stat.mtimeMs, size: stat.size };
        expectation.until = this.now() + this.windowMs;
      },
    };
  }

  /**
   * Ob eine festgestellte Änderung von einer eigenen Operation stammt. Massgeblich ist die jüngste passende
   * Anmeldung. Eine geänderte Datei gilt nur dann als eigene, wenn sie noch den Stand nach der Operation hat; so geht
   * eine fremde Änderung kurz danach nicht verloren.
   */
  isOwn(change: { path: string; kind: 'created' | 'changed' | 'deleted' }, stat?: fs.Stats | null): boolean {
    this.prune();
    const key = keyOf(change.path);
    const match = this.expectations.findLast((e) => e.key === key || (e.subtree && isKeyWithin(key, e.key)));
    if (!match) return false;
    if (change.kind === 'deleted') return !match.exists;
    if (!match.exists) return false;
    if (change.kind === 'created' || match.key !== key || !match.stamp) return true;
    return !!stat && stat.mtimeMs === match.stamp.mtimeMs && stat.size === match.stamp.size;
  }

  /** Vergisst Anmeldungen, deren Frist abgelaufen ist. */
  private prune(): void {
    const now = this.now();
    this.expectations = this.expectations.filter((e) => e.until > now);
  }
}
