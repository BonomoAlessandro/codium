// Eine JSON-Zustandsdatei mit Schemaversion: entprellt und atomar geschrieben, eine kaputte Datei wird
// beiseitegelegt statt überschrieben. Was im Zustand steht, entscheidet der Kern. Lädt nie Electron.

import * as fs from 'node:fs';
import * as path from 'node:path';

const DEFAULT_DEBOUNCE_MS = 200;

/** Jeder gespeicherte Zustand trägt seine Schemaversion. */
export interface Versioned {
  schemaVersion: number;
}

export interface StateFileOptions {
  /** Wartezeit nach der letzten Änderung, bis geschrieben wird. */
  debounceMs?: number;
  /** Wird aufgerufen, wenn eine kaputte Datei beiseitegelegt wurde. */
  onCorrupt?: (backupFile: string, reason: string) => void;
}

export class StateFile<T extends Versioned> {
  private pending: T | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;

  /**
   * @param file Pfad der Zustandsdatei
   * @param schemaVersion die Version, die dieser Stand der App schreibt und lesen kann
   * @param defaults liefert den leeren Zustand; fehlende Felder einer gelesenen Datei kommen von hier
   */
  constructor(
    readonly file: string,
    private readonly schemaVersion: number,
    private readonly defaults: () => T,
    private readonly options: StateFileOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /**
   * Liest den Zustand. Fehlt die Datei, kommt der leere Zustand. Ist sie kaputt (kein JSON-Objekt, keine
   * oder eine unbekannte Schemaversion), wird sie beiseitegelegt und der leere Zustand geliefert.
   */
  load(): T {
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch {
      return this.defaults();
    }
    let reason: string;
    try {
      // Ein BOM (etwa nach Bearbeiten im Editor) ist kein Grund, die Datei zu verwerfen.
      const parsed: unknown = JSON.parse(raw.replace(/^﻿/, ''));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        reason = 'kein JSON-Objekt';
      } else if ((parsed as Partial<Versioned>).schemaVersion !== this.schemaVersion) {
        reason = `Schemaversion ${String((parsed as Partial<Versioned>).schemaVersion)} statt ${this.schemaVersion}`;
      } else {
        return { ...this.defaults(), ...(parsed as T) };
      }
    } catch (err) {
      reason = `kein gültiges JSON (${(err as Error).message})`;
    }
    const backup = `${this.file}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(this.file, backup);
    } catch {
      fs.copyFileSync(this.file, backup);
    }
    this.options.onCorrupt?.(backup, reason);
    return this.defaults();
  }

  /** Merkt den Zustand vor und schreibt ihn nach der Wartezeit. */
  save(state: T): void {
    this.pending = state;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.writePending();
    }, this.debounceMs);
  }

  /** Schreibt einen vorgemerkten Zustand sofort, etwa beim Beenden. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.writePending();
  }

  private writePending(): void {
    if (!this.pending) return;
    const state = this.pending;
    this.pending = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    // Atomar: erst eine Temp-Datei daneben, dann umbenennen. Ein Absturz mitten im Schreiben hinterlässt so
    // nie eine halbe Zustandsdatei.
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, this.file);
  }
}
