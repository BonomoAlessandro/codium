# 27 – Testwerkzeuge: Fokus, Aufräumen, wackelige Tests

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: –
User Stories: keine; betrifft die Testläufe und die Spielregeln „Der Desktop des Nutzers ist tabu“ und „Aufräumen“
Spezifikation: „Testentscheidungen“ (Testmodus, die vier Testläufe)

Dieses Ticket kam nach den Tickets 24 bis 26 dazu, auf Wunsch des Nutzers. Bei deren Umsetzung am 2026-11-23 fielen an den Testwerkzeugen drei Dinge auf. Sie kosteten viel Zeit, und eines berührt den Desktop des Nutzers.

## Heutiger Stand

- **Fokus:** Die Starthilfe (`test/support/launchApp.ts`, `testModeViolations`) meldete beim Schliessen mehrmals „Testmodus verletzt: „…“ hat den Fokus“. Das kam dreimal unter Last vor und einmal auf einem ruhigen Rechner („Alpha – Codium“ im Test „öffnet die Suche auch mit Fokus im Terminal“). Verborgene Fenster liegen im Testmodus bei -32000/-32000, ohne Taskleiste, und werden mit `showInactive()` gezeigt (`src/main/electron/windowPort.ts`).
  - **Vermutung, nicht belegt:** Windows aktiviert ein solches Fenster, wenn ein anderes Fenster schliesst und es in der Reihenfolge der Fenster als nächstes kommt.
  - **Folge:** Tastatureingaben des Nutzers könnten dann für einen Moment in einem unsichtbaren Testfenster landen.
- **Liegengebliebene Prozesse und Ordner:** Läuft ein Test ins Zeitlimit, bleiben teils verborgene Codium-Instanzen (`electron.exe` aus `node_modules\electron\dist`, Elternprozess beendet) und Hilfsprozesse von embedded-postgres zurück (`postgres.exe --forkchild="io_worker" <pid>`, deren Hauptprozess schon weg ist).
  - Das Aufräumen in `stopApp` (15 s für `app.close()`, danach `killProcessTree`) und in `test/support/postgres.ts` greift dann nicht.
  - Temp-Ordner `codium-test-*` bleiben bei EPERM liegen; am 2026-11-23 waren es 35 Ordner mit 142 MB.
  - Die liegengebliebenen Prozesse halten zudem Dateien in `node_modules` fest, sodass ein späteres `npm ci` scheitert.
- **Wackelige Tests:** Auf einem ruhigen Rechner und in vollen Läufen gelegentlich rot, einzeln meist grün. Siehe auch `docs/offene-punkte.md`, „Wackelige Tests“.
  - UI „öffnet eine JDK-Klasse schreibgeschützt mit Quelltext; Ctrl + Linksklick geht darin weiter“ (`test/ui/java.test.ts`): Oft rot, auch auf dem Stand vor den Tickets 24 bis 26 (dort 0 von 4 grün). Der Cursor steht nach dem Sprung auf 1:1 oder mitten im Javadoc statt auf der Klassendeklaration, und in der Statusleiste steht oft noch „Searching…“. Monaco scrollt korrekt dorthin, wo der Sprachserver hinzeigt.
  - Schnell „lässt einen gelöschten Projektordner los …“ (`test/main/fileService.test.ts`): EPERM beim Löschen des überwachten Ordners, in vollen Läufen häufig.
  - Langsam „startet nach einem Absturz neu und gibt nach 3 Neustarts … auf“ (TypeScript-Server): Zeitüberschreitung bei der Definition nach dem Neustart.
  - Langsam „Gradle 8: Import mit dem Wrapper, Daemon mit passendem JDK, Definition“: Zeitlimit nach 342 s.
  - UI Markdown-Vorschau mit Mermaid: gelegentlich kein SVG innert der Wartezeit.
  - UI „speichert Eingaben der letzten Sekunde vor „Exit““ (`test/ui/save.test.ts`): einmal Zeitlimit beim Doppelklick.

## Was gebaut wird

- **Fokus:**
  - Ursache finden, ohne echte Eingaben an den Desktop und ohne fremde Fenster anzufassen; Code, Electron-Dokumentation und Versuche nur mit den eigenen Testfenstern.
  - Dann so beheben, dass ein Testfenster den Fokus von Windows nicht bekommen kann bzw. ihn nie hält. Beispiele, je nach Ursache: Testfenster nicht aktivierbar machen (etwa `focusable: false` bzw. `WS_EX_NOACTIVATE`) und sicherstellen, dass Fokus im Inneren der Seite für die Tests weiter funktioniert (Playwright-Eingaben, `:focus`, Fokus-Ereignisse).
  - Die strenge Prüfung in `testModeViolations` bleibt.
