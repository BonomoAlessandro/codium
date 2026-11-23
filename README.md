# Codium

Eine kleine eigene IDE im Stil des neuen IntelliJ, als Desktop-App für Windows: nur dunkel, englische Oberfläche,
ein Fenster pro Projekt. Grundlage sind die [Spezifikation](docs/specs/codium-v1.md) und die
[Tickets](docs/tickets/README.md); die Prüfliste für die Abnahme von Hand steht in [docs/abnahme.md](docs/abnahme.md).

## Was Codium 1 kann

- **Projekte und Fenster:** Ein Projekt ist ein Ordner und öffnet in einem eigenen Fenster. Beim Start kommen die
  zuletzt offenen Projekte wieder (mit Lage, Tabs und Cursor), sonst erscheint ein Willkommensfenster mit
  „Open Folder“, „Clone Repository“ und den zuletzt geöffneten Projekten.
- **Aufbau wie IntelliJ:** Kopfzeile mit Projektmenü und Git-Branch, Werkzeugfenster links („Project“, „Commit“),
  unten („Terminal“, „Git“, „Find“) und rechts („Database“), in der Mitte der Code in Tabs, unten die Statusleiste
  mit Fortschritt laufender Arbeiten. Meldungen erscheinen unten rechts.
- **Dateibaum:** Anlegen, Umbenennen, Kopieren und Einfügen, Löschen in den Papierkorb, „Copy Path“, „Open in
  Explorer“, „Open in Terminal“; folgt Änderungen von aussen. Ignorierte und geänderte Dateien in Git-Farben.
- **Editor:** Monaco (der Editor aus VS Code) mit den Farben von IntelliJ „Dark“ und JetBrains Mono. Speichert
  automatisch, erhält Kodierung (auch Windows-1252, UTF-16) und Zeilenende, lädt von aussen geänderte Dateien neu und
  fragt bei gleichzeitigen Änderungen. Tabs mit Anheften, Ctrl + Tab und Tab-Menü; Bilder als Bild.
- **Markdown:** `.md` öffnet geteilt mit Vorschau samt Mermaid-Diagrammen und Bildern aus dem Projekt.
- **Suchen:** Datei nach Namen, zuletzt geöffnete Dateien, Suche im ganzen Projekt (ripgrep) mit Trefferliste.
- **Sprachfunktionen für TypeScript/JavaScript und Java:** Ctrl + Linksklick zur Definition (auch in Bibliotheken und
  im JDK, dann schreibgeschützt mit Quelltext), Verwendungen, Implementierungen, Hover, Fehler, Vervollständigung mit
  Auto-Import, semantische Färbung, Symbolsuche, Zurück und Vor. TypeScript über den nativen Server von TypeScript 7
  (für Projekte bis TypeScript 6 über typescript-language-server), Java über jdtls mit Maven, Gradle und Lombok.
- **Git:** Branch-Menü (anlegen, wechseln, umbenennen, löschen; Push…, Pull, Fetch), Änderungsansicht mit Häkchen
  statt Staging-Bereich (Commit, Amend, Commit and Push, Rollback, .gitignore), Vergleichsansicht, Änderungsbalken im
  Editor mit „Rollback Lines“, Konflikte nach einem Pull (Merge und Rebase mit Abort/Continue), Log mit Graph und
  Filtern, Git-Konsole mit allen Aufrufen, Klonen.
- **Terminal:** mehrere Tabs mit PowerShell 7, Windows PowerShell, cmd oder Git Bash.
- **Datenbank (PostgreSQL):** Verbindungen pro Projekt (Passwort verschlüsselt mit Windows), Baum aus Schemas,
  Tabellen, Views und Spalten, Tabelleninhalt in Seiten zu 500 Zeilen mit Sortieren und WHERE-Filter, Bearbeiten mit
  Änderungssatz, der in einer Transaktion gespeichert wird.
- **Einstellungen** (Ctrl + Alt + S): Shell fürs Terminal, Schriftgrösse, JDK für den Java-Sprachserver; gelten für
  alle Projekte.

### Tastenkürzel

