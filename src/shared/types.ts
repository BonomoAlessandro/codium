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
  /** Öffnet das mitgelieferte README schreibgeschützt in einem Tab, am Abschnitt „Voraussetzungen“. */
  'readme.open': { section: 'prerequisites' };
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
 * Ein Eintrag eines Ordners im Dateibaum. Pfade im Vertrag sind absolut und beginnen mit dem Projektpfad in der
 * Schreibweise von `ProjectInfo.path`; die Namen haben die Schreibweise auf der Festplatte.
 */
export interface FileEntry {
  name: string;
  path: string;
  /** Ein Ordner (auch ein symbolischer Link oder eine Junction auf einen Ordner im Projekt). */
  isDirectory: boolean;
  /**
   * Ein symbolischer Link oder eine Junction, der Codium nicht folgt: Das Ziel liegt ausserhalb des Projekts
   * (`outside`) oder fehlt (`missing`). Der Eintrag selbst lässt sich umbenennen, löschen (der Papierkorb nimmt nur den
   * Link), sein Pfad kopieren und im Explorer zeigen; aufklappen, öffnen und kopieren nicht.
   */
  blockedLink?: 'outside' | 'missing';
}

/**
 * Eine Änderung von aussen, wie sie nach dem Bündeln der Dateiereignisse feststeht: `deleted` heisst, der Pfad
 * fehlt nach dem Bündeln noch; „gelöscht und neu angelegt“ ist `changed`. Eine Änderung an einem Ordner gilt für
 * alles darunter (ein umbenannter Ordner meldet nur sich selbst, nicht jede Datei darin).
 */
export interface FileChange {
  path: string;
  kind: 'created' | 'changed' | 'deleted';
}

/** Gebündelte Änderungen von aussen. Eigene Dateioperationen meldet stattdessen `files.operation`. */
export interface FilesChangedEvent {
  changes: FileChange[];
  /**
   * Die Überwachung hat womöglich Ereignisse verpasst (ein Ereignis ohne Dateinamen, etwa bei übergelaufenem
   * Puffer, oder sehr viele auf einmal). Die aufgeklappten Ordner sind neu eingelesen und ihre Unterschiede
   * (angelegt, gelöscht) in `changes` gemeldet. Geänderte Inhalte werden dabei nicht einzeln gemeldet, ebenso wenig
   * Änderungen in zugeklappten Ordnern: Was darüber hinaus wichtig ist (etwa offene Dateien in Ticket 07, die
   * Dateiliste in Ticket 08), prüft der Empfänger selbst. Zugleich kommt `git.dataChanged`.
   */
  rescanned?: true;
}

/**
 * Eine Dateioperation von Codium selbst, gemeldet, sobald sie fertig ist; spätere Dienste reagieren darauf (Tabs
 * folgen einer Umbenennung, Sprachserver und Git erfahren davon). Gelöscht heisst: in den Papierkorb verschoben.
 */
export type FileOperation =
  | { kind: 'created'; path: string; isDirectory: boolean }
  | { kind: 'renamed'; from: string; to: string; isDirectory: boolean }
  | { kind: 'deleted'; path: string; isDirectory: boolean }
  | { kind: 'copied'; from: string; to: string; isDirectory: boolean };

/** Kodierung einer Textdatei, wie der Datei-Dienst sie erkannt hat. */
export type TextEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'windows-1252';

/** Zeilenende einer Textdatei: das in der Datei überwiegende, ohne Zeilenumbruch LF. */
export type LineEnding = 'LF' | 'CRLF';

/** Ab dieser Grösse in Bytes öffnet eine Textdatei ohne Sprachfunktionen und ohne Änderungsbalken. */
export const LARGE_FILE_BYTES = 5 * 1024 * 1024;
/** Ab dieser Grösse in Bytes öffnet eine Datei gar nicht, sondern zeigt nur einen Hinweis. */
export const MAX_OPEN_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Inhalt einer Datei für einen Tab. Erkannt wird in dieser Reihenfolge: Grösse ab `MAX_OPEN_FILE_BYTES` (`tooLarge`),
 * Bild nach der Endung (PNG, JPEG, GIF, WebP, BMP, ICO; SVG ist Text), BOM (UTF-8, UTF-16 LE und BE), Null-Bytes in
 * den ersten 8 KB (`binary`), gültiges UTF-8, sonst Windows-1252. `size` ist die Grösse in Bytes.
 */
export type FileContent =
  | {
      kind: 'text';
      text: string;
      encoding: TextEncoding;
      lineEnding: LineEnding;
      size: number;
      /** Ab `LARGE_FILE_BYTES`: ohne Sprachfunktionen und ohne Änderungsbalken. */
      large: boolean;
      /** Stand der gelesenen Bytes, für `files.write` mit `expectedStamp`. */
      stamp: string;
    }
  | { kind: 'image'; /** Das Bild als data-URL. */ dataUrl: string; size: number }
  | { kind: 'binary'; size: number }
  | { kind: 'tooLarge'; size: number };

/** Ein Treffer der Suche nach Namen. */
export interface FileNameMatch {
  path: string;
  /** Pfad relativ zum Projekt mit „/“. */
  relative: string;
  /** Stellen im relativen Pfad, die die Eingabe getroffen hat (zum Hervorheben). */
  positions: number[];
  /** Die Datei ist von `.gitignore` ausgenommen (nur mit „include ignored“). */
  ignored?: true;
}

