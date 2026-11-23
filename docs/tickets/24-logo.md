# 24 – Logo und App-Symbol

Status: `ready-for-human` · Typ: HITL
Blockiert durch: –
User Stories: keine eigene; betrifft das Erscheinungsbild der ganzen App (Spezifikation „Lösung“, „Oberfläche“ und „Auslieferung“)
Spezifikation: „Oberfläche“ (Design), „Auslieferung und Abhängigkeiten“

Dieses Ticket kam nach Codium 1 dazu. Heute zeigen Installer, `Codium.exe`, Taskleiste und Fenster das Standardsymbol von Electron.

Typ HITL, weil die Wahl des Logos beim Nutzer liegt: Der Agent legt Entwürfe vor, der Nutzer wählt aus oder gibt Rückmeldung, erst dann wird eingebaut.

## Was gebaut wird

- **Entwürfe (zuerst, dann Rückmeldung des Nutzers):**
  - Drei bis vier eigenständige Entwürfe als SVG, jeweils mit kurzer Idee dahinter.
  - Eine Vorschauseite (eine lokale HTML-Datei, kein Start der App), die jeden Entwurf in den Grössen 16, 24, 32, 48, 256 px zeigt, auf dunklem und auf hellem Hintergrund, dazu in einer nachgestellten Taskleiste und in der Kopfzeile des Willkommensfensters.
  - Der Agent wartet auf die Wahl des Nutzers, arbeitet Rückmeldungen ein und legt bei Bedarf eine zweite Runde vor.
- **Vorgaben an das Logo:**
  - Eigenständig: Es darf nicht den Logos von IntelliJ bzw. JetBrains, VS Code oder VSCodium ähneln; auch nicht in Form oder Farbverlauf.
  - Einfach: klare Formen, die auch mit 16 px erkennbar bleiben; kein Text ausser höchstens einem Buchstaben.
  - Passend zum dunklen Design von Codium (Farben aus `src/renderer/styles/tokens.css`), und trotzdem gut sichtbar auf einer hellen Taskleiste.
- **Nach der Wahl, einbauen:**
  - Die SVG-Quelle liegt im Repository. Alle abgeleiteten Dateien (ICO mit den Grössen 16, 20, 24, 32, 40, 48, 64, 96, 128 und 256 px, PNG bis 512 px) entstehen reproduzierbar mit einem npm-Skript aus der Quelle. Keine Binärdatei ohne Quelle, kein Online-Werkzeug.
  - Installer, Deinstallierer, `Codium.exe`, die Verknüpfungen in Startmenü und auf dem Desktop tragen das Logo (Konfiguration von electron-builder).
  - Die Fenster setzen das Symbol auch selbst, damit Taskleiste und Alt + Tab es schon in der Entwicklungsversion zeigen.
  - Das Willkommensfenster zeigt das Logo gross über dem Titel; das Farbkürzel im Projektmenü bleibt, wie es ist.
  - Das README erwähnt, wo die Quelle liegt und wie man die Symbole neu erzeugt.

## Akzeptanzkriterien

- [x] Die Entwürfe und die Vorschauseite liegen vor, und der Nutzer hat einen Entwurf gewählt (im Abschnitt „Entscheidung“ des Tickets festgehalten, mit der Rückmeldung).
- [x] Das npm-Skript erzeugt aus der SVG-Quelle die ICO- und PNG-Dateien; zweimal ausgeführt entstehen dieselben Dateien.
- [x] Ein Einheitstest liest die ICO-Datei und prüft, dass alle verlangten Grössen enthalten sind.
- [x] Ein Playwright-Test (im Testmodus) prüft, dass das Willkommensfenster das Logo zeigt (Bild geladen, nicht leer).
- [x] `npm run test:packaged` prüft, dass `Codium.exe` im ungepackten Paket ein eigenes Symbol trägt und nicht das von Electron (etwa über den Vergleich der Symbol-Ressource mit dem erzeugten ICO).
- [ ] Alle Testläufe bleiben grün; der Installer lässt sich mit `npm run dist` bauen.

## Abnahme von Hand

