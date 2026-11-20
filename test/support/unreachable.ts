// Hilfen für Tests mit nicht erreichbaren Laufwerken, ohne echtes Netz: ein Laufwerksbuchstabe, den es nicht gibt,
// und eine Named Pipe, die nie antwortet. Ein Lesevorgang auf dieser Pipe belegt einen Thread des Threadpools von
// libuv, genau wie eine Abfrage auf ein Netzlaufwerk, das nicht antwortet.

import * as fs from 'node:fs';
import * as net from 'node:net';

/** Ein Laufwerksbuchstabe, unter dem nichts angeschlossen ist (wie ein Netzlaufwerk, das noch nicht verbunden ist). */
export function unusedDriveLetter(): string {
  // Mittlere Buchstaben: Lokale Laufwerke beginnen meist bei C, Netzlaufwerke bei Z.
  const letter = [...'QROPTUVSN'].find((l) => !fs.existsSync(`${l}:\\`));
  if (!letter) throw new Error('Kein freier Laufwerksbuchstabe gefunden.');
  return letter;
}

export interface NeverAnsweringPipe {
  /** Wie viele Lesevorgänge begonnen wurden. */
  readonly reads: number;
  /**
   * Liest von der Pipe, bis sie zugeht, und belegt dabei einen Thread des Threadpools. Scheitert danach wie eine
   * Abfrage auf ein nicht erreichbares Laufwerk.
   */
  hang(): Promise<never>;
  /** Schliesst die Pipe; wartet, bis alle Lesevorgänge zurück und ihre Handles zu sind. */
  close(): Promise<void>;
}

export async function neverAnsweringPipe(): Promise<NeverAnsweringPipe> {
  const pipePath = `\\\\.\\pipe\\codium-test-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(pipePath, resolve));
  const pending: Promise<unknown>[] = [];
  let reads = 0;
  return {
    get reads() {
      return reads;
    },
    hang() {
      reads++;
      const run = (async (): Promise<never> => {
        const handle = await fs.promises.open(pipePath, 'r');
        try {
          await handle.read(Buffer.alloc(1), 0, 1, null);
        } finally {
          await handle.close();
        }
        throw Object.assign(new Error('Laufwerk nicht erreichbar'), { code: 'EHOSTUNREACH' });
      })();
      pending.push(run.catch(() => {}));
      return run;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.all(pending);
    },
  };
}
