# 26 – Zweimal Shift: Dateien suchen

Status: `erledigt` (2026-11-23) · Typ: AFK
Blockiert durch: –
User Stories: keine eigene; ergänzt „Suchen und Navigieren“ (Datei nach Namen suchen, Ticket 08)
Spezifikation: „Suchen und Navigieren“, Tastenbelegung (`src/renderer/keymap.ts`)

Dieses Ticket kam nach Codium 1 dazu, auf Wunsch des Nutzers. In IntelliJ öffnet ein zweimaliges Drücken von Shift die Suche „Search Everywhere“, und der Nutzer sucht so nach Dateien. In Codium gibt es die Dateisuche heute nur über Ctrl + Shift + N („Go to File“, Ticket 08).

## Was gebaut wird

- **Zweimal Shift öffnet die Dateisuche:** dasselbe Suchfenster wie Ctrl + Shift + N, mit leerem Suchfeld und dem Fokus darin. Die übrigen Teile von „Search Everywhere“ (Klassen, Symbole, Aktionen in einem Fenster) gehören nicht dazu.
- **Wann es zählt**, wie in IntelliJ:
  - Shift wird zweimal kurz hintereinander allein gedrückt und losgelassen; der Abstand zwischen den beiden Tastendrücken liegt unter einem kurzen Zeitfenster (Richtwert 300–400 ms, im Code als eine benannte Konstante).
  - Linke und rechte Shift-Taste zählen gleich, auch gemischt.
  - Es zählt nicht, wenn dazwischen eine andere Taste gedrückt wird (etwa beim Tippen von Grossbuchstaben: Shift + A, Shift + B), wenn eine andere Modifikatortaste mitgedrückt ist (Ctrl, Alt, Windows; Alt + Shift wechselt unter Windows die Tastatursprache), wenn eine Maustaste dazwischen gedrückt wird (Shift + Klick zum Auswählen), wenn Shift nur gehalten wird (Tastenwiederholung) oder wenn das Fenster dazwischen den Fokus verliert.
- **Wo es wirkt:** im ganzen Projektfenster, auch mit dem Fokus im Editor, im Dateibaum, in den Werkzeugfenstern und im Terminal (Shift allein schickt der Shell nichts). Nicht, solange ein Dialog offen ist; ist die Dateisuche schon offen, bleibt sie offen, und die Eingabe bleibt erhalten.
- **Umsetzung:** Die Erkennung ist eine reine Funktion bzw. ein kleiner Zustandsautomat ohne DOM (Tastenereignisse mit Zeitstempel rein, „auslösen“ oder nicht raus), damit sie sich in Node prüfen lässt. Das Projektfenster hängt sie an seine bestehende Auswertung der Tasten in der Capture-Phase. In der zentralen Tastenbelegung steht „Shift Shift“ als Kürzel für `file.gotoFile`, neben Ctrl + Shift + N, damit es auch in Tooltips und der Anzeige der Kürzel erscheint („Double Shift“ wie in IntelliJ).

## Akzeptanzkriterien

- [x] Einheitstests für die Erkennung: zweimal Shift im Zeitfenster löst aus; zu langsam, eine andere Taste dazwischen, Ctrl/Alt mitgedrückt, Maustaste dazwischen, gehaltenes Shift mit Tastenwiederholung und Fokusverlust lösen nicht aus; linke und rechte Shift-Taste gemischt lösen aus; dreimal Shift löst nur einmal aus.
- [x] Ein Playwright-Test (im Testmodus) prüft: zweimal Shift mit Fokus im Editor öffnet „Go to File“, Tippen eines Namens und Enter öffnet die Datei.
- [x] Ein Playwright-Test prüft, dass Grossbuchstaben im Editor (Shift + Buchstabe, zweimal hintereinander) die Suche nicht öffnen und im Text landen.
- [x] Ein Playwright-Test prüft, dass zweimal Shift auch mit Fokus im Terminal die Suche öffnet und im Terminal nichts ankommt.
- [x] Der bestehende Test der zentralen Belegung (keine doppelt belegten Kürzel) kennt das neue Kürzel.
- [x] Alle Testläufe bleiben grün (`npm test`, `npm run test:ui`).

