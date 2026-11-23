# 26 – Zweimal Shift: Dateien suchen

Status: `ready-for-agent` · Typ: AFK
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
- **Dabei gefunden:** Nach Escape in „Go to File“ (auch über Ctrl + Shift + N) liegt der Fokus nicht wieder im Editor, sondern auf der Seite; das war schon vorher so und gehört nicht zu diesem Ticket.

## Hinweise

- Die Spielregeln gelten auch hier: Die echte App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Tastendrücke in den Tests gehen über Playwright an das verborgene Testfenster, nie an den Desktop.