/** Optionen der Projektsuche. */
export interface SearchOptions {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Dateimaske wie in IntelliJ, mehrere durch Komma getrennt, etwa „*.java, !*Test.java“; leer heisst alle. */
  fileMask: string;
  includeIgnored: boolean;
}

/** Ein Treffer der Projektsuche: Zeile und Spalte ab 1, Länge in Zeichen (UTF-16 wie im Editor). */
export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  length: number;
  /** Die Zeile (bei sehr langen Zeilen ein Ausschnitt um den Treffer). */
  lineText: string;
  /** Wo `lineText` in der Zeile beginnt (0 ohne Kürzung). */
  lineOffset: number;
}

/** Eine Stelle in einer Datei wie im Language Server Protocol: Zeilen und Zeichen ab 0, Zeichen in UTF-16. */
export interface TextRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

/**
 * Ein Ziel des Sprach-Dienstes (Definition, Verwendung, Implementierung). `readOnly` bei Zielen in Bibliotheken
 * (unter node_modules oder ausserhalb des Projekts); ihren Inhalt liefert `language.readTarget`.
 */
export interface CodeLocation {
  path: string;
  range: TextRange;
  readOnly?: true;
  /** Die Zeile des Ziels (nur bei Verwendungen, für das Werkzeugfenster „Find“). */
  lineText?: string;
}

/** Ein Vorschlag der Vervollständigung (Ticket 13). Details lädt `language.resolveCompletion` mit `id` nach. */
export interface CompletionEntry {
  id: number;
  label: string;
  /** Art nach LSP (`CompletionItemKind`, 1–25). */
  kind: number;
  detail?: string;
  /** Dokumentation als Markdown. */
  documentation?: string;
  insertText: string;
  /** `insertText` ist ein Snippet (`$1`, `${2:name}`). */
  snippet?: true;
  /** Ersetzter Bereich; ohne Angabe das Wort an der Stelle. */
  range?: TextRange;
  sortText?: string;
  filterText?: string;
  commitCharacters?: string[];
  /** Weitere Änderungen beim Übernehmen, etwa ein automatischer Import. */
  additionalTextEdits?: Array<{ range: TextRange; newText: string }>;
}

/** Ein Symbol aus der Symbolsuche (Ticket 13). */
export interface SymbolMatch {
  name: string;
  /** Art nach LSP (`SymbolKind`, 1–26). */
  kind: number;
  /** Wo es steht, etwa die Klasse einer Methode. */
  container?: string;
  path: string;
  range: TextRange;
}

/**
 * Legende der semantischen Token zwischen Kern und Oberfläche (Ticket 13): Der Kern meldet sie den Servern und rechnet
 * deren Token auf diese Reihenfolge um. Namen nach LSP, dazu `local` (TypeScript: lokale Variable).
 */
export const SEMANTIC_TOKEN_TYPES = [
  'namespace',
  'type',
  'class',
  'enum',
  'interface',
  'struct',
  'typeParameter',
  'parameter',
  'variable',
  'property',
  'enumMember',
  'event',
  'function',
  'method',
  'macro',
  'keyword',
  'modifier',
  'comment',
  'string',
  'number',
  'regexp',
  'operator',
  'decorator',
  'annotation',
] as const;
export const SEMANTIC_TOKEN_MODIFIERS = [
  'declaration',
  'definition',
  'readonly',
  'static',
  'deprecated',
  'abstract',
  'async',
  'modification',
  'documentation',
  'defaultLibrary',
  'local',
] as const;

/** Zustand einer Datei in Git (Ticket 15), nach `git status --porcelain=v2`: X für den Index, Y für die Arbeitskopie. */
export interface GitFileStatus {
  /** Absoluter Pfad. */
  path: string;
  /** Code für den Index: `.` unverändert, `M`, `A`, `D`, `R`, `C`, `T`, `U` (Konflikt), `?` unversioniert. */
  index: string;
  worktree: string;
  /** Bei Umbenennungen der alte Pfad. */
  origPath?: string;
  /** Ein Konflikt eines laufenden Merges. */
  conflict?: true;
}

/** Zustand des Repositorys eines Projekts (Ticket 15). */
export interface GitState {
  /** Ob der Projektordner in einem Git-Repository liegt; ohne sind alle Git-Funktionen aus. */
  repository: boolean;
  /** Wurzel des Repositorys (kann über dem Projektordner liegen). */
  root?: string;
  /** Aktueller Branch; `null`, wenn der HEAD abgekoppelt ist (dann `detached`) oder es noch keinen Commit gibt. */
  branch: string | null;
  /** Kurzer Hash des abgekoppelten HEAD. */
  detached?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  /** Eine laufende Operation. */
  operation?: 'merge' | 'rebase' | 'cherry-pick' | 'revert';
  files: GitFileStatus[];
  /** Ignorierte Dateien und Ordner (für die Farben im Dateibaum); ein Ordner wie node_modules als ein Eintrag. */
  ignored?: Array<{ path: string; directory?: true }>;
}

/**
 * Ein Änderungsblock einer Datei gegenüber dem letzten Commit (Ticket 17). `line` ist die erste Zeile im aktuellen
 * Text (ab 1), bei `deleted` die Zeile, vor der gelöscht wurde; `count` die Zahl aktueller Zeilen (0 bei `deleted`).
 */
export interface ChangeBlock {
  kind: 'modified' | 'added' | 'deleted';
  line: number;
  count: number;
  /** Die Zeilen im letzten Commit, ohne Zeilenende. */
  oldLines: string[];
}