## Abnahme von Hand

- [ ] Zweimal Shift fühlt sich an wie in IntelliJ: weder zu träge noch löst es beim normalen Tippen versehentlich aus.

## Umsetzung (Agent, 2026-11-23)

- **Erkennung** in `src/renderer/doubleShift.ts`, ein kleiner Zustandsautomat ohne DOM (`DoubleShiftDetector`): Tastendrücke mit Zeitstempel, Maustasten und Fokusverlust rein, „auslösen“ raus. Zeitfenster `DOUBLE_SHIFT_INTERVAL_MS` = 400 ms, gemessen vom ersten zum zweiten Drücken; auch das zweite Loslassen muss innerhalb davon kommen (sonst gilt Shift als gehalten). Ausgelöst wird wie in IntelliJ beim zweiten Loslassen, damit Shift + Buchstabe oder Shift + Klick auch nach dem zweiten Drücken noch abbrechen. Das Loslassen einer anderen Taste bricht nicht ab (beim schnellen Tippen kommt es oft erst nach dem nächsten Drücken). Beide Shift-Tasten gleichzeitig zählen nicht.
- **Projektfenster:** Die bestehende Auswertung in der Capture-Phase gibt jeden Tastendruck an die Erkennung, dazu kommen `keyup`, `pointerdown`/`mousedown` und `blur` des Fensters. Bei offenem Dialog (`isDialogOpen`) passiert nichts. Geöffnet wird über denselben Weg wie Ctrl + Shift + N; die Befehle der Suchfenster stehen jetzt in einer Tabelle (`SEARCH_POPUPS`), und eine offene Dateisuche bleibt samt Eingabe.
- **Tastenbelegung:** `DOUBLE_SHIFT` („Double Shift“) steht als zweites Kürzel für `file.gotoFile` in `keymap.ts`, als `global` (wirkt auch im Terminal). Was zweimal Shift öffnet, liest das Projektfenster aus der Belegung (`commandForShortcut`). Neu `shortcutLabels` für alle Kürzel eines Befehls; der leere Code-Bereich zeigt als ersten Hinweis „Go to File“ mit `Ctrl+Shift+N, Double Shift`.
- **Tests:** 12 Einheitstests in `test/renderer/doubleShift.test.ts`; `test/renderer/keymap.test.ts` kennt das neue Kürzel (keine doppelten Kürzel, kein Befehl mit zwei Kürzeln ausser diesem, kein Tastendruck trifft es). Drei Playwright-Tests in `test/ui/doubleShift.test.ts` (dazu: bei offenen Einstellungen passiert nichts, eine offene Dateisuche bleibt samt Eingabe, der Hinweis im leeren Code-Bereich); sie schicken die Tasten ohne Warten dazwischen, damit die Abstände auch unter Last im Zeitfenster bleiben, und der Grossbuchstaben-Test enthält eine Gegenprobe (gleiche Abstände, Shift allein öffnet). Gegenprobe am Code: Ohne den Abbruch durch andere Tasten wird der Grossbuchstaben-Test rot.
- **Testläufe:** `npm run typecheck` und `npm test` (392 Tests) grün, `npm run test:ui` 82 Tests. Unter der Last paralleler Testläufe waren im vollen Lauf einzelne Tests rot, die mit dieser Änderung nichts zu tun haben: „öffnet eine JDK-Klasse …“ (Java) und „bricht einen hängenden Klon … ab“ sind auch auf dem Stand von `main` rot, die übrigen (Commit „Rollback…“, Markdown mit Mermaid, Suche mit Ctrl + Shift + N, Aufräumen der Temp-Ordner mit EPERM) liefen beim erneuten Lauf grün.
- **Spezifikation und README** nennen zweimal Shift bei der Dateisuche, bei den Tasten im Terminal und unter „Ausserhalb des Umfangs“ (Search Everywhere bleibt draussen).
- **Dabei gefunden:** Nach Escape in „Go to File“ (auch über Ctrl + Shift + N) liegt der Fokus nicht wieder im Editor, sondern auf der Seite; das war schon vorher so. Im Review behoben (siehe dort).

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-23. Erkennung, Listener, die Tabelle `SEARCH_POPUPS` und der Aufbau des Grossbuchstaben-Tests (Tasten ohne Warten dazwischen, Gegenprobe) in Ordnung. Das Zeitfenster von 400 ms, der Hinweis im leeren Code-Bereich sowie Spezifikation und README auf dem Branch bleiben. Eingearbeitet:

