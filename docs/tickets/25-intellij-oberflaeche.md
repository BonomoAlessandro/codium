# 25 – Oberfläche näher an IntelliJ: runde Formen, Branch-Dropdown mit Symbolen

Status: `ready-for-human` · Typ: HITL
Blockiert durch: –
User Stories: 24 (dunkel im Stil des neuen IntelliJ), 94–96 (Branch-Menü)
Spezifikation: „Oberfläche“, „Git“ (Branch-Menü)

Dieses Ticket kam nach Codium 1 dazu, auf Wunsch des Nutzers: Codium soll sich in der Oberfläche stärker an IntelliJ orientieren.

Typ HITL, weil das Aussehen Geschmackssache ist: Der Agent legt zuerst eine Skizze vor, der Nutzer gibt sie frei oder gibt Rückmeldung, erst dann wird eingebaut. So wurde schon die Symbolleiste entschieden (Präzisierung 37 der Spezifikation).

## Heutiger Stand

- **Branch-Menü** (`src/renderer/git/BranchPopup.tsx`): Ein Klick auf den Branch in der Kopfzeile öffnet ein Suchfenster oben in der Mitte des Fensters, im selben Rahmen wie Ctrl + Shift + N. Es ist kein Dropdown, das am Branch-Knopf hängt.
- **Aktionen im Branch-Menü:** „Commit…“, „Push…“, „Pull“, „Fetch“ und „New Branch…“ stehen als reine Textzeilen über den Branches, ohne Symbole und ohne Tastenkürzel. Die Branches selbst und ihr Untermenü (Checkout, New Branch from…, Rename…, Delete) haben ebenfalls keine Symbole.
- **Rundungen:** In `src/renderer/styles/app.css` stehen Radien von 0, 2, 3, 4, 6, 8 und 10 px nebeneinander, jeweils von Hand gesetzt. Es gibt keine gemeinsamen Variablen in `tokens.css`. Auswahlbalken in Listen und Menüs gehen über die ganze Breite und sind eckig.

## Was gebaut wird

- **Skizze (zuerst, dann Rückmeldung des Nutzers):**
  - Eine Vorschauseite als lokale HTML-Datei, die die App nicht startet. Sie zeigt den heutigen Stand und den Vorschlag nebeneinander: Kopfzeile mit offenem Branch-Dropdown (mit offenem Untermenü), Projektmenü, ein Kontextmenü, einen Dialog, Knöpfe, Eingabefelder, Datei-Tabs, ein Werkzeugfenster mit Baum und Auswahl.
  - Für die grossen Flächen zeigt sie zwei Varianten: (a) nur die Bedienelemente rund, die Flächen wie heute; (b) zusätzlich Werkzeugfenster und Editor als abgerundete Flächen mit schmalem Abstand dazwischen, wie im neueren IntelliJ-Design „Islands“.
  - Der Agent wartet auf die Wahl des Nutzers, arbeitet Rückmeldungen ein und legt bei Bedarf eine zweite Runde vor.
- **Rundungen, einheitlich:**
  - Radien als Variablen in `src/renderer/styles/tokens.css` (etwa klein für Knöpfe, Eingabefelder, Tabs und Auswahl, mittel für Menüs und Popups, gross für Dialoge und, bei Variante b, für die Flächen). Richtwerte: 4–6 px, 8 px und 10–12 px; die endgültigen Werte folgen der freigegebenen Skizze.
  - Alle Radien in `app.css` nutzen diese Variablen; feste Werte bleiben nur für Kreise (`50%`) und bewusst eckige Stellen (`0`).
  - Auswahl und Hover in Listen und Menüs als abgerundeter Balken mit kleinem Abstand zum Rand, wie im neuen IntelliJ: im Projektbaum, in der Änderungsansicht, in Menüs, im Branch-Dropdown, in den Suchfenstern und in der Datenbankliste.
