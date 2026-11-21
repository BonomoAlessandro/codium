// Begrenzt, wie viele Dateizugriffe eines Projekts gleichzeitig laufen. Ein asynchroner Dateizugriff belegt einen
// Thread im Threadpool von libuv, bis das Laufwerk antwortet; hängt ein Netzlaufwerk, bliebe der Thread lange
// belegt. Mit der Grenze belegt ein hängendes Projekt nur wenige Threads, und andere Projekte und der Kern bleiben
// bedienbar (siehe auch folderQueries.ts und earlyStart.ts). Lädt nie Electron.

export class IoLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  /** Führt einen Zugriff aus, sobald ein Platz frei ist; ein frei werdender Platz geht direkt an den nächsten. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active < this.max) this.active++;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
