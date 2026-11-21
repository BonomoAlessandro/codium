# 03 – Layout: Kopfzeile, Werkzeugfenster, Statusleiste, Meldungen, Rückfragen

Status: `erledigt` (2026-11-21, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
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

- [x] Kern-Tests:
  - Der Layout-Zustand eines Projekts übersteht einen Neustart.
  - Fortschritt (Beginn, Stand, Ende) und Meldungen erreichen nur das Fenster ihres Projekts.
- [x] Playwright-Tests:
  - Werkzeugfenster per Klick öffnen, schliessen und wechseln, auch über die Alt-Kürzel.
  - Grösse eines Werkzeugfensters per Ziehen ändern; über die Höchstgrösse hinaus geht es nicht. Nach einem Neustart sind Zustand und Grösse wieder da.
  - Eine Information verschwindet von selbst, eine Fehlermeldung bleibt, bis sie geschlossen wird.
  - Eine Rückfrage liefert den gewählten Knopf zurück; Esc gilt als Abbrechen.
  - Das Projektmenü listet die zuletzt geöffneten Projekte; „Exit“ beendet die App.

## Abnahme von Hand

- [ ] Das Fenster sieht aus wie das neue IntelliJ „Dark“: Kopfzeile, Symbolleisten, Statusleiste, Abstände.
- [ ] Die Fensterknöpfe von Windows funktionieren. Das Fenster lässt sich an der Kopfzeile verschieben und per Doppelklick maximieren.
- [ ] Der Nutzer bestätigt die Aufteilung der Symbolleisten: links oben „Project“ und „Commit“, links unten „Terminal“ und „Git“ (später „Find“), rechts „Database“, keine Leiste am unteren Rand.
- [ ] Die Fensterknöpfe sitzen bündig rechts in der Kopfzeile. Beim Überfahren von „Maximieren“ erscheinen die Andock-Layouts von Windows 11.
- [ ] Am oberen Fensterrand (über der Kopfzeile) lässt sich die Fenstergrösse ändern.
- [ ] Die Trennlinie unter der Kopfzeile läuft unter den Fensterknöpfen durch, nichts Bedienbares liegt unter ihnen.
- [ ] Auch das Willkommensfenster lässt sich an seiner Kopfzeile verschieben und per Doppelklick maximieren.
- [ ] Ein Klick auf die leere Kopfzeile schliesst ein offenes Projektmenü. (Unter Windows erreicht ein Klick auf die Zieh-Fläche die Seite womöglich nicht.)
- [ ] Bei hellem Windows-Design blitzt beim Öffnen eines Fensters nichts Helles auf.
- [ ] In einem verkleinerten Fenster verschwindet der Code-Bereich nie; nach dem Vergrössern sind die alten Breiten der Werkzeugfenster wieder da.
- [ ] Die Alt-Kürzel funktionieren auf der Schweizer Tastatur; AltGr + 2 („@“) löst nichts aus.
- [ ] `npm run dev`: Ctrl + R und Ctrl + Shift + I aus dem Entwicklungsmenü funktionieren trotz verborgener Titelleiste.
- [ ] Eine Information bleibt stehen, solange die Maus über ihr steht, und verschwindet danach.

## Hinweise

- Ticket 02 hat im Platzhalter des Projektfensters eine vorläufige Leiste mit „Open Folder“, „Exit“ und den zuletzt geöffneten Projekten (`src/renderer/ProjectPlaceholder.tsx`). Die Playwright-Tests in `test/ui/projectWindows.test.ts` klicken deren Knöpfe und müssen auf das Projektmenü umgestellt werden. Die Logik dahinter (`useProjectActions` in `src/renderer/RecentProjects.tsx`) lässt sich fürs Projektmenü wiederverwenden.
- Die vorläufigen Hinweise stehen in `src/renderer/Notices.tsx`; Fehlertexte für Hinweise liefert `errorText` in `src/renderer/errors.ts`.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-21. Kein schwerer Befund. Akzeptanzkriterien, die Wettläufe beim Speichern des Layouts, die Prüfung von `project.setLayout` und die Eingriffe des Testmodus (`__codiumTestHooks`) sind in Ordnung. Eingearbeitet:

- **Offenes Menü nahm nach einem Alt-Kürzel weiter Tasten an** (nachgewiesen): Menü öffnen, Pfeil runter, Alt + 1, Enter führte „Open Folder…“ aus, mit Pfeil hoch wäre es „Exit“ gewesen. Jetzt schliesst sich das Menü, sobald der Fokus es verlässt. Die Kürzel der App schliessen offene Menüs zuerst (`closeOpenMenus` in `src/renderer/popup/Menu.tsx`), und ein geschlossenes Menü nimmt sofort keine Tasten mehr an, auch bevor React es entfernt hat. Ein Oberflächentest spielt genau diesen Ablauf durch, mit Pfeil runter und Pfeil hoch; ohne die Korrektur schlägt er fehl.
- **Spezifikation an die Symbolleisten angeglichen:** „Symbolleiste“ unter den Begriffen, Abschnitt „Oberfläche“, Präzisierung 24 und eine neue Präzisierung 37 beschreiben die Aufteilung wie im neuen IntelliJ.
- **Ziehen in einem kleinen Fenster** (nachgewiesen, nach der Nachprüfung umgebaut). Zuerst überschrieb Ziehen die gespeicherte Grösse der Gegenseite. Die erste Korrektur liess sie zwar unberührt, aber nach dem Loslassen schrumpften wieder beide Seiten anteilig. Jeder Versuch zu verbreitern machte die Seite schmaler: Fenster 720 × 400, links 280 und rechts 320 gespeichert; links 1 px breiter gezogen, war die Seite nach dem Loslassen 176 statt 200 px breit. Das trat schon bei Fenstern unter etwa 920 px auf, etwa halb angedockt. Jetzt wie in IntelliJ:
  - Die Oberfläche merkt sich die zuletzt gezogene Seite, ohne sie zu speichern. Bei Platzmangel weicht zuerst die andere Seite bis zu ihrer Mindestbreite, erst dann die gezogene (`panelSizes` mit Vorrang-Seite).
  - Beim Ziehen darf die Höchstgrösse die offene Gegenseite bis auf deren Mindestbreite verdrängen.
  - Die gezogene Breite bleibt nach dem Loslassen stehen. Gespeichert wird nur die gezogene Seite; die Gegenseite behält ihre gespeicherte Breite und zeigt sie im grösseren Fenster wieder.
  - Unten gibt es keine Gegenseite: Das untere Werkzeugfenster wird nur auf die Höhe begrenzt, die der Code-Bereich übrig lässt.
  - Einheitstests (`beginResize`, `resizeTo`, `panelSizes` in `toolWindowLayout.ts`). Ein Oberflächentest spielt den Fall des Prüfers in einem Fenster von 720 × 400 durch; gegen den vorherigen Stand scheitert er mit genau dessen Zahlen (176 statt 200).
- **Zieh-Zeiger blieb hängen,** wenn das Werkzeugfenster während des Ziehens verschwand (nachgewiesen). Bewegung und Loslassen kommen jetzt über das Fenster; Klicks auf Symbole, „Hide“ und die Kürzel beenden ein laufendes Ziehen zuerst. Oberflächentest: Ziehen, mittendrin Alt + 1 zweimal; danach kein Zieh-Zeiger mehr, und weitere Bewegungen ändern nichts.
- **Fortschritt im Willkommensfenster:** Eine schmale Leiste unten erscheint, solange eine Arbeit läuft (Ticket 10, Klonen). Die Anzeige teilt sich `ProgressIndicator.tsx` mit der Statusleiste. Oberflächentest über `__codiumTestHooks`.
- **Werkzeugfenster bleiben nach dem ersten Öffnen eingehängt** und werden beim Schliessen und Wechseln nur verborgen; Dateibaum und Terminal behalten so ihren Zustand. Oberflächentest: Eine Markierung am Inhalt übersteht Schliessen, Wechseln und Öffnen.
- **Knöpfe an Meldungen** sind auf Vollständigkeit geprüft (`assertNever` in `App.tsx`).

Nachprüfung durch denselben Agenten: Sieben der acht Befunde sind bestätigt behoben. Das Verhalten beim Ziehen im kleinen Fenster, zuerst als bewusst so geblieben geführt, ist nach IntelliJ umgebaut (oben).

Entscheidungen bei der Umsetzung, die Ticket und Spezifikation nicht vorgeben:

- **Aufteilung der Symbolleisten** wie im neuen IntelliJ und nach der Skizze aus der Befragung, ohne Leiste am unteren Rand (siehe Präzisierung 37); die Bestätigung des Nutzers steht in der Prüfliste.
- **Eingriffe des Testmodus** (`globalThis.__codiumTestHooks.emit`): Für Meldungen vom Typ Information und für Fortschritt gibt es im Kern noch keine echte Quelle. Die Oberflächentests schicken diese Ereignisse deshalb auf demselben Weg wie der Kern. Die Eingriffe gibt es nur im Testmodus und nur in `main.ts`; der Kern kennt den Testmodus weiterhin nicht.
- **Knöpfe an Meldungen** sind Aktionen der Oberfläche (Tabelle `NoticeActions` im Vertrag), keine Befehle an den Kern; so kann später auch „Open README“ einen Tab öffnen. Die Startmeldung zu einem fehlenden Projektordner trägt „Remove from List“, wenn der Ordner unter den zuletzt geöffneten Projekten steht.
- **Kürzel wie in IntelliJ:** Ein verborgenes Werkzeugfenster wird gezeigt und bekommt den Fokus, ein sichtbares ohne Fokus bekommt den Fokus, ein sichtbares mit Fokus wird geschlossen. Ein Klick auf das Symbol schaltet immer um und setzt beim Öffnen den Fokus hinein. Während einer Rückfrage ruhen die Kürzel. Die Belegung steht in `src/renderer/keymap.ts` (Grundlage für Ticket 06).
- **Rückfrage beim Entfernen:** Das „×“ an einem zuletzt geöffneten Projekt im Willkommensfenster fragt „Remove Recent Project“, wie IntelliJ. „Remove from List“ an einer Meldung entfernt ohne Rückfrage.
- **Standard-Layout:** links „Project“ offen (280 px), unten „Terminal“ (260 px) und rechts „Database“ (320 px) zu. Grössen werden in Pixeln gespeichert.
- **Mindestgrössen:** Werkzeugfenster links und rechts 150 px, unten 100 px; der Code-Bereich bleibt mindestens 240 × 120 px. Ist das Fenster zu schmal für links und rechts, weicht zuerst die Seite, die nicht zuletzt gezogen wurde; wurde in diesem Fenster noch keine gezogen, schrumpfen beide anteilig. Die gespeicherten Grössen bleiben.
- **Willkommensfenster** mit eigener Kopfzeile (Titel, Fensterknöpfe von Windows), Fensterfarbe immer `#1e1f22`, `nativeTheme.themeSource = 'dark'`.