- **Branch-Menü als echtes Dropdown:**
  - Es öffnet direkt unter dem Branch-Knopf der Kopfzeile, links bündig mit ihm, wie das Projektmenü, nicht mehr oben in der Mitte. Escape oder ein Klick daneben schliesst es; danach liegt der Fokus wieder auf dem Branch-Knopf.
  - Oben das Suchfeld; Tippen filtert sofort, wie heute.
  - Darunter die Aktionen als Zeilen mit Symbol und, wo Codium eines hat, dem Tastenkürzel rechts: „Pull“ (Ctrl + T), „Commit…“ (Ctrl + K), „Push…“ (Ctrl + Shift + K), „New Branch…“. „Fetch“ ist wie in IntelliJ ein Symbolknopf rechts in der Titelzeile des Dropdowns (Tooltip „Fetch“); die Spezifikation verlangt Fetch im Branch-Menü (User Story 95), und das bleibt so erfüllt.
  - Die Gruppen „Local“ und „Remote“ wie heute, jede Zeile mit Branch-Symbol. Der aktuelle Branch hat ein eigenes, hervorgehobenes Symbol statt des Textes „current“. Voraus und zurück stehen als kleine Pfeile mit Zahl, eingehend und ausgehend farbig unterschieden.
  - Eine gewählte Branch-Zeile zeigt rechts einen Pfeil (›); ihr Untermenü öffnet rechts daneben, per Maus beim Darüberfahren oder Klick, per Tastatur mit Enter oder Pfeil rechts. Pfeil links schliesst das Untermenü wieder. Die Einträge im Untermenü haben Symbole, wo IntelliJ welche zeigt (etwa Checkout, New Branch from…, Delete); die übrigen behalten den Platz frei, damit die Texte bündig stehen.
- **Menüs allgemein:**
  - `src/renderer/popup/Menu.tsx` bekommt ein optionales Symbol pro Eintrag, in einer eigenen, bündigen Spalte.
  - Im Projektmenü zeigen die zuletzt geöffneten Projekte ihr Farbkürzel, wie in der Kopfzeile und wie in IntelliJ.
- **Symbole:**
  - Eigene SVG-Symbole in `src/renderer/icons.tsx`, im Stil der bestehenden (16 px, Linien in der Symbolfarbe, eine Akzentfarbe nur wo sie etwas bedeutet). Sie dürfen sich in der Form an IntelliJ anlehnen, aber keine Dateien von JetBrains übernehmen. Wird doch eine frei lizenzierte Sammlung genutzt, steht ihre Lizenz im Repository.
  - Die zugänglichen Namen bleiben: „Commit…“, „Push…“, „Pull“, „Fetch“ und „New Branch…“ sind für Screenreader und Tests weiter unter diesem Namen zu finden.

## Entscheidung (Nutzer, 2026-11-23)

Skizze: [docs/entwuerfe/25-oberflaeche/index.html](../entwuerfe/25-oberflaeche/index.html) (bleibt als Beleg liegen).

Rückmeldung des Nutzers, wörtlich: „wir wollen mit option B weiterfahren“

Zu den übrigen Fragen der Skizze hat der Nutzer nichts anderes gesagt; die Punkte 2 bis 10 folgen deshalb den Empfehlungen, die ihm vorgelegt wurden.

1. Variante b: Werkzeugfenster und Editor als Inseln.
2. Inseln einheitlich in der Editorfarbe `#1e1f22`; der Rahmen (Kopfzeile, Leisten, Statusleiste) bleibt `#2b2d30`. `theme.ts` bleibt unverändert.
3. Inseln mit 10 px Radius und 6 px Abstand.
4. Der aktive Datei-Tab ist eine runde Fläche (statt des blauen Unterstrichs).
5. Knöpfe und Eingabefelder 6 px, Auswahlbalken 4 px mit 6 px Abstand zum Rand.
6. Branch-Dropdown mit eigener Titelzeile „Git Branches“ und Fetch-Knopf über dem Suchfeld.
7. Gelbes Etikett für den aktuellen Branch (Farbe wie HEAD im Git-Log); die Liste bleibt alphabetisch.
8. „Commit…“ mit Häkchen wie in IntelliJ, „Rename…“ ohne Symbol.
9. Im Projektmenü Symbole für „Open Folder…“, „Clone Repository…“ und „Settings…“, dazu die Farbkürzel der zuletzt geöffneten Projekte.
10. Voraus und zurück auch in der Kopfzeile als farbige Pfeile.

