# 17 – Vergleichsansicht und Änderungsbalken

Status: `erledigt` (2026-11-22, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
Blockiert durch: 16
User Stories: 113, 119–125
Spezifikation: „Git“ (Änderungsblöcke für die Änderungsbalken, Vergleichsansicht), „Editor, Tabs und Speichern“ (Ein Modell pro Datei)

## Was gebaut wird

- **Inhalt einer Datei in einem Commit** im Git-Dienst (leer, wenn sie dort nicht existiert), so geholt, wie Git ihn auschecken würde (Zeilenende-Umwandlung, Filter), und mit der Kodierung der Datei dekodiert. Wird auch von Ticket 19 genutzt.
- **Vergleichsansicht** als Tab im Code-Bereich mit Monacos Vergleichsansicht:
  - nebeneinander, umschaltbar auf eine Spalte
  - Pfeile für nächste und vorherige Änderung
  - Syntaxfarben wie im Editor
  - **Aus der Änderungsansicht** (Doppelklick, ersetzt das Öffnen aus Ticket 16, sowie Rechtsklick „Show Diff“): letzter Commit gegen Arbeitsordner. Die rechte Seite ist das gemeinsame Modell der Datei, bearbeitbar und automatisch gespeichert.
  - Neue Dateien vergleichen gegen leer, gelöschte gegen leer auf der rechten Seite, Umbenennungen alten gegen neuen Pfad.
  - **Vergleiche aus der Historie** (für Ticket 19 vorbereitet) sind auf beiden Seiten schreibgeschützt; bei Merge-Commits gegen den ersten Elterncommit.
  - Vergleichs-Tabs werden nach einem Neustart nicht wiederhergestellt.
- **Änderungsblöcke** im Git-Dienst:
  - Pro offener Datei einmal den Stand im letzten Commit holen (wie oben) und zwischenspeichern, bis sich HEAD oder Index ändern.
  - Zu einem aktuellen Text die Blöcke (geändert, neu, gelöscht) mit den alten Zeilen berechnen, zeilenweise ohne Rücksicht auf das Zeilenende, ohne Git-Aufruf pro Anfrage.
- **Änderungsbalken** im Editor:
  - Blau geändert, grün neu, grauer Keil für gelöschte Zeilen.
  - Die Oberfläche fragt während des Tippens entprellt nach.
  - Klick auf einen Balken zeigt den alten Stand dieses Blocks und bietet „Rollback Lines“; das ersetzt die Zeilen im Editor, danach greift das automatische Speichern.
  - Keine Balken für nicht versionierte Dateien und Dateien ab 5 MB.

- **Hinweis aus Ticket 05:** Tabs ab 5 MB tragen im Inhalt `large: true` (aus `files.read`); sie bekommen keine Änderungsbalken.

## Akzeptanzkriterien

- [x] Kern-Tests:
  - Inhalt einer Datei im letzten Commit, in einem älteren Commit und „nicht vorhanden“.
  - Änderungsblöcke für geänderte, eingefügte und gelöschte Zeilen, am Anfang und am Ende der Datei.
  - Mit Zeilenende-Umwandlung (Repository mit LF, Arbeitsdatei mit CRLF) ist eine unveränderte Datei ohne Blöcke.
  - Eine Windows-1252-Datei mit Umlauten ist unverändert ohne Blöcke.
  - Eine nicht versionierte Datei hat keine Blöcke.
  - Nach einem Commit ändert sich der Vergleichsstand.
- [x] Playwright-Tests:
  - Doppelklick in der Änderungsansicht öffnet die Vergleichsansicht mit altem und neuem Stand.
  - Bearbeiten der rechten Seite speichert die Datei; ein zugleich offener Datei-Tab zeigt denselben Text.
  - Nach dem Tippen erscheint ein Änderungsbalken; „Rollback Lines“ stellt den Block wieder her, und der Balken verschwindet.

## Abnahme von Hand

- [ ] Die Vergleichsansicht sieht aus wie in IntelliJ; Umschalten auf eine Spalte und die Pfeile funktionieren.
- [ ] Die Änderungsbalken folgen dem Tippen ohne spürbare Verzögerung.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-22. Zeilen-Diff (mit 20 000 Zufallsfällen geprüft), Zuordnung der Zeilen beim „Rollback Lines“ am Anfang, in der Mitte und am Ende, Zwischenspeicher des Vergleichsstands (auch bei einem Lesen, das während eines Commits läuft), Schutz gegen Argumente in `git.fileAtCommit` und das Nicht-Speichern der Vergleichs-Tabs in Ordnung. Eingearbeitet:

- **Rechte Seite blieb bei „Loading…“:** War die Datei ein wiederhergestellter, noch nicht gelesener Tab, wurde sie für den Vergleich nie geladen. Jetzt lädt die Vergleichsansicht die Datei, wann immer sie noch kein Modell hat.
- **Modell entsorgt, während der Vergleich es zeigte:** Beim Schliessen des letzten Vergleichs einer nur unsichtbar offenen Datei, bei „Close All Tabs“ und beim Umbenennen meldete Monaco einen Fehler. Die Vergleichsansicht gibt das Modell jetzt vorher frei; beim Umbenennen folgen Vergleichs-Tabs der Datei. UI-Test dazu.
- **Hauptprozess blockiert:** Der Zeilen-Diff bewahrte je Runde das ganze Feld auf (bei stark geänderten Dateien rund 200 ms und 130 MB je Anfrage, alle 250 ms beim Tippen). Jetzt nur der nötige Ausschnitt und höchstens 1000 Unterschiede, danach ein einziger Block. Zeittest mit 6000 Zeilen.
- **Rollback falscher Zeilen:** Ein Klick auf einen Balken direkt nach einer Eingabe nahm die Blöcke des vorigen Stands. Jetzt wird dann erst neu gefragt.
- **Binärdateien:** Vergleich zeigt „Binary files cannot be compared.“ statt endlos zu laden; ein binärer Stand im letzten Commit ergibt keine Balken.
- **Kodierung:** Der Stand im Commit wird mit der Kodierung der Arbeitsdatei dekodiert (`encoding` bei `git.fileAtCommit` und `git.changes`), nicht unabhängig erkannt. Kern-Test mit einem Windows-1252-Stand, der zugleich gültiges UTF-8 ist.
- **Rückgängig:** „Rollback Lines“ ist ein eigener Schritt im Rückgängig-Verlauf.
- **Alter Stand veraltete:** Die linke Seite eines offenen Vergleichs wird nach einem Commit oder Wechsel des Branches neu geholt.
- **Knopf „Unified“:** Monaco schaltete in schmalen Fenstern selbst auf eine Spalte; das ist aus, damit der Knopf stimmt.

Bewusst so gelassen:

- Der Zwischenspeicher ist ohne Gross-/Kleinschreibung geschlüsselt, wie alle Pfade in Codium (Windows).
- Ein fehlender oder zusätzlicher Zeilenumbruch am Dateiende ergibt keinen Balken („ohne Rücksicht auf das Zeilenende“).
