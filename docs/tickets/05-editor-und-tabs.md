# 05 – Monaco und Tabs

Status: `erledigt` (2026-11-21, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
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

- [x] Kern-Tests:
  - Lesen liefert Text, Bild, „binär“ bzw. „zu gross“ je nach Datei.
  - Eine UTF-16-Datei mit BOM gilt nicht als Binärdatei.
  - Die Schriftgrösse übersteht einen Neustart, und eine Änderung erreicht alle Fenster.
  - Offene Tabs, aktiver Tab und Cursorpositionen überstehen einen Neustart; Tabs fehlender Dateien entfallen.
- [x] Playwright-Tests:
  - Doppelklick im Baum öffnet einen Tab, ein zweiter Doppelklick auf dieselbe Datei öffnet keinen weiteren.
  - Zwei Dateien „index.ts“ in verschiedenen Ordnern haben unterscheidbare Beschriftungen.
  - Ein Bild öffnet als Bild, eine Binärdatei zeigt den Hinweis.
  - Nach einem Neustart sind die Tabs mit Cursorposition wieder da.
- [x] Im Netzwerkprotokoll der App erscheinen keine Zugriffe ausserhalb der eigenen Dateien. Die Konsole der Seite zeigt keine Verstösse gegen die Sicherheitsrichtlinie.

## Abnahme von Hand

- [ ] Java-, TypeScript-, JSON-, XML-, YAML- und SQL-Dateien sehen farblich wie in IntelliJ „Dark“ aus.
- [ ] Die Schrift ist JetBrains Mono und wirkt gleich gross wie in IntelliJ mit Grösse 13.
- [ ] Die Tableiste sieht aus wie im neuen IntelliJ (aktiver Tab blau unterstrichen, Kreuz beim Überfahren, Punkt bei „ungespeichert“).
- [ ] Ein Bild (PNG mit Transparenz) erscheint mit Schachbrett dahinter; eine Binärdatei und eine Datei über 50 MB zeigen ihren Hinweis.
- [ ] Doppelklick auf eine Datei im Baum setzt den Fokus in den Editor; „Select Opened File“ findet die Datei des aktiven Tabs auch in zugeklappten Ordnern.
- [ ] Nach „Exit“ und Neustart stehen Tabs, aktiver Tab und Cursor wie vorher; auch eine Cursorbewegung kurz vor „Exit“ ist gesichert.

## Umsetzung

- **Monaco 0.57** lokal gebündelt. `build.mjs` ersetzt Monacos Sprachdienste (TypeScript, JSON, CSS, HTML) und seinen LSP-Client durch leere Module; der allgemeine Editor-Worker wird als eigene Datei gebündelt und aus `dist/renderer` geladen. Weil Monacos JSON-Sprache am Sprachdienst hängt, bringt Codium eine kleine eigene JSON-Sprache nur mit Farben mit (`jsonLanguage.ts`).
- **Sicherheitsrichtlinie** zusätzlich mit `font-src`, `worker-src` und `connect-src 'self'`, `object-src`, `base-uri` und `form-action 'none'`. Der Testmodus zeichnet jeden Zugriff der Seiten (`web-request`) und Warnungen und Fehler der Konsole (`console-message`) auf; der Oberflächentest prüft damit, dass nur eigene Dateien geladen werden und keine Verstösse auftreten.
- **Farbschema** `codium-dark` (`theme.ts`): Wortarten nach IntelliJ „Dark“, Klammern ohne Paarfarben; für semantische Token gibt es Regeln für jede Reihenfolge der Modifikatoren `static`, `readonly` und `declaration`, weil Monaco sie in der Reihenfolge des Sprachservers sucht.
- **Schrift** JetBrains Mono über `@fontsource/jetbrains-mono` (400 und 700, je normal und kursiv). Der Editor entsteht erst, wenn die Schrift geladen ist; lädt sie später nach, misst Monaco neu. Zeilenhöhe 1,4 der Schriftgrösse.
- **Mehr als verlangt:** Windows-1252 wird schon erkannt (Lesen), und die Statusleiste zeigt schon Zeilenende und Kodierung. Gespeichert wird weiterhin erst mit Ticket 07.
- **Umbenennen eines offenen Tabs:** Monaco führt ein Modell unter seiner Adresse; der Tab bekommt ein neues Modell mit Inhalt und Markierung „ungespeichert“ des alten, den Rückgängig-Verlauf behält Monaco dabei nicht.
- **Bestehende Tests:** Die Dateibaum-Tests prüfen statt des Ereignisses `codium:open-file` jetzt die geöffneten Tabs. Monaco legt eigene Bereiche mit `role="alert"` an und setzt am `body` die Klasse `underline-links`; zwei Oberflächentests prüfen deshalb gezielt Codiums Meldungen bzw. die eigenen Zieh-Klassen.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-21. Alle Testläufe grün; Lesen im Kern (Reihenfolge der Erkennung, Grenzen, Pfadprüfung), Einstellungen, Tab-Zustand, das Bündel ohne Sprachdienste, Worker, Sicherheitsrichtlinie und die Tests in Ordnung. Eingearbeitet:

- **Schliessen und wieder Öffnen während des Lesens** (nachgewiesen): Das alte Lesen legte sein Modell noch an, das neue scheiterte an der schon vergebenen Adresse; der Tab schloss sich mit allgemeiner Fehlermeldung. Jetzt hat jedes Lesen eine Kennung, und nur das neueste zählt; Schliessen und Umbenennen machen sie ungültig. Vor dem Anlegen weicht ein Modell unter derselben Adresse.
- **Umbenennen während des Lesens** (nachgewiesen): Der Tab blieb für immer im Zustand „Laden“. Jetzt liest er unter dem neuen Pfad neu, sofort, wenn er aktiv ist.
- **Ordner mit offenen Tabs gelöscht** (nachgewiesen): Die Tabs schlossen einzeln; dazwischen wurde ein ungelesener Nachbar im selben Ordner aktiv, las die gelöschte Datei und meldete „Not found“. Jetzt schliessen alle betroffenen Tabs auf einmal, erst danach wird ein Tab aktiv.
- **Cursor einer gelöschten Datei blieb gespeichert** (nachgewiesen): Beim Schliessen nach dem Löschen sicherte die Oberfläche den Cursor nach dem Kern noch einmal. Jetzt nicht mehr.
- **Gleiche Beschriftung** für `Alphaindex.ts` und `AlphaAlphaindex.ts` (nachgewiesen): Der Ordnerteil zählt jetzt ab dem Projektordner selbst („Alpha“ gegen „Alpha/Alpha“).
- **Doppelte Tabs in einer beschädigten Zustandsdatei** blockierten jedes spätere Speichern der Tabs: Das Einlesen übergeht Doppelte, unter Windows auch solche in anderer Schreibweise.
- **Letzte Cursorbewegung vor dem Beenden** ging verloren: Beim Abbau und bei `pagehide` wird ein noch verzögertes Sichern sofort ausgeführt.
- **Kennzeichen `large`** wertet heute noch niemand aus: als Hinweis im Code und in den Tickets 12 und 17 festgehalten.
- **Tests:** ein Kern-Test für doppelte Tabs, ein Oberflächentest für Schliessen und Umbenennen während des Lesens und für das Löschen eines Ordners mit ungelesenem Tab samt Cursor; der Oberflächentest scheitert gegen den Stand vor der Korrektur. Ein Einheitstest für die Beschriftung mit gleichnamigem Unterordner.

Verworfen: nichts.
