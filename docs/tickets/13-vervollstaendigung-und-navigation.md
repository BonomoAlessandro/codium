# 13 – Vervollständigung, semantische Färbung, Symbolsuche, Zurück und Vor

Status: `erledigt` (2026-11-22, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
Blockiert durch: 06, 12
User Stories: 63, 65, 81, 84 (jeweils für TypeScript/JavaScript; Java folgt in Ticket 14)
Spezifikation: „Sprachverständnis“ (Vervollständigung, Semantische Färbung, Symbolsuche), „Oberfläche“ (Code-Farben), „Editor, Tabs und Speichern“ (Zurück und Vor)

## Was gebaut wird

- **Vervollständigung:** typisierte Methode im Sprach-Dienst samt Nachladen von Details; Monaco-Anbieter automatisch beim Tippen und mit Ctrl + Leertaste.
- **Semantische Färbung:** typisierte Methode für semantische Token; Monaco-Anbieter mit der Farbzuordnung aus Ticket 05 (Felder violett, statische Member kursiv, Methodendeklarationen blau, Parameter und lokale Variablen in der Grundfarbe, Konstanten violett kursiv).
- **Symbolsuche:** typisierte Methode über alle Sprachserver des Projekts. Popups wie die Dateisuche aus Ticket 08: Ctrl + N (Klassen, Interfaces, Enums) und Ctrl + Alt + Shift + N (alle Symbole). Enter öffnet an der Stelle.
- **Zurück und Vor:**
  - Navigationsverlauf pro Projektfenster.
  - Einträge entstehen bei Sprüngen (Definition, Verwendungen, Implementierungen, Datei- und Projektsuche, Symbolsuche, Zu Zeile) und bei grösseren Cursorbewegungen über mehr als einige Zeilen.
  - Ctrl + Alt + Links/Rechts und die Seitentasten der Maus.
- Alle Kürzel in der zentralen Tastenbelegung.

## Akzeptanzkriterien

- [x] Langsamer Testlauf an den Beispielprojekten aus Ticket 12:
  - Vervollständigung eines Members, mit nachgeladener Dokumentation.
  - Semantische Token unterscheiden Parameter, lokale Variable, Eigenschaft und statisches Member.
  - Symbolsuche findet eine Klasse über Ctrl + N und eine Funktion über „alle Symbole“.
- [x] Einheitstests des Navigationsverlaufs: Eintrag bei Sprung, kein Eintrag bei kleiner Cursorbewegung, Zurück und Vor, ein neuer Sprung nach Zurück verwirft die Vor-Einträge.
- [x] Playwright-Tests (im Lauf `test:ui`):
  - Ctrl + Linksklick in eine andere Datei, dann Ctrl + Alt + Links → zurück an der Ausgangsstelle; die Seitentaste „zurück“ der Maus (über das DevTools-Protokoll) wirkt gleich.
  - Ctrl + N, Klassenname tippen, Enter → Datei an der Klasse offen.
  - Ctrl + Leertaste zeigt Vorschläge.

## Abnahme von Hand

- [ ] Die semantische Färbung entspricht IntelliJ „Dark“.
- [ ] Die Vervollständigung erscheint beim Tippen ohne spürbare Verzögerung.
- [ ] Farben im Detail (Review): Konstanten auf Modulebene und Globale der Standardbibliothek (etwa `console`) erscheinen in der Grundfarbe; prüfen, ob IntelliJ sie violett bzw. kursiv zeigt.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-22. Gemeinsame Legende und Theme-Regeln, Umrechnung der Token samt neu berechneter Positionen, Verwerfen veralteter Antworten, Bereiche und Snippets der Vorschläge, Nachladen der Dokumentation, Filter der Symbolsuche, Grundlogik des Verlaufs, Kürzel und README in Ordnung; die Farben in der echten App (TypeScript 7) wie IntelliJ. Eingearbeitet:

- **Vorschläge wurden nach 1000 abgeschnitten** (nachgewiesen: die Server filtern nicht, `helperFunction` stand bei TypeScript 6 an Stelle 1028): Codium filtert nach dem getippten Wortanfang (die Buchstaben in dieser Reihenfolge) und sortiert, erst danach die Grenze; `incomplete` nur, wenn der Server es sagt oder wirklich gekürzt wurde.
- **Automatischer Import fehlte** (nachgewiesen): `additionalTextEdits` aus der Antwort und aus dem Nachladen gehen an Monaco; langsamer Test in allen drei Varianten.
- **Methoden ohne Farbe bei TypeScript bis 6** (typescript-language-server sagt `member`): Alias auf `method`; Test für Methodendeklaration und statische Methode in allen Varianten, Einheitstest der Umrechnung.
- **Umbenennen/Löschen der aktiven Datei hinterliess einen Eintrag mit altem Pfad** (nachgewiesen): Verlauf und letzte Stelle folgen, auch bei Löschen von aussen; Playwright-Test.
- **Kurze Sprünge ohne Eintrag:** Bewegungen durch Codium oder Monaco selbst (Definition in derselben Datei, Zu Zeile, Treffer) sind Sprünge, auch über wenige Zeilen; das Setzen des Cursors direkt nach einem Dateiwechsel gehört zum Wechsel.
- **Wettläufe bei Zurück/Vor:** Das Ziel gilt bis es erreicht ist (statt fester 2 s); eine Navigation während einer laufenden geht vom Ziel aus.
- **Maustasten hinter Dialogen:** gesperrt wie die Tastatur.
- **Symbolsuche mit TypeScript 6** setzte den Cursor auf den Zeilenanfang: Codium sucht den Namen in der Zeile. Bekannt, nicht geändert: Type-Aliase meldet TypeScript 6 als Variable, Ctrl + N findet sie dort nicht.
- **Semantische Token auch in Bibliothekszielen** ausserhalb des Projekts.
- **Aufräumen im Test** (tsserver hielt den Ordner): Der Dienst wartet beim Beenden auf die Kindprozesse von typescript-language-server.
- **Kommentar im Farbschema** berichtigt; Farben von Konstanten und Globalen in die Abnahme von Hand aufgenommen.
- **Offen, nicht geändert:** `labelDetails` (Herkunftsmodul) wird nicht angezeigt; `workspace/semanticTokens/refresh` ist nicht angemeldet.
