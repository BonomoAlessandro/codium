// Fortschritt laufender Arbeiten des Kerns (Git-Aktionen mit Netzwerk, Import durch Sprachserver, Klonen,
// Speichern eines Änderungssatzes) für die Statusleiste eines Fensters. Lädt nie Electron.

import type { ProgressEvent } from '../../shared/types';

/** Eine laufende Arbeit. Nach `end` bewirken weitere Aufrufe nichts mehr. */
export interface Progress {
  /** Meldet den Stand (0 bis 1, ohne Angabe unbekannt) und wahlweise einen neuen Titel. */
  report(update: { fraction?: number; title?: string }): void;
  /** Die Arbeit ist fertig, erfolgreich oder nicht. Darf mehrmals aufgerufen werden. */
  end(): void;
}

/** Kennungen sind im ganzen Hauptprozess eindeutig, damit sich Arbeiten verschiedener Melder nie überschneiden. */
let nextId = 1;

/** Meldet Arbeiten an ein Fenster; wohin, bestimmt die übergebene Zustellung. */
export class ProgressReporter {
  constructor(private readonly emit: (event: ProgressEvent) => void) {}

  /** Beginnt eine Arbeit mit Titel (etwa „Pushing…“) und wahlweise einem ersten Stand. */
  begin(title: string, fraction?: number): Progress {
    const id = `progress-${nextId++}`;
    let ended = false;
    this.emit({ kind: 'begin', id, title, ...fractionField(fraction) });
    return {
      report: ({ fraction: value, title: newTitle }) => {
        if (ended) return;
        this.emit({ kind: 'report', id, ...(newTitle === undefined ? {} : { title: newTitle }), ...fractionField(value) });
      },
      end: () => {
        if (ended) return;
        ended = true;
        this.emit({ kind: 'end', id });
      },
    };
  }

  /** Führt eine Arbeit mit Fortschritt aus; das Ende wird immer gemeldet, auch wenn die Arbeit scheitert. */
  async run<T>(title: string, work: (progress: Progress) => T | Promise<T>): Promise<T> {
    const progress = this.begin(title);
    try {
      return await work(progress);
    } finally {
      progress.end();
    }
  }
}

/** Der Stand als Feld der Nachricht, begrenzt auf 0 bis 1; ohne brauchbare Zahl gar kein Feld (unbekannt). */
function fractionField(fraction: number | undefined): { fraction?: number } {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return {};
  return { fraction: Math.min(1, Math.max(0, fraction)) };
}
