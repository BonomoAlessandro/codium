// Eine JSON-Zustandsdatei mit Schemaversion: entprellt und atomar geschrieben. Eine kaputte Datei wird
// beiseitegelegt statt überschrieben, eine unlesbare oder neuere Datei wird gar nicht angefasst. Was im Zustand
// steht, entscheidet der Kern. Lädt nie Electron.

import * as fs from 'node:fs';
import * as path from 'node:path';

const DEFAULT_DEBOUNCE_MS = 200;
/** Fehler, die unter Windows meist nur vorübergehend sind (Virenscanner, Editor hält die Datei kurz offen). */
const TRANSIENT_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

/** Jeder gespeicherte Zustand trägt seine Schemaversion. */
export interface Versioned {
  schemaVersion: number;
}

export interface StateFileOptions<T> {
  /** Wartezeit nach der letzten Änderung, bis geschrieben wird. */
  debounceMs?: number;
  /**
   * Prüft die Felder einer gelesenen Datei und ergänzt Fehlendes. Ungültige Felder werden ersetzt, nicht
   * übernommen. Ohne Angabe werden die Felder flach über den leeren Zustand gelegt.
   */
  normalize?: (raw: Record<string, unknown>) => T;
  /** Wird aufgerufen, wenn eine kaputte Datei beiseitegelegt wurde. */
  onCorrupt?: (backupFile: string, reason: string) => void;
  /** Meldet Lese- und Schreibfehler, die den Zustand nicht oder nicht vollständig sichern. */
  onError?: (message: string) => void;
  /** Wiederholungen bei vorübergehenden Dateifehlern. */
  retries?: number;
  retryDelayMs?: number;
}

export class StateFile<T extends Versioned> {
  private pending: T | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** Gesperrt: Die Datei auf der Festplatte darf nicht überschrieben werden (unlesbar oder neuer). */
  private blocked = false;
  private readonly debounceMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  /**
   * @param file Pfad der Zustandsdatei
   * @param schemaVersion die Version, die dieser Stand der App schreibt und lesen kann
   * @param defaults liefert den leeren Zustand
   */
  constructor(
    readonly file: string,
    private readonly schemaVersion: number,
    private readonly defaults: () => T,
    private readonly options: StateFileOptions<T> = {},
  ) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.retries = options.retries ?? 5;
    this.retryDelayMs = options.retryDelayMs ?? 50;
  }

  /**
   * Liest den Zustand.
   * - Fehlt die Datei, kommt der leere Zustand.
   * - Ist sie kaputt (kein JSON-Objekt, keine oder eine ältere Schemaversion), wird sie beiseitegelegt.
   * - Ist sie unlesbar oder von einer neueren Version der App, bleibt sie unberührt: Codium startet mit dem
   *   leeren Zustand und schreibt diese Datei nicht.
   */
  load(): T {
    let raw: string;
    try {
      raw = this.withRetries(() => fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return this.defaults();
      this.block(`Zustandsdatei ${this.file} ist nicht lesbar (${(err as Error).message}); sie wird nicht überschrieben.`);
      return this.defaults();
    }
    let parsed: unknown;
    try {
      // Ein BOM (etwa nach Bearbeiten im Editor) ist kein Grund, die Datei zu verwerfen.
      parsed = JSON.parse(raw.replace(/^﻿/, ''));
    } catch (err) {
      return this.quarantine(`kein gültiges JSON (${(err as Error).message})`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return this.quarantine('kein JSON-Objekt');
    const version = (parsed as Partial<Versioned>).schemaVersion;
    if (typeof version === 'number' && version > this.schemaVersion) {
      this.block(
        `Zustandsdatei ${this.file} stammt von einer neueren Version (Schema ${version}); sie wird nicht überschrieben.`,
      );
      return this.defaults();
    }
    if (version !== this.schemaVersion) return this.quarantine(`Schemaversion ${String(version)} statt ${this.schemaVersion}`);
    const record = parsed as Record<string, unknown>;
    return this.options.normalize ? this.options.normalize(record) : { ...this.defaults(), ...(record as Partial<T>) };
  }

  /** Merkt den Zustand vor und schreibt ihn nach der Wartezeit. */
  save(state: T): void {
    if (this.blocked) return;
    this.pending = state;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.writePending();
    }, this.debounceMs);
  }

  /** Schreibt einen vorgemerkten Zustand sofort, etwa beim Beenden. Wirft nie. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.writePending();
  }

  private writePending(): void {
    if (!this.pending || this.blocked) return;
    const state = this.pending;
    this.pending = null;
    // Atomar: erst eine Temp-Datei daneben, dann umbenennen. Ein Absturz mitten im Schreiben hinterlässt so nie
    // eine halbe Zustandsdatei.
    const temp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      this.withRetries(() => fs.renameSync(temp, this.file));
    } catch (err) {
      try {
        fs.rmSync(temp, { force: true });
      } catch {
        // Die Temp-Datei ist nur ein Rest; der nächste Versuch überschreibt sie.
      }
      // Der Stand bleibt vorgemerkt, damit der nächste Speichervorgang ihn noch einmal versucht, ausser es kam
      // inzwischen ein neuerer.
      this.pending ??= state;
      this.options.onError?.(`Zustandsdatei ${this.file} konnte nicht geschrieben werden: ${(err as Error).message}`);
    }
  }

  private quarantine(reason: string): T {
    const backup = `${this.file}.corrupt-${Date.now()}`;
    try {
      this.withRetries(() => fs.renameSync(this.file, backup));
    } catch {
      try {
        fs.copyFileSync(this.file, backup);
      } catch (err) {
        this.block(`Kaputte Zustandsdatei ${this.file} (${reason}) liess sich nicht sichern: ${(err as Error).message}`);
        return this.defaults();
      }
    }
    this.options.onCorrupt?.(backup, reason);
    return this.defaults();
  }

  private block(message: string): void {
    this.blocked = true;
    this.options.onError?.(message);
  }

  /** Führt eine Dateioperation aus und wiederholt sie bei vorübergehenden Fehlern einige Male. */
  private withRetries<R>(operation: () => R): R {
    for (let attempt = 0; ; attempt++) {
      try {
        return operation();
      } catch (err) {
        if (attempt >= this.retries || !TRANSIENT_CODES.has((err as NodeJS.ErrnoException).code ?? '')) throw err;
        sleepSync(this.retryDelayMs);
      }
    }
  }
}

/** Wartet synchron; nur für kurze Pausen zwischen Dateiversuchen. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
