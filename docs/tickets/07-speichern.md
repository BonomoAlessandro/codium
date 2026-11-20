# 07 – Automatisches Speichern, Kodierung und Änderungen von aussen

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: 05
User Stories: 23 (Zeilenende, Kodierung), 31 (Tab folgt dem neuen Namen), 56–62
Spezifikation: „Editor, Tabs und Speichern“ (Automatisches Speichern, Lesen, Schreiben, Änderungen von aussen), „Präzisierungen beim Schreiben“ Punkte 1, 2, 17

## Was gebaut wird

- **Kodierung und Zeilenende:**
  - Erkennung beim Lesen vollständig nach der Spezifikation: BOM, Null-Bytes, gültiges UTF-8, sonst Windows-1252; Zeilenende LF oder CRLF.
  - Schreiben in derselben Kodierung, mit demselben BOM und Zeilenende.
  - Neue Dateien: UTF-8 ohne BOM und das im Projekt überwiegende Zeilenende (Rückfall LF).
  - Beim Speichern wird sonst nichts verändert.
- **Automatisches Speichern** in der Oberfläche: etwa eine Sekunde nach der letzten Eingabe, sofort bei Tabwechsel, Schliessen des Tabs, Fokusverlust des Fensters und Ctrl + S (Eintrag in der zentralen Tastenbelegung bzw., falls Ticket 06 noch nicht fertig ist, so angelegt, dass 06 ihn übernimmt). Die Markierung „ungespeichert“ ist nur bis zum Speichern sichtbar.
- **Vor Git-Aktionen speichern:** Die Oberfläche bietet eine Funktion „alle offenen Speichervorgänge abschliessen“, auf die spätere Git-Aktionen warten (genutzt ab Ticket 15).
- **Änderungen von aussen:**
  - Eigene Schreibvorgänge erkennt der Datei-Dienst und meldet sie nicht als Änderung von aussen.
  - Geänderte offene Datei ohne ungespeicherte Eingaben → der Tab lädt still neu und behält Cursor und Scrollstand, so gut es geht.
  - **Konflikt:** Hat der Tab ungespeicherte Eingaben, erscheint im Tab der Hinweis „File changed on disk“ mit „Load from Disk“ und „Keep Mine“. Bis zur Entscheidung ruht das automatische Speichern für diesen Tab.
  - Gelöschte offene Datei (nach dem Bündeln wirklich weg) → der Tab schliesst sich.
  - Umbenennen im Dateibaum → ein offener Tab folgt dem neuen Namen.
- **Statusleiste:** Zeilenende und erkannte Kodierung.

## Akzeptanzkriterien

- [ ] Kern-Tests im Temp-Ordner:
  - Lesen und Zurückschreiben erhält die Bytes genau für UTF-8 mit und ohne BOM, UTF-16 LE und BE mit BOM, Windows-1252 mit Umlauten, LF und CRLF.
  - Eine neue Datei in einem Projekt mit überwiegend CRLF bekommt CRLF, in einem leeren Projekt LF.
  - Ein eigener Schreibvorgang erzeugt kein Ereignis „von aussen geändert“, ein fremder schon.
- [ ] Playwright-Tests:
  - Tippen, kurz warten → die Datei auf der Festplatte hat den neuen Inhalt, die Markierung „ungespeichert“ ist weg.
  - Tabwechsel speichert sofort; Ctrl + S speichert sofort.
  - Datei von aussen ändern → der offene Tab zeigt den neuen Inhalt.
  - Tippen und sofort danach die Datei von aussen ändern → der Hinweis erscheint. „Keep Mine“ schreibt die eigene Fassung, „Load from Disk“ zeigt die fremde.
  - Datei von aussen löschen → der Tab schliesst sich. Löschen und sofort neu anlegen → der Tab bleibt und zeigt den neuen Inhalt.
  - Datei im Baum umbenennen → der Tab heisst neu und speichert unter dem neuen Namen.

## Abnahme von Hand

- [ ] Eine Datei mit CRLF bearbeiten: `git diff` im Terminal zeigt nur die echte Änderung, keine Zeilenende-Änderungen.
- [ ] Während Claude Code eine offene Datei ändert, erscheint beim gleichzeitigen Tippen der Hinweis, und keine Fassung geht still verloren.