/** Branches des Repositorys. */
export interface GitBranches {
  local: Array<{ name: string; upstream?: string; current: boolean; ahead?: number; behind?: number }>;
  remote: Array<{ name: string; remote: string }>;
}

/** Filter des Git-Logs (Ticket 19). Mit `text` oder `author` gibt es keinen Graph. */
export interface GitLogFilter {
  /** Teil der Nachricht (ohne Gross-/Kleinschreibung) oder Anfang des Hashs. */
  text?: string;
  /** Nur dieser Branch (lokal oder remote); ohne alle Branches. */
  branch?: string;
  /** Teil von Name oder E-Mail des Autors (ohne Gross-/Kleinschreibung). */
  author?: string;
}

/** Ein Etikett an einem Commit. */
export interface GitRefLabel {
  name: string;
  kind: 'head' | 'local' | 'remote' | 'tag';
}

/**
 * Graph-Spuren einer Zeile: die Spalte des Commit-Punkts und die Linien zur nächsten Zeile (von Spalte `from` in dieser
 * zu Spalte `to` in der nächsten). `color` ist die Nummer der Spur (die Oberfläche wählt die Farbe).
 */
export interface GitGraphRow {
  column: number;
  color: number;
  lines: Array<{ from: number; to: number; color: number }>;
}

export interface GitLogCommit {
  hash: string;
  parents: string[];
  refs: GitRefLabel[];
  author: string;
  email: string;
  /** Autor-Datum (ms seit 1970). */
  date: number;
  subject: string;
  /** Fehlt mit Text- oder Autorfilter. */
  graph?: GitGraphRow;
}

/** Eine Seite des Logs. `version` wechselt, wenn der Log neu beginnt (anderer Filter, geänderte Refs). */
export interface GitLogPage {
  version: number;
  commits: GitLogCommit[];
  /** Alle Commits sind gelesen. */
  done: boolean;
  /** Ob die Zeilen Graph-Spuren tragen. */
  graph: boolean;
}

/** Details eines Commits mit den geänderten Dateien (bei einem Merge gegen den ersten Elterncommit). */
export interface GitCommitDetails {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: number;
  committer: string;
  commitDate: number;
  /** Die vollständige Nachricht. */
  message: string;
  files: Array<{
    /** Pfad relativ zur Wurzel des Repositorys, mit „/“. */
    repoPath: string;
    /** Absoluter Pfad. */
    path: string;
    /** `A` hinzugefügt, `M` geändert, `D` gelöscht, `R` umbenannt, `C` kopiert, `T` Typ geändert. */
    status: string;
    /** Bei Umbenennungen und Kopien der alte Pfad relativ zur Wurzel. */
    origRepoPath?: string;
  }>;
}

/** Ein Eintrag der Git-Konsole (Ticket 15). */
export interface GitConsoleEntry {
  id: number;
  /** Zeitpunkt des Starts (ms seit 1970). */
  time: number;
  /** Der Befehl, etwa `git checkout -b feature`. */
  command: string;
  output: string;
  /** `null`, solange er läuft oder wenn er sich nicht starten liess. */
  exitCode: number | null;
  /** Eine Abfrage im Hintergrund (nicht vom Nutzer ausgelöst, nicht schreibend, ohne Netz). */
  background: boolean;
}

/** Ein Fehler oder eine Warnung eines Sprachservers. */
export interface LanguageDiagnostic {
  range: TextRange;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;
  code?: string;
  /** Unnötiger oder veralteter Code (grau bzw. durchgestrichen). */
  tags?: Array<'unnecessary' | 'deprecated'>;
}

/** So viele Treffer liefert die Projektsuche höchstens; danach meldet sie „more results“. */
export const SEARCH_MATCH_LIMIT = 2000;

/** Einstellungen, die für alle Projekte gelten (im App-Zustand). Felder kommen mit den Tickets, die sie brauchen. */
export interface AppSettings {
  /** Schriftgrösse aller Editoren, wie Monaco sie zählt. */
  fontSize: number;
  /** JDK für den Java-Sprachserver (Ordner); `null` heisst „Newest detected“. */
  jdk: string | null;
  /** Shell fürs Terminal; `null` heisst Standard (PowerShell 7, sonst Windows PowerShell). */
  terminalShell: ShellId | null;
}

/** Eine Shell fürs Terminal (Ticket 11). */
export type ShellId = 'pwsh' | 'powershell' | 'cmd' | 'gitbash';

/** Eine gefundene Shell. */
export interface ShellInfo {
  id: ShellId;
  /** Name zur Anzeige, etwa „PowerShell 7“. */
  name: string;
  /** Pfad zur ausführbaren Datei. */
  path: string;
}

/** Ein erkanntes JDK. */
export interface JdkInfo {
  /** Ordner des JDK (mit `bin\java.exe`). */
  path: string;
  /** Version aus der Datei `release`, etwa „25.0.5.1“. */
  version: string;
  /** Hauptversion, etwa 25. */
  major: number;
  /** Hersteller aus der Datei `release`, etwa „Eclipse Adoptium“. */
  vendor?: string;
}

export const DEFAULT_FONT_SIZE = 13;
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 72;

/** Ansicht einer Markdown-Datei: nur Editor, geteilt mit Vorschau, nur Vorschau. */
export type MarkdownView = 'editor' | 'split' | 'preview';

