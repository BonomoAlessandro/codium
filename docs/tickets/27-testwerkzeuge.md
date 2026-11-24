# 27 – Testwerkzeuge: Fokus, Aufräumen, wackelige Tests

Status: `erledigt` (2026-11-24) · Typ: AFK
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
- **Wächter im Testmodus:** Die Starthilfe hält eine benannte Pipe offen und gibt ihren Namen in `CODIUM_TEST_GUARD_PIPE` mit (`src/main/testGuard.ts`). Schliesst Windows sie, weil der Testprozess endet (auch hart), beendet Codium alle Nachkommen und sich selbst. Eine Prozessnummer allein wäre unsicher, Windows vergibt sie schnell neu. Prozessbäume bestimmt Codium mit Startzeiten (`descendantsIn` in `processTree.ts`); `taskkill /T` träfe auch ältere Prozesse mit veralteter Elternnummer. **Wirkung:** Playwright startet Electron unter Windows nicht abgekoppelt; endet der Testprozess hart, beendet vermutlich schon das Job-Objekt von Node den Hauptprozess von Codium, bevor der Wächter greift, und mit ihm alles, was Codium selbst mit Node startet. Der Wächter zählt dort, wo kein Job-Objekt hilft: bei einer abgekoppelt gestarteten Instanz und bei Nachkommen ausserhalb eines Job-Objekts. Was im echten Lauf trotzdem übrig bleibt, etwa ein Gradle-Daemon, räumt die Schlussprüfung ab. **Test:** Ein eigener Node-Prozess (`guardStarter.ts`; prüft Testmodus und Datenordner im Temp-Ordner) startet Codium abgekoppelt und wird hart beendet. Das Projekt hat TypeScript 5 mit einem Ersatz für den tsserver, der einen abgekoppelten Hilfsprozess startet, wie es ein Gradle-Daemon ist; dazu das Terminal mit cmd. Binnen 10 s läuft kein Prozess dieses Baums mehr. Gegenprobe: Ohne `killDescendants` im Wächter blieben die Hilfsprozesse stehen. Weil diese Instanz ohne Playwright und damit ohne die Prüfung in `close()` läuft, prüft der Test ihre Fenster nur lesend über Win32: nicht aktivierbar, auf keinem Bildschirm, nicht im Vordergrund. Dazu Einheitstests des Wächters. Ein von Hand mit `taskkill /T` abgebrochener UI-Lauf hinterliess keine Prozesse; das belegt den Wächter nicht, denn taskkill beendete den ganzen Baum.
- **Test-PostgreSQL:** Ein abgekoppelter Wächterprozess je Server (`postgresReaper.ts`) merkt sich alle Prozesse des Servers mit Startzeit. Endet seine Eingabe, weil `stop` fertig ist oder weil der Testprozess fort ist, beendet er alle, auch Hilfsprozesse ohne Hauptprozess, und löscht den Ordner. Seit dem Review startet die Testhilfe den Server selbst (embedded-postgres legt nur noch den Datenordner an), und `stop` überlässt das Beenden dem Wächter, nach Nummer und Startzeit, den Hauptprozess zuerst. Das `taskkill /T` von embedded-postgres über die blosse Nummer entfällt. Langsame Tests in `test/slow/testPostgres.test.ts`: Nach `stop` und nach dem harten Ende eines Testprozesses (`postgresHolder.ts`) läuft kein Prozess des Servers mehr, und sein Ordner ist fort. Ergänzt am 2026-11-24, nachdem in einem vollen langsamen Lauf ein `io_worker` ohne Hauptprozess liegen blieb: Beendet `taskkill /T` beim Stoppen die Hilfsprozesse vor dem Hauptprozess, startet dieser noch einen neuen `io_worker`, den niemand gemerkt hat. Der Wächter nimmt jetzt auch Hilfsprozesse (`--forkchild`) gemerkter, schon beendeter Prozesse mit, nie Kinder einer neu vergebenen Nummer oder einen fremden Hauptprozess (Einheitstests).
- **Schlussprüfung je Testlauf** (`test/support/finalCheck.ts`, `globalSetup` aller drei Vitest-Läufe): Sie beendet verwaiste Prozesse aus diesem Checkout samt Nachkommen und entfernt Temp-Ordner dieses Laufs, jeweils mit Meldung und bei EPERM mit Wiederholungen. „Aus diesem Checkout“ heisst: Programm im Checkout (Electron, PostgreSQL aus embedded-postgres, ripgrep, natives TypeScript, ConPTY), typescript-language-server des Checkouts oder Java mit den Java-Werkzeugen bzw. dem Test-Zwischenspeicher. Nie mit lebendem Elternprozess, nie aus anderen Ordnern, nie das installierte Codium. Verwaist heisst: Die Elternnummer fehlt, oder sie gehört einem Prozess, der mehr als 60 s nach dem Kind startete (neu vergeben); unbekannte Startzeiten und kleinere Abstände, die auch ein Sprung der Systemuhr erklärt, gelten nicht als verwaist. Läuft gleichzeitig ein anderer Testlauf in diesem Checkout, meldet sie verwaiste Prozesse nur (ein Gradle-Daemon etwa könnte gerade von jenem Lauf wieder benutzt werden). Für die Kindprozesse von PostgreSQL nennt Windows keinen Programmpfad; dann gilt der Anfang der Befehlszeile (`programOf`, ergänzt am 2026-11-24, weil der liegengebliebene `io_worker` sonst durchfiel). Temp-Ordner tragen die Kennung des Laufs im Namen; am 2026-11-24 kamen die zwei Tests dazu, die ihre Ordner noch ohne Kennung anlegten (`folderQueries`, `nodeSystem`). Einheitstests der Auswahl in `test/main/processes.test.ts`, dazu ein langsamer Test an der echten Prozesstabelle.
- **Wackelige Tests:**

  | Test | Ursache | Behebung |
  |---|---|---|
  | UI „öffnet eine JDK-Klasse …“ | **Codium sprang falsch.** Gemessen mit vorübergehenden Diagnosen in der App: Kurz nach dem Import liefert jdtls für ein Ziel in einer Klassendatei die ganze Datei als Bereich (für String 0:0 bis 4917:0), wenig später den Namen (141:19 bis 141:25). Monaco nimmt den Anfang des Bereichs, der Cursor stand auf 1:1. Dazu ein Wettlauf im Test: Er klickte jede Sekunde neu, und ein Klick, der gerade beim Ankommen eines Sprungs kam, traf ein Wort in der eben geöffneten Klassendatei (Cursor mitten im Javadoc, etwa 126:30). | Der Sprach-Dienst hält ein Ziel in einer Klassendatei über mehrere Zeilen für grob und fragt bei der Definition neu, alle 500 ms, höchstens 4 s nach der ersten Antwort; danach gilt die letzte. Gemessen war jdtls nach weniger als einer Sekunde genau. Der Test wartet das Ende des Imports ab, klickt einmal und prüft Zeile und Spalte des Cursors (der Name in der Deklaration). Wörter sucht er über Textknoten hinweg, weil Monaco lange Abschnitte ohne Färbung nach 50 Zeichen teilt („…, CharSeq“ und „uence,“). Der langsame Maven-Test prüft, dass das Ziel der Name ist; Einheitstests für das Erkennen und Neufragen. Vorher mit Diagnose 1 von 4 grün (beim Vorgänger 0 von 4), danach einzeln 4 von 4; auf der Deklaration landete der Sprung in allen 11 Läufen seit der Behebung. |
  | Schnell „lässt einen gelöschten Projektordner los …“ | Jedes Ereignis der Überwachung stösst ein Neueinlesen des Git-Zustands an, und Git läuft mit dem Projektordner als Arbeitsordner. Solange es läuft, verweigert Windows das Löschen mit EPERM; nachgestellt mit einem Kindprozess, der im Ordner läuft. Unter Last dauert der Aufruf länger. Kein Fehler im Produkt: Git muss im Ordner laufen. | Der Test (und der zum Abbau des Projekt-Kerns) öffnet das Projekt ohne Git; geprüft wird nur die Überwachung. Die Diagnose „PROBE EPERM“ ist entfernt. |
  | Langsam „startet nach einem Absturz neu …“ | **Fehler im Produkt.** Der neu gestartete native TypeScript-Server (tsgo) stürzte selbst ab (Exit-Code 2, Go-Panic in `Session.getSnapshot`, die Sitzung fehlte noch): Ein geplantes Abholen der Fehler (`textDocument/diagnostic`) oder eine Dateiänderung (`workspace/didChangeWatchedFiles`) erreichte ihn mitten in `initialize`. LSP verlangt, dass vorher `initialized` kommt. Der Absturz zählte als weiterer; nach dem dritten gab Codium den Server auf, und die Definition blieb leer. Einzeln etwa jedes vierte Mal rot. | Vor `initialized` geht nichts mehr an einen Server: Das Abholen der Fehler wartet (`start` holt sie danach ohnehin), Dateiänderungen puffert der Dienst je Server und schickt sie danach in derselben Reihenfolge (endet der Server vorher, verfallen sie), und alle Anfragen samt `java/classFileContents` warten, bis der Server bereit ist. Neuer Test mit einem nachgemachten Server, der sich wie tsgo verhält (`test/support/fakeLspServer.ts`): vorher zwei zusätzliche Abstürze, jetzt keiner. Dazu Tests für die Pufferung samt Reihenfolge und ihren Verfall. Der langsame Test danach 15 von 15 grün. |
  | Langsam „Gradle 8: Import mit dem Wrapper …“ | **Offen.** Im vollen Lauf vom 2026-11-23 war jdtls nach etwa 100 s bereit, dann blieb die Definition 240 s leer. Das Protokoll des Gradle-Daemons aus diesem Lauf (im Test-Zwischenspeicher) zeigt dieselben erfolgreichen Builds wie grüne Läufe; am Import durch Gradle lag es nicht. Das Protokoll von jdtls verschwand mit dem Temp-Ordner. Einzeln 5 von 5 grün (davon 4 am 2026-11-24). Vermutung: jdtls nahm App.java als Datei ausserhalb des Projekts. | Eine Zeitüberschreitung nennt jetzt die Meldungen an App.java (jdtls meldet eine Datei ausserhalb des Projekts dort) und das Ende des Protokolls von jdtls. Zeitlimit unverändert. |
  | UI Markdown-Vorschau mit Mermaid | Der Virenscanner hält die frisch gebaute `dist/renderer/mermaid.js` (5 MB) beim ersten Zugriff fest: Das erste Lesen nach `node build.mjs` dauerte 16,7 s, das zweite 3 ms (die gleich grosse `renderer.js` brauchte 3 ms). Das erste Mermaid-Diagramm nach dem Bauen kam nach 12 bis 19 s, danach nach etwa 1 s; der Test wartet 15 s. | Ein zweites `globalSetup` des UI-Laufs (`test/support/warmBuild.ts`) liest alle Dateien in `dist/` einmal und meldet langsame. Nach dem Review kam die Wartezeit trotzdem einmal im Test an (kurz nach einem Standby des Rechners; der Scanner prüfte die Datei offenbar erneut). Weil es reine Dauer ist, wartet der Test seither bis 60 s darauf, dass Mermaid geladen ist, und danach wie zuvor 15 s aufs Zeichnen; so sind Laden und Zeichnen getrennt erkennbar. |
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

