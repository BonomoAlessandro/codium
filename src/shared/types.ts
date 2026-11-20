// Vertrag zwischen Oberfläche (Renderer) und Kern (Hauptprozess).
// Befehle gehen als Anfrage mit Antwort an den Kern, Ereignisse gehen vom Kern an genau ein Fenster.
// Spätere Tickets ergänzen Befehle und Ereignisse in den beiden Tabellen unten; die Mechanik bleibt gleich.

/** Name und Version der App, zur Anzeige. */
export interface AppInfo {
  name: string;
  version: string;
}

/** Das Projekt, das in einem Fenster offen ist. */
export interface ProjectInfo {
  /** Normalisierter absoluter Pfad des Projektordners. */
  path: string;
  /** Anzeigename, der Name des Projektordners. */
  name: string;
}

/** Was das anfragende Fenster ist: das Willkommensfenster oder ein Projektfenster. */
export type WindowInfo =
  | { kind: 'welcome'; title: string }
  | { kind: 'project'; title: string; project: ProjectInfo };

/** Ein Eintrag der zuletzt geöffneten Projekte. */
export interface RecentProject {
  /** Normalisierter absoluter Pfad des Projektordners. */
  path: string;
  name: string;
  /** Ob der Ordner beim Abfragen da war. */
  exists: boolean;
}

/** Eine Meldung des Kerns an ein Fenster. */
export interface Notice {
  level: 'info' | 'success' | 'error';
  text: string;
}

/**
 * Codes gescheiterter Befehle, auf die die Oberfläche reagiert. Die Meldung eines solchen Fehlers ist englisch
 * und lässt sich so anzeigen.
 */
export const ErrorCode = {
  /** Der Projektordner fehlt; `data.path` ist der Pfad. */
  projectNotFound: 'PROJECT_NOT_FOUND',
  /** Codium wird gerade beendet und öffnet nichts mehr. */
  shuttingDown: 'SHUTTING_DOWN',
  /** Ein Parameter fehlt oder hat die falsche Form. */
  invalidParams: 'INVALID_PARAMS',
} as const;

/**
 * Alle Befehle: Name → Parameter und Ergebnis. Ein Befehl ohne Parameter hat `params: void` und wird ohne
 * zweites Argument aufgerufen.
 */
export interface Commands {
  /** Name und Version der App. */
  'app.info': { params: void; result: AppInfo };
  /** Das Projekt des anfragenden Fensters, `null` ohne Projekt (etwa im Willkommensfenster). */
  'project.info': { params: void; result: ProjectInfo | null };
  /** Art und Titel des anfragenden Fensters; `null` für ein Fenster, das der Kern nicht kennt. */
  'window.info': { params: void; result: WindowInfo | null };
  /** Die zuletzt geöffneten Projekte, neueste zuerst. */
  'app.recentProjects': { params: void; result: RecentProject[] };
  /**
   * „Open Folder“: Ordnerauswahl, dann das Projekt öffnen wie `app.openProject`. `null`, wenn die Auswahl
   * abgebrochen wurde.
   */
  'app.openFolder': { params: void; result: ProjectInfo | null };
  /**
   * Öffnet ein Projekt in einem neuen Fenster. Ist es schon offen, kommt sein Fenster nach vorne. Ein offenes
   * Willkommensfenster schliesst sich. Fehlt der Ordner, scheitert der Befehl mit `PROJECT_NOT_FOUND`.
   */
  'app.openProject': { params: { path: string }; result: ProjectInfo };
  /** Entfernt ein Projekt aus den zuletzt geöffneten und liefert die neue Liste. */
  'app.removeRecentProject': { params: { path: string }; result: RecentProject[] };
  /** „Exit“: beendet Codium; alle offenen Projekte öffnen beim nächsten Start wieder. */
  'app.exit': { params: void; result: void };
}

/** Alle Ereignisse: Name → Nutzlast. */
export interface Events {
  /** Eine Meldung für das Fenster. */
  'app.notice': Notice;
}

export type CommandName = keyof Commands;
export type EventName = keyof Events;
export type CommandParams<K extends CommandName> = Commands[K]['params'];
export type CommandResult<K extends CommandName> = Commands[K]['result'];
/** Argumente nach dem Befehlsnamen: keine bei `params: void`, sonst genau die Parameter. */
export type CommandArgs<K extends CommandName> = [CommandParams<K>] extends [void] ? [] : [params: CommandParams<K>];

/** Anfrage über den IPC-Kanal `IPC.request`. */
export interface RequestMessage {
  name: string;
  params?: unknown;
}

/**
 * Antwort auf eine Anfrage. Fehler kommen als Wert zurück statt als geworfene Ausnahme, damit die Meldung
 * unverändert in der Oberfläche ankommt.
 */
export type ResponseMessage = { ok: true; result: unknown } | { ok: false; error: CommandFailure };

/** Ein gescheiterter Befehl: Meldung, dazu optional ein Code und strukturierte Daten (etwa eine Dateiliste). */
export interface CommandFailure {
  message: string;
  code?: string;
  data?: unknown;
}

/** Ereignis über den IPC-Kanal `IPC.event`. */
export interface EventMessage {
  name: string;
  payload: unknown;
}

/**
 * Die Brücke, die das Preload-Skript dem Renderer unter `window.codium` bereitstellt. Sie wirft nie: Electron
 * übernimmt bei einem Fehler über die Brücke nur die Meldung, Code und Daten gingen verloren. Die Oberfläche
 * benutzt sie über `createApi` (renderer/api.ts), das aus einer gescheiterten Antwort einen `CodiumError` wirft.
 */
export interface CodiumBridge {
  /** Schickt einen Befehl an den Kern und liefert die Antwort als Wert. */
  invoke(name: string, params?: unknown): Promise<ResponseMessage>;
  /** Hört auf ein Ereignis des Kerns für dieses Fenster; liefert eine Funktion zum Abmelden. */
  on(name: string, listener: (payload: unknown) => void): () => void;
}

/** Die typisierte API der Oberfläche über der Brücke. */
export interface CodiumApi {
  /** Schickt einen Befehl an den Kern und liefert das Ergebnis; wirft einen `CodiumError`, wenn er scheitert. */
  request<K extends CommandName>(name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>>;
  /** Hört auf ein Ereignis des Kerns für dieses Fenster; liefert eine Funktion zum Abmelden. */
  on<K extends EventName>(name: K, listener: (payload: Events[K]) => void): () => void;
}

/** Fehler eines Befehls in der Oberfläche, mit Code und Daten aus dem Kern. */
export class CodiumError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'CodiumError';
  }
}

/** IPC-Kanalnamen an einem Ort, damit Main und Preload nicht auseinanderlaufen. */
export const IPC = {
  request: 'codium:request',
  event: 'codium:event',
} as const;
