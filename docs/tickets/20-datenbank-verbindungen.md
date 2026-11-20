# 20 – Datenbank: Verbindungen und Baum

Status: `ready-for-agent` · Typ: AFK
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

- [ ] Langsamer Testlauf gegen embedded-postgres:
  - Verbindung testen (gültig und ungültig).
  - Baum mit Schemas, Tabellen, Views und Spalten samt Primärschlüssel und Nullbarkeit; Systemschemas fehlen.
  - Ein gespeichertes Passwort liegt nur verschlüsselt im Projekt-Zustand (nachgemachter Port); „Ask for password every time“ speichert keines.
  - Verbindungen überstehen einen Neustart und gehören nur zu ihrem Projekt.
  - Der Abbau des Projekt-Kerns baut die Pools ab.
  - Nach den Tests läuft kein PostgreSQL-Prozess mehr.
- [ ] Playwright-Test: Verbindung anlegen, Baum aufklappen, eine Tabelle mit ihren Spalten erscheint.

## Abnahme von Hand

- [ ] Verbindung zu einer echten PostgreSQL-Datenbank mit SSL.
- [ ] Nach einem Neustart verbindet Codium ohne erneute Passworteingabe; mit „Ask for password every time“ wird gefragt.