- **Aufräumen, auch nach Zeitüberschreitungen:**
  - **Wächter im Testmodus:** Die App kennt den Prozess, der sie gestartet hat (z. B. über eine Umgebungsvariable mit der PID des Testprozesses). Endet dieser, beendet sich die App binnen weniger Sekunden selbst, samt eigener Kindprozesse (Sprachserver, Shells). Ausserhalb des Testmodus ändert sich nichts.
  - **Test-PostgreSQL:** `stop` beendet alle Prozesse dieses Servers einschliesslich der Hilfsprozesse. Ein Test-Server, dessen Testprozess endet, hinterlässt keine verwaisten `postgres.exe`.
  - **Schlussprüfung je Testlauf** (globales Teardown in UI- und langsamem Lauf, wo sinnvoll auch im schnellen): Sie sucht verwaiste Prozesse aus diesem Checkout (Codium-Testinstanzen, `postgres.exe` aus `@embedded-postgres`, Sprachserver), deren Elternprozess nicht mehr läuft, und beendet sie mit deutlicher Meldung. Ebenso entfernt sie liegengebliebene `codium-test-*`-Ordner dieses Laufs, mit einigen Versuchen bei EPERM. Nie fasst sie Prozesse an, deren Elternprozess noch läuft, Prozesse aus anderen Ordnern oder das installierte Codium des Nutzers.
- **Wackelige Tests:**
  - Für jeden oben genannten Test die Ursache suchen und an der Ursache beheben, im Produkt oder im Test. Ein Zeitlimit wird nur erhöht, wenn die Ursache wirklich Dauer ist; das wird dann begründet.
  - Für den JDK-Klassen-Test zuerst klären, ob Codium falsch springt, etwa weil es dem Sprachserver zu früh glaubt oder einen Bereich falsch übernimmt. Ist es ein Fehler im Produkt, wird er behoben, und der Test prüft das richtige Ziel.
  - `docs/offene-punkte.md`, Abschnitt „Wackelige Tests“, nachführen: was behoben ist und was offen bleibt, mit Grund.

## Akzeptanzkriterien

- [x] Die Ursache der Fokusmeldungen ist im Ticket beschrieben und behoben. Ein Test belegt den Mechanismus, z. B. dass Testfenster nicht aktivierbar sind und Fokus in der Seite trotzdem funktioniert. In den Läufen unten gibt es keine Fokusmeldung.
- [x] Ein Test belegt den Wächter: Endet der startende Prozess, beendet sich eine Codium-Testinstanz samt Kindprozessen binnen weniger Sekunden.
- [x] Ein Test belegt das Aufräumen des Test-PostgreSQL. Nach `stop` und nach dem Ende des Testprozesses laufen keine Prozesse dieses Servers mehr.
- [x] Die Schlussprüfung meldet und beendet verwaiste Prozesse aus diesem Checkout und entfernt liegengebliebene Temp-Ordner des Laufs. Einheitstests prüfen die Auswahl: nur verwaiste, nur aus diesem Checkout, nie mit lebendem Elternprozess.
- [x] Jeder der sechs genannten wackeligen Tests hat im Ticket eine Ursache und eine Behebung, oder eine begründete Einschätzung, warum er bleibt, samt Eintrag in `docs/offene-punkte.md`.
- [x] Auf einem ruhigen Rechner laufen `npm test`, `npm run test:slow` und `npm run test:ui` je dreimal in Folge grün, `npm run test:packaged` einmal. Danach sind keine Prozesse und keine Temp-Ordner aus den Läufen übrig.

## Abnahme von Hand

- [ ] Während eines vollen UI-Laufs bleibt der Fokus durchgehend in einem Fenster des Nutzers (etwa einem Editor, in dem er tippt); keine Eingabe geht verloren.

## Hinweise

- Die Spielregeln gelten verschärft: Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Keine echten Eingaben an den Desktop, keine Fenster in den Vordergrund holen, keine Systemeinstellungen ändern. Zum Prüfen des Fokus nur eigene Testfenster und Prozesse verwenden.
- Die vollen Läufe laufen allein auf dem Rechner, nicht parallel zu anderen Testläufen.

## Umsetzung (Agent, 2026-11-24)

