# 30 – TypeScript-Server stürzt in einem Java-Projekt mit Web-Oberfläche wiederholt ab

Status: `erledigt` (2026-11-26, auf Wunsch des Nutzers ohne gefundene Ursache abgeschlossen; siehe „Abschluss“) · Typ: AFK
Blockiert durch: –
User Stories: „Sprachverständnis“ (TypeScript und JavaScript, Neustart nach Absturz)
Spezifikation: „Sprachverständnis“ (Wahl des TypeScript-Servers, Neustarts), „Einstellungen, Meldungen und Voraussetzungen“

Dieses Ticket kam nach Ticket 29 dazu, auf Wunsch des Nutzers. Er bekam am 2026-11-24 im installierten Codium 0.2.0 diese Meldung:

> The TypeScript language server stopped 4 times within three minutes and was not restarted. Reopen the project to try again.

Version 0.2.0 enthält schon die Behebung aus Ticket 27: Dort stürzte der native TypeScript-Server ab, weil Codium ihm vor `initialized` Anfragen schickte. Hier muss also eine andere Ursache vorliegen.

## Heutiger Stand

### Das Projekt

Es ist ein Arbeitsprojekt des Nutzers. Name und Pfad stehen bewusst nicht im Ticket; der Auftrag an den Agenten nennt sie.
- Ein Maven-Projekt mit mehreren Modulen, im Kern Java.
- Im Wurzelordner gibt es kein `package.json`, kein `tsconfig.json` und kein `node_modules`. Codium wählt deshalb den mitgelieferten nativen Server von TypeScript 7 (`bundled-native`, `tsc --lsp --stdio`, `typescriptServer.ts`). Er startet erst, wenn eine JavaScript- oder TypeScript-Datei geöffnet wird.
- In einem Modul liegt eine Web-Oberfläche mit Vite: `src/main/webapp` mit `package.json`, `vite.config.js`, `node_modules` (gut 40 Pakete) und rund 40 JavaScript-Dateien. TypeScript-Dateien gibt es keine.
- Das Maven-Plugin Quinoa hat eine vollständige Node-Distribution samt `node_modules` in einen versteckten Ordner im Modul gelegt (`.quinoa/node/...`).
- Im Wurzelordner liegt eine leere Datei namens `nul`. Das ist unter Windows ein reservierter Gerätename; die Datei entsteht typischerweise durch ein `> nul` in einer Bash.

### Was Codium heute tut

- **Fehlerausgabe:** `lspConnection.ts` verwirft alles, was ein Sprachserver auf stderr schreibt (`this.child.stderr.on('data', () => {})`). Ein Protokoll gibt es nicht. Exit-Code und Signal eines Absturzes erscheinen nirgends.
  - Folge: Weder der Nutzer noch ein Agent kann im Nachhinein sehen, warum der Server abstürzte.
  - In Ticket 27 fand sich die Ursache nur durch Nachstellen im Test: eine Go-Panic mit Exit 2.
- **Aufgeben:** Nach `MAX_RESTARTS + 1` = 4 Abstürzen in `RESTART_WINDOW_MS` = 3 Minuten gibt Codium den Server auf. Danach hilft nur das erneute Öffnen des Projekts, und die Meldung bietet dafür keinen Knopf.

### Spuren, nicht belegt

- Die Datei `nul` beim Durchsuchen oder Überwachen des Projekts. Mit reservierten Gerätenamen kommen manche Werkzeuge unter Windows nicht zurecht.
- Ohne `tsconfig.json` bzw. `jsconfig.json` sucht der native Server womöglich selbst nach Dateien und stösst dabei auf die Node-Distribution in `.quinoa` oder auf `node_modules`.
- Eine bestimmte Datei aus der Web-Oberfläche (etwa `vite.config.js` oder eine Komponente) bringt den Server zum Absturz.
- Ein Fehler im nativen TypeScript-Server selbst, also eine Go-Panic, die jeder Neustart wieder auslöst.

## Was gebaut wird

1. **Abstürze nachvollziehbar machen:**
   - Codium hebt je Sprachserver die letzten Zeilen von stderr auf, als Ringpuffer mit fester Grösse, etwa 64 KB.
   - Bei einem Absturz schreibt Codium Zeitpunkt, Server, Art des Servers (`kind`), Programm, Exit-Code bzw. Signal und den aufgehobenen stderr in ein Protokoll im Datenordner von Codium, etwa `logs\language-servers.log`.
   - Das Protokoll hat eine begrenzte Grösse und wird ersetzt bzw. rotiert, wenn sie erreicht ist.
   - Im Testmodus liegt es im Datenordner des Tests.
2. **Meldung mit Knöpfen:**
   - Die Meldung „… was not restarted …“ bekommt einen Knopf, der das Protokoll öffnet (etwa „Show Log“), und einen Knopf „Restart“. „Restart“ setzt die Zählung zurück und startet den Server neu, ohne das Projekt neu zu öffnen.
   - Der Wortlaut der Meldung bleibt englisch und nennt den Neustart über den Knopf statt „Reopen the project“.
   - Die bestehenden Knöpfe an Meldungen (siehe Spezifikation, „Meldungen“) sind das Vorbild.
3. **Ursache finden:**
   - Der Agent stellt den Absturz nach. Am besten nimmt er ein nachgebautes Testprojekt mit den Merkmalen oben: Maven-Struktur, eine Web-Oberfläche mit `package.json` und `node_modules` in einem Unterordner, eine Datei `nul` im Wurzelordner, eine Node-Distribution in einem versteckten Ordner.
   - Dabei grenzt er ein, welches Merkmal den Absturz auslöst.
   - Das Projekt des Nutzers darf er nur lesen. Er öffnet es nicht in Codium und startet darin keine Werkzeuge, die schreiben könnten (jdtls, Maven, npm). Braucht er Teile davon, kopiert er sie in einen Temp-Ordner des Laufs.
   - Ursache und Beleg kommen ins Ticket, etwa die Ausgabe des Servers auf stderr aus dem neuen Protokoll.
