// Fehlertexte für Hinweise der Oberfläche. Ohne DOM, damit es sich in Node testen lässt.

import { CodiumError, isKnownErrorCode } from '../shared/types';

/** Allgemeiner Text für einen Fehler ohne bekannten Code. */
export const GENERIC_ERROR_TEXT = 'Something went wrong. Please try again.';

/**
 * Text eines gescheiterten Befehls für einen Hinweis: die englische Meldung bei einem bekannten Code, sonst der
 * allgemeine Text. Interne Meldungen sind nicht für Nutzer gedacht und landen nur in der Konsole der Seite.
 */
export function errorText(err: unknown): string {
  if (err instanceof CodiumError && isKnownErrorCode(err.code)) return err.message;
  console.error(err);
  return GENERIC_ERROR_TEXT;
}