Begonnen am 2026-11-23 (Fokus, Wächter, Test-PostgreSQL, Schlussprüfung), nach einer erzwungenen Pause am 2026-11-24 fortgesetzt (wackelige Tests, Lücken, volle Läufe). Im Temp-Ordner lagen nach dem abgebrochenen Lauf keine `codium-test-*`-Ordner; entfernt wurde nur eine Sicherungskopie `postgres.keep.ts`, die der Agent am Vortag dort abgelegt hatte.

- **Fokus:**
  - **Ursache:** Testfenster waren aktivierbar. `showInactive()` zeigt ein Fenster nur, ohne es zu aktivieren; danach steht es als gewöhnliches Fenster in der Z-Reihenfolge, gleich unter dem Vordergrundfenster. Schliesst oder minimiert der Nutzer sein Fenster, aktiviert Windows das nächste aktivierbare Fenster dieser Reihenfolge, auch eines ausserhalb des Bildschirms. Dann meldete `isFocused()` beim Schliessen „hat den Fokus“, und Eingaben des Nutzers konnten im unsichtbaren Testfenster landen; unter Last vermutlich häufiger, weil die Testfenster dann länger offen sind. Belegt ist der Mechanismus durch die Dokumentation von Windows, genau ihn schaltet `WS_EX_NOACTIVATE` aus („The system does not bring this window to the foreground when the user minimizes or closes the foreground window“). Nachgestellt wurde er nicht: Dafür müsste ein Fenster des Nutzers schliessen. Das bleibt in „Abnahme von Hand“.
  - **Behebung:** Im Testmodus öffnen Fenster mit `focusable: false`; Electron setzt damit `WS_EX_NOACTIVATE`. Fokus in der Seite emuliert Playwright über die Entwicklerwerkzeuge, Eingaben gehen weiter.
  - **Prüfung:** `testModeViolations` bleibt streng und meldet zusätzlich aktivierbare Fenster und jede Aktivierung durch Windows, die ein Haken auf `WM_ACTIVATE` im Hauptprozess aufzeichnet, auch an inzwischen geschlossenen Fenstern. `isFocused()` allein genügte nicht mehr, weil Chromium ein nicht aktivierbares Fenster nie als aktiv führt.
  - **Tests:** UI-Test in `test/ui/app.test.ts`: Fensterstil nativ und nur lesend abgefragt (`test/support/nativeWindow.ts`), Haken vorhanden, Fokus-Ereignisse, `:focus` und Eingaben im Editor, keine Aktivierung. Einheitstest der Auswertung von `WM_ACTIVATE` in `test/main/testMode.test.ts`.
