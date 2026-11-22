# 21 – Datenbank: Tabelleninhalt und Bearbeiten

Status: `erledigt` (2026-11-22, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
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

- [x] Langsamer Testlauf gegen embedded-postgres:
  - Seiten mit Standardsortierung nach Primärschlüssel, Sortierung, Filter, ungültiger Filter.
  - Update, Insert (mit Standardwert, mit Identitätsspalte, mit ausdrücklichem NULL) und Delete in einer Transaktion.
  - Ein Fehler (etwa verletzter Fremdschlüssel) rollt alles zurück, der Änderungssatz bleibt.
  - Eine inzwischen fremd geänderte Zelle (gleiche Spalte) und eine inzwischen gelöschte Zeile brechen das Speichern ab.
  - Schreibschutz für eine Tabelle ohne Primärschlüssel und für eine View.
  - Verlustfreie Werte für numeric mit vielen Stellen, bigint über 2^53, timestamptz, json und jsonb, auch als ursprüngliche Werte im Vergleich.
  - bytea erscheint als Länge.
- [x] Playwright-Tests:
  - Tabelle öffnen, mehrere Zellen in mehreren Zeilen ändern, eine Zeile hinzufügen, eine löschen, „Submit“ → nach dem Neuladen ist alles da.
  - Eine Änderung mit „Revert“ verwerfen.
  - Mit offener Änderung die Seite wechseln → Rückfrage.
  - Während des Speicherns zeigt die Statusleiste Fortschritt.

## Abnahme von Hand

- [ ] Eine grosse Tabelle (über 100'000 Zeilen) öffnet schnell, Blättern und Sortieren sind flüssig.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-22. Bezeichner in Anführungszeichen, Sortierspalte aus der Spaltenliste, Werte immer als Parameter, Transaktion mit Rollback bei jedem Fehler (auch „keine Zeile getroffen“) und Freigabe des Clients, Reihenfolge Updates–Deletes–Inserts, Änderungen an gelöschten Zeilen und am Primärschlüssel, `DEFAULT VALUES`, ausdrückliches NULL, verlustfreie Werte, Schutz vor veralteten Antworten beim Blättern und die Rückfrage beim Schliessen in Ordnung. Eingearbeitet:

- **Ctrl + Enter während der Eingabe verlor sie** (oder speichert die anderen und verwarf sie danach still). Der Änderungssatz liegt jetzt zusätzlich in einem sofort aktuellen Ref. UI-Test dazu.
- **Falsche Zeile geändert:** Während eine Seite lud, liess sich die alte bearbeiten; die Änderung hing dann an der Zeile gleicher Nummer der neuen Seite. Jetzt ist Bearbeiten während des Ladens gesperrt.
- **Aus NULL wurde leerer Text** schon durch Doppelklick und Verlassen (bzw. „Open Editor“ und OK). Übernommen wird jetzt nur, was getippt wurde; Escape bricht sicher ab. UI-Test dazu.
- **Mehrzeilige Werte:** Das einzeilige Feld hätte die Zeilenumbrüche verloren; solche Werte öffnen jetzt das grosse Feld.
- **char(n):** Jedes Update scheiterte (der geladene Wert hat Füllzeichen, `::text` nicht). Diese Spalten vergleichen jetzt im eigenen Typ. Langsamer Test dazu.
- **Tabs verwechselt:** „Users“ und „users“ (und „a.b“ + „c“ gegen „a“ + „b.c“) ergaben denselben Tab. Jetzt eindeutige Schlüssel.
- **Binärer Primärschlüssel:** wurde über die Länge getroffen; solche Tabellen sind jetzt schreibgeschützt. **Domänen** über bytea und json zählen wie ihr Basistyp. Test dazu.
- **json sortieren** schlug fehl (kein Ordnungsoperator); jetzt nach dem Text. **Filter mit „;“** gibt eine klare Meldung statt eines Absturzes der Anfrage. Ein **fehlerhafter Filter** lässt sich mit Enter erneut versuchen. **Ctrl + Enter im grossen Feld** löst kein „Submit“ der Tabelle mehr aus.

Bewusst so gelassen (in der Liste offener Punkte): Sehr grosse Werte (etwa Megabyte-JSON) kommen pro Seite vollständig in die Oberfläche, und die Zeilen werden beim Tippen ohne Memoisierung neu gezeichnet; das Schliessen des ganzen Fensters fragt nicht nach offenen Änderungssätzen (nur das Schliessen des Tabs).
