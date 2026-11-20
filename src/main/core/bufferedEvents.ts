// Ereignisse an Fenster, deren Seite noch nicht bereit ist, gehen sonst verloren (etwa eine Meldung direkt nach
// dem Öffnen). Dieser Puffer hält sie pro Fenster zurück, bis das Fenster „bereit“ meldet. Lädt nie Electron.

import type { EventSink } from './ports';

interface Pending {
  name: string;
  payload: unknown;
}

export class BufferedEventSink implements EventSink {
  private readonly ready = new Set<number>();
  private readonly queues = new Map<number, Pending[]>();

  constructor(
    private readonly inner: EventSink,
    /** Höchstzahl zurückgehaltener Ereignisse pro Fenster; ältere fallen dann weg. */
    private readonly limit = 500,
  ) {}

  send(windowId: number, name: string, payload: unknown): void {
    if (this.ready.has(windowId)) {
      this.inner.send(windowId, name, payload);
      return;
    }
    const queue = this.queues.get(windowId) ?? [];
    queue.push({ name, payload });
    if (queue.length > this.limit) queue.shift();
    this.queues.set(windowId, queue);
  }

  /** Das Fenster ist bereit: zurückgehaltene Ereignisse in ihrer Reihenfolge zustellen, neue direkt. */
  markReady(windowId: number): void {
    this.ready.add(windowId);
    const queue = this.queues.get(windowId) ?? [];
    this.queues.delete(windowId);
    for (const { name, payload } of queue) this.inner.send(windowId, name, payload);
  }

  /** Das Fenster ist zu: nichts mehr zustellen, nichts mehr zurückhalten. */
  forget(windowId: number): void {
    this.ready.delete(windowId);
    this.queues.delete(windowId);
  }
}