- **Wächter im Testmodus:** Die Starthilfe hält eine benannte Pipe offen und gibt ihren Namen in `CODIUM_TEST_GUARD_PIPE` mit (`src/main/testGuard.ts`). Schliesst Windows sie, weil der Testprozess endet (auch hart), beendet Codium alle Nachkommen und sich selbst. Eine Prozessnummer allein wäre unsicher, Windows vergibt sie schnell neu. Prozessbäume bestimmt Codium mit Startzeiten (`descendantsIn` in `processTree.ts`); `taskkill /T` träfe auch ältere Prozesse mit veralteter Elternnummer. Test: Ein eigener Node-Prozess (`guardStarter.ts`, prüft den Testmodus) startet Codium mit offenem Terminal (cmd) und TypeScript-Sprachserver und wird hart beendet; binnen 10 s läuft kein Prozess dieses Baums mehr. Dazu Einheitstests des Wächters. Im Einsatz bestätigt: Ein von Hand hart abgebrochener UI-Lauf hinterliess keine Prozesse.
- **Test-PostgreSQL:** Ein abgekoppelter Wächterprozess je Server (`postgresReaper.ts`) merkt sich alle Prozesse des Servers mit Startzeit. Endet seine Eingabe, weil `stop` fertig ist oder weil der Testprozess fort ist, beendet er alle, auch Hilfsprozesse ohne Hauptprozess, und löscht den Ordner. Langsame Tests in `test/slow/testPostgres.test.ts`: Nach `stop` und nach dem harten Ende eines Testprozesses (`postgresHolder.ts`) läuft kein Prozess des Servers mehr, und sein Ordner ist fort. Ergänzt am 2026-11-24, nachdem in einem vollen langsamen Lauf ein `io_worker` ohne Hauptprozess liegen blieb: Beendet `taskkill /T` beim Stoppen die Hilfsprozesse vor dem Hauptprozess, startet dieser noch einen neuen `io_worker`, den niemand gemerkt hat. Der Wächter nimmt jetzt auch Hilfsprozesse (`--forkchild`) gemerkter, schon beendeter Prozesse mit, nie Kinder einer neu vergebenen Nummer oder einen fremden Hauptprozess (Einheitstests).
- **Schlussprüfung je Testlauf** (`test/support/finalCheck.ts`, `globalSetup` aller drei Vitest-Läufe): Sie beendet verwaiste Prozesse aus diesem Checkout samt Nachkommen und entfernt Temp-Ordner dieses Laufs, jeweils mit Meldung und bei EPERM mit Wiederholungen. „Aus diesem Checkout“ heisst: Programm im Checkout (Electron, PostgreSQL aus embedded-postgres, ripgrep, natives TypeScript, ConPTY), typescript-language-server des Checkouts oder Java mit den Java-Werkzeugen bzw. dem Test-Zwischenspeicher. Nie mit lebendem Elternprozess (auch nicht, wenn ein jüngerer Prozess dessen Nummer trägt), nie aus anderen Ordnern, nie das installierte Codium. Für die Kindprozesse von PostgreSQL nennt Windows keinen Programmpfad; dann gilt der Anfang der Befehlszeile (`programOf`, ergänzt am 2026-11-24, weil der liegengebliebene `io_worker` sonst durchfiel). Temp-Ordner tragen die Kennung des Laufs im Namen; am 2026-11-24 kamen die zwei Tests dazu, die ihre Ordner noch ohne Kennung anlegten (`folderQueries`, `nodeSystem`). Einheitstests der Auswahl in `test/main/processes.test.ts`, dazu ein langsamer Test an der echten Prozesstabelle.
- **Wackelige Tests:**

  | Test | Ursache | Behebung |
  |---|---|---|
  | UI „öffnet eine JDK-Klasse …“ | **Codium sprang falsch.** Gemessen mit vorübergehenden Diagnosen in der App: Kurz nach dem Import liefert jdtls für ein Ziel in einer Klassendatei die ganze Datei als Bereich (für String 0:0 bis 4917:0), wenig später den Namen (141:19 bis 141:25). Monaco nimmt den Anfang des Bereichs, der Cursor stand auf 1:1. Dazu ein Wettlauf im Test: Er klickte jede Sekunde neu, und ein Klick, der gerade beim Ankommen eines Sprungs kam, traf ein Wort in der eben geöffneten Klassendatei (Cursor mitten im Javadoc, etwa 126:30). | Der Sprach-Dienst hält ein Ziel in einer Klassendatei über mehrere Zeilen für grob und fragt neu, alle 500 ms, höchstens etwa 15 s; gemessen war jdtls nach weniger als einer Sekunde genau. Der Test wartet das Ende des Imports ab, klickt einmal und prüft Zeile und Spalte des Cursors (der Name in der Deklaration). Wörter sucht er über Textknoten hinweg, weil Monaco lange Abschnitte ohne Färbung nach 50 Zeichen teilt („…, CharSeq“ und „uence,“). Der langsame Maven-Test prüft, dass das Ziel der Name ist; Einheitstests für das Erkennen und Neufragen. Vorher mit Diagnose 1 von 4 grün (beim Vorgänger 0 von 4), danach einzeln 4 von 4; auf der Deklaration landete der Sprung in allen 11 Läufen seit der Behebung. |
  | Schnell „lässt einen gelöschten Projektordner los …“ | Jedes Ereignis der Überwachung stösst ein Neueinlesen des Git-Zustands an, und Git läuft mit dem Projektordner als Arbeitsordner. Solange es läuft, verweigert Windows das Löschen mit EPERM; nachgestellt mit einem Kindprozess, der im Ordner läuft. Unter Last dauert der Aufruf länger. Kein Fehler im Produkt: Git muss im Ordner laufen. | Der Test (und der zum Abbau des Projekt-Kerns) öffnet das Projekt ohne Git; geprüft wird nur die Überwachung. Die Diagnose „PROBE EPERM“ ist entfernt. |
  | Langsam „startet nach einem Absturz neu …“ | **Fehler im Produkt.** Der neu gestartete native TypeScript-Server (tsgo) stürzte selbst ab (Exit-Code 2, Go-Panic in `Session.getSnapshot`, die Sitzung fehlte noch): Ein geplantes Abholen der Fehler (`textDocument/diagnostic`) oder eine Dateiänderung (`workspace/didChangeWatchedFiles`) erreichte ihn mitten in `initialize`. LSP verlangt, dass vorher `initialized` kommt. Der Absturz zählte als weiterer; nach dem dritten gab Codium den Server auf, und die Definition blieb leer. Einzeln etwa jedes vierte Mal rot. | `pullDiagnostics` und `notifyWatched` gehen nur an Server nach `initialized`; `start` holt die Fehler danach ohnehin. Neuer Test mit einem nachgemachten Server, der sich wie tsgo verhält (`test/support/fakeLspServer.ts`): vorher zwei zusätzliche Abstürze, jetzt keiner. Der langsame Test danach 15 von 15 grün. |
  | Langsam „Gradle 8: Import mit dem Wrapper …“ | **Offen.** Im vollen Lauf vom 2026-11-23 war jdtls nach etwa 100 s bereit, dann blieb die Definition 240 s leer. Das Protokoll des Gradle-Daemons aus diesem Lauf (im Test-Zwischenspeicher) zeigt dieselben erfolgreichen Builds wie grüne Läufe; am Import durch Gradle lag es nicht. Das Protokoll von jdtls verschwand mit dem Temp-Ordner. Einzeln 5 von 5 grün (davon 4 am 2026-11-24). Vermutung: jdtls nahm App.java als Datei ausserhalb des Projekts. | Eine Zeitüberschreitung nennt jetzt die Meldungen an App.java (jdtls meldet eine Datei ausserhalb des Projekts dort) und das Ende des Protokolls von jdtls. Zeitlimit unverändert. |
  | UI Markdown-Vorschau mit Mermaid | Der Virenscanner hält die frisch gebaute `dist/renderer/mermaid.js` (5 MB) beim ersten Zugriff fest: Das erste Lesen nach `node build.mjs` dauerte 16,7 s, das zweite 3 ms (die gleich grosse `renderer.js` brauchte 3 ms). Das erste Mermaid-Diagramm nach dem Bauen kam nach 12 bis 19 s, danach nach etwa 1 s; der Test wartet 15 s. | Ein zweites `globalSetup` des UI-Laufs (`test/support/warmBuild.ts`) liest alle Dateien in `dist/` einmal und meldet langsame. Das Zeitlimit des Tests bleibt. |
  | UI „speichert Eingaben der letzten Sekunde vor „Exit““ | **Offen.** Einmal, in einem sonst grünen Lauf (86 von 87 am 2026-11-23), hing im zweiten Start der Doppelklick auf b.txt 30 s: Playwright meldete das Element sichtbar und stabil, danach „performing dblclick action“ ohne Rückkehr; die Eingabe kam bei der App nicht an. Einzeln 8 von 8 grün. In Codium keine Ursache gefunden (keine blockierenden Dialoge, keine synchronen Aufrufe im Renderer). | Keine Änderung; beobachten (`docs/offene-punkte.md`). |