## Review

Ein zweiter Agent hat den Branch am 2026-11-24 gegen Ticket, Spezifikation und Spielregeln geprüft; nichts blockierte. Eingearbeitet:

- **Neufragen bei groben Zielen:** nur noch für die Definition (für Implementierungen und Verwendungen gibt es keine Messung, die es begründet), mit einer Zeitgrenze von 4 s ab der ersten Antwort statt einer Zahl von Versuchen; eine Anfrage, die dann noch läuft, wartet der Dienst nicht ab. Einheitstest für „bleibt grob“ mit der Zeitgrenze. Eine Anfrage, die über die Zeitgrenze hinaus läuft, bricht Codium bei jdtls nicht ab (`$/cancelRequest` schickt der Dienst nirgends); ihre Antwort verfällt.
- **`stopApp`** beendet Codium über den Handle des Kindprozesses und nur, solange Node dessen Ausgang nicht gesehen hat; `killDescendants` fragt nach der Abfrage der Prozesstabelle nach. Der langsame Test der Schlussprüfung beendet seinen Waisen nur, wenn unter der Nummer noch derselbe Prozess läuft.
- **Schlussprüfung bei gleichzeitigen Läufen:** Läuft ein anderer Vitest-Prozess dieses Checkouts, meldet sie verwaiste Prozesse nur. Eine Sperrdatei je Lauf schien nicht robuster: Sie bliebe nach einem abgebrochenen Lauf liegen, die Prozesstabelle nicht. Einheitstests, README.
- **Unbekannte Startzeit oder Uhrsprung** gelten nie als verwaist (Abstand von mehr als 60 s nötig), und ein Prozess mit unbekannter Startzeit zählt nicht als Kind. Einheitstests.
- **Dateiänderungen vor `initialized`** werden je Server gepuffert und danach in derselben Reihenfolge geschickt, beim Ende des Servers verworfen; Tests mit dem nachgemachten Server.
- **`readTarget`:** `java/classFileContents` wartet wie jede andere Anfrage, bis jdtls bereit ist; ebenso geben `connectionFor` und die Symbolsuche nichts an einen Server, der zwischendurch neu startet. Die Regel „nichts vor `initialized`“ gilt damit allgemein; der Aufwand war klein.
- **Wirkung des Wächters** im Abschnitt „Umsetzung“ genauer beschrieben (Job-Objekt von Node, abgekoppelter Fall, Schlussprüfung für Gradle-Daemons); der Satz zum abgebrochenen UI-Lauf ist berichtigt. Der Wächter-Test war ohne `killDescendants` tatsächlich grün; er hat jetzt einen abgekoppelten Nachkommen, und die Gegenprobe ist rot.
- **`guardStarter.ts`** prüft den Datenordner im Temp-Ordner selbst; die README nennt die Ausnahme bei „Electron nie direkt starten“; die Fenster dieser Instanz prüft der Test nur lesend (nicht aktivierbar, auf keinem Bildschirm, nicht im Vordergrund).
- **`taskkill /T` von embedded-postgres:** entfällt; der Wächter beendet den Server nach Nummer und Startzeit und löscht den Ordner, die Testhilfe startet den Server selbst.

