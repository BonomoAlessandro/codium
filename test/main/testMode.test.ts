// Testmodus (Ticket 27): reine Logik, ohne Electron.

import { describe, expect, it } from 'vitest';
import { isActivation } from '../../src/main/testMode';

/** wParam, wie Electron es an einen Fensterhaken gibt: ein Puffer in Zeigergrösse (8 Byte unter x64). */
function wParam(low: number, high = 0): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt16LE(low, 0);
  buffer.writeUInt16LE(high, 2);
  return buffer;
}

describe('Aktivierung eines Testfensters (WM_ACTIVATE)', () => {
  it('erkennt WA_ACTIVE und WA_CLICKACTIVE als Aktivierung, auch bei gesetztem oberen Wort (minimiert)', () => {
    expect(isActivation(wParam(1))).toBe(true);
    expect(isActivation(wParam(2))).toBe(true);
    expect(isActivation(wParam(1, 1))).toBe(true);
  });

  it('nimmt WA_INACTIVE und unvollständige Puffer nicht als Aktivierung', () => {
    expect(isActivation(wParam(0))).toBe(false);
    expect(isActivation(wParam(0, 1))).toBe(false);
    expect(isActivation(Buffer.alloc(0))).toBe(false);
  });
});
