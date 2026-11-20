// Verteilt Ereignisse des Kerns in der Oberfläche an ihre Abonnenten. Solange ein Ereignis noch nie einen
// Abonnenten hatte (etwa weil React die Komponente noch nicht gezeigt hat), wird es zurückgehalten und dem ersten
// Abonnenten zugestellt. Danach gibt es kein Zurückhalten mehr: Wer sich abmeldet, will nichts Veraltetes
// nachgeliefert bekommen. Ohne Electron und ohne DOM, damit es sich in Node testen lässt.

export type EventListener = (payload: unknown) => void;

export class EventHub {
  private readonly listeners = new Map<string, Set<EventListener>>();
  private readonly buffers = new Map<string, unknown[]>();
  private readonly everSubscribed = new Set<string>();

  /** @param bufferLimit Höchstzahl zurückgehaltener Ereignisse pro Name; ältere fallen dann weg */
  constructor(private readonly bufferLimit = 100) {}

  /** Stellt ein Ereignis allen Abonnenten zu; hält es zurück, wenn der Name noch nie abonniert wurde. */
  deliver(name: string, payload: unknown): void {
    const listeners = this.listeners.get(name);
    if (listeners && listeners.size > 0) {
      for (const listener of [...listeners]) listener(payload);
      return;
    }
    if (this.everSubscribed.has(name)) return;
    const buffer = this.buffers.get(name) ?? [];
    buffer.push(payload);
    if (buffer.length > this.bufferLimit) buffer.shift();
    this.buffers.set(name, buffer);
  }

  /** Abonniert ein Ereignis; Zurückgehaltenes kommt sofort. Liefert eine Funktion zum Abmelden. */
  subscribe(name: string, listener: EventListener): () => void {
    this.everSubscribed.add(name);
    const listeners = this.listeners.get(name) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(name, listeners);
    const buffered = this.buffers.get(name) ?? [];
    this.buffers.delete(name);
    for (const payload of buffered) listener(payload);
    return () => {
      listeners.delete(listener);
    };
  }
}
