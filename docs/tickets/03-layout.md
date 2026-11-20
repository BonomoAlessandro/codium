# 03 – Layout: Kopfzeile, Werkzeugfenster, Statusleiste, Meldungen, Rückfragen

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: 02
User Stories: 7 (Menügerüst mit „Exit“), 13, 15–17, 19–22 (ohne Inhalte von Terminal, Git, Find), 24, 174–176
Spezifikation: „Oberfläche“, „Einstellungen, Meldungen und Voraussetzungen“ (Fortschritt), „Präzisierungen beim Schreiben“ Punkt 29

## Was gebaut wird

- **Dunkles Design** nach dem neuen IntelliJ „Dark“:
  - Die Design-Variablen werden auf ein dunkles Schema reduziert.
  - Die Fensterfarbe beim Öffnen ist immer dessen Hintergrundfarbe, auch bei hellem Windows-Design.
  - Die Oberflächenbeschriftungen sind englisch, ebenso die Sprachangabe der Seite.
- **Kopfzeile:**
  - Von Codium gezeichnet, mit den Fensterknöpfen von Windows über die Titelleisten-Überlagerung von Electron.
  - Links das Projektmenü (Projektname mit Pfeil) mit den zuletzt geöffneten Projekten, „Open Folder…“ und „Exit“. „Clone Repository…“ und „Settings…“ kommen mit den Tickets 10 und 09.
  - Der Platz für das Branch-Menü ist vorgesehen (Ticket 15).
- **Werkzeugfenster mit Symbolleisten:**
  - Links „Project“ und „Commit“, unten „Terminal“ und „Git“, rechts „Database“, zunächst mit Platzhalterinhalt. „Find“ ist als Werkzeugfenster vorgesehen, das nur erscheint, wenn es Inhalt hat (Ticket 08).
  - Pro Seite höchstens eines sichtbar; Klick auf das Symbol des sichtbaren Fensters schliesst es, Klick auf ein anderes wechselt.
  - Grösse per Ziehen an den Trennlinien, mit Mindest- und Höchstgrössen, damit der Code-Bereich nie verschwindet.
  - Das untere Werkzeugfenster geht über die ganze Breite zwischen den Symbolleisten.
  - Kürzel Alt + 1 (Project), Alt + 0 (Commit), Alt + F12 (Terminal), Alt + 9 (Git), Alt + 3 (Find). Sie werden so angelegt, dass Ticket 06 sie in die zentrale Tastenbelegung übernehmen kann.
- **Code-Bereich** in der Mitte, vorerst leer mit einem kurzen Hinweis.
- **Statusleiste:** links eine Fortschrittsanzeige für laufende Arbeiten des Kerns (mehrere werden zusammengefasst), rechts Plätze für Zeile:Spalte, Zeilenende und Kodierung (gefüllt ab Ticket 05 bzw. 07).
- **Meldungen** unten rechts, gestapelt. Erfolg und Information verschwinden nach etwa fünf Sekunden, Fehler bleiben, bis man sie schliesst. Meldungen können Knöpfe tragen. Der Kern kann Meldungen und Fortschritt an ein Fenster schicken. Der vorläufige Hinweis aus Ticket 02 wird zu einer solchen Meldung.
- **Rückfragen:** ein Dialog in der Oberfläche (Titel, Text, Liste von Einträgen, Knöpfe), den alle späteren Tickets für Rückfragen verwenden.
- **Zustand pro Projekt:** welches Werkzeugfenster je Seite aktiv ist, ob es offen ist, die Grössen.

## Akzeptanzkriterien

- [ ] Kern-Tests:
  - Der Layout-Zustand eines Projekts übersteht einen Neustart.
  - Fortschritt (Beginn, Stand, Ende) und Meldungen erreichen nur das Fenster ihres Projekts.
- [ ] Playwright-Tests:
  - Werkzeugfenster per Klick öffnen, schliessen und wechseln, auch über die Alt-Kürzel.
  - Grösse eines Werkzeugfensters per Ziehen ändern; über die Höchstgrösse hinaus geht es nicht. Nach einem Neustart sind Zustand und Grösse wieder da.
  - Eine Information verschwindet von selbst, eine Fehlermeldung bleibt, bis sie geschlossen wird.
  - Eine Rückfrage liefert den gewählten Knopf zurück; Esc gilt als Abbrechen.
  - Das Projektmenü listet die zuletzt geöffneten Projekte; „Exit“ beendet die App.

## Abnahme von Hand

- [ ] Das Fenster sieht aus wie das neue IntelliJ „Dark“: Kopfzeile, Symbolleisten, Statusleiste, Abstände.
- [ ] Die Fensterknöpfe von Windows funktionieren. Das Fenster lässt sich an der Kopfzeile verschieben und per Doppelklick maximieren.