Nicht eingearbeitet: nichts. Bewusst so gelassen sind nur die Entscheidungen oben (kein Neufragen bei Implementierungen, keine Sperrdatei, kein Abbruch der überzähligen Anfrage bei jdtls).


**Nachprüfung** (am selben Tag; nichts blockierte). Eingearbeitet:

- **Test-PostgreSQL:** Der Start zählt eine Antwort nur, wenn der Server den eigenen Datenordner nennt (`current_setting('data_directory')`) und der eigene Prozess noch läuft; alle Test-Server haben dieselben Zugangsdaten. Lässt sich `postgres.exe` nicht starten oder endet es, bricht der Start sofort ab. Der Wächter merkt sich den Server gleich nach dem Start und nach der Bereitschaft noch einmal. `@embedded-postgres/windows-x64` ist in den devDependencies deklariert (installierte Version; im Lockfile nur `packages[""].devDependencies` nachgeführt, `npm ci` und die Installation von Electron liefen durch, alle `resolved` auf registry.npmjs.org).
- **Wächter-Test:** Das Sicherheitsnetz beendet auch die Hilfsprozesse aus `keepers.txt`, die nie im Prozessbaum auftauchten, nur wenn sie nach Beginn des Tests gestartet wurden.
- **README:** Andere Läufe erkennt die Schlussprüfung nur an der Schreibweise des Pfads (8.3-Name, `subst`, Junction zählen nicht), und ein offener Vitest im Watch-Modus unterdrückt das Beenden.
- **Puffer ohne Grenze:** bewusst so. Er besteht nur zwischen dem Start eines Servers und `initialized` (Sekunden), verfällt mit dem Server und geht als eine einzige Meldung hinaus; ohne ihn wären dieselben Änderungen einzeln hinausgegangen.

