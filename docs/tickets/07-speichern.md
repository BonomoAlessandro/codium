# 07 – Automatisches Speichern, Kodierung und Änderungen von aussen

Status: `erledigt` (2026-11-22, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
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

- [x] Kern-Tests im Temp-Ordner:
  - Lesen und Zurückschreiben erhält die Bytes genau für UTF-8 mit und ohne BOM, UTF-16 LE und BE mit BOM, Windows-1252 mit Umlauten, LF und CRLF.
  - Eine neue Datei in einem Projekt mit überwiegend CRLF bekommt CRLF, in einem leeren Projekt LF.
  - Ein eigener Schreibvorgang erzeugt kein Ereignis „von aussen geändert“, ein fremder schon.
- [x] Playwright-Tests:
  - Tippen, kurz warten → die Datei auf der Festplatte hat den neuen Inhalt, die Markierung „ungespeichert“ ist weg.
  - Tabwechsel speichert sofort; Ctrl + S speichert sofort.
  - Datei von aussen ändern → der offene Tab zeigt den neuen Inhalt.
  - Tippen und sofort danach die Datei von aussen ändern → der Hinweis erscheint. „Keep Mine“ schreibt die eigene Fassung, „Load from Disk“ zeigt die fremde.
  - Datei von aussen löschen → der Tab schliesst sich. Löschen und sofort neu anlegen → der Tab bleibt und zeigt den neuen Inhalt.
  - Datei im Baum umbenennen → der Tab heisst neu und speichert unter dem neuen Namen.

## Abnahme von Hand

- [ ] Eine Datei mit CRLF bearbeiten: `git diff` im Terminal zeigt nur die echte Änderung, keine Zeilenende-Änderungen.
- [ ] Während Claude Code eine offene Datei ändert, erscheint beim gleichzeitigen Tippen der Hinweis, und keine Fassung geht still verloren.
- [ ] Eine Datei mit gemischten Zeilenenden (etwa aus einem Windows-Repository) an einer Stelle bearbeiten: `git diff` zeigt nur die bearbeiteten Zeilen.
- [ ] Tippen und sofort „Exit“, Alt + F4 oder das Kreuz des Fensters: Die Eingaben sind gespeichert.
- [ ] In einer Windows-1252-Datei ein Zeichen wie „→“ tippen: Die Meldung erklärt es; Schliessen des Tabs fragt, bevor die Eingaben verloren gehen.

## Umsetzung

- **Schreiben im Kern** (`files.write`): in der Kodierung der Datei mit ihrem BOM (UTF-8, UTF-16 LE und BE, Windows-1252 mit eigener Zeichentabelle; ein Zeichen, das Windows-1252 nicht kennt, ergibt `CANNOT_ENCODE` statt einer still verfälschten Datei). Die eigene Änderung meldet der Kern vorher bei der Überwachung an; sie kommt nicht als Änderung von aussen zurück.
- **Neue Dateien:** Hat eine Textdatei keinen Zeilenumbruch, liefert `files.read` das im Projekt überwiegende Zeilenende (Stichprobe von bis zu 200 Textdateien ohne `.git`, `node_modules` und Build-Ordner, eine Minute zwischengespeichert; Rückfall LF).
- **Oberfläche:** Speichern etwa 1 s nach der letzten Eingabe, sofort beim Tabwechsel, beim Schliessen, wenn das Fenster den Fokus verliert, mit Ctrl + S (in der zentralen Tastenbelegung) und vor dem Schliessen des Fensters bzw. dem Beenden. Speichervorgänge einer Datei laufen nacheinander. `EditorAreaHandle.saveAll()` wartet auf alle; Git-Aktionen (Ticket 15) nutzen es.
- **Änderungen von aussen:** Ohne Eingaben übernimmt der Tab den neuen Inhalt als eigenen Schritt im Rückgängig-Verlauf; ersetzt wird nur der Teil zwischen gleichem Anfang und Ende, so bleiben Cursor und Scrollstand. Mit Eingaben erscheint über dem Editor „File changed on disk“ mit „Load from Disk“ und „Keep Mine“; bis dahin ruht das Speichern. Nach verpassten Ereignissen (`rescanned`) prüft der Tab selbst.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-21. Erhalt der Bytes für reine Zeilenenden, alle 256 Bytes von Windows-1252, Echo eigener Schreibvorgänge, Zeilenende neuer Dateien, Pfadprüfung, Reihenfolge der Speichervorgänge, Umbenennen, „Keep Mine“ und „Load from Disk“ in Ordnung. Eingearbeitet:

- **Fremde Änderung kurz vor dem Speichern wurde still überschrieben** (nachgewiesen, hoch): Der Konflikt wurde nur erkannt, wenn die Meldung der Überwachung vor dem Speichern ankam; danach hielt der Kern die fremde Änderung für das Echo des eigenen Schreibens. Jetzt liefern `files.read` und `files.write` einen Stand (Hash der Bytes), und `files.write` schreibt nur, wenn die Datei noch den erwarteten Stand hat (sonst `FILE_CHANGED`, und der Tab zeigt den Hinweis). Nur „Keep Mine“ schreibt ohne Prüfung. Bekannte Grenze: Was ein anderes Programm genau zwischen Prüfung und Schreiben schreibt, geht verloren (im Code vermerkt).
- **Eingaben der letzten Sekunde gingen beim Beenden und Schliessen des Fensters verloren** (nachgewiesen, hoch): Vor dem Schliessen eines Projektfensters und vor dem Beenden schickt der Kern `editor.flushRequest` und wartet auf `editor.flushed`, höchstens 3 s. Der Fenster-Port bekam dafür `onCloseRequested`; während Codium endet, schliessen Fenster ohne Aufhalten, sonst bräche Electron das Beenden ab.
- **Schliessen eines Tabs, dessen Eingaben sich nicht speichern lassen, verwarf sie** (nachgewiesen): Schliessen durch den Nutzer speichert jetzt zuerst und fragt bei Eingaben, die sich nicht speichern lassen (auch bei „File changed on disk“), mit „Discard and Close“ und „Cancel“.
- **Gemischte Zeilenenden wurden vereinheitlicht** (nachgewiesen): Der Kern behält das Zeilenende gleich gebliebener Zeilen am Anfang und Ende; im geänderten Bereich übernehmen die Zeilen der Reihe nach die Zeilenenden der alten Zeilen dort, nur eingefügte bekommen das überwiegende. Auch ein einzelnes CR bleibt.
- **Tests:** Kern-Tests für den erwarteten Stand, gemischte Zeilenenden und einzelnes CR, das Speichern vor „Exit“ und vor dem Schliessen eines Fensters (mit Zeitlimit ohne Antwort). Oberflächentests für Ctrl + S gleich nach einer fremden Änderung, für Tippen und sofort „Exit“ bzw. Schliessen des Fensters und für die Rückfrage beim Schliessen eines Tabs.

Verworfen: **Gelöschte Datei mit Eingaben** – die Spezifikation schliesst den Tab einer von aussen gelöschten Datei ausdrücklich („keine Geister-Tabs“), wie IntelliJ. Bleibt so; steht als Entscheidung hier.