/** Höchstgrösse eines Bildes in der Markdown-Vorschau. */
export const MAX_PREVIEW_IMAGE_BYTES = 10 * 1024 * 1024;

/** Cursor und Scrollstand eines Editors: Zeile und Spalte ab 1, Scrollstand in Pixeln von oben. */
export interface CursorState {
  line: number;
  column: number;
  scrollTop: number;
}

/** Die offenen Datei-Tabs eines Projekts in ihrer Reihenfolge (absolute Pfade) und der aktive Tab. */
export interface EditorTabs {
  tabs: string[];
  /** Pfad des aktiven Tabs; `null` ohne Tabs. Muss einer der Tabs sein. */
  active: string | null;
  /** Die angehefteten Tabs; sie stehen links, vor allen anderen. Ohne Angabe keine. */
  pinned?: string[];
}

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
  /**
   * Ein Pfad liegt ausserhalb des Projekts, auch erst nach dem Auflösen von `..`, Junctions oder symbolischen
   * Links; `data.path` ist der Pfad.
   */
  pathOutsideProject: 'PATH_OUTSIDE_PROJECT',
  /** Die Datei oder der Ordner fehlt; `data.path` ist der Pfad. */
  fileNotFound: 'FILE_NOT_FOUND',
  /** Am Ziel gibt es schon eine Datei oder einen Ordner dieses Namens; `data.path` ist das Ziel. */
  fileExists: 'FILE_EXISTS',
  /** Der Name einer Datei oder eines Ordners ist unter Windows nicht erlaubt. */
  invalidFileName: 'INVALID_FILE_NAME',
  /** Eine Dateioperation ist am Dateisystem gescheitert (etwa fehlende Rechte, Datei in Gebrauch). */
  fileOperationFailed: 'FILE_OPERATION_FAILED',
  /** Der Pfad ist ein Ordner, der Befehl braucht eine Datei; `data.path` ist der Pfad. */
  notAFile: 'NOT_A_FILE',
  /** Eine Datei ist für den Zweck zu gross (etwa ein Bild über 10 MB in der Vorschau); `data.path` ist der Pfad. */
  fileTooLarge: 'FILE_TOO_LARGE',
  /** Ein Zeichen lässt sich in der Kodierung der Datei nicht speichern; `data.character` ist das Zeichen. */
  cannotEncode: 'CANNOT_ENCODE',
  /** Die Datei hat sich seit dem erwarteten Stand geändert (etwa von aussen); `data.path` ist der Pfad. */
  fileChanged: 'FILE_CHANGED',
  /** Git wurde nicht gefunden; Git-Funktionen sind aus. */
  gitNotFound: 'GIT_NOT_FOUND',
  /** Git ist gescheitert; die Meldung ist die von Git im Wortlaut. */
  gitFailed: 'GIT_FAILED',
  /** Ein Branch ist nicht gemergt; Löschen geht nur erzwungen (nach Rückfrage). */
  gitNotMerged: 'GIT_NOT_MERGED',
  /** Ein Wechsel wurde wegen lokaler Änderungen verweigert; `data.files` sind die betroffenen Dateien. */
  gitCheckoutBlocked: 'GIT_CHECKOUT_BLOCKED',
  /** Ein Push wurde abgelehnt, weil der Remote weiter ist (Ticket 18); die Oberfläche bietet „Pull“ an. */
  gitPushRejected: 'GIT_PUSH_REJECTED',
  /** Der Projektordner liegt in keinem Git-Repository. */
  notARepository: 'NOT_A_REPOSITORY',
  /** Es gibt keine Shell fürs Terminal. */
  shellNotFound: 'SHELL_NOT_FOUND',
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
  /** Die aufgeklappten Ordner im Dateibaum (absolute Pfade); ohne gespeicherte nur der Projektordner selbst. */
  'project.expandedFolders': { params: void; result: string[] };
  /** Speichert die aufgeklappten Ordner; Pfade ausserhalb des Projekts lehnt der Kern ab. */
  'project.setExpandedFolders': { params: { paths: string[] }; result: void };
  /** Die Einstellungen; ohne gespeicherte die Standardwerte. */
  'app.settings': { params: void; result: AppSettings };
  /**
   * Die erkannten JDKs (neueste zuerst) und das JDK, das der Java-Sprachserver nehmen würde: das eingestellte, sonst
   * das neueste ab Java 25; `null`, wenn es keines gibt.
   */
  'app.jdks': { params: void; result: { jdks: JdkInfo[]; forLanguageServer: JdkInfo | null } };
  /** Was von den Voraussetzungen da ist: Git (ohne Git sind Git-Funktionen und „Clone Repository“ aus). */
  'app.prerequisites': { params: void; result: { git: boolean } };
  /** Vorschlag für „Clone Repository“: der zuletzt gewählte Elternordner, sonst der Benutzerordner. */
  'app.cloneDefaults': { params: void; result: { parent: string } };
  /** Ordnerauswahl von Windows (etwa für „Browse…“); `null`, wenn sie abgebrochen wurde. */
  'app.pickFolder': { params: { title: string }; result: string | null };
  /**
   * „Clone Repository“: klont `url` in den absoluten Ordner `directory` (mit Fortschritt in der Statusleiste des
   * Fensters) und öffnet das Projekt wie `app.openProject`. Ein bestehender, nicht leerer Ordner: `FILE_EXISTS`. Ohne
   * Git: `GIT_NOT_FOUND`. Scheitert Git oder wird der Klon abgebrochen (`app.cancelClone`, Beenden von Codium), kommt
   * `GIT_FAILED` mit der Meldung von Git im Wortlaut, und die Ordner, die der Klon selbst angelegt hat, sind entfernt.
   */
  'app.clone': { params: { url: string; directory: string }; result: ProjectInfo };
  /** Bricht die laufenden Klone des anfragenden Fensters ab (Git samt Kindprozessen wird beendet). */
  'app.cancelClone': { params: void; result: void };
  /**
   * Öffnet eine Web-Adresse (http, https, mailto) im Standardbrowser bzw. Mailprogramm, über den Port „Shell-Aktionen“
   * (im Testmodus nur aufgezeichnet). Andere Adressen: `INVALID_PARAMS`.
   */
  'app.openExternal': { params: { url: string }; result: void };
  /** Das mit Codium mitgelieferte README (Markdown), für „Open README“. */
  'app.readme': { params: void; result: { text: string } };
  /**
   * Suche nach Namen (Ctrl + Shift + N): die besten Treffer (höchstens 100) unter allen Dateien des Projekts,
   * versteckte eingeschlossen, ohne `.git`; von `.gitignore` ausgenommene nur mit `includeIgnored`.
   */
  'files.findByName': { params: { query: string; includeIgnored?: boolean }; result: { matches: FileNameMatch[] } };
  /**
   * Startet eine Projektsuche (Ctrl + Shift + F); eine laufende des Fensters bricht ab. Die Treffer kommen als
   * `search.results` mit der gelieferten Kennung.
   */
  'search.start': { params: SearchOptions; result: { searchId: number } };
  /** Bricht eine laufende Projektsuche ab. */
  'search.cancel': { params: { searchId: number }; result: void };
  /**
   * Ein Dokument ist in der Oberfläche offen (mit dem aktuellen Text, auch ungespeichert). Der Sprach-Dienst startet
   * nötigenfalls den Server der Sprache. Dateien ohne Sprachserver und Tabs ab 5 MB meldet die Oberfläche nicht.
   */
  'language.didOpen': { params: { path: string; text: string; version: number }; result: void };
  /** Der Text eines offenen Dokuments hat sich geändert (der ganze Text). */
  'language.didChange': { params: { path: string; text: string; version: number }; result: void };
  'language.didClose': { params: { path: string }; result: void };
  /** Definition an einer Stelle; ohne Server oder Ziel eine leere Liste. */
  'language.definition': { params: { path: string; line: number; character: number }; result: CodeLocation[] };
  /** Verwendungen (mit der Deklaration), jeweils mit der Zeile. */
  'language.references': { params: { path: string; line: number; character: number }; result: CodeLocation[] };
  'language.implementations': { params: { path: string; line: number; character: number }; result: CodeLocation[] };
  /** Typ und Dokumentation an einer Stelle, als Markdown; `null` ohne. */
  'language.hover': { params: { path: string; line: number; character: number }; result: { markdown: string; range?: TextRange } | null };
  /** Zustand des Repositorys (Ticket 15). */
  'git.state': { params: void; result: GitState };
  /** Zustand neu lesen (etwa wenn das Fenster den Fokus bekommt); liefert ihn. */
  'git.refresh': { params: void; result: GitState };
  'git.branches': { params: void; result: GitBranches };
  /** Neuer Branch vom aktuellen Stand oder von `from` (lokal oder remote), wahlweise ausgecheckt. */
  'git.createBranch': { params: { name: string; from?: string; checkout: boolean }; result: void };
  /** Wechselt auf einen lokalen Branch; verweigert: `GIT_CHECKOUT_BLOCKED` mit den Dateien. */
  'git.checkout': { params: { name: string }; result: void };
  /** Wechselt auf einen Remote-Branch: legt einen folgenden lokalen an oder checkt den gleichnamigen aus. */
  'git.checkoutRemote': { params: { name: string }; result: { local: string } };
  'git.renameBranch': { params: { name: string; newName: string }; result: void };
  /** Löscht einen lokalen Branch; nicht gemergt: `GIT_NOT_MERGED`, mit `force` trotzdem. Der aktuelle nie. */
  'git.deleteBranch': { params: { name: string; force?: boolean }; result: void };
  /** Die Einträge der Git-Konsole (höchstens 1'000), älteste zuerst. */
  'git.console': { params: void; result: GitConsoleEntry[] };
  /**
   * Commit nur mit den angehakten Pfaden (Ticket 16): nicht versionierte darunter kommen zuerst in den Index; für andere
   * Dateien vorbereitete Index-Einträge bleiben unberührt. Bei einer Umbenennung gehören alter und neuer Pfad dazu.
   * `amend` ergänzt den letzten Commit (auch ohne Pfade, dann nur mit neuer Nachricht).
   */
  'git.commit': { params: { paths: string[]; message: string; amend?: boolean }; result: void };
  /** Die Nachricht des letzten Commits (für „Amend“); `null` ohne Commit. */
  'git.lastMessage': { params: void; result: string | null };
  /**
   * Setzt Dateien auf den letzten Commit zurück, in Arbeitsordner und Index: geänderte und gelöschte wiederhergestellt,
   * hinzugefügte aus dem Index und in den Papierkorb, Umbenennungen rückgängig.
   */
  'git.rollback': { params: { paths: string[] }; result: void };
  /** Hängt den Pfad (relativ zum Repository) an die .gitignore im Wurzelordner an und legt sie bei Bedarf an. */
  'git.addToGitignore': { params: { path: string }; result: void };
  /** Fetch von allen Remotes; verschwundene Remote-Branches werden entfernt (Ticket 18). */
  'git.fetch': { params: void; result: void };
  /** Pull nach der Git-Konfiguration des Nutzers (Merge oder Rebase); `conflicts`: Es blieben Konflikte. */
  'git.pull': { params: void; result: { conflicts: boolean } };
  /**
   * Push des aktuellen Branches, nie erzwungen. Ohne Upstream auf „origin“ (bzw. das einzige Remote) unter demselben
   * Namen, mit Upstream. Abgelehnt, weil der Remote weiter ist: `GIT_PUSH_REJECTED`.
   */
  'git.push': { params: void; result: { remote: string; branch: string; upstreamSet: boolean } };
  /** Bricht einen laufenden Merge oder Rebase ab. */
  'git.abort': { params: void; result: void };
  /** Rebase fortsetzen: alle Änderungen an versionierten Dateien in den Index, ohne Editor; `conflicts`: neue Konflikte. */
  'git.continueRebase': { params: void; result: { conflicts: boolean } };
  /** Die von Git vorbereitete Merge-Nachricht (ohne Kommentarzeilen); `null` ohne laufenden Merge. */
  'git.mergeMessage': { params: void; result: string | null };
  /** Konfliktdateien, die noch Konfliktmarkierungen enthalten. */
  'git.conflictMarkers': { params: void; result: string[] };
  /**
   * Eine Seite des Logs ab `offset` (Ticket 19), aus einem laufenden Git-Prozess je Fenster. Ein anderer Filter oder
   * geänderte Refs starten ihn neu; dann beginnt eine neue `version` (und `offset` zählt in ihr).
   */
  'git.log': { params: { filter: GitLogFilter; offset: number }; result: GitLogPage };
  /** Details und geänderte Dateien eines Commits. */
  'git.commitDetails': { params: { hash: string }; result: GitCommitDetails };
  /** Inhalt einer Datei (Pfad relativ zur Wurzel des Repositorys) in einem Commit, wie `git.fileAtCommit`. */
  'git.commitFile': { params: { hash: string; repoPath: string }; result: { exists: boolean; text: string; binary?: true } };
  /** „Checkout Revision“: abgekoppelter Zustand auf diesem Commit. */
  'git.checkoutRevision': { params: { hash: string }; result: void };
  /** „Copy Revision Number“: der volle Hash in die Zwischenablage. */
  'git.copyRevision': { params: { hash: string }; result: void };
  /**
   * Inhalt einer Datei in einem Commit (Standard HEAD), so wie Git ihn auschecken würde (Zeilenende, Filter), mit der
   * Kodierung der Datei dekodiert; `exists: false` und leer, wenn es sie dort nicht gibt (Ticket 17).
   */
  'git.fileAtCommit': {
    /** `encoding`: die der Datei im Arbeitsordner; ohne Angabe wird sie aus dem Inhalt erkannt. */
    params: { path: string; commit?: string; encoding?: TextEncoding };
    /** `binary`: Der Inhalt ist keine Textdatei (`text` ist dann leer). */
    result: { exists: boolean; text: string; binary?: true };
  };
  /** Änderungsblöcke eines aktuellen Texts gegenüber dem letzten Commit; leer für nicht versionierte Dateien. */
  'git.changes': { params: { path: string; text: string; encoding?: TextEncoding }; result: ChangeBlock[] };
  /** Ansicht des Werkzeugfensters „Commit“ (im Projekt-Zustand). */
  'project.commitView': { params: void; result: { groupByDirectory: boolean } };
  'project.setCommitView': { params: { groupByDirectory: boolean }; result: void };
  /** Vorschläge an einer Stelle (Ticket 13); `incomplete`: beim Weitertippen neu fragen. */
  'language.completion': {
    params: { path: string; line: number; character: number; triggerCharacter?: string };
    result: { incomplete: boolean; items: CompletionEntry[] };
  };
  /** Details eines Vorschlags aus der letzten Vervollständigung. */
  'language.resolveCompletion': {
    params: { id: number };
    result: { detail?: string; documentation?: string; additionalTextEdits?: Array<{ range: TextRange; newText: string }> };
  };
  /** Semantische Token einer Datei, kodiert wie in LSP, mit der Legende `SEMANTIC_TOKEN_TYPES`/`…_MODIFIERS`. */
  'language.semanticTokens': { params: { path: string }; result: { data: number[] } | null };
  /** Symbolsuche über alle Sprachserver des Projekts: `types` nur Klassen, Interfaces und Enums. */
  'language.symbols': { params: { query: string; kinds: 'types' | 'all' }; result: SymbolMatch[] };
  /** Inhalt eines schreibgeschützten Ziels (siehe `CodeLocation.readOnly`). */
  'language.readTarget': { params: { path: string }; result: { text: string } };
  /** Die gemerkte Ansicht einer Markdown-Datei; `null` ohne gemerkte (dann gilt „Split“). */
  'project.markdownView': { params: { path: string }; result: MarkdownView | null };
  /** Merkt die Ansicht einer Markdown-Datei; sie folgt Umbenennungen in Codium und entfällt beim Löschen. */
  'project.setMarkdownView': { params: { path: string; view: MarkdownView }; result: void };
  /**
   * Startet ein Terminal mit der eingestellten Shell im Ordner `cwd` (im Projekt; eine Datei heisst: ihr Ordner; ohne
   * Angabe der Projektordner). Die Ausgabe kommt als `terminal.data`, das Ende als `terminal.exit`. Ohne Shell:
   * `SHELL_NOT_FOUND`.
   */
  'terminal.start': { params: { cwd?: string; cols: number; rows: number }; result: { terminalId: number; shell: string; cwd: string } };
  /** Eingaben an die Shell. */
  'terminal.write': { params: { terminalId: number; data: string }; result: void };
  /** Neue Grösse in Zeichen. */
  'terminal.resize': { params: { terminalId: number; cols: number; rows: number }; result: void };
  /** Beendet die Shell samt den Programmen, die sie gestartet hat. */
  'terminal.close': { params: { terminalId: number }; result: void };
  /** Die zuletzt geöffneten Dateien des Projekts, neueste zuerst; Dateien, die es nicht mehr gibt, fehlen. */
  'project.recentFiles': { params: void; result: string[] };
  /** Merkt eine Datei als zuletzt geöffnet (höchstens 50 im Projekt-Zustand). */
  'project.addRecentFile': { params: { path: string }; result: void };
  /** Antwort auf `editor.flushRequest`: Alle Tabs des Fensters sind gespeichert (oder liessen sich nicht speichern). */
  'editor.flushed': { params: { requestId: number }; result: void };
  /**
   * Ändert Einstellungen (nur die angegebenen Felder) und liefert alle. Die Änderung geht als `app.settingsChanged`
   * an alle Fenster. Ungültige Werte (etwa eine Schriftgrösse ausserhalb von 6 bis 72, ein JDK, das kein absoluter
   * Pfad ist) lehnt der Kern mit `INVALID_PARAMS` ab.
   */
  'app.updateSettings': { params: Partial<AppSettings>; result: AppSettings };
  /** Die gefundenen Shells fürs Terminal und die, die ein neues Terminal ohne Einstellung nimmt. */
  'app.shells': { params: void; result: { shells: ShellInfo[]; standard: ShellId | null } };
  /**
   * Die gespeicherten Datei-Tabs des Projekts. Tabs von Dateien, die es nicht mehr gibt (oder die jetzt Ordner sind),
   * entfallen still; war einer davon aktiv, wird sein Nachbar aktiv.
   */
  'project.tabs': { params: void; result: EditorTabs };
  /**
   * Speichert die offenen Datei-Tabs. Geprüft wird ohne Dateizugriff: absolute Pfade im Projekt, ohne Doppelte,
   * `active` einer der Tabs oder `null`, `pinned` die ersten Tabs der Reihe (sonst `INVALID_PARAMS`).
   */
  'project.setTabs': { params: EditorTabs; result: void };
  /** Der zuletzt bekannte Cursor und Scrollstand einer Datei, `null`, wenn keiner gespeichert ist. */
  'project.cursor': { params: { path: string }; result: CursorState | null };
  /**
   * Merkt sich Cursor und Scrollstand einer Datei (auch nach dem Schliessen ihres Tabs, für die zuletzt benutzten
   * Dateien). Die Angaben folgen Umbenennungen in Codium und entfallen beim Löschen.
   */
  'project.setCursor': { params: { path: string; cursor: CursorState }; result: void };

  // Datei-Dienst. Jeder Befehl prüft, dass seine Pfade absolut sind (sonst `INVALID_PARAMS`), dass es sie gibt
  // (sonst `FILE_NOT_FOUND`) und dass sie auch nach dem Auflösen von `..`, Junctions und symbolischen Links im
  // Projekt liegen (sonst `PATH_OUTSIDE_PROJECT`). Befehle, die nur den Eintrag selbst betreffen (Umbenennen,
  // Löschen, Pfad kopieren, im Explorer zeigen), folgen einem Link nicht; dort muss der Elternordner im Projekt
  // liegen. Den Projektordner selbst kann man weder umbenennen, löschen noch kopieren, und im Ordner `.git` ändert
  // kein Befehl etwas (beides `INVALID_PARAMS`).

  /** Inhalt eines Ordners: Ordner vor Dateien, alphabetisch ohne Unterscheidung der Gross-/Kleinschreibung, ohne `.git`. */
  'files.list': { params: { path: string }; result: FileEntry[] };
  /**
   * Legt eine leere Datei an und liefert ihren Pfad. Der Name darf wie in IntelliJ Unterordner enthalten
   * (`a/b/c.txt`); fehlende Ordner entstehen dabei. Gibt es die Datei schon: `FILE_EXISTS`.
   */
  'files.createFile': { params: { parent: string; name: string }; result: string };
  /** Legt einen Ordner an (auch verschachtelt, `a/b`) und liefert seinen Pfad. Gibt es ihn schon: `FILE_EXISTS`. */
  'files.createDirectory': { params: { parent: string; name: string }; result: string };
  /** Benennt eine Datei oder einen Ordner um (nur der Name, kein Verschieben) und liefert den neuen Pfad. */
  'files.rename': { params: { path: string; newName: string }; result: string };
  /** Verschiebt Dateien und Ordner in den Papierkorb; liegt ein Eintrag in einem anderen, genügt dieser. */
  'files.delete': { params: { paths: string[] }; result: void };
  /**
   * Kopiert Dateien und Ordner in den Ordner `target` und liefert die neuen Pfade. Bei einem Namenskonflikt bekommt
   * die Kopie einen Namen mit Zusatz („Name (2).ext“). `newName` gibt bei genau einer Quelle den Namen vor; ist er
   * vergeben: `FILE_EXISTS`.
   */
  'files.copy': { params: { sources: string[]; target: string; newName?: string }; result: string[] };
  /**
   * Der Name, den `files.copy` für eine Kopie von `source` im Ordner `target` wählen würde: der Name der Quelle
   * selbst, wenn er dort frei ist, sonst einer mit Zusatz. Für den Vorschlag im Dialog „Copy“.
   */
  'files.suggestCopyName': { params: { source: string; target: string }; result: string };
  /** „Copy Path“: schreibt die absoluten Pfade (je Zeile einer) in die Zwischenablage. */
  'files.copyPaths': { params: { paths: string[] }; result: void };
  /** „Open in Explorer“: zeigt die Datei oder den Ordner markiert im Explorer. */
  'files.showInExplorer': { params: { path: string }; result: void };
  /**
   * Ein Bild für die Markdown-Vorschau als data-URL (PNG, JPEG, GIF, WebP, BMP, ICO, SVG). Pfade ausserhalb des Projekts
   * lehnt der Kern ab wie überall; ein Bild über 10 MB: `FILE_TOO_LARGE`; eine Datei, die kein Bild ist:
   * `INVALID_PARAMS`.
   */
  'files.readImage': { params: { path: string }; result: { dataUrl: string; size: number } };
  /**
   * Liest eine Datei für einen Tab (siehe `FileContent`). Ein Ordner: `NOT_A_FILE`. Hat eine Textdatei keinen
   * Zeilenumbruch (etwa eine neue, leere), ist `lineEnding` das im Projekt überwiegende (Rückfall LF).
   */
  'files.read': { params: { path: string }; result: FileContent };
  /**
   * Speichert den Text einer Datei in der angegebenen Kodierung (mit ihrem BOM); sonst wird nichts verändert. Zeilen,
   * die gleich geblieben sind, behalten ihr Zeilenende (auch in Dateien mit gemischten Zeilenenden); neue und geänderte
   * Zeilen bekommen `lineEnding`. Die Datei muss es geben.
   *
   * Mit `expectedStamp` (aus `files.read` oder dem letzten `files.write`) wird nur geschrieben, wenn die Datei noch
   * diesen Stand hat; sonst `FILE_CHANGED`, und nichts ist geschrieben. Lässt sich ein Zeichen in der Kodierung nicht
   * schreiben: `CANNOT_ENCODE`. Der eigene Schreibvorgang kommt nicht als `files.changed` zurück. Liefert den neuen
   * Stand.
   */
  'files.write': {
    params: { path: string; text: string; encoding: TextEncoding; lineEnding: LineEnding; expectedStamp?: string };
    result: { stamp: string };
  };
}