- **Testläufe** (2026-11-24, nacheinander und allein auf dem Rechner):

  | Lauf | Ergebnis | Dauer |
  |---|---|---|
  | `npm run typecheck` | grün | 1 s |
  | `npm test` 1, 2, 3 | je 429 von 429 grün (50 Dateien) | 96 s, 93 s, 90 s |
  | `npm run test:slow` 1, 2, 3 | je 40 von 40 grün (9 Dateien), nichts übersprungen | 102 s, 176 s, 100 s |
  | `npm run test:ui` 1, 2, 3 | je 89 von 89 grün (25 Dateien) | 479 s, 449 s, 436 s |
  | `npm run test:packaged` | 21 von 21 Prüfungen bestanden | 140 s |

  Nach jedem Lauf: keine Prozesse aus dem Checkout, keine `codium-*`-Ordner im Temp-Ordner, keine Meldung der Schlussprüfung, keine Verletzung des Testmodus (also auch keine Fokusmeldung). Das Vorlesen der gebauten App meldete je UI-Lauf `mermaid.js` mit 10,5 bis 17,9 s (einmal auch `renderer.js` mit 5,2 s); ohne es wäre diese Zeit in Tests gefallen.

  Ein erster Durchgang wurde abgebrochen und nicht gezählt: Der neue Neustart-Test brauchte beim Abbau mehr Zeit als die Standardfrist (behoben, siehe Commit), parallel lief ein fremder Build (21 Git-Fehler in einem schnellen Lauf, danach nicht mehr), und nach einem langsamen Lauf blieb ein `io_worker` liegen (siehe Test-PostgreSQL und Schlussprüfung). Ein dabei von Hand hart abgebrochener UI-Lauf hinterliess keine Prozesse.
