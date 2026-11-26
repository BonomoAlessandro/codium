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

  it('lässt nachrangiger Arbeit nie alle Plätze und anderen Zugriffen den Vortritt (Ticket 32)', async () => {
    const limiter = new IoLimiter(3);
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const job = (name: string, background: boolean) => {
      const gate = deferred();
      gates.set(name, gate);
      const work = async () => {
        started.push(name);
        await gate.promise;
      };
      return background ? limiter.runInBackground(work) : limiter.run(work);
    };
    const runs = ['b1', 'b2', 'b3', 'b4'].map((name) => job(name, true));
    await tick();
    // Ein Platz bleibt frei: Ein Zugriff beginnt sofort, obwohl nachrangige Arbeit wartet.
    expect(started).toEqual(['b1', 'b2']);
    runs.push(job('n1', false));
    await tick();
    expect(started).toEqual(['b1', 'b2', 'n1']);

    // Alle Plätze belegt: Ein wartender Zugriff kommt vor der wartenden nachrangigen Arbeit dran.
    runs.push(job('n2', false));
    await tick();
    gates.get('b1')!.resolve();
    await tick();
    expect(started).toEqual(['b1', 'b2', 'n1', 'n2']);

    // Erst wenn kein Zugriff mehr wartet, geht ein frei werdender Platz an nachrangige Arbeit, der Reihe nach.
    gates.get('n1')!.resolve();
    await tick();
    expect(started).toEqual(['b1', 'b2', 'n1', 'n2', 'b3']);
    gates.get('n2')!.resolve();
    await tick();
    expect(started).toEqual(['b1', 'b2', 'n1', 'n2', 'b3']);
    gates.get('b2')!.resolve();
    await tick();
    expect(started).toEqual(['b1', 'b2', 'n1', 'n2', 'b3', 'b4']);

    // Eine gescheiterte nachrangige Arbeit gibt ihren Platz ebenso frei.
    gates.get('b3')!.reject(new Error('gesperrt'));
    gates.get('b4')!.resolve();
    const results = await Promise.allSettled(runs);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    runs.length = 0;
    runs.push(job('n3', false), job('n4', false), job('n5', false));
    await tick();
    expect(started.slice(-3)).toEqual(['n3', 'n4', 'n5']);
    for (const name of ['n3', 'n4', 'n5']) gates.get(name)!.resolve();
    await Promise.all(runs);
  });
});