Radien laut Skizze: `--radius-xs` 3 px, `--radius-s` 4 px, `--radius-m` 6 px, `--radius-l` 8 px, `--radius-xl` 10 px, `--radius-island` 10 px; dazu `--island-gap` 6 px und `--list-inset` 6 px.

## Akzeptanzkriterien

- [x] Die Vorschauseite liegt vor, und der Nutzer hat den Vorschlag freigegeben, mit Wahl der Variante für die Flächen (im Abschnitt „Entscheidung“ des Tickets festgehalten, mit der Rückmeldung).
- [x] Ein Einheitstest liest `app.css` und prüft, dass alle Radien über die Variablen aus `tokens.css` laufen (ausser `50%` und `0`).
- [x] Ein Playwright-Test (im Testmodus) prüft, dass das Branch-Dropdown direkt unter dem Branch-Knopf öffnet: Oberkante knapp unter dessen Unterkante, links bündig.
- [x] Ein Playwright-Test prüft, dass die Aktionszeilen „Pull“, „Commit…“, „Push…“ und „New Branch…“ ein Symbol tragen, die Kürzel anzeigen und ausführbar sind, und dass der Knopf „Fetch“ in der Titelzeile fetcht.
- [x] Ein Playwright-Test prüft die Bedienung per Tastatur: Pfeile, Enter bzw. Pfeil rechts öffnet das Untermenü, Pfeil links schliesst es, Escape schliesst das Dropdown und gibt den Fokus an den Branch-Knopf zurück.
- [x] Die bestehenden Oberflächentests (`test/ui/git.test.ts` und weitere, die Menüs nutzen) laufen angepasst weiter.
- [ ] Alle Testläufe bleiben grün (`npm test`, `npm run test:slow`, `npm run test:ui`, `npm run test:packaged`).

## Abnahme von Hand

- [ ] Codium wirkt neben IntelliJ stimmig: Rundungen, Auswahlbalken, Menüs und Dialoge fühlen sich vertraut an.
- [ ] Das Branch-Dropdown bedient sich wie das von IntelliJ, mit Maus und Tastatur.
- [ ] Die Symbole sind bei 100 % und 150 % Skalierung klar und eindeutig.
- [ ] Werkzeugfenster und Editor als Inseln: Bei normalem und maximiertem Fenster sind die Abstände gleichmässig, nichts ragt über die runden Ecken hinaus, und die Griffe im Abstand lassen sich gut ziehen.

## Hinweise

- Bildschirmfotos für die Abnahme entstehen über Playwright im Testmodus (verborgenes Fenster), nicht durch einen Start der App.
- Die Spielregeln gelten auch hier: Die echte App nur über die Testläufe bzw. `launchCodium` starten, nie direkt; die Vorschauseite ist eine HTML-Datei und braucht die App nicht.
- Mehr als Rundungen, Menüs und Branch-Dropdown umfasst dieses Ticket nicht. Weitere Angleichungen an IntelliJ, die der Nutzer beim Freigeben der Skizze wünscht, werden eigene Tickets, wenn sie über diesen Rahmen hinausgehen.

## Umsetzung (Agent, 2026-11-23)