4. **An der Ursache beheben:**
   - Liegt der Fehler in Codium, etwa bei dem, was Codium dem Server meldet (Pfade, Dateiänderungen, Arbeitsordner), wird er dort behoben.
   - Liegt er im nativen TypeScript-Server selbst, baut Codium eine Umgehung ein und begründet sie im Ticket. Beispiele: bestimmte Pfade nicht melden; den Server für die Web-Oberfläche in deren Ordner starten statt im Wurzelordner; bei fehlender Konfiguration nur die offenen Dateien prüfen lassen.
   - Eine Meldung an das TypeScript-Projekt geht nur mit Zustimmung des Nutzers hinaus. Der Agent bereitet sie dann im Ticket vor, ohne Namen oder Inhalte aus dem Projekt des Nutzers.
5. **Spezifikation:** Bei „Sprachverständnis“ (Neustarts, Protokoll) und „Meldungen“ (neue Knöpfe) nachführen. `docs/offene-punkte.md` nur, falls etwas bewusst offen bleibt.

## Akzeptanzkriterien

- [ ] Die Ursache des Absturzes steht im Ticket, mit Beleg. *Entfallen: nicht gefunden, kein Nachstellen brachte einen Absturz (siehe „Umsetzung“); der Nutzer hat das Ticket trotzdem abschliessen lassen (siehe „Abschluss“).*
- [ ] Ein Test stellt die auslösende Lage nach, mit einem nachgebauten Testprojekt bzw. einem nachgemachten Server wie in `test/support/fakeLspServer.ts`. Ohne die Behebung ist er rot, mit ihr grün. Ein Test mit dem echten nativen Server kommt in den langsamen Lauf, falls er die Ursache besser belegt. *Entfallen: ohne Ursache keine auslösende Lage und keine Behebung (siehe „Abschluss“).*
- [x] Ein schneller Test prüft das Protokoll:
  - Ein Server, der etwas auf stderr schreibt und mit einem Exit-Code ungleich 0 endet, hinterlässt einen Eintrag mit Server, Exit-Code und den letzten stderr-Zeilen.
  - Der Ringpuffer und die Grössengrenze des Protokolls halten.
- [x] Ein Test prüft die Meldung nach dem Aufgeben:
  - „Show Log“ öffnet das Protokoll.
  - „Restart“ startet den Server neu, und Sprachfunktionen (etwa eine Definition) gehen danach wieder.
- [x] `npm run typecheck`, `npm test`, `npm run test:slow` und `npm run test:ui` sind grün. *Vor dem Review alle grün; nach dem Review war in zwei UI-Läufen je ein Test rot, der bekannte hängende Doppelklick (siehe „Review“); ein dritter UI-Lauf vor dem Merge war grün (90 von 90).*

## Abnahme von Hand

- [ ] Im betroffenen Projekt des Nutzers bleibt der TypeScript-Server nach dem Öffnen von JavaScript-Dateien der Web-Oberfläche stabil, und die Sprachfunktionen gehen.
- [ ] Stürzt ein Sprachserver doch einmal ab, zeigt „Show Log“ verständlich, was passiert ist.

## Hinweise

- Die Spielregeln gelten: Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Keine echten Eingaben an den Desktop.
- Das installierte Codium des Nutzers und seine Prozesse nicht anfassen, auch nicht seinen Datenordner.
- Name und Pfad des Projekts sowie Inhalte daraus gehören nicht in Commits, Tickets oder Tests. Tests und Testprojekte bauen nur die Merkmale nach.

## Umsetzung (Agent, 2026-11-24 und 2026-11-25)

**Vorweg:** Protokoll und Knöpfe sind gebaut und getestet. Die Ursache des Absturzes ist **nicht gefunden**: Kein Nachstellen brachte den nativen Server zum Absturz, auch nicht das Nachspielen über Codiums echten Kern am 2026-11-25. Die Kriterien 1 und 2 bleiben deshalb offen. Mit dem Protokoll zeigt der nächste Absturz beim Nutzer, was passiert ist.

Gefunden wurde dabei ein anderer, wiederholbarer Fehler des Servers (siehe „Nachspielen über Codiums Kern“): Nach mehr als 1000 Dateiänderungen auf einmal verliert er eine gleichzeitige Bearbeitung einer offenen Datei. Danach enden Anfragen zu dieser Datei in Panics, die der Server abfängt. Das passt zur Lage beim Nutzer, beendete den Server in keinem Versuch und ist deshalb nicht als Ursache belegt.

### Ursache: gesucht, nicht gefunden

- **Vorgehen:** Das Projekt des Nutzers nur gelesen: Ordner, Dateizeiten, `git --no-optional-locks reflog` bzw. `diff`. Nachgestellt in Temp-Kopien:
  - die nötigen Teile: Wurzel mit `nul`, Module ohne `target`, `.quinoa/node`, die Web-Oberfläche samt `node_modules`;
  - ein Temp-Klon des Repositorys (`git clone --no-hardlinks`) mit denselben Zutaten, um die echten Branch-Wechsel des Tages nachzuspielen;
  - eine vollständige Kopie des Projektordners samt `.git` und Build-Ausgaben.

  Alle Kopien sind wieder gelöscht, ebenso die Laufprotokolle mit Inhalten daraus. Gestartet wurde nur der mitgelieferte native Server 7.0.2, und zwar auf zwei Wegen:
  - über einen kleinen LSP-Client mit Codiums Fähigkeiten, der alles mitschreibt, auch stderr;
  - über Codiums echten Kern samt Dateiüberwachung, in einem vorübergehenden langsamen Test (nicht committet).
