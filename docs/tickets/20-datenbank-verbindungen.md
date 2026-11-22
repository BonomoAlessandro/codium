# 20 – Datenbank: Verbindungen und Baum

Status: `erledigt` (2026-11-22, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
Blockiert durch: 03
User Stories: 19 (mit Inhalt), 152–159
Spezifikation: „Datenbank“ (Treiber, Verbindungen, SSL, Pool, Baum), „Präzisierungen beim Schreiben“ Punkt 12

## Was gebaut wird

- **Datenbank-Dienst** im Projekt-Kern mit node-postgres. Werte werden in ihrer Textdarstellung übertragen, ohne Umwandlung in JavaScript-Zahlen oder -Daten.
- **Verbindungen** im Projekt-Zustand:
  - Felder: Name, Host, Port (Standard 5432), Datenbank, Benutzer, SSL ja/nein, „Ask for password every time“, das Passwort verschlüsselt über den Port „Geheimnisse“.
  - Ein abgefragtes Passwort bleibt nur bis zum Schliessen des Fensters im Arbeitsspeicher.
  - SSL „ja“ verbindet verschlüsselt ohne Zertifikatsprüfung.
  - Pro Verbindung ein kleiner Pool, beim Abbau des Projekt-Kerns abgebaut.
- **Werkzeugfenster „Database“:**
  - „+“ legt eine Verbindung an; Dialog mit „Test Connection“.
  - Rechtsklick: „Edit…“, „Delete“ (mit Rückfrage), „Refresh“.
  - Baum: Verbindung, darunter die konfigurierte Datenbank, darunter die Schemas (ohne Systemschemas), darin Tabellen und Views, darin die Spalten mit Typ, Nullbarkeit und Primärschlüssel. Geladen beim Aufklappen.
  - Verbindungsfehler erscheinen als Fehlerhinweis mit der Meldung der Datenbank.
- **embedded-postgres** als neue Entwicklungsabhängigkeit, mit einer Testhilfe, die den Server auf einem freien Zufallsport startet (nie 5432) und danach stoppt.

## Akzeptanzkriterien

- [x] Langsamer Testlauf gegen embedded-postgres:
  - Verbindung testen (gültig und ungültig).
  - Baum mit Schemas, Tabellen, Views und Spalten samt Primärschlüssel und Nullbarkeit; Systemschemas fehlen.
  - Ein gespeichertes Passwort liegt nur verschlüsselt im Projekt-Zustand (nachgemachter Port); „Ask for password every time“ speichert keines.
  - Verbindungen überstehen einen Neustart und gehören nur zu ihrem Projekt.
  - Der Abbau des Projekt-Kerns baut die Pools ab.
  - Nach den Tests läuft kein PostgreSQL-Prozess mehr.
- [x] Playwright-Test: Verbindung anlegen, Baum aufklappen, eine Tabelle mit ihren Spalten erscheint.

## Abnahme von Hand

- [ ] Verbindung zu einer echten PostgreSQL-Datenbank mit SSL.
- [ ] Nach einem Neustart verbindet Codium ohne erneute Passworteingabe; mit „Ask for password every time“ wird gefragt.

## Umsetzung

- Abhängigkeiten: `pg` 8.23.1 (Laufzeit, im Hauptprozess gebündelt; `pg-native` bleibt aussen vor) und `embedded-postgres` 18.6.0-beta.19 (nur Tests; bewusst nicht die drei Tage alte 18.7).
- Ohne Verschlüsselung (Port „Geheimnisse“ nicht verfügbar) speichert Codium kein Passwort, sondern rät zu „Ask for password every time“.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-22. Parameter in allen Abfragen des Baums, kein Passwort an die Oberfläche (nur `hasPassword`), kein gespeichertes Passwort mit „Ask for password every time“, Fehlerereignisse der Pools, Systemschemas und Primärschlüssel, Werte als Text und die Testabdeckung der Akzeptanzkriterien in Ordnung. Eingearbeitet:

- **Absturz des Hauptprozesses möglich:** Der Client von „Test Connection“ hatte keinen Empfänger für Fehlerereignisse (Abbruch der Verbindung nach dem Verbinden). Jetzt abgefangen.
- **Passwort an den falschen Host:** Ein abgefragtes Passwort überlebte eine Änderung von Host oder Benutzer. Jetzt verwirft jedes Speichern es. Langsamer Test dazu.
- **PGPASSWORD und pgpass des Nutzers:** Ohne Passwort nahm node-postgres diese und schickte sie an den eingegebenen Host. Jetzt immer ein ausdrückliches (auch leeres) Passwort. Langsamer Test dazu.
- **„Test Connection“ mit „Ask for password every time“** ging nicht (Feld gesperrt). Jetzt nimmt das Feld ein Passwort nur für den Test an, gespeichert wird es nie. Test dazu.
- **Pools konnten liegen bleiben** (gleichzeitige erste Anfragen, Schliessen oder Bearbeiten während des Entschlüsselns). Jetzt ein Pool je Verbindung als Versprechen mit Generation; ein veralteter wird gleich beendet. Test dazu.
- **Baum:** Nach dem Bearbeiten stand der alte Datenbankname im Ast; ein Fehler beim Übergeben des Passworts liess einen Knoten für immer „laden“; „Refresh“ während eines Ladens ging verloren; gleichzeitige Anfragen fragten mehrmals nach dem Passwort. Alles behoben (Reihenfolge, try/finally, Zähler je Knoten, eine Abfrage je Verbindung).
- **Gespeichertes Passwort entfernen:** „Remove saved password“ im Dialog.
- **Testhilfe:** Scheitert die Vorbereitung, bleibt kein Server liegen; die Prüfung auf Prozesse nimmt den echten Pfad, den Port und die Kindprozesse und prüft sich selbst am laufenden Server.

Bewusst so gelassen: Beendet ein Verbindungsfehler den Pool, scheitern Anfragen, die ihn gerade benutzen, mit der Meldung von node-postgres (beim nächsten Versuch entsteht ein neuer Pool). Der freie Port wird vor dem Start von PostgreSQL wieder freigegeben (nur ein kleines Risiko für Tests); 5432 ist ausgeschlossen. SSL prüft die Abnahme von Hand.
