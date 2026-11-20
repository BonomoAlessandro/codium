# 17 – Vergleichsansicht und Änderungsbalken

Status: `ready-for-agent` · Typ: AFK
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

## Akzeptanzkriterien

- [ ] Kern-Tests:
  - Inhalt einer Datei im letzten Commit, in einem älteren Commit und „nicht vorhanden“.
  - Änderungsblöcke für geänderte, eingefügte und gelöschte Zeilen, am Anfang und am Ende der Datei.
  - Mit Zeilenende-Umwandlung (Repository mit LF, Arbeitsdatei mit CRLF) ist eine unveränderte Datei ohne Blöcke.
  - Eine Windows-1252-Datei mit Umlauten ist unverändert ohne Blöcke.
  - Eine nicht versionierte Datei hat keine Blöcke.
  - Nach einem Commit ändert sich der Vergleichsstand.
- [ ] Playwright-Tests:
  - Doppelklick in der Änderungsansicht öffnet die Vergleichsansicht mit altem und neuem Stand.
  - Bearbeiten der rechten Seite speichert die Datei; ein zugleich offener Datei-Tab zeigt denselben Text.
  - Nach dem Tippen erscheint ein Änderungsbalken; „Rollback Lines“ stellt den Block wieder her, und der Balken verschwindet.

## Abnahme von Hand

- [ ] Die Vergleichsansicht sieht aus wie in IntelliJ; Umschalten auf eine Spalte und die Pfeile funktionieren.
- [ ] Die Änderungsbalken folgen dem Tippen ohne spürbare Verzögerung.
