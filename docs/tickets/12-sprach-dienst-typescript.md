# 12 – Sprach-Dienst mit TypeScript: Definition, Verwendungen, Hover, Fehler

Status: `ready-for-agent` · Typ: AFK
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

## Akzeptanzkriterien

- [ ] Die Spezifikation enthält das Ergebnis der Klärung zum nativen Sprachserver und die daraus folgende Wahl des Rückfalls.
- [ ] Langsamer Testlauf mit echten Sprachservern an drei kleinen Beispielprojekten (TypeScript 7, TypeScript 6, ohne eigenes TypeScript):
  - Definition über Dateigrenzen, Verwendungen einer Funktion, Implementierungen eines Interfaces.
  - Hover mit Typ und JSDoc.
  - Fehler nach einer fehlerhaften Änderung, die noch nicht gespeichert ist.
  - Definition in eine Typdefinition unter node_modules liefert ein schreibgeschütztes Ziel.
  - Eine von aussen geänderte und eine in Codium umbenannte Datei werden berücksichtigt.
  - Neustart nach einem Absturz; Aufgeben nach dem dritten Absturz in drei Minuten (mit steuerbarer Uhr oder nachgemachtem Absturz).
  - Abbau des Projekt-Kerns beendet die Server samt Kindprozessen.
- [ ] Kern-Test: Ohne Kennzeichen startet kein Server, bis eine TypeScript-Datei geöffnet wird.
- [ ] Playwright-Tests (im Lauf `test:ui`):
  - Ctrl + Linksklick auf einen Funktionsaufruf öffnet die andere Datei an der Definition.
  - Ctrl + Linksklick auf die Deklaration zeigt die Verwendungen.
  - Alt + F7 füllt das Werkzeugfenster „Find“.
- [ ] `npm run test:packaged` startet die mitgelieferten TypeScript-Sprachserver im ungepackten Paket.

## Abnahme von Hand

- [ ] Ctrl halten und über Bezeichner fahren: Unterstreichung nur, wo ein Ziel existiert.
- [ ] In einem echten TypeScript-Projekt fühlen sich Sprünge und Fehler an wie in IntelliJ.
