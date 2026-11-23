// Testmodus der echten App für automatische Prüfungen (Agenten, Playwright). Lädt nie Electron.
//
// - CODIUM_TEST_HIDDEN=1: Fenster ausserhalb des Bildschirms, nicht aktivierbar und ohne Taskleisten-Eintrag;
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
  /**
   * Was passiert wäre, etwa `window-focused`, `show-in-explorer`, `clipboard-write`. Dazu, was nur beobachtet wird:
   * `web-request` (jeder Zugriff einer Seite, `{ url, resourceType }`) und `console-message` (Warnungen und Fehler einer
   * Seite, `{ windowId, level, message, source }`).
   */
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

/** Windows-Nachricht, mit der ein Fenster erfährt, dass es aktiviert oder deaktiviert wird. */
export const WM_ACTIVATE = 0x0006;

/**
 * Ob eine WM_ACTIVATE-Nachricht eine Aktivierung meldet: Das untere Wort von wParam ist WA_ACTIVE (1) oder
 * WA_CLICKACTIVE (2), bei einer Deaktivierung WA_INACTIVE (0). wParam kommt von Electron als Puffer in Zeigergrösse.
 */
export function isActivation(wParam: Buffer): boolean {
  return wParam.length >= 2 && wParam.readUInt16LE(0) !== 0;
}

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