- **Rundungen:** `tokens.css` hat `--radius-xs` (3 px), `--radius-s` (4 px), `--radius-m` (6 px), `--radius-l` (8 px), `--radius-xl` (10 px) und `--radius-island` (10 px), dazu `--island-gap` und `--list-inset` (je 6 px) und die Git-Farben `--git-incoming`, `--git-outgoing`, `--git-head`. Alle Radien in `app.css` laufen über diese Variablen; fest bleiben nur `50%` (Punkt „ungespeichert“) und `0` (Knöpfe in Monaco). Knöpfe, Eingabe- und Suchfelder haben jetzt 6 statt 4 px.
- **Inseln (Variante b):** Die Werkbank hat die Panelfarbe; jedes Werkzeugfenster (`.tool-window`) und der Code-Bereich sind Inseln in der Editorfarbe mit `--radius-island` und `overflow: hidden`. Der Abstand liegt als Innenabstand in der Fläche einer Seite (`.tool-window-side`), so bleiben die gespeicherten Grössen, die Mindestgrössen und die Rechnung in `toolWindowLayout.ts` unverändert. Der Griff zum Ziehen liegt im Abstand (8 px breit, 1 px über die Ränder). Im Projektfenster entfallen die Trennlinien unter der Kopfzeile, an den Leisten und über der Statusleiste; das Willkommensfenster bleibt, wie es war. `theme.ts` ist unverändert.
- **Auswahlbalken:** Projektbaum, Suchfenster, Werkzeugfenster „Find“, Änderungsansicht, Git-Log und Datenbankliste zeigen Auswahl und Hover als runden Balken mit 6 px Abstand zum Rand; der Einzug in Baum und Datenbankliste ist so verrechnet, dass die Texte an derselben Stelle stehen wie vorher. Git-Log und Datenbank nutzen jetzt dieselbe Auswahlfarbe wie die übrigen Listen.
- **Datei-Tabs:** Hover und aktiver Tab als runde Fläche (6 px) statt des blauen Unterstrichs.
- **Felder und Häkchen:** Fokus und Fehler als 2 px breiter Rand. Eigene Häkchen (3 px Radius, angehakt in der Akzentfarbe, auch „teilweise“ in der Änderungsansicht). Die Filterfelder im Git-Log und in der Tabellenansicht sehen jetzt aus wie die übrigen Felder. Knöpfe in Dialogen mindestens 72 px breit, Fokus als Ring aussen.
- **Symbole:** aus der Skizze (`docs/entwuerfe/25-oberflaeche/symbole/icons-neu.tsx`) nach `icons.tsx` übernommen, dazu nach Entscheidung 8 ein Häkchen für „Commit…“ (`CommitActionIcon`). Akzentfarben laufen über Klassen (`icon-incoming`, `icon-outgoing`, `icon-success`, `icon-head`). `ProjectIcon`, `GitIcon`, `TerminalIcon` und `FindIcon` nehmen eine Grösse an, damit sie in Menüs mit 16 px erscheinen.
- **Menüs:** `Menu.tsx` hat ein optionales Symbol pro Eintrag in einer bündigen Spalte (nur wenn ein Eintrag eines hat), eine wählbare Breite der Spalte und die Lage `beside` (rechts neben einem Element, Pfeil links schliesst). Das Projektmenü zeigt Symbole für „Open Folder…“, „Clone Repository…“ und „Settings…“ und die Farbkürzel der zuletzt geöffneten Projekte; das Rechtsklick-Menü im Baum hat Symbole wie in der Skizze. Ein per Tastatur geöffnetes Menü trägt keinen blauen Rahmen mehr um sich selbst.
- **Branch-Dropdown** (`BranchPopup.tsx`, neu geschrieben): eigenes Popup statt des Suchfensters, 4 px unter dem Branch-Knopf und links bündig, im Fenster gehalten. Titelzeile „Git Branches“ mit Symbolknopf „Fetch“, darunter das Suchfeld; Aktionen „Pull“, „Commit…“, „Push…“, „New Branch…“ mit Symbol und Kürzel aus `keymap.ts`; Gruppen „Local“ und „Remote“ alphabetisch mit Branch-Symbol, der aktuelle mit dem gelben Etikett, voraus und zurück als farbige Pfeile mit Zahl. Die gewählte Zeile zeigt ›; das Untermenü öffnet rechts daneben (Enter, Pfeil rechts, Klick oder nach 200 ms Überfahren), Pfeil links und Escape schliessen es, „Rename…“ hat kein Symbol. Escape schliesst das Dropdown mit dem Fokus auf dem Branch-Knopf; nach einem Klick daneben ebenso, ausser das angeklickte Element nimmt den Fokus selbst (etwa der Editor). Der Knopf trägt `aria-expanded`; ein zweiter Klick schliesst. Die zugänglichen Namen bleiben: Dialog „Git Branches“, Feld „Search branches“, Optionen „Pull“, „Commit…“, „Push…“, „New Branch…“, Knopf „Fetch“.
- **Kopfzeile:** voraus und zurück als grüner bzw. blauer Pfeil mit Zahl (`BranchSync`, auch im Dropdown).
- **Tests:** `test/renderer/radii.test.ts` (Werte der Radien; alle Radien in `app.css` über die Variablen) und `test/ui/branchDropdown.test.ts` (Lage unter dem Knopf; Aktionen mit Symbol und Kürzel, Fetch, Pull, Push, Commit und New Branch ausführbar; Tastatur, Überfahren, Klick daneben, zweiter Klick). `test/ui/git.test.ts` läuft unverändert. Nebenbei: Im Klon-Test darf der Abbruch unter Last länger als eine Sekunde dauern (scheiterte auch auf `main`).
- **Geprüft mit Fotos im Testmodus** (vorübergehender Test über `launchCodium`, wieder entfernt): Monaco, Terminal, Git-Log, Änderungsansicht, Datenbank-Fenster, Markdown-Vorschau mit Mermaid, alle Werkzeugfenster ausgeblendet und ein bis zur Höchstgrösse gezogenes Werkzeugfenster; nichts ragt über die runden Ecken, das Ziehen am Griff im Abstand funktioniert. Maximierte Werkzeugfenster kennt Codium nicht; ein maximiertes Fenster verhindert der Testmodus, deshalb steht es in der Abnahme von Hand.
- **Testläufe (Zwischenstand vor dem Rebase, unter Last durch parallele Läufe anderer Tickets):** `npm run typecheck` sauber; `npm test` 43 Dateien, 381 Tests grün; `npm run test:slow` 7 Dateien, 37 Tests grün; `npm run test:packaged` 18 Prüfungen ok. `npm run test:ui`: erster voller Lauf 78 von 81 grün, zweiter voller Lauf (27 statt 15 Minuten, stark belastet) 70 von 81; alle roten Tests liefen beim Wiederholen einzeln grün, ausser `java.test.ts` („öffnet eine JDK-Klasse …“): Der Editor bleibt nach dem Sprung oben in `String.class` stehen statt bei der Klassendeklaration. Das passiert auch mit dem Stand von `main` (dort 1 von 2 Läufen rot) und hat mit diesem Ticket nichts zu tun. `branchDropdown.test.ts` und `git.test.ts` waren in allen Läufen grün. Die vollen Läufe werden nach dem Rebase auf den neuen `main` allein wiederholt.
- **Übrig gebliebene Instanzen:** Unter Last liefen Tests ins Zeitlimit (90 s); danach scheiterte das Löschen ihres Temp-Ordners mit EPERM, und ihre Codium-Instanz lief ohne Elternprozess weiter (zwei aus diesem Branch, um 13:04 und 13:43, vom Koordinator mit Freigabe des Nutzers beendet). Nach den späteren Läufen blieb nichts übrig. Die Korrektur an der Starthilfe wird ein eigener Fix.
