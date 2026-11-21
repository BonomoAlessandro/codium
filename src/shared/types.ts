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
  /** Ob der Ordner beim Abfragen da und erreichbar war. */
  exists: boolean;
}

/**
 * Knöpfe an Meldungen des Kerns: Name → Parameter. Die Oberfläche führt sie aus, wenn der Nutzer den Knopf
 * klickt; so kann ein Knopf auch etwas tun, das nur die Oberfläche kann (etwa einen Tab öffnen). Spätere Tickets
 * ergänzen die Tabelle.
 */
export interface NoticeActions {
  /** Entfernt ein Projekt (absoluter Pfad) aus den zuletzt geöffneten. */
  'recentProjects.remove': { path: string };
}

/** Ein Knopf an einer Meldung des Kerns. */
export type NoticeAction = {
  [K in keyof NoticeActions]: { label: string; action: K; params: NoticeActions[K] };
}[keyof NoticeActions];

/**
 * Eine Meldung des Kerns an ein Fenster. Erfolg und Information verschwinden nach einigen Sekunden von selbst,
 * Fehler bleiben, bis der Nutzer sie schliesst.
 */
export interface Notice {
  level: 'info' | 'success' | 'error';
  text: string;
  /** Knöpfe der Meldung; ein Klick führt die Aktion aus und schliesst die Meldung. */
  actions?: NoticeAction[];
}

/**
 * Fortschritt einer Arbeit des Kerns (etwa „Pushing…“), an das Fenster, für das sie läuft. Jede Arbeit hat eine
 * Kennung, die im ganzen Hauptprozess eindeutig ist; auf `begin` folgen beliebig viele `report` und genau ein `end`.
 * `fraction` liegt zwischen 0 und 1 und fehlt, solange der Stand unbekannt ist.
 */
export type ProgressEvent =
  | { kind: 'begin'; id: string; title: string; fraction?: number }
  | { kind: 'report'; id: string; title?: string; fraction?: number }
  | { kind: 'end'; id: string };

/** Die Seiten des Projektfensters mit Werkzeugfenstern. */
export type ToolWindowSide = 'left' | 'bottom' | 'right';

export const TOOL_WINDOW_SIDES: readonly ToolWindowSide[] = ['left', 'bottom', 'right'];

/** Alle Werkzeugfenster und ihre Seite. „Find“ erscheint nur, solange es Trefferlisten gibt (Ticket 08). */
export const TOOL_WINDOW_SIDE = {
  project: 'left',
  commit: 'left',
  terminal: 'bottom',
  git: 'bottom',
  find: 'bottom',
  database: 'right',
} as const satisfies Record<string, ToolWindowSide>;

export type ToolWindowId = keyof typeof TOOL_WINDOW_SIDE;

/** Ob ein Wert eines der Werkzeugfenster ist. */
export function isToolWindowId(value: unknown): value is ToolWindowId {
  return typeof value === 'string' && Object.hasOwn(TOOL_WINDOW_SIDE, value);
}

/** Zustand einer Seite: das aktive Werkzeugfenster, ob es offen ist, und seine Grösse in Pixeln (Breite bzw. Höhe). */
export interface ToolWindowSideLayout {
  active: ToolWindowId;
  open: boolean;
  size: number;
}

/** Layout der Werkzeugfenster eines Projekts; pro Seite ist höchstens ein Werkzeugfenster sichtbar. */
export type ToolWindowLayout = Record<ToolWindowSide, ToolWindowSideLayout>;

/**
 * Alle Codes gescheiterter Befehle, die die Oberfläche sehen kann. Die Meldung eines Fehlers mit einem dieser
 * Codes ist englisch und lässt sich so anzeigen. Ein Fehler ohne Code ist ein interner Fehler; seine Meldung ist
 * nicht für Nutzer gedacht, die Oberfläche zeigt dafür einen allgemeinen Text.
 */
export const ErrorCode = {
  /** Den Befehl gibt es nicht. */
  unknownCommand: 'UNKNOWN_COMMAND',
  /** Ein Parameter fehlt oder hat die falsche Form. */
  invalidParams: 'INVALID_PARAMS',
  /** Der Befehl braucht ein offenes Projekt, das anfragende Fenster hat keines. */
  noProject: 'NO_PROJECT',
  /** Der Projektordner fehlt; `data.path` ist der Pfad. */
  projectNotFound: 'PROJECT_NOT_FOUND',
  /** Der Projektordner ist nicht erreichbar (etwa ein Netzlaufwerk, das nicht antwortet); `data.path` ist der Pfad. */
  projectUnreachable: 'PROJECT_UNREACHABLE',
  /** Codium wird gerade beendet und öffnet nichts mehr. */
  shuttingDown: 'SHUTTING_DOWN',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Ob ein Code zu den bekannten gehört, deren Meldung sich anzeigen lässt. */
export function isKnownErrorCode(code: string | undefined): code is ErrorCodeValue {
  return Object.values(ErrorCode).some((known) => known === code);
}

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
   * Öffnet ein Projekt (absoluter Pfad) in einem neuen Fenster. Ist es schon offen, kommt sein Fenster nach vorne.
   * Ein offenes Willkommensfenster schliesst sich. Fehlt der Ordner, scheitert der Befehl mit `PROJECT_NOT_FOUND`,
   * ist er nicht erreichbar, mit `PROJECT_UNREACHABLE`.
   */
  'app.openProject': { params: { path: string }; result: ProjectInfo };
  /** Entfernt ein Projekt (absoluter Pfad) aus den zuletzt geöffneten und liefert die neue Liste. */
  'app.removeRecentProject': { params: { path: string }; result: RecentProject[] };
  /** „Exit“: beendet Codium; alle offenen Projekte öffnen beim nächsten Start wieder. */
  'app.exit': { params: void; result: void };
  /** Das gespeicherte Layout der Werkzeugfenster des Projekts, ohne gespeichertes der Standard. */
  'project.layout': { params: void; result: ToolWindowLayout };
  /**
   * Speichert das Layout der Werkzeugfenster des Projekts. Ein unvollständiges oder ungültiges Layout (unbekanntes
   * Werkzeugfenster, Werkzeugfenster auf der falschen Seite, Grösse ausserhalb von 1 bis 10'000 Pixeln) lehnt der
   * Kern mit `INVALID_PARAMS` ab.
   */
  'project.setLayout': { params: ToolWindowLayout; result: void };
}

/** Alle Ereignisse: Name → Nutzlast. */
export interface Events {
  /** Eine Meldung für das Fenster. */
  'app.notice': Notice;
  /** Fortschritt einer Arbeit des Kerns für das Fenster (Statusleiste). */
  'app.progress': ProgressEvent;
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
