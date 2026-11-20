# 22 – README und Abnahme auf einem frischen Rechner

Status: `ready-for-human` · Typ: HITL
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
- **Gesammelte Prüfliste:** Alle Punkte „Abnahme von Hand“ der Tickets 01 bis 21 nach Bereichen geordnet in `docs/abnahme.md`.
- **Installer bauen** und auf einem zweiten Rechner oder unter einem frischen Windows-Benutzer ohne Codium-Daten prüfen.

## Akzeptanzkriterien

- [ ] Das README ist aktuell und beschreibt das tatsächliche Verhalten.
- [ ] `docs/abnahme.md` enthält alle Prüfpunkte der Tickets 01 bis 21.

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