Wie in IntelliJ, auch auf der Schweizer Tastatur (Buchstaben nach dem getippten Zeichen, Ziffern nach ihrer Lage).

| Bereich | Kürzel |
|---|---|
| Werkzeugfenster | Alt + 1 Project, Alt + 0 Commit, Alt + F12 Terminal, Alt + 9 Git, Alt + 3 Find |
| Allgemein | Ctrl + Alt + S Einstellungen, Ctrl + S alles speichern, Ctrl + F4 Tab schliessen, Ctrl + Tab / Ctrl + Shift + Tab zuletzt benutzte Tabs |
| Suchen | Ctrl + Shift + N oder zweimal Shift Datei, Ctrl + E zuletzt geöffnete Dateien, Ctrl + Shift + F im Projekt, Ctrl + N Klasse, Ctrl + Alt + Shift + N Symbol |
| Editor | Ctrl + F Suchen, Ctrl + R Ersetzen, Ctrl + G Zu Zeile, Ctrl + D Zeile verdoppeln, Ctrl + Y Zeile löschen, Ctrl + / Kommentar, Ctrl + W / Ctrl + Shift + W Auswahl erweitern/verkleinern, Alt + Shift + ↑/↓ Zeile verschieben, Ctrl + Z / Ctrl + Shift + Z, Ctrl + Mausrad Schriftgrösse |
| Navigation | Ctrl + Linksklick oder Ctrl + B Definition, Ctrl + Alt + B Implementierungen, Ctrl + Q Dokumentation, Alt + F7 Verwendungen, Ctrl + Alt + ← / → (und die Seitentasten der Maus) Zurück/Vor |
| Git | Ctrl + K Commit, Ctrl + Shift + K Push, Ctrl + T Pull |
| Datenbank | Ctrl + Enter „Submit“ im Tabelleninhalt |

## Voraussetzungen

### Zum Benutzen