- **Wettlauf im Terminal-Test** (unter Last zweimal rot): cmd schreibt Ausgabe und neue Eingabeaufforderung in getrennten Stücken; der Test wartet jetzt auf beide.
- **Wartezeiten von 1 s** in den neuen Oberflächentests: Wo die App arbeiten muss (Dateiliste, Öffnen, Fokus), wartet der Test bis 10 s.
- **Fokus nach Escape** (bestand schon vor dem Ticket, eigener Commit): Der Rahmen der Suchfenster (`QuickPopup`) merkte sich den Fokus erst im Effekt, als das `autoFocus` des Suchfelds schon gelaufen war, und gab ihn beim Schliessen an das eigene, entfernte Suchfeld zurück. Jetzt wird er beim ersten Rendern festgehalten; löst ein Suchfenster ein anderes ab, gilt, was sich das erste gemerkt hat. Getestet in `search.test.ts` (Ctrl + Shift + N, Wechsel von Ctrl + E zu Ctrl + Shift + N) und im Grossbuchstaben-Test (zweimal Shift, Escape, das nächste Zeichen landet im Editor). Gegenprobe: Ohne die Übergabe beim Wechsel wird der neue Test rot.
- **`scope` und `global` beim Eintrag „Double Shift“** wertete niemand aus: Die Kommentare sagen jetzt, dass sie nur der Anzeige dienen und für zweimal Shift nur Befehle vorgesehen sind, die ein Suchfenster öffnen.
- **IME:** Eine laufende Eingabe über einen IME (`isComposing`, `key === 'Process'`) bricht die Zählung ab; Einheitstest.
- **Mausrad:** Shift + Mausrad bricht ab wie eine Maustaste; Einheitstest.
- **Dabei gefunden, Enter gleich nach den ersten Treffern** (bestand schon vorher, eigener Commit): Die Dateilisten (Go to File, Recent Files, Symbole) setzten die Auswahl erst in einem Effekt nach dem Zeichnen zurück; ein Enter in diesem Moment nahm noch die Auswahl der leeren Liste und öffnete nichts. Das erklärt vermutlich die unter Last roten Abfragen nach Enter in `search.test.ts` und im Terminal-Test; seither lief der volle Oberflächenlauf grün. Die Auswahl wird jetzt beim Zeichnen bestimmt. Einen sicher reproduzierenden Test gibt es dafür nicht (es hängt am Zeitpunkt).
- Zwei weitere Hinweise ohne Handlungsbedarf. Den Abschnitt „Nach Codium 1“ in `docs/abnahme.md` führt der Merge mit den Tickets 24 und 25 zusammen.

Testläufe nach dem Review: `npm run typecheck` grün, `npm test` 394 Tests (davon 14 für die Erkennung), `npm run test:ui` 83 von 83 grün. Im vollen schnellen Lauf war unter der Last paralleler Läufe wiederholt „lässt einen gelöschten Projektordner los …“ (`test/main/fileService.test.ts`, EPERM beim Löschen des überwachten Ordners) rot; der Test berührt nichts aus diesem Ticket und läuft für sich grün (36 von 36).

## Hinweise

- Die Spielregeln gelten auch hier: Die echte App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Tastendrücke in den Tests gehen über Playwright an das verborgene Testfenster, nie an den Desktop.
