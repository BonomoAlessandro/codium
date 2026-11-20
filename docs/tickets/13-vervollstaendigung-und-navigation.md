# 13 – Vervollständigung, semantische Färbung, Symbolsuche, Zurück und Vor

Status: `ready-for-agent` · Typ: AFK
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

- [ ] Langsamer Testlauf an den Beispielprojekten aus Ticket 12:
  - Vervollständigung eines Members, mit nachgeladener Dokumentation.
  - Semantische Token unterscheiden Parameter, lokale Variable, Eigenschaft und statisches Member.
  - Symbolsuche findet eine Klasse über Ctrl + N und eine Funktion über „alle Symbole“.
- [ ] Einheitstests des Navigationsverlaufs: Eintrag bei Sprung, kein Eintrag bei kleiner Cursorbewegung, Zurück und Vor, ein neuer Sprung nach Zurück verwirft die Vor-Einträge.
- [ ] Playwright-Tests (im Lauf `test:ui`):
  - Ctrl + Linksklick in eine andere Datei, dann Ctrl + Alt + Links → zurück an der Ausgangsstelle; die Seitentaste „zurück“ der Maus (über das DevTools-Protokoll) wirkt gleich.
  - Ctrl + N, Klassenname tippen, Enter → Datei an der Klasse offen.
  - Ctrl + Leertaste zeigt Vorschläge.

## Abnahme von Hand

- [ ] Die semantische Färbung entspricht IntelliJ „Dark“.
- [ ] Die Vervollständigung erscheint beim Tippen ohne spürbare Verzögerung.