- Windows 10 oder 11
- [Git für Windows](https://git-scm.com/download/win) im PATH. Ohne Git öffnen Projekte trotzdem; nur die Git-Funktionen fehlen, und Codium zeigt einen Hinweis.
- Ein JDK 25 oder neuer, nur für die Java-Sprachfunktionen (Ctrl + Linksklick, Vervollständigung, Fehler in Java). Codium findet es selbst in den üblichen Installationsordnern (Oracle, Eclipse Adoptium/Temurin, Microsoft, Amazon Corretto, Azul Zulu, BellSoft, auch unter `%LOCALAPPDATA%\Programs`) und unter den von IntelliJ geladenen JDKs (`%USERPROFILE%\.jdks`); welches es nimmt, lässt sich unter „Settings…“ wählen. `JAVA_HOME` muss nicht darauf zeigen, und ältere JDKs für ältere Projekte dürfen zusätzlich installiert sein. Ohne JDK 25 erscheint ein Hinweis erst beim Öffnen eines Java-Projekts; alles andere funktioniert.
- Optional PowerShell 7 für das Terminal (sonst Windows PowerShell).
- Ausdrücklich nicht nötig: Node.js, Maven, Gradle, ein PostgreSQL-Client. TypeScript, jdtls und Lombok bringt Codium mit; Maven- und Gradle-Projekte importiert jdtls selbst (Gradle über den Wrapper des Projekts).

### Zum Entwickeln

- Node.js 22 oder neuer mit npm
- Git
- Netzzugang beim ersten Bauen und für einzelne langsame Tests (npm-Pakete, jdtls, Maven Central und die Gradle-Verteilung)
- **jdtls und Lombok** (Java-Sprachserver) holt `node build.mjs` bzw. `npm run fetch:java` in fester Version mit Prüfsumme von download.eclipse.org und Maven Central nach `.cache/java-tools`. Ohne Netz geht das Bauen weiter; der langsame Testlauf überspringt dann die Java-Tests.
- **JDK 25** für die Java-Tests im langsamen Testlauf (sonst überspringen sie sich mit Meldung).
- **Kein C++-Compiler nötig:** node-pty (Terminal) bringt fertige Binärdateien für Windows x64 und arm64 mit; `npm ci` kompiliert nichts. Nur wenn `npm_config_build_from_source=true` gesetzt ist oder eine andere Plattform benutzt wird, baut node-pty selbst und braucht dann Python und die C++-Build-Tools von Visual Studio.
- **Kein PostgreSQL nötig:** Die Datenbank-Tests starten mit `embedded-postgres` einen eigenen Server auf einem freien Zufallsport (nie 5432) und beenden ihn danach.

## Installieren

`npm run dist` baut den Installer `release\Codium Setup <version>.exe` und zählt dafür die Version hoch: Solange
Codium bei 0.x ist, steigt die zweite Stelle (0.1.0 → 0.2.0 → 0.3.0); ein Schritt auf 1.0 geschieht von Hand. Die neue
Version steht danach in `package.json` und `package-lock.json` und gehört committet; scheitert das Bauen, bleibt die
alte. `npm run test:packaged` zählt nicht hoch. Der Installer installiert für den angemeldeten Benutzer
(ohne Administratorrechte), der Ordner lässt sich wählen. Codium speichert seine Daten (Fensterlage, Einstellungen,
Zustand je Projekt samt Datenbank-Verbindungen) unter `%APPDATA%\Codium`, nie im Projektordner. Updates gibt es nicht
automatisch, und der Installer ist nicht signiert (Windows SmartScreen fragt beim ersten Start nach).

## Entwicklung

```powershell
npm ci
npm start          # bauen + App starten
npm run dev        # wie start, mit Sourcemaps und unminifiziert, mit Entwicklungsmenü (Ctrl + R, Ctrl + Shift + I)
npm run typecheck  # TypeScript prüfen
npm run dist       # Version hochzählen (0.x) und Installer bauen -> release\Codium Setup <version>.exe
```

Beim ersten `npm start` lädt Electron sein Programm einmalig herunter.

**Eigener Datenordner:** Unpaketiert (`npm start`, `npm run dev`) verwendet Codium `%APPDATA%\Codium-dev` und berührt
eine installierte App (`%APPDATA%\Codium`) nicht. Die Einzelinstanz-Sperre hängt am Datenordner: Die
Entwicklungsversion läuft neben einer installierten Codium, aber nur einmal.

### Tests

Vier Testläufe; keiner berührt den Desktop, die echten Einstellungen oder fremde Server.

| Lauf | Was | Voraussetzungen |
|---|---|---|
| `npm test` | Schnelle Tests: der Kern am Vertrag in Node ohne Electron (nachgemachte Ports), Regeln der Oberfläche ohne DOM, Git gegen Temp-Repositories | – |
| `npm run test:slow` | Langsame Tests: echte Sprachserver (TypeScript, jdtls mit Maven und Gradle), Terminal mit echten Shells, PostgreSQL aus embedded-postgres | JDK 25 und Netz für die Java-Tests (sonst übersprungen) |
| `npm run test:ui` | Oberflächentests: die gebaute App im Testmodus, gesteuert mit Playwright | – |
| `npm run test:packaged` | Prüfungen am ungepackten Paket (`release\win-unpacked`): Inhalt, mitgelieferte Programme, Sprachserver im Paket | – |

Alle Tests schirmen ab: Git mit eigener Konfiguration (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`) und nur gegen
Temp-Repositories, Maven und Gradle mit eigenen Einstellungen unter `.test-cache`, Datenbanken nur aus embedded-postgres,
Temp-Ordner werden gelöscht, und am Ende läuft kein gestarteter Prozess mehr.

**Testmodus** der echten App (Details in `src/main/testMode.ts` und in den Spielregeln unter `docs/tickets/README.md`):
`CODIUM_TEST_HIDDEN=1` öffnet Fenster ausserhalb des Bildschirms ohne Fokus und zeichnet „nach vorne holen“, Explorer
und Zwischenablage nur auf. `CODIUM_TEST_DATA_DIR` ersetzt `%APPDATA%` als Wurzel des Datenordners,
`CODIUM_TEST_PICK_DIR` beantwortet die Ordnerauswahl, und `CODIUM_TEST_NO_GIT=1` lässt Codium so tun, als fehle Git.
`CODIUM_TEST_JAVA=1` schaltet im Testmodus den Java-Sprachserver ein (mit `CODIUM_TEST_MAVEN_SETTINGS`). Im Testmodus
liegen im Hauptprozess die Aufzeichnung (`globalThis.__codiumTest`) und Eingriffe für Oberflächentests
(`globalThis.__codiumTestHooks`).

## Aufbau

Grundsatz wie bei THub: Die Logik liegt im Hauptprozess, ohne direkte Abhängigkeit von Electron, damit sie sich in
Node testen lässt. Die Oberfläche zeigt an und schickt Befehle.

- **App-Kern** (`src/main/core/appCore.ts`): Fenster, Projekte, Willkommensfenster, Beenden und Wiederöffnen,
  Einstellungen, Prüfung der Voraussetzungen, Klonen, Befehlsverteilung.
- **Projekt-Kern** (`src/main/core/projectCore.ts`) je Projektfenster, mit seinen Diensten: Dateien
  (`fileService.ts`, Dateiüberwachung, Suche mit ripgrep), Terminal (`terminalService.ts`), Sprachen
  (`language/`), Git (`git/`), Datenbank (`database/`) und dem Projekt-Zustand. Baut er ab, enden alle Prozesse
  und Verbindungen des Projekts.
- **Ports** (`src/main/core/ports.ts`): alles, was Electron oder das Betriebssystem braucht (Fenster, Ordnerauswahl,
  Geheimnisse, Papierkorb, Explorer, Zwischenablage, System). Echt in `src/main/electron` und `src/main/system`, in
  Tests nachgemacht (`test/support/fakePorts.ts`).
- **Vertrag** (`src/shared/types.ts`): Befehle und Ereignisse zwischen Oberfläche und Kern, Fehlercodes; die
  Oberfläche erreicht den Kern nur über `window.codium` (`src/preload/preload.ts`).
- **Oberfläche** (`src/renderer`): React mit TypeScript, normales CSS mit Design-Variablen. Projektfenster und
  Werkzeugfenster (`project/`), Editor und Tabs (`editor/`), Git (`git/`), Datenbank (`database/`), Terminal
  (`terminal/`), Suche (`search/`), Markdown (`markdown/`), Sprach-Client (`language/`), zentrale Tastenbelegung
  (`keymap.ts`).

```
src/
  shared/      Vertrag, Farben der Kopfzeile, Regeln für Dateinamen
  main/        Hauptprozess: main.ts verbindet Kern, Ports und IPC; core/ ohne Electron; electron/ und system/ als Ports
  preload/     API window.codium
  renderer/    React-Oberfläche
test/
  support/     Test-Gerüst (nachgemachte Ports, Temp-Ordner, Git, PostgreSQL, Starthilfe für die App)
  main/, renderer/, slow/, ui/   die Testläufe
scripts/       jdtls holen, Prüfungen am Paket
docs/          Spezifikation, Tickets, Prüfliste für die Abnahme
```

| Teil | Technik |
|---|---|
| App-Hülle | [Electron](https://www.electronjs.org/) |
| Oberfläche | [React](https://react.dev/) mit TypeScript, Monaco, xterm.js |
| Sprachserver | TypeScript 7 (nativ), typescript-language-server, jdtls mit Lombok |
| Weiteres | node-pty, ripgrep, node-postgres, markdown-it, DOMPurify, Mermaid |
| Build | esbuild (Bundling), TypeScript (nur Typecheck), electron-builder (NSIS-Installer) |
| Tests | Vitest, Playwright, embedded-postgres |

## Bewusst nicht dabei

Codium 1 lässt unter anderem weg: Ausführen und Debuggen, Refactorings und Code formatieren, weitere Sprachen und
Datenbanken, eine SQL-Konsole, Stash, Cherry-Pick und Drei-Wege-Merge, automatischen Fetch und erzwungenen Push, ein
helles Design, automatische Updates und Plugins. Die vollständige Liste steht in der Spezifikation unter
[„Ausserhalb des Umfangs“](docs/specs/codium-v1.md#ausserhalb-des-umfangs).
