// Testmodus (Ticket 27): Aktivierung der Testfenster und Wächter, ohne Electron.

import { randomUUID } from 'node:crypto';
import * as net from 'node:net';
import { describe, expect, it } from 'vitest';
import { watchTestGuard } from '../../src/main/testGuard';
import { isActivation, readTestMode } from '../../src/main/testMode';

describe('Wächter im Testmodus', () => {
  const pipeName = () => `\\\\.\\pipe\\codium-test-guard-unit-${randomUUID()}`;

  it('liest die Pipe des Wächters aus der Umgebung', () => {
    expect(readTestMode({ CODIUM_TEST_GUARD_PIPE: '\\\\.\\pipe\\x' }).guardPipe).toBe('\\\\.\\pipe\\x');
    expect(readTestMode({}).guardPipe).toBeUndefined();
  });

  it('meldet genau einmal, wenn der Testprozess seine Pipe schliesst, und nicht vorher', async () => {
    const pipe = pipeName();
    let connection: net.Socket | undefined;
    const server = net.createServer((socket) => (connection = socket));
    await new Promise<void>((resolve) => server.listen(pipe, resolve));
    try {
      const reasons: string[] = [];
      watchTestGuard(pipe, (reason) => reasons.push(reason));
      await expect.poll(() => connection !== undefined, { timeout: 5_000 }).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(reasons).toEqual([]);

      connection!.destroy();
      await expect.poll(() => reasons.length, { timeout: 5_000 }).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(reasons).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it('meldet sofort, wenn es die Pipe nicht (mehr) gibt', async () => {
    const reasons: string[] = [];
    watchTestGuard(pipeName(), (reason) => reasons.push(reason));
    await expect.poll(() => reasons.length, { timeout: 5_000 }).toBe(1);
    expect(reasons[0]).toMatch(/nicht erreichbar/);
  });
});

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
