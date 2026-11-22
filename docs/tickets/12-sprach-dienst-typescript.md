# 12 – Sprach-Dienst mit TypeScript: Definition, Verwendungen, Hover, Fehler

Status: `erledigt` (2026-11-22, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
Blockiert durch: 06, 07, 08
User Stories: 74–80, 82, 83, 88, 90 (jeweils für TypeScript/JavaScript), 89 sinngemäss
Spezifikation: „Sprachverständnis“ (ohne Java-Teile), „Vertrag zwischen Oberfläche und Kern“ (typisierte Methoden, Dokumente melden), „Editor, Tabs und Speichern“ (Modell pro Datei, Editor-Opener), „Präzisierungen beim Schreiben“ Punkt 19

## Was gebaut wird

Der Sprach-Dienst mit seinem ersten Sprachserver. Vervollständigung, semantische Färbung, Symbolsuche und Zurück/Vor folgen in Ticket 13, Java in Ticket 14.

- **Zuerst klären und in der Spezifikation festhalten:** Welche Funktionen dieser Version (Definition, Verwendungen, Implementierungen, Hover, Fehler, Vervollständigung, semantische Token, Symbolsuche) liefert der native Sprachserver von TypeScript 7 bereits? Danach entscheidet sich der Rückfall für Projekte ohne eigenes TypeScript (Spezifikation, „Sprachverständnis“). Ergebnis als kurzer Absatz unter „Grundlage der Entscheidungen“ eintragen.
- **Sprach-Dienst** im Projekt-Kern:
  - Startet Sprachserver nach den Regeln der Spezifikation: beim Öffnen des Projekts, wenn Kennzeichen da sind (tsconfig, jsconfig, package.json), sonst beim Öffnen der ersten passenden Datei. Höchstens ein Server je Sprache und Projektfenster.
  - **Serverwahl** nach der TypeScript-Version im Projekt: ab 7 der native Server des Projekts; bis 6 typescript-language-server mit dem tsserver des Projekts; ohne eigenes TypeScript der mitgelieferte (nativer Server von TypeScript 7 oder der Rückfall).
  - Neustart nach Absturz höchstens dreimal in drei Minuten, danach Fehlerhinweis.
  - Beim Abbau des Projekt-Kerns werden alle Server samt Kindprozessen beendet.
  - Dateiereignisse von aussen sowie Neu, Umbenennen und Löschen durch Codium werden den Servern gemeldet.
  - Fortschritt der Server erscheint in der Statusleiste.
  - Typisierte Methoden: Definition, Verwendungen, Implementierungen, Hover, Inhalt eines schreibgeschützten Ziels. Weitere kommen mit Ticket 13.
- **Oberfläche:**
  - Die Oberfläche meldet geöffnete, geänderte und geschlossene Dokumente mit aktuellem Text, auch vor dem Speichern.
  - **Definition:** Ctrl + Linksklick mit Unterstreichung beim Halten von Ctrl, und Ctrl + B.
  - **Verwendungen:** als Ersatzbefehl, wenn die Definition die Stelle selbst ist; Alt + F7 legt sie als Reiter ins Werkzeugfenster „Find“ (Ticket 08).
  - **Implementierungen:** Ctrl + Alt + B.
  - **Hover** mit Markdown; Ctrl + Q an der Cursorposition.
  - **Fehler und Warnungen** als Markierungen.
  - **Ziele in anderen Dateien:** Vor der Rückgabe an Monaco legt die Oberfläche Modelle für alle Ziele an; geöffnet wird über den Editor-Opener aus Ticket 05. Ziele in Typdefinitionen unter node_modules öffnen schreibgeschützt.
  - Kürzel in der zentralen Tastenbelegung.
- **Auslieferung:** die TypeScript-Sprachserver (TypeScript 7 als Laufzeit-Bestandteil, typescript-language-server, gegebenenfalls TypeScript 6 als Rückfall) ausserhalb des App-Archivs, wo nötig. Die Entwicklungsabhängigkeit TypeScript des Projekts selbst bleibt davon getrennt.

- **Hinweis aus Ticket 05:** Tabs ab 5 MB tragen im Inhalt `large: true` (aus `files.read`); für sie meldet die Oberfläche dem Sprach-Dienst nichts.

## Akzeptanzkriterien

- [x] Die Spezifikation enthält das Ergebnis der Klärung zum nativen Sprachserver und die daraus folgende Wahl des Rückfalls.
- [x] Langsamer Testlauf mit echten Sprachservern an drei kleinen Beispielprojekten (TypeScript 7, TypeScript 6, ohne eigenes TypeScript):
  - Definition über Dateigrenzen, Verwendungen einer Funktion, Implementierungen eines Interfaces.
  - Hover mit Typ und JSDoc.
  - Fehler nach einer fehlerhaften Änderung, die noch nicht gespeichert ist.
  - Definition in eine Typdefinition unter node_modules liefert ein schreibgeschütztes Ziel.
  - Eine von aussen geänderte und eine in Codium umbenannte Datei werden berücksichtigt.
  - Neustart nach einem Absturz; Aufgeben nach dem dritten Absturz in drei Minuten (mit steuerbarer Uhr oder nachgemachtem Absturz).
  - Abbau des Projekt-Kerns beendet die Server samt Kindprozessen.
- [x] Kern-Test: Ohne Kennzeichen startet kein Server, bis eine TypeScript-Datei geöffnet wird.
- [x] Playwright-Tests (im Lauf `test:ui`):
  - Ctrl + Linksklick auf einen Funktionsaufruf öffnet die andere Datei an der Definition.
  - Ctrl + Linksklick auf die Deklaration zeigt die Verwendungen.
  - Alt + F7 füllt das Werkzeugfenster „Find“.
- [x] `npm run test:packaged` startet die mitgelieferten TypeScript-Sprachserver im ungepackten Paket.

## Abnahme von Hand

- [ ] Ctrl halten und über Bezeichner fahren: Unterstreichung nur, wo ein Ziel existiert.
- [ ] In einem echten TypeScript-Projekt fühlen sich Sprünge und Fehler an wie in IntelliJ.

## Klärung

Der native Server von TypeScript 7.0.2 (`tsc --lsp --stdio`) liefert alle Funktionen dieser Version (Definition, Verwendungen, Implementierungen, Hover mit JSDoc, Pull-Diagnosen, Vervollständigung mit Details, semantische Token, Symbolsuche). Ein mitgeliefertes TypeScript 6 als Rückfall entfällt; festgehalten in der Spezifikation unter „Grundlage der Entscheidungen“, die übrigen Stellen sind nachgezogen.

Anmerkungen zur Umsetzung:
- **Neustart:** Wie im Text des Tickets und in der Spezifikation höchstens drei Neustarts in drei Minuten; der vierte Absturz in diesem Fenster gibt mit Fehlerhinweis auf. Das Kriterium „Aufgeben nach dem dritten Absturz“ liest sich anders; offen für die Abnahme.
- **Kern-Test ohne Kennzeichen** läuft im langsamen Lauf (der schnelle startet keine Sprachserver).
- **Paket:** Der native Server liegt mit seinen `lib.*.d.ts` unter `resources/typescript-native` (electron-builder lässt .d.ts aus node_modules weg; ohne sie stürzt der Server ab). Die Paketprüfung führt ein LSP-Gespräch, das diese Dateien braucht.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-22. Die Klärung zum nativen Server bestätigt; Serverwahl, Start-Regeln, Neustart-Regel, Abbau samt Kindern, UTF-16-Positionen, Rückübersetzung der URIs, Prüfung von `readTarget`, Hover ohne HTML, Kürzel, Melden der Dokumente und Paketierung in Ordnung. Eingearbeitet:

- **Fehler in anderen offenen Dateien veralteten** (nachgewiesen; der native Server liefert Fehler auf Abfrage): Nach jeder Änderung werden alle offenen Dokumente neu abgefragt, dazu `workspace/diagnostic/refresh`. Langsamer Test, Gegenprobe rot.
- **Jede Datei unter node_modules öffnete über `readTarget` als UTF-8 und schreibgeschützt:** Dateien im Projekt liest wieder der Datei-Dienst (Kodierung, Bilder, Grössengrenzen); schreibgeschützt sind nur Sprungziele und Ziele ausserhalb des Projekts; `readTarget` hält die Grenze von 50 MB ein.
- **Der native Server lehnte `shutdown` mit `params: null` ab** und wurde immer hart beendet: `shutdown`/`exit` ohne `params`; der Test verlangt einen Abbau unter einer Sekunde.
- **Vorschau-Modelle für Sprungziele** waren bearbeitbar und veralteten: schreibgeschützt im Peek und vor jeder Abfrage frisch, soweit kein Editor sie zeigt.
- **Doppeltes `didOpen` und Benachrichtigungen vor `initialize`:** Benachrichtigungen erst nach `initialized`; der Dienst führt, welche Dokumente der Server offen hat.
- **Hartes Beenden nach dem Ende des Servers** konnte eine neu vergebene Prozessnummer treffen: nur noch, wenn der Server nicht von selbst endet.
- **Hängendes oder abgelehntes `initialize`** liess den Server tot zurück: Er wird beendet, das zählt wie ein Absturz.
- **Anfragen in Bibliothekszielen ausserhalb des Projekts** (etwa `lib.dom.d.ts`) sind erlaubt; Dateien ab 5 MB öffnet der Dienst nicht selbst.
- **Selbst geöffnete Dokumente** schliesst der Dienst nach verpassten Dateiereignissen und nach einem Neustart.
- **Tests:** dazu eine von aussen geänderte Datei, Fehler in einer anderen offenen Datei, die Freigabe der Neustarts nach Ablauf der drei Minuten und das LSP-Gespräch im Paket.
- **Hinweis ohne Änderung:** Codium startet beim Öffnen eines Projekts dessen eigenes TypeScript (`tsc.exe` bzw. `tsserver.js`), wie spezifiziert, ohne Vertrauensabfrage.
