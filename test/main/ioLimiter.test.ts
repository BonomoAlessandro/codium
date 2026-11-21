// Die Warteschlange für Dateizugriffe eines Projekts: Hängende Zugriffe belegen höchstens so viele Threads, wie sie
// gleichzeitig zulässt; ein frei werdender Platz geht der Reihe nach an den nächsten.

import { describe, expect, it } from 'vitest';
import { IoLimiter } from '../../src/main/core/ioLimiter';

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('Warteschlange für Dateizugriffe', () => {
  it('lässt höchstens die erlaubte Zahl gleichzeitig laufen, die übrigen der Reihe nach', async () => {
    const limiter = new IoLimiter(2);
    const gates = Array.from({ length: 5 }, deferred);
    const started: number[] = [];
    let active = 0;
    let most = 0;
    const runs = gates.map((gate, i) =>
      limiter.run(async () => {
        started.push(i);
        active++;
        most = Math.max(most, active);
        try {
          await gate.promise;
        } finally {
          active--;
        }
      }),
    );
    await tick();
    expect(started).toEqual([0, 1]);

    // Ein gescheiterter Zugriff gibt seinen Platz genauso frei.
    gates[1].reject(new Error('Netzwerkfehler'));
    await expect(runs[1]).rejects.toThrow('Netzwerkfehler');
    await tick();
    expect(started).toEqual([0, 1, 2]);

    // Neue Zugriffe drängeln sich nicht vor die wartenden.
    const late = deferred();
    runs.push(limiter.run(() => late.promise.then(() => void started.push(5))));
    gates[0].resolve();
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);

    gates[2].resolve();
    gates[3].resolve();
    gates[4].resolve();
    late.resolve();
    await Promise.allSettled(runs);
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    expect(most).toBe(2);
  });
});
