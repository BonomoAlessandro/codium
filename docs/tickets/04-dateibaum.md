# 04 – Datei-Dienst und Dateibaum

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: 03
User Stories: 12, 25, 27 (sichtbar, ohne Graufärbung bis Ticket 16), 28–30, 31 (ohne Tab und Git), 32–35, 36
Spezifikation: „Dateien, Dateiüberwachung und Suche“ (Dateibaum, Dateiüberwachung, Dateioperationen)

## Was gebaut wird

- **Datei-Dienst** im Projekt-Kern:
  - Ordnerinhalte auf Anfrage, Ordner vor Dateien, alphabetisch ohne Unterscheidung der Gross-/Kleinschreibung; `.git` wird nicht angezeigt.
  - **Dateiüberwachung:**
    - Rekursiv über den Projektordner; Ereignisse werden kurz gesammelt, danach wird geprüft, was wirklich existiert, und gebündelt an das Fenster gemeldet.
    - „Gelöscht und neu angelegt“ gilt als Änderung.
    - Ereignisse ohne Dateinamen führen zum Neueinlesen der betroffenen Ordner.
    - Änderungen in `.git` lösen keine Dateiereignisse aus; ein eigenes Ereignis „Git-Daten geändert“ (HEAD, Index, Refs) wird für Ticket 15 bereitgestellt.
    - Die Überwachung endet beim Abbau des Projekt-Kerns.
  - **Dateioperationen:**
    - neue Datei, neuer Ordner, Umbenennen
    - Löschen in den Papierkorb über den Port
    - Kopieren und Einfügen; bei Namenskonflikt Vorschlag mit Zusatz, etwa „Name (2).ext“
    - Pfad kopieren, im Explorer zeigen
    - Jede Operation erzeugt ein Ereignis, auf das spätere Dienste reagieren können (Tabs in Ticket 07, Sprachserver in Ticket 12, Git in Ticket 16).
- **Werkzeugfenster „Project“:**
  - Baum mit Auf- und Zuklappen, Einfachklick wählt aus, Doppelklick oder Enter löst „Datei öffnen“ aus (ein Ereignis, das Ticket 05 aufnimmt).
  - Rechtsklick-Menü: „New“ (File, Directory), „Rename…“, „Delete…“ (mit Rückfrage aus Ticket 03), „Copy“, „Paste“, „Copy Path“, „Open in Explorer“, „Open in Terminal“ (inaktiv bis Ticket 11).
  - Der Umbenennen-Dialog zeigt bei Java-Dateien den Hinweis, dass Verweise nicht angepasst werden.
  - Knopf „Select Opened File“ (wirkt ab Ticket 05).
  - Der Baum aktualisiert sich bei Dateiereignissen, ohne aufgeklappte Ordner oder Auswahl zu verlieren.
- **Zustand pro Projekt:** aufgeklappte Ordner.

## Akzeptanzkriterien

- [ ] Kern-Tests im Temp-Ordner:
  - Ordnerinhalt mit Sortierung und ohne `.git`.
  - Dateioperationen inklusive Namenskonflikt beim Einfügen und Löschen in den nachgemachten Papierkorb.
  - Eine von aussen angelegte, geänderte, umbenannte oder gelöschte Datei erzeugt ein gebündeltes Ereignis.
  - Löschen und sofortiges Neuanlegen derselben Datei meldet eine Änderung, kein Löschen.
  - Änderungen in `.git` erzeugen kein Dateiereignis, aber bei HEAD, Index oder Refs das Ereignis „Git-Daten geändert“.
  - Nach dem Abbau des Projekt-Kerns kommen keine Ereignisse mehr.
  - Aufgeklappte Ordner überstehen einen Neustart.
- [ ] Playwright-Tests: Ordner aufklappen, neue Datei über das Rechtsklick-Menü anlegen, umbenennen, löschen mit Rückfrage (landet im Papierkorb-Ordner des Testmodus). Eine von aussen angelegte Datei erscheint im Baum.

## Abnahme von Hand

- [ ] In einem grossen Projekt (etwa mit node_modules) bleibt der Baum flüssig.
- [ ] „Open in Explorer“ öffnet den Explorer mit der markierten Datei; „Delete…“ landet im Windows-Papierkorb.
