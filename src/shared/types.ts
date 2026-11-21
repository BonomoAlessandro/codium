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

/** So viele Treffer liefert die Projektsuche höchstens; danach meldet sie „more results“. */
export const SEARCH_MATCH_LIMIT = 2000;

/** Einstellungen, die für alle Projekte gelten (im App-Zustand). Felder kommen mit den Tickets, die sie brauchen. */
export interface AppSettings {
  /** Schriftgrösse aller Editoren, wie Monaco sie zählt. */
  fontSize: number;
  /** JDK für den Java-Sprachserver (Ordner); `null` heisst „Newest detected“. */
  jdk: string | null;
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
  /** Ein Zeichen lässt sich in der Kodierung der Datei nicht speichern; `data.character` ist das Zeichen. */
  cannotEncode: 'CANNOT_ENCODE',
  /** Die Datei hat sich seit dem erwarteten Stand geändert (etwa von aussen); `data.path` ist der Pfad. */
  fileChanged: 'FILE_CHANGED',
  /** Git wurde nicht gefunden; Git-Funktionen sind aus. */
  gitNotFound: 'GIT_NOT_FOUND',
  /** Git ist gescheitert; die Meldung ist die von Git im Wortlaut. */
  gitFailed: 'GIT_FAILED',
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