- **Was den Server nicht zum Absturz brachte** (jeweils Exit erst durch das eigene `shutdown`/`exit`, keine Panic, auch keine abgefangene in den Meldungen des Servers):

  | Lage | Ergebnis |
  |---|---|
  | Eine JSX-Datei und `vite.config.js` öffnen, Fehler und Token holen | stabil |
  | Alle JS/JSX-Dateien der Web-Oberfläche (weit über hundert) öffnen; je Datei Hover, Definition, Verwendungen, Vervollständigung; Symbolsuche | stabil |
  | Tippen wie in Codium (je Taste der ganze Text), danach Fehler und Vervollständigung samt Auto-Import | stabil |
  | Symbolsuche wie Ctrl + N, je Taste eine Anfrage, auch Sonderzeichen und ohne offene Datei | stabil |
  | Der Branch-Wechsel des Tages (einige hundert Dateien, auch in der Web-Oberfläche und ihrer `package.json`) mit eigener Überwachung des Servers, mit Meldungen wie von Codium (Dateiänderungen, Neuladen und Schliessen offener Dateien) und über Codiums Kern | stabil |
  | `node_modules` entfernen und neu anlegen (wie `npm install`) | stabil; der Server meldet nur „watch terminated … (directory removed)“ und erholt sich |
  | `target` aller Module löschen und neu schreiben, dreimal (wie `mvn clean install`, mit den echten Build-Ausgaben); dazu 24 000 Dateien anlegen, ändern, löschen | stabil |
  | Zwischendateien von Vite und Vitest in `node_modules`, ungewöhnliche Dateinamen (`[ ]`, `%`, `#`, Umlaute, Emoji, ohne Endung) im Wurzelordner und neben offenen Dateien | stabil |
  | Nach Wechsel, `node_modules` bzw. `target` 50 s Ruhe, sodass das Aufräumen des Servers nach 30 s (siehe unten) die gesammelten Änderungen verarbeitet | stabil |
  | Der Merge des Tages im Temp-Klon (einige hundert Dateien, Konflikte unter anderem in JSX-Dateien der Web-Oberfläche). Offen waren zwei zuletzt benutzte JS-Dateien und die JSX-Konfliktdateien. Codium-ähnlich: Dateiänderungen, Neuladen der offenen Dateien mit Konfliktmarkern, Fehler, Token, Hover, 40 s Ruhe; danach Konflikte gelöst, Commit, wieder 40 s Ruhe | stabil; der Server meldet die Konfliktmarker als Fehler |
  | Die drei Konfliktdateien frisch geöffnet und gründlich abgefragt | stabil |
  | 690 Zwischenstände einer Konfliktlösung als `didChange` (Markerzeilen einzeln und paarweise entfernt, je Block nur eine Seite, Marker angeschnitten), je mit Fehlern und Token | stabil |
  | Eine offene Datei mit kleingeschriebenem Pfad (wie in den gemerkten Cursorn), dazu Tippen und der Merge | einmal hing der Server danach (siehe unten), kein Absturz; in der Wiederholung stabil |

- **Die Spuren aus dem Ticket:**
  - **`nul`:** Windows löst `<Ordner>\nul` zum Gerät `\\.\nul` auf. Der Server hielt das in allen Läufen aus, auch in der vollständigen Kopie.
  - **`.quinoa`:** kommt nicht ins Programm des Servers.
  - **Ohne Konfiguration:** Der Server bildet ein Projekt aus den offenen Dateien (`/dev/null/inferred`, einige hundert Dateien) und überwacht den Projektordner rekursiv.
  - **Eine bestimmte Datei:** Alle Dateien der Web-Oberfläche liefen durch, siehe Tabelle.
  - **Go-Panic:** nicht belegt, aber möglich; siehe unten.
- **Was der Quelltext von 7.0.2 zeigt** (öffentlicher Tag `typescript/v7.0.2`, nur gelesen):
  - **Eigene Überwachung:** Meldet ein Client keine dynamische Registrierung für `workspace/didChangeWatchedFiles` (so Codium), startet der Server eine eigene Überwachung (`lspwatcher`, seit Juni 2026). Sie läuft über den ganzen Projektordner rekursiv, hier also auch über `.git`, `target`, `.quinoa` und `node_modules`. VS Code meldet dynamische Registrierung; dort läuft dieser Weg nicht. Codium meldet dieselben Änderungen ohnehin selbst, sie kommen also doppelt an.
  - **Panics ausserhalb von Anfragen:** Eine Panic in einer Anfrage fängt der Server ab und protokolliert sie (`panic handling request`). Mehrere Arbeiten laufen aber auf eigenen Goroutinen ohne `recover`, und eine Panic dort beendet den Prozess mit Exit-Code 2:
    - die Rückrufe der eigenen Überwachung;
    - die Hintergrund-Warteschlange: Typ-Installation (ATA), Vorwärmen der Auto-Imports nach einer Änderung an genau einer offenen Datei, Nachführen der Überwachung;
    - das Aufräumen 30 s nach der letzten Änderung (`IdleCleanDiskCache`, ein Timer), das alle gesammelten Dateiänderungen verarbeitet;
    - die parallelen Parser beim Aufbau eines Programms.

    Ein solcher Absturz liesse sich ohne stderr nicht erklären. Genau das fehlte bisher.
  - **Bekannte Panic:** microsoft/typescript-go#4609 bzw. #4628, „ScriptKind must be specified when parsing source file“ bei Dateien ohne bekannte Endung. #4267 beschreibt damit einen Absturz des Servers in einem Arbeitsbereich mit unbekannten Dateiarten. 7.0.2 (2026-07-08) ist weiterhin die neueste Version, die Behebung kam am 2026-07-14. In den Nachstellungen kam keine solche Datei ins Programm: In `node_modules` zeigen nur native Bindungen mit `main` auf eine `.node`-Datei, und die löst der Server nicht auf (eigener Versuch).
- **Lage im Projekt** (Dateizeiten, Reflog, Angaben des Auftraggebers und des Nutzers; hier bewusst nur als Merkmale):
  - Die Meldung kam wenige Minuten nach dem Start von Codium 0.2.0.
  - Laut Nutzer kam der Absturz, während zwei Branches gemergt wurden, mit einer offenen JavaScript-Datei. Der Merge hatte Konflikte, unter anderem in JSX-Dateien der Web-Oberfläche, und wurde erst nach der Meldung committet.
  - Im selben Zeitraum liefen ein Terminal in Codium, Vitest und ein Maven-Build; `npm install` und `vite build` von Quinoa folgten erst nach der Meldung.
  - Kurz vor der Meldung lief kein `tsc.exe` mehr unter dem installierten Codium.
- **Fragen des Auftraggebers, am Code geprüft:**
  - **`.git`:** Codium meldet Änderungen unter `.git` nie an die Sprachserver (`fileWatcher.ts`; nur HEAD, Index und Refs lösen „Git-Daten geändert“ aus). Die eigene Überwachung des Servers sieht `.git` dagegen, also auch `index.lock`, `MERGE_HEAD` und `ORIG_HEAD` eines Merges; im nachgestellten Merge ohne Folgen.
  - **Kleingeschriebene Pfade:** Klein geschrieben sind nur die Schlüssel interner Tabellen, etwa der gemerkten Cursor. `didOpen` und `didChange` schickt die Oberfläche mit dem Pfad des Tabs, der Sprach-Dienst bildet die URI aus diesem Pfad. Ein Dokument mit kleingeschriebener URI, während die Überwachung die richtige Schreibweise meldet, brachte den Server nicht zum Absturz.
