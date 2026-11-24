# 28 – Scrollbalken im Code-Bereich wie in IntelliJ

Status: `ready-for-agent` · Typ: HITL
Blockiert durch: –
User Stories: keine eigene; ergänzt 24 (dunkel im Stil des neuen IntelliJ)
Spezifikation: „Oberfläche“ (Design), Code-Farben (`src/renderer/editor/theme.ts`)

Dieses Ticket kam nach Ticket 27 dazu, auf Wunsch des Nutzers. Die Scrollbalken im Code-Bereich sollen aussehen wie in IntelliJ: feiner, runder und in den Farben des neuen IntelliJ-Designs „Dark“. Es setzt fort, was Ticket 25 mit den runden Formen begonnen hat.

Typ HITL, weil das Aussehen Geschmackssache ist. Wie bei Ticket 25 legt der Agent zuerst Bilder vor, der Nutzer gibt frei oder gibt Rückmeldung, erst dann wird eingebaut.

## Heutiger Stand

- **Optionen:** Die Editoren aus Monaco haben keine eigenen Einstellungen für die Scrollbalken. Sie zeigen die von Monaco: rund 14 px breit, mit eckigem Schieber und einer eigenen Fläche am rechten Rand. Dort zeichnet Monaco auch seine Übersichtsleiste mit Markierungen für Fehler, Suchtreffer, Git-Änderungen (`changeBars.ts`, linke Spur) und die Cursorzeile.
- **Farben:** Die Farben des Schiebers stehen in `src/renderer/editor/theme.ts`, nämlich `scrollbarSlider.background`, `.hoverBackground` und `.activeBackground`; der Schatten ist schon ausgeschaltet.
- **Wo Monaco vorkommt:**
  - im Editor (`EditorArea.tsx`);
  - in der Vergleichsansicht (`DiffView.tsx`);
  - in der Vorschau der Projektsuche (`FindInFilesPopup.tsx`);
  - im Zelleditor der Tabellenansicht (`TableView.tsx`).
- **In IntelliJ** ist der Schieber schmal und ganz gerundet, eine Kapsel. Dahinter liegt keine sichtbare Spur. Er ist halb durchsichtig grau, wird beim Darüberfahren deutlicher und etwas breiter und tritt zurück, wenn nicht gescrollt wird. Die Markierungen für Fehler und Warnungen stehen in einem eigenen, schmalen Streifen.

## Was gebaut wird

- **Erst die Bilder (HITL):**
  - Der Agent macht Aufnahmen des Code-Bereichs aus dem verborgenen Testfenster, über Playwright im Testmodus, nie vom Desktop. Gezeigt wird eine lange Datei mit Fehlermarkierung, Git-Änderung und Suchtreffern.
  - Zu sehen sind der heutige Stand und zwei bis drei Varianten, jeweils in Ruhe, beim Darüberfahren und beim Ziehen. Die Varianten unterscheiden sich in Breite, Farbe und Verhalten.
  - Der Agent legt die Bilder dem Nutzer vor. Eingebaut wird erst nach der Freigabe. Die Entscheidung kommt ins Ticket.
- **Form:**
  - Senkrechter und waagrechter Schieber sind fein und ganz gerundet (Kapsel). Richtwert: in Ruhe 6 bis 8 px breit, beim Darüberfahren etwas breiter.
  - Keine sichtbare Spur, kein Schatten.
  - Die Fläche zum Greifen bleibt gross genug, auch wenn der Schieber schmal aussieht. Der Schieber lässt sich gut treffen und ziehen, ein Klick neben ihn blättert wie bisher.
- **Farbe:**
  - Wie im neuen IntelliJ-Design „Dark“: halb durchsichtiges Grau in Ruhe, heller beim Darüberfahren, noch heller beim Ziehen.
  - Die Werte stehen an einer Stelle, also in `theme.ts` bzw. als Design-Variablen in `tokens.css`, und passen zu den Farben aus Ticket 25.
- **Verhalten:** Ob der Schieber ausblendet, wenn nicht gescrollt wird, wie in IntelliJ, oder immer sichtbar bleibt, entscheidet der Nutzer anhand der Bilder.
- **Markierungen:**
  - Fehler, Warnungen, Suchtreffer, Git-Änderungen und die Cursorzeile bleiben neben dem schmaleren Schieber gut sichtbar und anklickbar.
  - Braucht es dafür einen eigenen Streifen wie in IntelliJ oder eine andere Aufteilung, zeigen das die Bilder.
- **Überall gleich:** Alle Monaco-Editoren, die oben genannt sind, bekommen dieselben Scrollbalken. Die Einstellung steht an einer zentralen Stelle, nicht in jedem Editor einzeln.
- **Spezifikation:** Im Abschnitt „Oberfläche“, Unterpunkt „Design“, eine Zeile zu den Scrollbalken nachführen.

## Ausserhalb des Umfangs

Die Scrollbalken ausserhalb von Monaco gehören nicht dazu. Das betrifft:
- den Dateibaum;
- die Listen in den Werkzeugfenstern;
- das Git-Log;
- das Terminal;
- die Markdown-Vorschau.

Will der Nutzer sie ebenfalls angleichen, wird das ein eigenes Ticket. Der Agent nennt in seinem Bericht, wo sie heute anders aussehen.

## Akzeptanzkriterien

- [ ] Die Bilder (heute und die Varianten) wurden dem Nutzer vorgelegt, und seine Entscheidung steht im Ticket.
- [ ] Die Scrollbalken aller Monaco-Editoren entsprechen der freigegebenen Variante in Form, Breite, Farbe und Verhalten. Die Werte stehen an einer zentralen Stelle.
- [ ] Ein Playwright-Test im Testmodus prüft in einer langen Datei:
  - Der senkrechte Schieber ist so breit wie freigegeben und ganz gerundet (Radius mindestens die halbe Breite).
  - Er hat die freigegebenen Farben in Ruhe und beim Darüberfahren.
  - Er lässt sich ziehen, und der Editor scrollt dabei.
- [ ] Ein Test prüft, dass die Markierungen nach dem Umbau weiter erscheinen, etwa eine Git-Änderung oder ein Suchtreffer in der Übersichtsleiste.
- [ ] Die Vergleichsansicht zeigt dieselben Scrollbalken; ein Test oder eine Prüfung im bestehenden Test zur Vergleichsansicht genügt.
- [ ] `npm run typecheck`, `npm test` und `npm run test:ui` sind grün.

## Abnahme von Hand

- [ ] Die Scrollbalken sehen aus wie in IntelliJ und lassen sich mit der Maus gut greifen.
- [ ] Fehler und Git-Änderungen sind am rechten Rand weiter gut zu erkennen.

## Hinweise

- Die Spielregeln gelten: Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Aufnahmen nur vom verborgenen Testfenster über Playwright, nie vom Desktop. Keine echten Eingaben an den Desktop.
- Monaco bietet für die Scrollbalken Optionen wie `scrollbar.verticalScrollbarSize`, `verticalSliderSize`, `useShadows` und `vertical: 'auto'`. Die Rundung geht über CSS am Schieber (`.monaco-scrollable-element > .scrollbar > .slider`). Was davon trägt, klärt der Agent bei der Umsetzung.
