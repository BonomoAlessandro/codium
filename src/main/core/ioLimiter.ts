// Begrenzt, wie viele Dateizugriffe eines Projekts gleichzeitig laufen. Ein asynchroner Dateizugriff belegt einen
// Thread im Threadpool von libuv, bis das Laufwerk antwortet; hängt ein Netzlaufwerk, bliebe der Thread lange
// belegt. Mit der Grenze belegt ein hängendes Projekt nur wenige Threads, und andere Projekte und der Kern bleiben
// bedienbar (siehe auch folderQueries.ts und earlyStart.ts). Lädt nie Electron.
//
// Nachrangige Arbeit (etwa das Bestimmen der Art von Tausenden Java-Dateien, Ticket 32) teilt dieselbe Grenze, lässt
// aber anderen Zugriffen den Vortritt: Sie beginnt nur, wenn kein anderer Zugriff wartet, und belegt ab zwei Plätzen nie
// alle.
// So verzögert sie etwa das Lesen eines Ordners beim Aufklappen höchstens um einen laufenden Zugriff.

export class IoLimiter {
  private active = 0;
  private activeBackground = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly waitingBackground: Array<() => void> = [];
  /**
   * So viele Plätze darf nachrangige Arbeit höchstens belegen: einen weniger als alle, damit einer für andere Zugriffe
   * frei bleibt; bei nur einem Platz (`max` 1) diesen einen (Review).
   */
  private readonly maxBackground: number;

  constructor(private readonly max: number) {
    this.maxBackground = Math.max(1, max - 1);
  }

  /** Führt einen Zugriff aus, sobald ein Platz frei ist; ein frei werdender Platz geht direkt an den nächsten. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active < this.max) this.active++;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  /**
   * Führt nachrangige Arbeit aus: erst, wenn kein anderer Zugriff wartet und ein Platz für nachrangige Arbeit frei
   * ist; untereinander der Reihe nach.
   */
  async runInBackground<T>(work: () => Promise<T>): Promise<T> {
    if (this.active < this.max && this.activeBackground < this.maxBackground && this.waiting.length === 0 && this.waitingBackground.length === 0) {
      this.active++;
      this.activeBackground++;
    } else {
      await new Promise<void>((resolve) => this.waitingBackground.push(resolve));
    }
    try {
      return await work();
    } finally {
      this.activeBackground--;
      this.release();
    }
  }

  /** Gibt einen Platz frei: zuerst an einen wartenden Zugriff, sonst an wartende nachrangige Arbeit. */
  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
      return;
    }
    if (this.waitingBackground.length > 0 && this.activeBackground < this.maxBackground) {
      this.activeBackground++;
      this.waitingBackground.shift()!();
      return;
    }
    this.active--;
  }
}