- **Hänger, nicht wiederholbar:** In einem Lauf (offene Datei mit kleingeschriebenem Pfad, Tippen, Merge mit Konflikten, danach das Aufräumen nach 30 s) beantwortete der Server `shutdown` nicht mehr und lief 4 Minuten weiter, bis der Lauf ihn beendete. Ohne Absturz, auf stderr nichts. Die Wiederholung lief normal. Für die Meldung des Nutzers zählt ein Hänger nicht (Codium zählt nur beendete Server), er sei aber erwähnt.
- **Nebenwirkung, gehört nicht zur Ursache:** Bei Projekten ohne Konfiguration installiert der Server Typen über `npm` in den gemeinsamen Zwischenspeicher `%LOCALAPPDATA%\Microsoft\TypeScript\7.0` (ATA). Meine Läufe haben dort `package.json` und `@types/*` aufgefrischt. Der Ordner gehört auch dem installierten Codium und anderen Editoren, und die bestehenden Tests mit JavaScript ohne Konfiguration tun dasselbe. Siehe `docs/offene-punkte.md`.

### Nachspielen über Codiums Kern, kurzlebige Dateien (2026-11-25)

- **Neue Spuren aus den Dateizeiten** (Projekt des Nutzers nur gelesen; hier nur als Merkmale), alles zwischen dem Start von Codium und der Meldung bzw. kurz davor:
  - **Merge vor dem Start von Codium:** Der Merge begann gleich nach einem Checkout, noch bevor Codium startete. Codium startete also in einen Merge mit Konflikten.
  - **Konflikte gelöst:** Die Konfliktdateien, darunter JSX-Dateien der Web-Oberfläche, wurden kurz darauf gelöst und an Ort und Stelle geschrieben, wie Codium speichert; eine davon über eine Temp-Datei (sicheres Speichern eines anderen Werkzeugs).
  - **Vitest:** danach neue Einträge **ohne Endung** in `node_modules/.vitest-cache` der Web-Oberfläche; im Ordner der JSX-Konfliktdateien kam und ging ein Eintrag, und eine JS-Datei dort änderte sich.
  - **Maven:** danach ein Build mit `clean` (`target`-Ordner neu angelegt) und einer wachsenden Zahl geschriebener Dateien, zuletzt mehrere hundert je Minute.
- **Was der Quelltext von 7.0.2 dazu zeigt:**
  - Die eigene Überwachung (`lspwatcher.forwardEvents`) reicht jedes Ereignis unter dem Projektordner weiter, ohne Filter nach Endung, auch aus `.git`, `target` und `node_modules`; Neuanlagen meldet sie als „changed“. Codium meldet dieselben Änderungen (ohne `.git`) zusätzlich selbst.
  - Ein Eintrag unter `node_modules`, der zu keinem Paket gehört (etwa `.vitest-cache/<Hash>`), lässt die Auto-Import-Liste dieses `node_modules` bei der nächsten Vervollständigung ganz neu bauen.
  - Kommen bis zur nächsten Anfrage mehr als 1000 Dateiänderungen zusammen und betrifft keine davon eine Datei, die der Server gelesen hat, leert er die Listen „changed“ und „deleted“ ganz (`snapshot.go`, Zweig `HasExcessiveWatchEvents`; `watchChangesOverlapCache` prüft nur Dateien von der Festplatte, keine offenen Dokumente). Dabei geht auch ein `didChange` einer offenen Datei aus demselben Zeitraum verloren: Das Dokument hat den neuen Text, das Programm behält den alten.
- **Versuche** im Temp-Klon mit dem nativen Server 7.0.2 über Codiums echten Kern samt Dateiüberwachung und Git-Dienst (vorübergehender langsamer Test, nicht committet). Die Oberfläche war nachgebildet: stilles Neuladen offener Dateien nach Änderungen von aussen, Speichern über `files.write`, Tippen mit Vervollständigung und Auto-Imports, Token, Hover. Mitgeschrieben wurden die Meldungen des Servers (`window/logMessage`, dort stehen abgefangene Panics), stderr, die Prozessnummer alle 200 ms und das Protokoll der Sprachserver. Ergebnis jeweils: dieselbe Prozessnummer bis zum Schluss, nichts auf stderr, kein Eintrag im Protokoll.

  | Versuch | Lage | Ergebnis |
  |---|---|---|
  | A: der Tag | Merge mit Konflikten vor dem Start; offene JS-Datei; die Konfliktdateien in der Reihenfolge und im Takt der Dateizeiten im Editor gelöst (Zwischenstände, Tippen, Speichern); Vitest-Einträge ohne Endung; Temp-Eintrag im Konfliktordner; JS-Datei von aussen geändert (stilles Neuladen); 40 s Ruhe; 1500 Klassendateien in `target`; 40 s Ruhe; `git add` und Commit; 40 s Ruhe (282 s) | kein Absturz. Nach den Vitest-Einträgen baute der Server die Auto-Import-Liste neu, ohne Folgen. **Eine abgefangene Panic**, als die Klassendateien und ein Tastendruck zusammenkamen (siehe unten). |
  | B: kurzlebige Dateien | Zwölf Runden mit Merge-Zustand und vier offenen Dateien: in `.git` `index.lock`, `MERGE_MSG`, `ORIG_HEAD`, `AUTO_MERGE`, `MERGE_MODE`, `COMMIT_EDITMSG`, `HEAD.lock`, `gc.pid`; neben den offenen Dateien `*.orig`, `*_BASE_*`/`*_LOCAL_*`/`*_REMOTE_*` (git mergetool), `___jb_tmp___`/`___jb_old___` (sicheres Speichern), `*.tmp.<pid>.<Zeit>`, `*~`, `4913`, Dateien ohne Endung; im Wurzelordner und in einem Werkzeugordner Temp- und Sperrdateien; Einträge ohne Endung in `.vitest-cache`; die Datei `nul` beschrieben; eine offene Datei atomar ersetzt (Temp-Datei, Umbenennen); jeweils nach 60 bis 400 ms gelöscht, dazwischen Tippen, Vervollständigung, Hover, dreimal 40 s Ruhe. Der Server verarbeitete 2423 Änderungen in 91 Schüben (168 s). | stabil, keine Panic |
  | C: grosse Schübe | 20 Runden: die vorige Ausgabe gelöscht und 1200 Klassendateien geschrieben (wie `mvn clean` und Kompilieren), 0 bis 600 ms danach ein Konfliktblock im Editor aufgelöst, gleich danach Token, Hover, Definition, Verwendungen, Implementierungen, Vervollständigung und Symbolsuche; viermal 35 s Ruhe (229 s) | kein Absturz; **18 abgefangene Panics** in den Token |
  | D: neutral | Ein Ordner mit einer JS-Datei (Umlaute, 40 Funktionen), sonst nichts: 1200 Dateien anlegen, eine Zeile tippen (davor bzw. 100 ms danach), Vervollständigung am Zeilenende, Token; acht Runden | kein Absturz; **in 8 von 8 Runden eine abgefangene Panic** |