- [ ] Das Logo gefällt; es wirkt auch mit 16 px in der Taskleiste und im Explorer (`Codium.exe`) noch klar.
- [ ] Installer und Deinstallierer zeigen das Logo, ebenso die Verknüpfungen im Startmenü und auf dem Desktop. Nach dem Aktualisieren einer bestehenden Installation kann Windows eine Weile noch das alte Symbol aus seinem Zwischenspeicher zeigen; dann nach einer Neuanmeldung nochmals ansehen.
- [ ] Taskleiste und Alt + Tab zeigen das Logo, bei hellem und dunklem Windows-Design und bei 100 % und 150 % Skalierung.
- [ ] `npm start`: Auch die Entwicklungsversion zeigt das Logo in Taskleiste und Alt + Tab, nicht das Symbol von Electron.
- [ ] Das Willkommensfenster sieht mit dem Logo über dem Titel stimmig aus.

## Hinweise

- **Name:** „Codium“ ist auch der Name anderer Werkzeuge (etwa VSCodium, eine freie Fassung von VS Code). Das Logo soll deshalb erst recht eigenständig sein. Ob der Name bleibt, ist nicht Teil dieses Tickets; falls der Nutzer ihn ändern möchte, wäre das ein eigenes Ticket.
- Die Spielregeln gelten auch hier: Die echte App nur über die Testläufe bzw. `launchCodium` starten, nie direkt; die Vorschauseite ist eine HTML-Datei und braucht die App nicht.

## Entscheidung (Nutzer, 2026-11-23)

Gewählt: **Entwurf 1 „Orbit“**. Ein offener Ring in Akzentblau (`#3574f0`) bildet das C; in seiner Öffnung sitzt ein grüner Punkt (`#5fb865`) wie ein Elektron, weil „-ium“ nach einem chemischen Element klingt. Rückmeldung des Nutzers, wörtlich: „den entwurf 1, Orbit finde ich toll“. Er hatte keine Änderungswünsche, deshalb gab es keine zweite Runde.

Zur Wahl standen vier Entwürfe: 1 Orbit, 2 Bausteine, 3 Klammer, 4 Fisch. Die Vorschauseite `docs/entwuerfe/24-logo/index.html` bleibt mit allen Entwürfen als Beleg der Wahl. Die Quelle des Logos liegt seither in `assets/logo`.

## Umsetzung (Agent, 2026-11-23)

