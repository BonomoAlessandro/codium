# 22 – README und Abnahme auf einem frischen Rechner

Status: `erledigt` (2026-11-23) · Typ: HITL
Blockiert durch: alle anderen Tickets
User Stories: 179–181, sowie alle als Abnahme
Spezifikation: „Auslieferung und Abhängigkeiten“, „Weitere Hinweise“

## Was gebaut wird

- **README neu schreiben:**
  - Umfang von Codium 1, Bedienung und Tastenkürzel.
  - Aufbau: App-Kern, Projekt-Kern mit Diensten, Ports, Vertrag, Oberfläche.
  - Tests: die vier Testläufe und ihre Voraussetzungen (JDK 25 und Netz für die Java-Tests).
  - Entwicklung inklusive eigenem Datenordner und Testmodus.
  - Voraussetzungen aktuell, inklusive der Antwort zum C++-Compiler aus Ticket 11.
  - Die „Offenen Punkte“ verschwinden; was bewusst nicht dabei ist, steht als kurzer Abschnitt mit Verweis auf die Spezifikation.
- **Gesammelte Prüfliste:** Alle Punkte „Abnahme von Hand“ der Tickets 01 bis 21 und 23 nach Bereichen geordnet in `docs/abnahme.md`.
- **Installer bauen** und auf einem zweiten Rechner oder unter einem frischen Windows-Benutzer ohne Codium-Daten prüfen.

## Akzeptanzkriterien

- [x] Das README ist aktuell und beschreibt das tatsächliche Verhalten.
- [x] `docs/abnahme.md` enthält alle Prüfpunkte der Tickets 01 bis 21 und 23.

## Abnahme von Hand

- [ ] Die Prüflisten „Abnahme von Hand“ aller Tickets sind durchgeklickt; Abweichungen sind als neue Tickets erfasst.
- [ ] Auf dem frischen Rechner bzw. Benutzer, mit Git und JDK 25 nach README:
  - Installation über den Installer ohne weitere Einrichtung.
  - Ein Java- (Maven) und ein TypeScript-Projekt öffnen: Ctrl + Linksklick funktioniert in beiden.
  - Git-Funktionen gegen ein echtes Remote.
  - Terminal mit PowerShell 7 bzw. Windows PowerShell.
  - Verbindung zu einer PostgreSQL-Datenbank.
- [ ] Ohne JDK 25: Codium startet ohne Fehler, der JDK-Hinweis erscheint erst bei einem Java-Projekt, alles andere funktioniert.
- [ ] Ohne Git: Hinweis „Git not found“, alles ausser Git funktioniert.
- [ ] Gefundene Fehler sind als neue Tickets erfasst.

## Umsetzung (Agent, 2026-11-22)

- README neu geschrieben: Umfang, Tastenkürzel (aus der zentralen Tastenbelegung), Voraussetzungen samt C++-Compiler und PostgreSQL, Installieren, Entwicklung mit eigenem Datenordner und Testmodus, die vier Testläufe, Aufbau, „Bewusst nicht dabei“ mit Verweis auf die Spezifikation. Die „Offenen Punkte“ sind weg.
- `docs/abnahme.md` per Skript aus den Abschnitten „Abnahme von Hand“ erzeugt (96 Punkte aus den Tickets 01 bis 21 und 23, nach Bereichen, mit Herkunft) und um die Prüfung auf dem frischen Rechner ergänzt.
- Installer gebaut: `releaseCodium Setup 0.1.0.exe` (rund 189 MB, nicht signiert, noch mit dem Standard-Symbol von Electron); die Prüfungen am Paket bestehen.
- Offen ist die Abnahme von Hand durch den Nutzer.

## Entscheidung (Nutzer, 2026-11-23)

Der Nutzer schliesst das Ticket ab, ohne die Prüfliste vorher gesammelt durchzuklicken. Er prüft Codium im Alltag und erfasst Abweichungen als neue Tickets. Die Punkte unter „Abnahme von Hand“ oben und in `docs/abnahme.md` bleiben deshalb unabgehakt; sie dienen weiter als Prüfliste.