- **Die Panics** (alle aus `textDocument/*`-Anfragen, abgefangen vom Server, `panic handling request`):
  - Vervollständigung: `runtime error: slice bounds out of range [:2502] with length 2500` (in D; in A dasselbe mit anderen Zahlen) in `ls.isPotentiallyValidJSDocSnippetCompletionPosition` (`jsdoc_snippet.go:77`), aufgerufen aus `getCompletionsAtPosition`. Die Position kommt aus dem neuen Text, die Datei des Programms ist noch die alte und kürzer.
  - Token: `semantic tokens: token spans multiple lines` in `ls.encodeSemanticTokens`. Die Token kommen aus dem alten Text, umgerechnet mit der Zeilentabelle des neuen.
  - Im Protokoll des Servers steht davor jeweils ein Schub wie „Processed 3082 file changes“ und danach ein neuer Stand ohne „Marking project … dirty“ und ohne Neubau des Programms. In D blieb das Programm acht Runden lang beim Text vor der ersten Runde, weil jede Bearbeitung wieder in einen solchen Schub fiel. Erst eine Bearbeitung in einem kleinen Schub holt es nach.
  - Codium bekommt dabei einen Fehler bzw. nichts zurück: keine Vorschläge, keine Färbung. Ob auch Fehlerhinweise an falschen Stellen erscheinen, ist nicht geprüft.
- **Bewertung:**
  - Der Fehler passt zur Lage beim Nutzer. Während des Maven-Builds kommen leicht mehr als 1000 Änderungen zusammen, zumal Codium und die Überwachung des Servers jede doppelt melden. Dazu kam eine offene, gerade bearbeitete Datei.
  - Einen Absturz erklärt er nicht: In allen Versuchen fing der Server die Panics in der Anfrage ab. Beenden würde den Server eine Panic auf einer Goroutine ohne `recover`, etwa in den parallelen Arbeitsgruppen, im Timer des Aufräumens oder in der Hintergrund-Warteschlange. Bei einem Projekt ohne Konfiguration rechnen diese Wege keine Positionen zwischen Programm und Dokument um, und die Verwendungen über mehrere Projekte fangen Panics selbst ab. Belegt ist ein solcher Weg nicht.
  - **Die Ursache bleibt offen**, ebenso die Kriterien 1 und 2.
- **Gemeinsamer Typ-Zwischenspeicher:** In diesen Versuchen lief der Server mit `LOCALAPPDATA` auf einer Kopie im Temp-Ordner. `%LOCALAPPDATA%\Microsoft\TypeScript\7.0` (älter als diese Arbeiten, nicht von mir angelegt) blieb unverändert, geprüft an den Dateizeiten, ebenso in den vollen Testläufen (siehe dort).
- **Aufgeräumt:** Temp-Klon samt kopierter `node_modules`, `.quinoa` und `nul`, die Kopie des Zwischenspeichers, alle Laufprotokolle und der gelesene Quelltext von typescript-go sind gelöscht; der vorübergehende Test ist entfernt.

### Behebung

- **An der Ursache:** keine, weil die Ursache fehlt. Eine Meldung an das TypeScript-Projekt zum Absturz gibt es ohne Ursache nicht vorzubereiten. Für den gefundenen Fehler mit den verlorenen Bearbeitungen steht unten ein Entwurf.
- **Vorschlag, vom Nutzer am 2026-11-26 verworfen** (nicht umgesetzt): Codium meldet `didChangeWatchedFiles.dynamicRegistration: true`, nimmt die Registrierungen des Servers an und meldet wie bisher alle Änderungen im Projekt. Dann startet der Server seine eigene Überwachung nicht, und Codium läuft wie VS Code auf dem viel benutzten Weg.
  - Dafür spricht: Weniger doppelte Arbeit, und Dateiänderungen gehen durch die Anfrageschleife des Servers, die Panics abfängt. Geprüft: Der Server meldet dann „using LSP client-side watching“ und schickt `client/registerCapability`.
  - Dagegen spricht: Es ist nicht belegt, dass es den Absturz behebt. Änderungen ausserhalb des Projekts (Typ-Zwischenspeicher, `node_modules` über dem Projektordner) sähe dann niemand mehr.
  - Dazu (2026-11-25): Ohne die eigene Überwachung des Servers kämen nur Codiums Meldungen an, ohne `.git`; die Schübe wären etwa halb so gross. Die verlorenen Bearbeitungen verhindert das allein nicht, denn ein grosser Build im Projektordner meldet auch so über 1000 Änderungen. Das täte erst ein zusätzlicher Filter: Codium meldet dem TypeScript-Server nur Dateien mit Endungen, die er liest (TypeScript, JavaScript, JSON), und Ordner. Auch das ist nicht umgesetzt und zu entscheiden.