- **Quelle:** `assets/logo/codium.svg` (Hauptfassung) und `assets/logo/codium-16.svg` (vereinfachte Fassung: dickerer Ring, gerade Enden, Punkt auf dem Pixelraster), unverändert aus dem gewählten Entwurf übernommen.
- **Erzeugen:** `npm run icons` (`scripts/icons.mjs`) rastert mit `@resvg/resvg-js` (neue Entwicklungsabhängigkeit, fest auf 2.6.2, MPL-2.0, ohne Installationsskript). 16, 20 und 24 px kommen aus der 16-px-Fassung; die verkleinerte Hauptfassung wirkte dort im Vergleich dünn. Ab 32 px kommt alles aus der Hauptfassung. Das ICO enthält 16, 20, 24, 32, 40, 48, 64, 96, 128 und 256 px. Bis 128 px sind es 32-Bit-Bitmaps mit Maske (das liest jedes Windows-Programm), 256 px ist ein PNG. Den Container schreibt `scripts/iconFormat.mjs` selbst, ohne weiteres Paket. Dazu kommen PNG-Dateien von 16 bis 512 px in `assets/icons/png`. Zweimal ausgeführt entstehen byte-gleiche Dateien. Sie sind eingecheckt, damit `npm run dist` sie ohne Zwischenschritt findet.
- **Paket:** `build.win.icon`, `nsis.installerIcon` und `nsis.uninstallerIcon` zeigen auf das ICO; die Verknüpfungen in Startmenü und auf dem Desktop übernehmen das Symbol der exe. Über `extraResources` liegt das ICO zusätzlich als `resources/codium.ico` neben dem App-Archiv.
- **Fenster:** Jedes `BrowserWindow` bekommt das ICO als `icon` (`src/main/appIcon.ts`): unpaketiert aus `assets/icons`, im Paket das neben dem App-Archiv.
- **Willkommensfenster:** Das Logo steht mit 64 px über dem Titel „Codium“. esbuild kopiert `codium.svg` als Datei nach `dist/renderer/assets` (Loader für `.svg`), so bleibt es unter der Regel „nur eigene Dateien der Oberfläche“. In der Kopfzeile gibt es kein Logo; das hatte die Vorschau nur vorgeschlagen.
- **README:** Abschnitt „Logo und App-Symbol“ (Quelle, `npm run icons`, wo das Symbol verwendet wird), dazu der Aufbau mit `assets/`.
- **Tests:**
  - `test/main/icons.test.ts` (schneller Lauf, 7 Tests): Das ICO enthält genau die verlangten Grössen im richtigen Format, jedes Bild deckt einen Teil der Fläche (nicht leer). Die eingecheckten Dateien entsprechen einer frischen Erzeugung, und zwei Erzeugungen sind byte-gleich; so fällt ein vergessenes `npm run icons` auf. Dazu kommen der Aufbau der Bitmaps (unten nach oben, Maske) und halbtransparente Pixel mit gerader statt vormultiplizierter Farbe. Geprüft sind ausserdem der Pfad für die Fenster und die Einträge für electron-builder.
  - `test/main/lockfile.test.ts` (schneller Lauf): Jedes `resolved` in `package-lock.json` beginnt mit `https://registry.npmjs.org/`.
  - `test/ui/logo.test.ts` (Playwright im Testmodus): Das Logo ist geladen, 64 × 64 px gross und steht über dem Titel. Auf eine Leinwand gezeichnet, deckt es einen Teil der Fläche. Die Datei kam aus dem Ordner der Oberfläche und wurde nicht abgewiesen.
  - `npm run test:packaged`: `scripts/iconFormat.mjs` liest die Symbol-Ressourcen der exe direkt aus der Datei, ohne sie zu starten. Geprüft wird, dass die erste Symbolgruppe von `Codium.exe` (die zeigt Windows) Byte für Byte aus den Bildern von `assets/icons/codium.ico` besteht und kein Bild mit der Gruppe von `electron.exe` teilt. Dazu muss das ICO für die Fenster neben dem App-Archiv liegen.
- **Installer:** Gebaut mit `electron-builder --win`, also wie `npm run dist`, aber ohne die Version hochzuzählen; das Hochzählen bleibt dem Nutzer. Die erste Symbolgruppe von `Codium Setup 0.1.0.exe` besteht ebenfalls aus den Bildern des ICO. Den Deinstallierer baut electron-builder nur vorübergehend, er liess sich nicht nachprüfen; er gehört zur Abnahme von Hand.
- **Testläufe vor dem Review** (am 2026-11-23, während parallel die Tests zweier anderer Worktrees liefen):
  - `npm run typecheck`: grün.
  - `npm test`: 385 von 385 Tests grün (43 Dateien). Im ersten Lauf schlug ein Test der Dateiüberwachung mit `EPERM` fehl; er war einzeln und im zweiten vollen Lauf grün.
  - `npm run test:slow`: 37 von 37 grün (7 Dateien). Im ersten Lauf lief der Neustart-Test des TypeScript-Servers ins Zeitlimit; er war einzeln und im zweiten vollen Lauf grün.
  - `npm run test:packaged`: alle 21 Prüfungen bestanden.
  - `npm run test:ui`: drei volle Läufe mit 4, 11 und 3 von 80 roten Tests, jedes Mal in anderen Dateien. Die Gründe waren `EPERM` beim Löschen der Temp-Ordner, Zeitlimits und zweimal „Testmodus verletzt: … hat den Fokus“. `logo.test.ts` war in allen drei Läufen grün. Jeder rote Test war beim Wiederholen grün, ausser „öffnet eine JDK-Klasse schreibgeschützt“ (`java.test.ts`). Der scheiterte auch auf dem Stand ohne dieses Ticket in zwei von drei Läufen (gegengeprüft) und war mit diesem Ticket einmal grün. Er wartet nach dem Sprung nur die Grundeinstellung von 1 s, bis die Klasse sichtbar wird. Ein voller Lauf ganz ohne Rot steht deshalb noch aus und sollte auf einem ruhigen Rechner nachgeholt werden.
