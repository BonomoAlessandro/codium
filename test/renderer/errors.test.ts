import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorText, GENERIC_ERROR_TEXT } from '../../src/renderer/errors';
import { CodiumError, ErrorCode } from '../../src/shared/types';

describe('Fehlertexte der Oberfläche', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('zeigt die Meldung eines Fehlers mit bekanntem Code', () => {
    expect(errorText(new CodiumError('Folder not found: C:\\x', ErrorCode.projectNotFound))).toBe('Folder not found: C:\\x');
  });

  it('zeigt für interne Fehler einen allgemeinen Text und schreibt die Einzelheiten in die Konsole', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(errorText(new CodiumError('Fenster 3 ist nicht mehr offen.'))).toBe(GENERIC_ERROR_TEXT);
    expect(errorText(new CodiumError('verweigert', 'GIBT_ES_NICHT'))).toBe(GENERIC_ERROR_TEXT);
    expect(errorText(new Error('kaputt'))).toBe(GENERIC_ERROR_TEXT);
    expect(consoleError).toHaveBeenCalledTimes(3);
  });
});