- **Entwurf einer Meldung an microsoft/typescript-go** (geht nur mit Zustimmung des Nutzers hinaus; ohne Namen und Inhalte aus seinem Projekt; nachgestellt mit dem neutralen Versuch D über Codiums Kern, der die Änderungen zusätzlich selbst meldete; vor dem Absenden fehlt noch ein Nachstellen mit einem reinen LSP-Client, das zeigt, dass die eigene Überwachung des Servers allein genügt):

  > **LSP: edits to an open file are dropped when more than 1000 watched-file changes are pending; requests on that file then panic**
  >
  > TypeScript 7.0.2 (`tsc --lsp --stdio`) on Windows; the client does not announce `didChangeWatchedFiles.dynamicRegistration`, so the built-in watcher runs.
  > 1. Open a folder without tsconfig/jsconfig that contains `web/main.js` (plain JS with a non-ASCII character).
  > 2. Create 1200 files in a subfolder (e.g. `build/r0/C0.class` …) and, before the next request, send `textDocument/didChange` that appends a line `gr`.
  > 3. Request `textDocument/completion` at the end of that line.
  >
  > Expected: completions for the new text. Actual: `panic handling request textDocument/completion: runtime error: slice bounds out of range [:2502] with length 2500` in `isPotentiallyValidJSDocSnippetCompletionPosition`; `textDocument/semanticTokens/full` fails with "token spans multiple lines". The program keeps the old text of the file until an edit arrives together with fewer pending changes.
  > As far as we can read `internal/project/snapshot.go`: when `HasExcessiveWatchEvents()` is true and `watchChangesOverlapCache()` is false, `Changed` and `Deleted` are cleared, including the change of the open document, because `watchChangesOverlapCache` only looks at files read from disk.

### Gebaut

- **Ringpuffer** (`src/main/core/language/serverLog.ts`, `TailBuffer`):
  - Jede LSP-Verbindung liest stderr wie bisher, hebt aber die letzten 64 KB auf. Fehlt der Anfang, beginnt der Text an einer ganzen Zeile; gibt es keine, am ersten ganzen UTF-8-Zeichen (seit dem Review).
  - Die Verbindung meldet beim Ende Exit-Code und Signal sowie einen Startfehler (etwa ENOENT).
- **Protokoll** (`LanguageServerLog`, eine Instanz im App-Kern für alle Projektfenster, Schreibvorgänge nacheinander):
  - Inhalt eines Eintrags: Zeitpunkt (Ortszeit mit Millisekunden), Projekt, Server, Art (`kind`), Programm mit Argumenten, Exit-Code bzw. Signal und wie es weitergeht („Restarting (restart 1 of 3 …)“ bzw. „Not restarted …“), danach stderr.
  - Notiz bei einem Start, den Codium abbrach (keine Antwort auf `initialize`), bzw. bei einem Startfehler.
  - Auf den Rest von stderr wartet der Eintrag höchstens 1 s, denn Node meldet `exit` vor dem Schliessen der Pipes.
  - Ort: `logs\language-servers.log` im Datenordner, im Testmodus also im Datenordner des Tests.
  - Grösse: Würde ein Eintrag die Datei über 1 MB bringen, wird sie zu `language-servers.old.log` (ein älteres fällt weg). Ein einzelner Eintrag über der Grenze wird hinten gekürzt, nie mitten in einem Zeichen. Lässt sich das Protokoll nicht ersetzen (etwa weil ein anderes Programm es offen hält), kommt der Eintrag trotzdem dazu (seit dem Review).
  - Beim Beenden wartet der App-Kern bis 2 s auf Einträge, die noch geschrieben werden; der Sprach-Dienst meldet jeden gleich beim Ende des Servers an (`track`, `idle`; seit dem Review). Ein Fehler beim Melden eines Schreibfehlers lässt die Warteschlange nicht dauerhaft ablehnen.
  - Ein normales Beenden durch Codium kommt nicht ins Protokoll. Schreibfehler gehen an die Fehlerausgabe des Hauptprozesses (`console.error`; `main.ts` gibt dem Kern kein eigenes Protokoll), nie als Ausnahme.
- **Meldung nach dem Aufgeben:**
  - Wortlaut: „The TypeScript language server stopped 4 times within three minutes and was not restarted. Click Restart to start it again.“
  - Sie erscheint erst, wenn der letzte Eintrag geschrieben ist.
  - **„Show Log“** (Aktion `languageServers.showLog`, Befehl `app.languageServerLog`): öffnet das Protokoll schreibgeschützt als Tab „language-servers.log – language server log (read-only)“, den Cursor am letzten Eintrag. Er zeigt erst `language-servers.old.log`, dann das aktuelle Protokoll, damit nach einem Ersetzen die ersten Abstürze einer Reihe nicht fehlen. Ist der Tab schon offen, bekommt er den neuen Text und gilt weiter als gespeichert, schliesst also ohne Rückfrage (beides seit dem Review). Die Meldung bleibt stehen: Knöpfe können dafür neu `keepOpen` tragen, sonst schliesst wie bisher jeder Klick die Meldung.
  - **„Restart“** (Aktion und Befehl `language.restart`): Der Dienst beendet einen allenfalls laufenden Server und setzt die Zählung zurück. Er startet neu, wenn das Projekt Kennzeichen der Sprache hat oder ein Dokument dieser Sprache offen ist; offene Dokumente bekommt der Server wie nach jedem Start. `restartJava` (anderes JDK) nutzt denselben Weg.
- **Doku:** Spezifikation („Sprachverständnis“: Neustarts und Protokoll; „Oberfläche“, „Meldungen“: neue Knöpfe und `keepOpen`), README (Ort des Protokolls), `docs/offene-punkte.md`.

### Tests

- **Schnell, `test/main/serverLog.test.ts`:**
  - Ringpuffer: alles unter der Grenze; nur das Ende, an einer ganzen Zeile; ein Stück über der Grenze; ohne ganze Zeile ab dem ersten ganzen Zeichen.
  - Eintrag mit allen Feldern; Signal, Notiz, gekürztes und leeres stderr.
  - Ersetzen vor der Grenze, höchstens zwei Dateien, für „Show Log“ erst das alte, dann das aktuelle; scheitert das Ersetzen, kommt der Eintrag trotzdem dazu.
  - Kürzen eines zu grossen Eintrags, mit der Grenze an jeder Stelle eines 3-Byte-Zeichens, ohne kaputtes UTF-8.
  - Gleichzeitige Einträge nacheinander, auch wenn dabei ersetzt wird; Schreibfehler ohne Ausnahme, auch wenn die Meldung selbst wirft.
  - Warten auf Einträge in Vorbereitung, höchstens bis zur Frist.