- **Nebenbei:** Der Oberflächentest „bricht einen hängenden Klon mit Cancel ab“ wartete nur die Grundeinstellung von 1 s auf die Meldung. Unter Last dauerte das Beenden von Git samt Prozessbaum 1 bis 1,5 s, und der Test scheiterte auch ohne die Änderungen dieses Tickets (gegengeprüft). Er wartet jetzt bis 10 s.
- **Auffälligkeit, eigener Fix (nicht in diesem Branch):** Laufen Oberflächentests unter Last ins Zeitlimit, können verborgene Codium-Instanzen übrig bleiben. Das verletzt die Spielregel „Aufräumen“. Beobachtet wurde es, während parallel die Oberflächentests anderer Worktrees liefen; die Testläufe dieses Tickets liessen drei Instanzen zurück (13:01, 13:30, 13:38). Der Ablauf, soweit erkennbar:
  1. Ein Test läuft ins Zeitlimit von 90 s (etwa „Einstellungen“ oder „Markdown-Vorschau“), oder das Beenden zieht sich hin.
  2. Nach dem Test beendet `beforeTempDirRemoval` die App über `stopApp`: zuerst `app.close()` mit 15 s Frist, danach `killProcessTree`. Die App lief danach trotzdem weiter.
  3. `removeDir` gibt nach rund 1 s Wiederholungen mit `EPERM` auf, weil die laufende App Dateien im Datenordner hält.
  4. Nach dem Lauf läuft der Hauptprozess von Electron ohne Elternprozess weiter, samt GPU-, Renderer- und Netzwerk-Prozess.

  Warum weder `app.close()` noch `killProcessTree` greifen, ist nicht untersucht.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-23. Für gut befunden und unverändert geblieben sind: der ICO-Schreiber (Verzeichnis, Masken, PNG bei 256 px), die Reproduzierbarkeit, die Auswertung der PE-Ressourcen in `test-packaged.mjs`, die Pfade für Entwicklung und Paket, der SVG-Loader samt Sicherheitsrichtlinie und die Änderung am Klon-Test. Eingearbeitet:

- **Lockfile zeigte auf eine private Registry** (Fehler): Die neuen Einträge von `@resvg` in `package-lock.json` hatten als `resolved` die Adresse einer Registry, die in der globalen npm-Konfiguration des Rechners eingestellt ist. Host und Präfix sind jetzt `https://registry.npmjs.org/`; Pfad und `integrity` sind gleich geblieben. Das ist von Hand gemacht, ohne `npm install`, und ohne projekteigene `.npmrc`. Der neue Test `test/main/lockfile.test.ts` verlangt das für jeden Eintrag und sagt in der Fehlermeldung, was zu tun ist. Einbau und Review sind in einem einzigen Commit zusammengefasst, damit die interne Adresse in keinem Commit steht.
- **Testlücke beim Alpha:** resvg liefert vormultiplizierte Farben, und kein Test hätte bemerkt, wenn die Umrechnung fehlte. Ein neuer Test rastert ein halbtransparentes Rechteck und erwartet die gerade Farbe, auch im ICO. Gegenprobe: Ohne die Umrechnung ist er rot.
- **Version fest:** `@resvg/resvg-js` steht fest auf `2.6.2` statt `^2.6.2`, in `package.json` und von Hand im Lockfile.
- **Prüfung „nicht das Symbol von Electron“ ehrlich:** Sie vergleicht jetzt die Symbolgruppe von `Codium.exe` direkt mit der von `electron.exe`. Fehlt `electron.exe`, erscheint eine FEHL-Zeile statt eines Absturzes.
- **Abnahme von Hand angeglichen:** Das Ticket hat jetzt dieselben fünf Punkte wie `docs/abnahme.md`, auch den zur Entwicklungsversion und den Hinweis auf den Symbol-Zwischenspeicher von Windows.

Offen bleibt das Kriterium „Alle Testläufe bleiben grün“, bis die vollen Läufe allein, ohne parallele Tests anderer Worktrees, gelaufen sind.
