// Testmodus der echten App für automatische Prüfungen (Agenten, Playwright). Lädt nie Electron.
//
// - CODIUM_TEST_HIDDEN=1: Fenster ausserhalb des Bildschirms, ohne Aktivierung und ohne Taskleisten-Eintrag;
//   „nach vorne holen“, Explorer und Zwischenablage werden nicht ausgeführt, sondern aufgezeichnet; der
//   Papierkorb ist ein Ordner im Datenordner.
// - CODIUM_TEST_DATA_DIR: ersetzt %APPDATA% als Wurzel des Datenordners (eigene Daten, eigene Einzelinstanz).
// - CODIUM_TEST_PICK_DIR: Antwort auf jede Ordnerauswahl; ohne sie gilt die Auswahl als abgebrochen.
// - CODIUM_TEST_NO_GIT=1: Codium tut so, als fehle Git.

export interface TestMode {
  hidden: boolean;
  dataDir?: string;
  pickDir?: string;
  noGit: boolean;
}

export function readTestMode(env: NodeJS.ProcessEnv): TestMode {
  return {
    hidden: env.CODIUM_TEST_HIDDEN === '1',
    dataDir: env.CODIUM_TEST_DATA_DIR || undefined,
    pickDir: env.CODIUM_TEST_PICK_DIR || undefined,
    noGit: env.CODIUM_TEST_NO_GIT === '1',
  };
}

/** Ein aufgezeichnetes Ereignis des Testmodus. */
export interface TestEvent {
  /** Was passiert wäre, etwa `window-focused`, `show-in-explorer`, `clipboard-write`. */
  kind: string;
  detail?: unknown;
  /** Zeitpunkt in Millisekunden seit 1970. */
  at: number;
}

/**
 * Aufzeichnung im Hauptprozess. Im Testmodus liegt sie unter `globalThis.__codiumTest`, damit Playwright sie
 * über die Auswertung im Hauptprozess lesen kann.
 */
export class TestRecorder {
  readonly events: TestEvent[] = [];

  /** @param enabled nur im Testmodus wird aufgezeichnet, sonst wüchse die Liste im Betrieb unbegrenzt */
  constructor(private readonly enabled: boolean) {}

  record(kind: string, detail?: unknown): void {
    if (this.enabled) this.events.push({ kind, detail, at: Date.now() });
  }
}

/** Name der Eigenschaft auf `globalThis`, unter der die Aufzeichnung liegt. */
export const TEST_RECORDER_GLOBAL = '__codiumTest';

/**
 * Eingriffe für Oberflächentests, nur im Testmodus unter `globalThis.__codiumTestHooks`. Sie spielen die Seite des
 * Kerns, solange es noch keine echte Quelle gibt (etwa Fortschritt, bevor Git-Aktionen existieren): Ein Ereignis
 * geht denselben Weg zum Fenster wie eines des Kerns.
 */
export interface TestHooks {
  /** Schickt ein Ereignis des Vertrags an ein Fenster. */
  emit(windowId: number, name: string, payload: unknown): void;
}

/** Name der Eigenschaft auf `globalThis`, unter der die Eingriffe für Tests liegen. */
export const TEST_HOOKS_GLOBAL = '__codiumTestHooks';