- **Prüfläufe nach dem ersten Einarbeiten** (2026-11-24; durch die volle Serie unten ersetzt):

  | Lauf | Ergebnis | Dauer |
  |---|---|---|
  | `npm run typecheck` | grün | 2 s |
  | `npm test` | 437 von 437 grün (50 Dateien) | 97 s |
  | `npm run test:slow` | 40 von 40 grün (9 Dateien) | 148 s |
  | `npm run test:ui` | 89 von 89 grün (25 Dateien), im dritten Anlauf | 457 s |
  | JDK-Klassen-Test einzeln, 3× | je grün | 22 s, 20 s, 21 s |
  | TS-Neustart-Test einzeln, 3× | je grün | je 6 s |

  Nach jedem Lauf: keine Prozesse aus dem Checkout, keine `codium-*`-Ordner, keine Meldung der Schlussprüfung, keine Verletzung des Testmodus. Die zwei roten UI-Läufe davor: Im ersten hing „fängt Monacos kollidierende Kürzel ab“ 19 min; laut Ereignisprotokoll war der Rechner von 11:29 bis 11:53 im modernen Standby (Leerlauf, geweckt durch eine Tastatureingabe), der Lauf begann um 11:31. Im zweiten blieb das Mermaid-SVG 15 s aus; daraufhin trennt der Test das Laden (bis 60 s) vom Zeichnen (siehe die Zeile zu Mermaid oben). Danach war der Lauf grün.

- **Volle Serie nach der Nachprüfung** (2026-11-24, nacheinander allein auf dem Rechner; Akzeptanzkriterium 6 für den Stand nach dem Review):

  | Lauf | Ergebnis | Dauer |
  |---|---|---|
  | `npm run typecheck` | grün | 2 s |
  | `npm test` 1, 2, 3 | je 437 von 437 grün (50 Dateien) | 85 s, 93 s, 94 s |
  | `npm run test:slow` 1, 2, 3 | je 40 von 40 grün (9 Dateien), nichts übersprungen | 164 s, 111 s, 166 s |
  | `npm run test:ui` 1, 2, 3 | je 89 von 89 grün (25 Dateien) | 486 s, 504 s, 516 s |
  | `npm run test:packaged` | 21 von 21 Prüfungen bestanden | 213 s |

  Nach jedem Lauf: keine Prozesse aus dem Checkout, keine `codium-*`-Ordner, keine Meldung der Schlussprüfung, keine Verletzung des Testmodus. Laut Ereignisprotokoll (nur gelesen) war der Rechner während der ganzen Serie (12:38 bis 13:20) nie im Standby, und nach keinem Lauf lief ein fremder Build. Das Vorlesen meldete `mermaid.js` mit 6,5 s, 16,6 s und 9,2 s.
