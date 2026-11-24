# 30 – TypeScript-Server stürzt in einem Java-Projekt mit Web-Oberfläche wiederholt ab

Status: `ready-for-agent` · Typ: AFK
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

- [ ] Die Ursache des Absturzes steht im Ticket, mit Beleg.
- [ ] Ein Test stellt die auslösende Lage nach, mit einem nachgebauten Testprojekt bzw. einem nachgemachten Server wie in `test/support/fakeLspServer.ts`. Ohne die Behebung ist er rot, mit ihr grün. Ein Test mit dem echten nativen Server kommt in den langsamen Lauf, falls er die Ursache besser belegt.
- [ ] Ein schneller Test prüft das Protokoll:
  - Ein Server, der etwas auf stderr schreibt und mit einem Exit-Code ungleich 0 endet, hinterlässt einen Eintrag mit Server, Exit-Code und den letzten stderr-Zeilen.
  - Der Ringpuffer und die Grössengrenze des Protokolls halten.
- [ ] Ein Test prüft die Meldung nach dem Aufgeben:
  - „Show Log“ öffnet das Protokoll.
  - „Restart“ startet den Server neu, und Sprachfunktionen (etwa eine Definition) gehen danach wieder.
- [ ] `npm run typecheck`, `npm test`, `npm run test:slow` und `npm run test:ui` sind grün.

## Abnahme von Hand

- [ ] Im betroffenen Projekt des Nutzers bleibt der TypeScript-Server nach dem Öffnen von JavaScript-Dateien der Web-Oberfläche stabil, und die Sprachfunktionen gehen.
- [ ] Stürzt ein Sprachserver doch einmal ab, zeigt „Show Log“ verständlich, was passiert ist.

## Hinweise

- Die Spielregeln gelten: Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Keine echten Eingaben an den Desktop.
- Das installierte Codium des Nutzers und seine Prozesse nicht anfassen, auch nicht seinen Datenordner.
- Name und Pfad des Projekts sowie Inhalte daraus gehören nicht in Commits, Tickets oder Tests. Tests und Testprojekte bauen nur die Merkmale nach.
