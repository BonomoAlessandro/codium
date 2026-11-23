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

- [ ] Einheitstests für die Erkennung: zweimal Shift im Zeitfenster löst aus; zu langsam, eine andere Taste dazwischen, Ctrl/Alt mitgedrückt, Maustaste dazwischen, gehaltenes Shift mit Tastenwiederholung und Fokusverlust lösen nicht aus; linke und rechte Shift-Taste gemischt lösen aus; dreimal Shift löst nur einmal aus.
- [ ] Ein Playwright-Test (im Testmodus) prüft: zweimal Shift mit Fokus im Editor öffnet „Go to File“, Tippen eines Namens und Enter öffnet die Datei.
- [ ] Ein Playwright-Test prüft, dass Grossbuchstaben im Editor (Shift + Buchstabe, zweimal hintereinander) die Suche nicht öffnen und im Text landen.
- [ ] Ein Playwright-Test prüft, dass zweimal Shift auch mit Fokus im Terminal die Suche öffnet und im Terminal nichts ankommt.
- [ ] Der bestehende Test der zentralen Belegung (keine doppelt belegten Kürzel) kennt das neue Kürzel.
- [ ] Alle Testläufe bleiben grün (`npm test`, `npm run test:ui`).

## Abnahme von Hand

- [ ] Zweimal Shift fühlt sich an wie in IntelliJ: weder zu träge noch löst es beim normalen Tippen versehentlich aus.

## Hinweise

- Die Spielregeln gelten auch hier: Die echte App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Tastendrücke in den Tests gehen über Playwright an das verborgene Testfenster, nie an den Desktop.
