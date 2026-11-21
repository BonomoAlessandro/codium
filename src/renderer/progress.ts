// Laufende Arbeiten des Kerns für die Statusleiste: Fortschritts-Ereignisse zu einer Liste verrechnen und mehrere
// Arbeiten zusammenfassen. Reine Logik ohne DOM, damit sie sich in Node prüfen lässt.

import type { ProgressEvent } from '../shared/types';

/** Eine laufende Arbeit. `fraction` (0 bis 1) fehlt, solange der Stand unbekannt ist. */
export interface RunningWork {
  id: string;
  title: string;
  fraction?: number;
}

/**
 * Verrechnet ein Ereignis mit der Liste: `begin` fügt hinzu, `report` ändert Titel und Stand (ein `report` ohne
 * `fraction` heisst „Stand unbekannt“), `end` entfernt. Ein `report` zu einer unbekannten Arbeit bleibt ohne Wirkung.
 */
export function applyProgress(list: readonly RunningWork[], event: ProgressEvent): RunningWork[] {
  switch (event.kind) {
    case 'begin':
      return [...list.filter((w) => w.id !== event.id), work(event.id, event.title, event.fraction)];
    case 'report':
      return list.map((w) => (w.id === event.id ? work(w.id, event.title ?? w.title, event.fraction) : w));
    case 'end':
      return list.filter((w) => w.id !== event.id);
  }
}

/** Was die Statusleiste zeigt: Text, gemeinsamer Stand (falls bei allen bekannt) und die Titel aller Arbeiten. */
export interface ProgressSummary {
  text: string;
  fraction?: number;
  titles: string[];
}

/**
 * Fasst die laufenden Arbeiten zusammen: eine mit ihrem Titel und Stand; mehrere als „2 processes running“ wie in
 * IntelliJ, mit dem mittleren Stand, wenn er bei allen bekannt ist. `null` ohne laufende Arbeit.
 */
export function summarizeProgress(list: readonly RunningWork[]): ProgressSummary | null {
  if (list.length === 0) return null;
  const titles = list.map((w) => w.title);
  if (list.length === 1) return { text: list[0].title, titles, ...fractionField(list[0].fraction) };
  const known = list.every((w) => w.fraction !== undefined);
  const mean = known ? list.reduce((sum, w) => sum + (w.fraction ?? 0), 0) / list.length : undefined;
  return { text: `${list.length} processes running`, titles, ...fractionField(mean) };
}

function work(id: string, title: string, fraction: number | undefined): RunningWork {
  return { id, title, ...fractionField(fraction) };
}

function fractionField(fraction: number | undefined): { fraction?: number } {
  return fraction === undefined ? {} : { fraction };
}