- **Schnell, `test/main/languageServerLog.test.ts`** (nachgemachter Server `fakeLspServer.ts`, der neu auf Bestellung abstürzt, solange eine Marker-Datei existiert):
  - Ein Absturz mit Exit-Code 3 nach 4000 Zeilen (über 100 KB) auf stderr hinterlässt einen Eintrag mit Server, Art, Programm, Exit-Code, „Restarting (restart 1 of 3 …)“ und dem Ende von stderr bis zur Panic-Zeile, ohne den Anfang.
  - Ein Server, der nach jedem `didOpen` abstürzt, wird nach vier Enden aufgegeben. Die Meldung trägt die beiden Knöpfe, das Protokoll enthält alle vier Enden. (Seit dem Review ohne eigene Grössengrenze und ohne Warnungen von Node auf stderr; das Ersetzen prüfen die Einheitstests.)
  - `language.restart` startet neu, die Definition geht wieder, und ein weiterer Absturz startet erneut statt aufzugeben.
  - Ungültige Parameter; kein Start ohne Dokument und Kennzeichen, auch nicht mit TypeScript 5 im Projekt, das sonst den nachgemachten Server nähme.
  - Ein Eintrag, der nach dem Absturz noch auf stderr wartet (ein Hilfsprozess hält es offen), ist beim Kern angemeldet und steht nach dem Beenden im Protokoll; ein Kern ohne Projekt wartet beim Beenden auf einen Eintrag, der erst nach 1,5 s kommt.
- **UI, `test/ui/languageServerLog.test.ts`:** In der echten App beendet der Test den nativen Server viermal. Geprüft werden:
  - die Meldung mit den Knöpfen;
  - „Show Log“: schreibgeschützter Tab, Titel, Cursor am letzten Eintrag, die Meldung bleibt stehen; ein zweites Mal nach einem neuen Eintrag: neuer Text, nicht ungespeichert;
  - „Restart“: die Meldung geht zu, der Server läuft wieder, und Ctrl + Linksklick springt zur Definition;
  - der Tab des Protokolls schliesst ohne Rückfrage.
- **Kriterium 2** (Test der auslösenden Lage, ohne Behebung rot): nicht erfüllbar ohne Ursache. Der neutrale Versuch D liesse sich zu einem langsamen Test machen, falls Codium den Fehler mit den verlorenen Bearbeitungen umgeht; ohne Umgehung gibt es nichts, wogegen er grün würde.

### Testläufe vor dem Review (2026-11-25, nacheinander und allein auf dem Rechner; durch die Läufe im Abschnitt „Review“ ersetzt)

| Lauf | Ergebnis | Dauer |
|---|---|---|
| `npm run typecheck` | grün | 2 s |
| `npm test` | 449 von 449 grün (52 Dateien) | 85 s |
| `npm run test:slow` | 40 von 40 grün (9 Dateien), nichts übersprungen | 161 s |
| `npm run test:ui` | 90 von 90 grün (26 Dateien) | 475 s |

Danach: keine Prozesse aus dem Checkout, keine `codium-*`-Ordner im Temp-Ordner, keine Meldung der Schlussprüfung. Das Vorlesen der gebauten App meldete `mermaid.js` mit 17,2 s (Virenscanner). `%LOCALAPPDATA%\Microsoft\TypeScript\7.0` blieb auch in diesen Läufen unverändert (keine Datei mit Datum 2026-11-25).

## Review

Ein zweiter Agent hat den Branch am 2026-11-25 gegen Ticket, Spezifikation und Spielregeln geprüft; nichts blockierte. Eingearbeitet:

- **„Show Log“ auf einem schon offenen Tab:** Nach `setValue` gelten der neue Text und seine Version als gespeichert (`savedVersion`, `diskText`), ein geplantes Speichern entfällt. Vorher galt der schreibgeschützte Tab als ungespeichert, und beim Schliessen kam die Rückfrage zu Änderungen, die sich nicht speichern liessen. Der UI-Test klickt „Show Log“ ein zweites Mal nach einem neuen Eintrag und prüft den neuen Text, „nicht ungespeichert“ und das Schliessen ohne Rückfrage. Gegenprobe ohne die Behebung: rot (`data-modified` ist „true“).
- **Rotation im Kern-Test:** Der nachgemachte Server läuft mit `NODE_NO_WARNINGS=1`. Der Test braucht keine eigene Grössengrenze mehr; Ersetzen und Reihenfolge prüfen die Einheitstests. Die Testoption `serverLogMaxBytes` ist entfernt.
- **„Restart“ ohne Kennzeichen:** Das Projekt „Plain“ hat TypeScript 5 (`node_modules/typescript/lib/tsserver.js`), aber kein tsconfig.json, jsconfig.json oder package.json; ein Start nähme also den nachgemachten Server. Geprüft: kein Server, kein Protokoll. Gegenprobe ohne die Bedingung: rot.
- **Kürzen ohne kaputtes UTF-8:** Fälle mit 0, 1 und 2 ASCII-Zeichen vor lauter `€`, sodass die Grenze an jede Stelle eines Zeichens fällt. Das Kürzen schneidet jetzt an der Zeichengrenze in den Bytes, statt hinterher ein Ersatzzeichen zu entfernen. Gegenprobe: rot.
- **Ersetzen scheitert:** `rename` steht in einem eigenen `try`; der Eintrag kommt trotzdem dazu, mit einer Meldung. Einheitstest mit einem nicht leeren Ordner am Platz des alten Protokolls. Gegenprobe: rot.
- **Warteschlange:** `.catch` an der Warteschlange; zusätzlich fängt das Melden selbst Fehler ab. Einheitstest mit einem werfenden `log`. Gegenprobe (beides entfernt): rot.
- **Ringpuffer:** Ohne ganze Zeile beginnt der Text am ersten ganzen UTF-8-Zeichen. Einheitstest ohne Zeilenumbruch und mit nur einer Zeile. Gegenprobe: rot.
- **Gleichzeitige Einträge** jetzt mit einer Grenze, bei der zwei Einträge in eine Datei passen: nur ganze Einträge, in der Reihenfolge, Grössen eingehalten.
- **Beenden:** `AppCore.shutdown` wartet bis 2 s auf das Protokoll (`LanguageServerLog.idle`); der Sprach-Dienst meldet jeden Eintrag gleich beim Ende des Servers an (`track`). Zwei Tests, beide mit Gegenprobe rot:
  - ein Absturz, nach dem ein Hilfsprozess stderr offen hält: Der Eintrag ist angemeldet und steht nach dem Beenden im Protokoll;
  - ein Kern ohne Projekt mit einem Eintrag, der erst nach 1,5 s kommt.

  Der erste Test allein belegt das Warten nicht: Mit laufendem Server dauerte das Beenden hier ohnehin 1,3 s, länger als die Wartezeit auf stderr. Deshalb gibt es den zweiten.
