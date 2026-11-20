# 10 – Repository klonen

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: 09
User Stories: 6, 7 („Clone Repository“)
Spezifikation: „Fenster, Projekte und gespeicherter Zustand“ (Klonen), „Git“ (Grundsätze zum Aufruf von Git)

## Was gebaut wird

- **„Clone Repository“** im Willkommensfenster und im Projektmenü.
- **Dialog** mit URL und Zielordner:
  - Vorschlag für den Zielordner: der Ordnername aus der URL unter dem zuletzt gewählten Elternordner (im App-Zustand gemerkt).
  - Ein bestehender, nicht leerer Zielordner wird abgelehnt.
- **Klonen** über das installierte Git mit Fortschritt im Dialog bzw. in der Statusleiste:
  - Git ohne Editor und ohne Eingabeaufforderung im Terminal (Grundsätze der Spezifikation); die Anmeldung läuft über die eingerichteten Helfer.
  - Nach Erfolg öffnet sich das Projekt in einem neuen Fenster und landet in den zuletzt geöffneten Projekten.
  - Fehler zeigen die Meldung von Git im Wortlaut. Ein halb angelegter Zielordner wird entfernt.
- Ohne Git (Ticket 09) ist „Clone Repository“ inaktiv, mit Erklärung beim Überfahren.

## Akzeptanzkriterien

- [ ] Kern-Tests mit einem lokalen Bare-Repository als Quelle:
  - Klonen legt den Ordner an und öffnet das Projekt.
  - Ein nicht leerer Zielordner wird abgelehnt.
  - Ein nicht vorhandener lokaler Pfad als Quelle liefert die Meldung von Git und hinterlässt keinen Ordner.
- [ ] Einheitstest der reinen Funktion für den Ordnernamen: HTTPS-URLs mit und ohne `.git`-Endung, SSH-Form (`git@host:pfad/name.git`), abschliessender Schrägstrich.
- [ ] Playwright-Test: Klonen aus dem Willkommensfenster mit einem lokalen Bare-Repository öffnet ein Projektfenster.

## Abnahme von Hand

- [ ] Ein echtes Repository (etwa von Bitbucket) über HTTPS klonen: Die Anmeldung über den Git Credential Manager erscheint und funktioniert.
