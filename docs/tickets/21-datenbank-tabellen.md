# 21 – Datenbank: Tabelleninhalt und Bearbeiten

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: 05, 20
User Stories: 160–171
Spezifikation: „Datenbank“ (Tabelleninhalt, Bearbeiten, NULL, Lange Werte, Binäre Spalten), „Präzisierungen beim Schreiben“ Punkt 12

## Was gebaut wird

- **Tabelleninhalt als Tab** im Code-Bereich (Doppelklick auf Tabelle oder View im Baum):
  - Seiten zu 500 Zeilen mit „Next“/„Previous“ und Anzeige der Zeilen.
  - Ohne gewählte Sortierung nach dem Primärschlüssel sortiert, damit die Seiten stabil sind; bei Views und Tabellen ohne Primärschlüssel ohne Sortierung.
  - **Sortieren:** Klick auf einen Spaltenkopf wechselt aufsteigend, absteigend, ohne; ausgeführt in der Datenbank.
  - **Filterfeld** für eine WHERE-Bedingung, unverändert übernommen; ein ungültiger Filter zeigt die Meldung der Datenbank.
  - Tabelleninhalts-Tabs werden nach einem Neustart nicht wiederhergestellt.
- **Bearbeiten** nur bei Tabellen mit Primärschlüssel. Views und Tabellen ohne Primärschlüssel sind schreibgeschützt, mit Hinweis.
  - Doppelklick bearbeitet eine Zelle; geänderte Zellen farbig markiert.
  - „Add Row“ fügt eine leere Zeile am Ende an; „Delete Row“ streicht Zeilen bis zum Speichern durch.
  - Rechtsklick „Set NULL“; NULL grau als „null“ angezeigt.
  - „Open Editor“ für lange Texte, json und jsonb in einem grösseren Feld (JSON mit Farben).
  - bytea als „binary, N bytes“, schreibgeschützt.
- **Speichern** im Datenbank-Dienst:
  - „Submit“ (Ctrl + Enter) führt den Änderungssatz in einer Transaktion mit Parametern aus; PostgreSQL wandelt die Textwerte in den Spaltentyp.
  - **Updates** treffen die Zeile über den Primärschlüssel und die ursprünglichen Werte der geänderten Spalten (Vergleich der Textdarstellung, NULL-sicher).
  - **Deletes** treffen die Zeile über den Primärschlüssel.
  - **Inserts:** Leere Zellen neuer Zeilen fallen weg (Standardwerte greifen), gesetztes NULL wird NULL.
  - Trifft eine Anweisung keine Zeile (fremd geändert oder gelöscht), bricht die Transaktion mit klarer Meldung ab.
  - Bei jedem Fehler Rollback und Meldung der Datenbank; der Änderungssatz bleibt offen.
  - Nach Erfolg lädt die Seite neu. Das Speichern erscheint als Fortschritt in der Statusleiste.
  - „Revert“ verwirft den Änderungssatz.
  - Seitenwechsel, Sortierung, Filter oder Schliessen des Tabs mit offenen Änderungen fragt nach (Rückfrage aus Ticket 03).

## Akzeptanzkriterien

- [ ] Langsamer Testlauf gegen embedded-postgres:
  - Seiten mit Standardsortierung nach Primärschlüssel, Sortierung, Filter, ungültiger Filter.
  - Update, Insert (mit Standardwert, mit Identitätsspalte, mit ausdrücklichem NULL) und Delete in einer Transaktion.
  - Ein Fehler (etwa verletzter Fremdschlüssel) rollt alles zurück, der Änderungssatz bleibt.
  - Eine inzwischen fremd geänderte Zelle (gleiche Spalte) und eine inzwischen gelöschte Zeile brechen das Speichern ab.
  - Schreibschutz für eine Tabelle ohne Primärschlüssel und für eine View.
  - Verlustfreie Werte für numeric mit vielen Stellen, bigint über 2^53, timestamptz, json und jsonb, auch als ursprüngliche Werte im Vergleich.
  - bytea erscheint als Länge.
- [ ] Playwright-Tests:
  - Tabelle öffnen, mehrere Zellen in mehreren Zeilen ändern, eine Zeile hinzufügen, eine löschen, „Submit“ → nach dem Neuladen ist alles da.
  - Eine Änderung mit „Revert“ verwerfen.
  - Mit offener Änderung die Seite wechseln → Rückfrage.
  - Während des Speicherns zeigt die Statusleiste Fortschritt.

## Abnahme von Hand

- [ ] Eine grosse Tabelle (über 100'000 Zeilen) öffnet schnell, Blättern und Sortieren sind flüssig.
