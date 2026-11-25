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

## Entscheidung (Nutzer, 2026-11-25)

Entwürfe: [docs/entwuerfe/28-scrollbalken/index.html](../entwuerfe/28-scrollbalken/index.html) (bleiben als Beleg liegen). Vorgelegt wurden der heutige Stand und drei Varianten: A (Kapsel über der Übersichtsleiste, immer sichtbar), B (wie IntelliJ: Kapsel und eigener Streifen, Ausblenden) und C (eigener Streifen mit zwei Spuren, immer sichtbar), jeweils in Ruhe, beim Darüberfahren und beim Ziehen, dazu die Vergleichsansicht.

Rückmeldung des Nutzers, wörtlich: „ja wir nehmen variante B“

Er antwortete damit auf die Empfehlungen, die ihm vorgelegt wurden; die übrigen Punkte folgen deshalb diesen Empfehlungen:

1. **Variante B:** Rand rechts 16 px. Links eine Greiffläche von 10 px mit einer Kapsel von 6 px, beim Darüberfahren und Ziehen 9 px; dann 1 px Abstand und ganz rechts ein eigener Streifen von 5 px, in dem jede Markierung die volle Breite hat. Keine Spur, kein Schatten. Der waagrechte Schieber entsprechend (Greiffläche 12 px, Kapsel 6 bzw. 9 px hoch).
2. **Ausblenden:** Die Kapsel ist ausgeblendet, solange nicht gescrollt wird, und erscheint beim Scrollen, beim Darüberfahren über den Rand und beim Ziehen. Der Streifen bleibt immer sichtbar und anklickbar.
3. **Farben genau wie IntelliJ „Dark“** (Vorgaben in IntelliJs `ScrollBarPainter`; das Theme setzt keine eigenen): in Ruhe `#a6a6a647`, beim Darüberfahren `#a6a6a659`, beim Ziehen eine Stufe heller (Wert und Begründung unter „Umsetzung“). Den feinen Rand des Schiebers aus IntelliJ gibt es nicht. Alle Werte an einer Stelle.
4. **Vergleichsansicht:** Der eckige Kasten in Monacos Vergleichsübersicht entfällt; die Kapsel des rechten Editors zeigt die Lage, die roten und grünen Markierungen bleiben.

## Akzeptanzkriterien

- [x] Die Bilder (heute und die Varianten) wurden dem Nutzer vorgelegt, und seine Entscheidung steht im Ticket.
- [x] Die Scrollbalken aller Monaco-Editoren entsprechen der freigegebenen Variante in Form, Breite, Farbe und Verhalten. Die Werte stehen an einer zentralen Stelle.
- [x] Ein Playwright-Test im Testmodus prüft in einer langen Datei:
  - Der senkrechte Schieber ist so breit wie freigegeben und ganz gerundet (Radius mindestens die halbe Breite).
  - Er hat die freigegebenen Farben in Ruhe und beim Darüberfahren.
  - Er lässt sich ziehen, und der Editor scrollt dabei.
- [x] Ein Test prüft, dass die Markierungen nach dem Umbau weiter erscheinen, etwa eine Git-Änderung oder ein Suchtreffer in der Übersichtsleiste.
- [x] Die Vergleichsansicht zeigt dieselben Scrollbalken; ein Test oder eine Prüfung im bestehenden Test zur Vergleichsansicht genügt.
- [x] `npm run typecheck`, `npm test` und `npm run test:ui` sind grün (siehe Umsetzung, Testläufe).

## Abnahme von Hand

- [ ] Die Scrollbalken sehen aus wie in IntelliJ und lassen sich mit der Maus gut greifen.
- [ ] Fehler und Git-Änderungen sind am rechten Rand weiter gut zu erkennen.
- [ ] Die Kapsel erscheint beim Scrollen mit Mausrad, Touchpad und Tastatur und verschwindet kurz danach wieder; das Ausblenden stört nicht beim Suchen der Lage in der Datei.
- [ ] Der schmale Streifen ist bei 100 % und 150 % Skalierung scharf, und ein Klick auf eine Markierung springt an die richtige Stelle.

## Hinweise

