// Regeln für Meldungen unten rechts. Ohne DOM, damit sie sich in Node prüfen lassen.

import type { Notice } from '../shared/types';

/** So lange bleiben Erfolg und Information stehen. */
export const NOTICE_TIMEOUT_MS = 5000;

/**
 * Wann eine Meldung von selbst verschwindet: Erfolg und Information nach `NOTICE_TIMEOUT_MS`, Fehler nie (`null`),
 * damit kein Fehler übersehen wird.
 */
export function noticeTimeout(level: Notice['level']): number | null {
  return level === 'error' ? null : NOTICE_TIMEOUT_MS;
}