/** Alle Ereignisse: Name → Nutzlast. */
export interface Events {
  /** Eine Meldung für das Fenster. */
  'app.notice': Notice;
  /** Fortschritt einer Arbeit des Kerns für das Fenster (Statusleiste). */
  'app.progress': ProgressEvent;
  /** Die Einstellungen haben sich geändert (an alle Fenster); die Nutzlast sind alle Einstellungen. */
  'app.settingsChanged': AppSettings;
  /**
   * Das Fenster schliesst sich gleich oder Codium endet: Die Oberfläche speichert alle Tabs und antwortet mit
   * `editor.flushed` und derselben Kennung. Der Kern wartet darauf höchstens einige Sekunden.
   */
  'editor.flushRequest': { requestId: number };
  /**
   * Treffer einer Projektsuche, gesammelt. Zuletzt kommt eines mit `done`; mit `limitReached` gibt es mehr Treffer, als
   * gemeldet wurden, mit `error` ist die Suche gescheitert (etwa ein ungültiger regulärer Ausdruck).
   */
  'search.results': { searchId: number; matches: SearchMatch[]; done: boolean; limitReached?: true; error?: string };
  /** Dateien des Projekts wurden von aussen angelegt, geändert oder gelöscht (gebündelt). */
  'files.changed': FilesChangedEvent;
  /** Codium hat eine Dateioperation ausgeführt. */
  'files.operation': FileOperation;
  /**
   * Im Ordner `.git` des Projekts haben sich HEAD, der Index oder Refs geändert (gebündelt). Änderungen in `.git`
   * lösen sonst keine Dateiereignisse aus. Grundlage für den Git-Dienst (Ticket 15).
   */
  'git.dataChanged': Record<string, never>;
  /** Ausgabe eines Terminals. */
  'terminal.data': { terminalId: number; data: string };
  /** Die Shell eines Terminals ist beendet (auch nach `terminal.close`). */
  'terminal.exit': { terminalId: number; exitCode: number };
  /** Der Zustand des Repositorys hat sich geändert (Ticket 15). */
  'git.stateChanged': GitState;
  /** Die Refs haben sich geändert (eigene Aktion, Fetch, ausserhalb von Codium); der Log lädt neu (Ticket 19). */
  'git.refsChanged': Record<string, never>;
  /** Ein Eintrag der Git-Konsole ist neu oder fertig. */
  'git.console': GitConsoleEntry;
  /** Fehler und Warnungen einer Datei (ersetzen die bisherigen). */
  'language.diagnostics': { path: string; diagnostics: LanguageDiagnostic[] };
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
