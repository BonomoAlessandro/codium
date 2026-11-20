# 05 – Monaco und Tabs

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: 04
User Stories: 11 (Tabs und Cursor), 23 (Zeile:Spalte), 35, 37, 38, 43–45, 46 (Schrift und Grösse 13), 47, 52–55
Spezifikation: „Editor, Tabs und Speichern“ (Monaco, Tabs, Lesen, Bilder, grosse Dateien), „Oberfläche“ (Code-Farben, Schrift), „Vertrag zwischen Oberfläche und Kern“ (Abschottung), „Auslieferung und Abhängigkeiten“ (Monaco)

## Was gebaut wird

- **Monaco:**
  - Lokal gebündelt mit seinem allgemeinen Editor-Worker, nichts aus dem Netz.
  - Die Sicherheitsrichtlinie der Seite erlaubt Worker nur aus den eigenen Dateien.
  - Monacos eingebaute Sprachfunktionen (TypeScript, JavaScript, JSON, CSS, HTML) sind abgeschaltet, die Farben nach Wortarten bleiben.
  - **Ein Modell pro Datei**, das alle Ansichten derselben Datei teilen.
  - Ein eigener **Editor-Opener**, über den Monaco andere Dateien als Tab öffnet (genutzt ab Ticket 12).
- **Farbschema** nach dem IntelliJ-Editorschema „Dark“ für die Wortarten. Die Zuordnung für semantische Token (Felder, statische Member, Methodendeklarationen, Parameter, lokale Variablen, Konstanten) wird schon angelegt; Ticket 13 liefert die Token.
- **Schrift** JetBrains Mono mitgeliefert, Monaco-Schriftgrösse 13.
- **Einstellungsspeicher:** Der App-Kern bekommt einen Einstellungsspeicher im App-Zustand mit der ersten Einstellung „Schriftgrösse“. Änderungen gehen an alle Fenster. Der Dialog folgt mit Ticket 09, Ctrl + Mausrad mit Ticket 06.
- **Tabs (Grundlage):**
  - Öffnen aus dem Dateibaum; eine offene Datei wird nicht doppelt geöffnet; Schliessen über das Kreuz am Tab.
  - Gleiche Dateinamen bekommen den kürzesten unterscheidenden Ordnerteil.
  - Menü, Anheften, Überlauf und Kürzel folgen mit Ticket 06.
- **Lesen** im Datei-Dienst: Erkennung in der Reihenfolge der Spezifikation (BOM, Null-Bytes, UTF-8). Die Erkennung von Windows-1252 und das Schreiben kommen mit Ticket 07; bis dahin genügen UTF-8 und UTF-16 mit BOM.
- **Dateiarten:**
  - Bilder (PNG, JPEG, GIF, WebP, BMP, ICO) als data-URL über den Vertrag; SVG als Text.
  - Binärdateien mit Hinweis.
  - Ab 5 MB ohne Sprachfunktionen, ab 50 MB nur ein Hinweis.
- **Bearbeiten** in Monaco mit Rückgängig und Wiederholen, vorerst ohne Speichern auf die Festplatte (Ticket 07). Bis dahin zeigt der Tab nach einer Eingabe die Markierung „ungespeichert“.
- **Statusleiste:** Zeile:Spalte des Cursors.
- **„Select Opened File“** im Dateibaum zeigt die aktive Datei.
- **Zustand pro Projekt:** offene Datei-Tabs in Reihenfolge, aktiver Tab, Cursor und Scrollstand je Datei. Beim Wiederöffnen werden nur Datei-Tabs wiederhergestellt; Tabs fehlender Dateien entfallen still.

## Akzeptanzkriterien

- [ ] Kern-Tests:
  - Lesen liefert Text, Bild, „binär“ bzw. „zu gross“ je nach Datei.
  - Eine UTF-16-Datei mit BOM gilt nicht als Binärdatei.
  - Die Schriftgrösse übersteht einen Neustart, und eine Änderung erreicht alle Fenster.
  - Offene Tabs, aktiver Tab und Cursorpositionen überstehen einen Neustart; Tabs fehlender Dateien entfallen.
- [ ] Playwright-Tests:
  - Doppelklick im Baum öffnet einen Tab, ein zweiter Doppelklick auf dieselbe Datei öffnet keinen weiteren.
  - Zwei Dateien „index.ts“ in verschiedenen Ordnern haben unterscheidbare Beschriftungen.
  - Ein Bild öffnet als Bild, eine Binärdatei zeigt den Hinweis.
  - Nach einem Neustart sind die Tabs mit Cursorposition wieder da.
- [ ] Im Netzwerkprotokoll der App erscheinen keine Zugriffe ausserhalb der eigenen Dateien. Die Konsole der Seite zeigt keine Verstösse gegen die Sicherheitsrichtlinie.

## Abnahme von Hand

- [ ] Java-, TypeScript-, JSON-, XML-, YAML- und SQL-Dateien sehen farblich wie in IntelliJ „Dark“ aus.
- [ ] Die Schrift ist JetBrains Mono und wirkt gleich gross wie in IntelliJ mit Grösse 13.