- Die Spielregeln gelten: Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Aufnahmen nur vom verborgenen Testfenster über Playwright, nie vom Desktop. Keine echten Eingaben an den Desktop.
- Monaco bietet für die Scrollbalken Optionen wie `scrollbar.verticalScrollbarSize`, `verticalSliderSize`, `useShadows` und `vertical: 'auto'`. Die Rundung geht über CSS am Schieber (`.monaco-scrollable-element > .scrollbar > .slider`). Was davon trägt, klärt der Agent bei der Umsetzung.

## Umsetzung (Agent, 2026-11-25)

- **Eine Stelle für alle Editoren:** `src/renderer/editor/scrollbars.ts` richtet jeden neuen Monaco-Editor ein; `monaco.ts` meldet das einmal mit `monaco.editor.onDidCreateEditor` an. Monaco meldet darüber auch die beiden Seiten der Vergleichsansicht, die Vorschau der Projektsuche und den Zelleditor der Tabellenansicht. Keiner der Editoren setzt eigene Scrollbalken-Optionen.
- **Werte an einer Stelle:** `EDITOR_SCROLLBAR` in `theme.ts` (Greiffläche 10 px, Abstand 1 px, Streifen 5 px, Kapsel 6 bzw. 9 px, waagrechter Balken 12 px, 800 ms sichtbar nach dem Scrollen, die drei Farben). Daraus:
  - die Monaco-Optionen (`editorScrollbarOptions`): Rand 16 px, Schieber 10 px, eine Spur in der Übersichtsleiste (`overviewRulerLanes: 1`), Balken immer bedienbar (`vertical`/`horizontal: 'visible'`), ohne Pfeile und Schatten;
  - die Farben `scrollbarSlider.*` in `EDITOR_COLORS`; app.css liest sie über Monacos Farbvariablen (`--vscode-scrollbarSlider-*`);
  - die Masse der Kapsel und des Streifens als `--editor-scrollbar-thumb`, `--editor-scrollbar-thumb-hover` und `--editor-scrollbar-stripe`, gesetzt von `monaco.ts` auf `:root`. `tokens.css` verweist darauf und hat neu `--radius-pill` (999 px) für die Kapsel.