- **„Show Log“ nach dem Ersetzen:** erst `language-servers.old.log`, dann das aktuelle Protokoll, in einem Tab (`readAll`). Einheitstest; Vertrag, Spezifikation und README nachgeführt.
- **Wortlaut zu Schreibfehlern** korrigiert: Sie gehen an die Fehlerausgabe des Hauptprozesses, nicht in ein Protokoll von Codium.
- **Entwurf der Meldung an typescript-go:** Er sagt jetzt, dass Codium im Versuch D die Änderungen zusätzlich selbst meldete und dass vor dem Absenden ein Nachstellen mit einem reinen LSP-Client fehlt. Er geht weiterhin nicht hinaus.
- **Datenschutz:** Durch Merkmale ersetzt sind die Uhrzeiten aus Reflog und Dateizeiten, Zahlen zum Projekt (Dateien je Merge und Branch-Wechsel, Grösse der Kopie, geschriebene Build-Dateien je Minute), die Zusammensetzung der Konfliktdateien und der Werkzeugordner im Projekt, auch in den Teilen des Vorgängers. Die Doku-Commits des Branches sind mit `git reset --soft` zu einem zusammengefasst; geprüft mit `git log -p main..HEAD`.

Nicht eingearbeitet: nichts. Bewusst so gelassen: Der Code-Commit des Vorgängers nennt als Beispiel einer Zeitangabe eine Uhrzeit mit dem Datum der Meldung (Kommentar in `serverLog.ts`, Testdaten in `serverLog.test.ts`). Für sich verrät sie nichts über das Projekt. Umgeschrieben ist dieser Commit nicht, denn verlangt war das Zusammenfassen der Doku-Commits; falls gewünscht, lässt sich die Beispielzeit dort neutral ersetzen.

**Testläufe nach dem Review** (2026-11-25, nacheinander und allein auf dem Rechner):

| Lauf | Ergebnis | Dauer |
|---|---|---|
| `npm run typecheck` | grün | 2 s |
| `npm test` | 455 von 455 grün (52 Dateien) | 98 s |
| `npm run test:slow` | 40 von 40 grün (9 Dateien), nichts übersprungen | 195 s |
| `npm run test:ui` | **89 von 90** (26 Dateien); rot: „bleibt stabil, wenn ein Tab während des Lesens schliesst …“ (`editor.test.ts`) | 482 s |
| `npm run test:ui`, zweiter Lauf | **89 von 90**; rot: „lädt eine von aussen geänderte Datei still neu …“ (`save.test.ts`) | 505 s |
| `npm run test:ui`, dritter Lauf (Prüfung vor dem Merge) | 90 von 90 grün | 446 s |

- Beide roten Tests zeigen dasselbe Bild: Der Doppelklick auf eine Datei im Baum kehrt nicht zurück (Playwright meldet das Element sichtbar und stabil, danach „performing dblclick action“ bis zum Zeitlimit von 30 s). Das ist der bekannte wackelige Test aus Ticket 27 (`docs/offene-punkte.md`, „Wackelige Tests“, dort nachgeführt), jetzt in zwei Läufen hintereinander und in anderen Tests.
- Einzeln danach: `editor.test.ts` 3 von 3 Läufen grün. `save.test.ts` 6 von 7; der rote Einzellauf traf einen dritten Test („überschreibt eine fremde Änderung nicht …“), seine Meldung ist nicht festgehalten.
- Die geänderten Stellen laufen in diesen Tests nicht: Der offene Tab von „Show Log“ und das Protokoll kommen dort nicht vor, und das Warten beim Beenden endet ohne Einträge sofort. Einen Zusammenhang sehe ich nicht, belegt ist das aber nicht. Vor dem Review war derselbe UI-Lauf grün (90 von 90).
- Laut Ereignisprotokoll war der Rechner während der Läufe nicht im Standby (ein Standby begann erst 30 s nach dem Ende des zweiten UI-Laufs); es lief kein fremder Build.
- Danach: keine Prozesse aus dem Checkout, keine `codium-*`-Ordner, keine Meldung der Schlussprüfung, keine Verletzung des Testmodus. Das Vorlesen der gebauten App meldete `mermaid.js` mit 18,3 s bzw. 17,4 s.
- Ein UI-Einzellauf schrieb `package-lock.json` im gemeinsamen Typ-Zwischenspeicher neu (gleiche Grösse), der bekannte Nebeneffekt aus `docs/offene-punkte.md`, „Gemeinsamer Typ-Zwischenspeicher“.
- **Kriterium 5:** Nach den beiden roten Läufen war es zunächst wieder offen. Ein dritter UI-Lauf vor dem Merge war grün (90 von 90), samt `typecheck`; der hängende Doppelklick bleibt unter „Wackelige Tests“ in `docs/offene-punkte.md` zu beobachten.

## Abschluss (2026-11-26)

Der Nutzer hat entschieden, wörtlich: „vergiss den punkt6 und schliesse das ticket 30 vollständig ab. Falls wiedermal ein fehler auftaucht werde ich ein neues ticket erstellen“.

- Die Ursache bleibt unbekannt; die Kriterien 1 und 2 entfallen.
- Der Vorschlag zu `didChangeWatchedFiles.dynamicRegistration` und zum Filtern nach Endungen (bisher Punkt 6 in `docs/offene-punkte.md`) ist verworfen und dort gestrichen.
- Der Entwurf einer Meldung an typescript-go bleibt unverschickt.
- Gebaut und gemergt bleibt die Diagnose: Protokoll der Sprachserver, „Show Log“ und „Restart“. Sie ist ab Codium 0.3.0 im installierten Codium enthalten. Tritt der Absturz wieder auf, wird es ein neues Ticket, mit dem Inhalt von „Show Log“.
- Die Punkte unter „Abnahme von Hand“ bleiben offen, bis der Nutzer sie prüft.