- **Form (app.css, Abschnitt „Scrollbalken der Monaco-Editoren“):** Monacos Schieber ist durchsichtig, gezeichnet wird die Kapsel als `::before` darin. Monaco setzt den senkrechten Schieber per Stil am Element mittig in den Rand; `left: 0 !important` holt ihn in die Greiffläche links vom Streifen. Gegriffen wird auf dem ganzen Schieber (10 px breit), ein Klick daneben springt wie bisher an die Stelle. Gemeint ist nur der Balken des Editors selbst (`.editor-scrollable`).
- **Ausblenden:** Ausgeblendet wird nur die Kapsel (Deckkraft), nie der Balken; so bleiben Greiffläche und Streifen bedienbar. Sichtbar beim Darüberfahren über den Rand, beim Ziehen und beim Scrollen: `scrollbars.ts` setzt dafür `data-codium-scrolling` am Editor, solange gescrollt wird und 800 ms danach. Ein Attribut statt einer Klasse, weil Monaco die Klassen an diesem Element selbst neu setzt (etwa beim Fokus). Einblenden in 100 ms, Ausblenden in 300 ms.
- **Streifen:** Monaco zeichnet seine Übersichtsleiste so breit wie den ganzen Rand; das CSS staucht sie auf 5 px ganz rechts. Mit einer Spur geht jede Markierung über die volle Breite, die Kanten bleiben dabei scharf. Die Leiste nimmt keine Mausereignisse an; ein Klick in den Streifen trifft den Balken und springt an die Stelle.
- **Ergänzung, Stapelreihenfolge im Streifen:** Mit einer Spur überdecken sich Markierungen derselben Zeile, und Monaco zeichnet nach `zIndex`. Die grau hervorgehobenen Vorkommen des Worts unter dem Cursor (zIndex 0) lagen über den Git-Änderungen (bisher ohne zIndex); bei einem häufigen Wort verschwanden die Änderungen fast ganz (im Test gefunden). Die Änderungsbalken (`changeBars.ts`) haben jetzt zIndex 5: über den Vorkommen, unter Suchtreffern (10 und 13), Warnungen (20) und Fehlern (30). Die Cursorzeile zeichnet Monaco zuletzt.
- **Farben und Begründung für das Ziehen:** in Ruhe `#a6a6a647` und beim Darüberfahren `#a6a6a659`, genau die Vorgaben von IntelliJ „Dark“ (Grau `#a6a6a6` zu 28 % bzw. 35 %; auf der Editorfläche wirken sie wie `#444547` bzw. `#4e4e50`). Beim Ziehen `#a6a6a66b`: dasselbe Grau zu 42 %, also eine weitere gleich grosse Stufe wie von Ruhe zu Darüberfahren. Es wirkt wie `#575859` und damit fast so hell wie IntelliJs Mac-Schieber beim Darüberfahren (`#8080808c`, wirkt wie `#545456`), bleibt aber im Farbton der beiden anderen Zustände. Der feine Rand des Schiebers aus IntelliJ fehlt wie entschieden.
- **Vergleichsansicht:** Der Kasten `.diffViewport` in Monacos Vergleichsübersicht ist durchsichtig. Die Übersicht selbst (30 px, rot und grün) bleibt und lässt sich weiter anklicken und ziehen; beide Seiten haben Rand, Kapsel und Streifen wie der Code-Bereich.
- **Nicht angepasst:** Die Listen in Monacos Vorschlags- und Hover-Fenstern behalten Monacos eckige Schieber; sie nutzen aber dieselben Farbvariablen und haben damit die neuen Farben. Die Scrollbalken ausserhalb von Monaco sind unverändert; wo sie anders aussehen, steht in den Entwürfen (Abschnitt „Ausserhalb von Monaco“).
- **Tests:**
  - `test/renderer/editorScrollbars.test.ts` (5 Tests): Masse und Farben von Variante B, Stufen der Farben, Farben an Monaco, Optionen, app.css nutzt die Variablen und `--radius-pill`. `radii.test.ts` kennt `--radius-pill`.
  - `test/ui/scrollbars.test.ts` (3 Tests, lange Datei in einem Temp-Repository): Rand 16 px mit Schieber in der Greiffläche und Streifen von 5 px ganz rechts; Kapsel 6 px, Radius mindestens die halbe Breite, Farbe in Ruhe und ausgeblendet; beim Darüberfahren sichtbar, 9 px, Farbe; Ziehen scrollt (erste sichtbare Zeile von 1 auf über 21), Farbe beim Ziehen; Ausblenden über dem Text, Einblenden beim Scrollen mit dem Mausrad und wieder Ausblenden. Git-Änderung im Streifen (über dem Grau der Vorkommen), ein Klick darauf springt zur geänderten Zeile; Suchtreffer im Streifen, einer je Fundstelle. Vergleichsansicht: Rand, Schieber, Streifen, Kapsel und Farbe, beim Darüberfahren 9 px, Kasten der Vergleichsübersicht durchsichtig.
- **Bilder des eingebauten Stands:** in den Entwürfen unter „Eingebaut“ (`docs/entwuerfe/28-scrollbalken/bilder/eingebaut-*.png`), aufgenommen mit `AUFNAHME_EINGEBAUT=1` über dasselbe Skript, ohne etwas einzuspielen.
- **Testläufe (2026-11-25, nacheinander, allein auf dem Rechner):**
  - `npm run typecheck`: sauber.
  - `npm test`: 55 Dateien, 484 Tests grün.
  - `npm run test:ui`, erster Lauf (ab 14:47): 97 von 98 grün. Rot war „zeigt Änderungen in den Gruppen, committet die angehakte und lässt die neue Datei stehen“ (`commit.test.ts`, Zeitlimit von 90 s, danach EPERM beim Löschen seines Temp-Ordners, den die Schlussprüfung entfernte). Der Rechner war von 14:50:20 bis 15:06:07 im modernen Standby (Systemprotokoll, Kernel-Power 506 und 507), der Lauf zählt deshalb nicht. Einzeln danach `commit.test.ts` 3 von 3 grün.
  - `npm run test:ui`, zweiter Lauf (ab 15:09, ohne Standby): 28 Dateien, 98 Tests grün, 525 s.
