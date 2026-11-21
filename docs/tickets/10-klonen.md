# 10 – Repository klonen

Status: `erledigt` (2026-11-22, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
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

- [x] Kern-Tests mit einem lokalen Bare-Repository als Quelle:
  - Klonen legt den Ordner an und öffnet das Projekt.
  - Ein nicht leerer Zielordner wird abgelehnt.
  - Ein nicht vorhandener lokaler Pfad als Quelle liefert die Meldung von Git und hinterlässt keinen Ordner.
- [x] Einheitstest der reinen Funktion für den Ordnernamen: HTTPS-URLs mit und ohne `.git`-Endung, SSH-Form (`git@host:pfad/name.git`), abschliessender Schrägstrich.
- [x] Playwright-Test: Klonen aus dem Willkommensfenster mit einem lokalen Bare-Repository öffnet ein Projektfenster.

## Abnahme von Hand

- [ ] Ein echtes Repository (etwa von Bitbucket) über HTTPS klonen: Die Anmeldung über den Git Credential Manager erscheint und funktioniert.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-22. Aufruf von Git (`--` vor URL und Ziel, `ext::` standardmässig abgelehnt, kein Editor, keine Eingabeaufforderung, Helfer unberührt), Abschirmung in den Tests, Fortschritt, Öffnen danach, Vorschlag des Zielordners, Dialog und der Zustand ohne Git in Ordnung. Eingearbeitet:

- **Aufräumen löschte fremde Ordner** (nachgewiesen, auch bei zwei Klonen ins selbe Ziel): Codium legt Zielordner und fehlende Elternordner selbst an (`mkdir` ohne `recursive`) und entfernt nach einem Fehler nur diese; ein Ordner, den es vorher gab oder den ein anderer Vorgang anlegte, bleibt. Ein zweiter Klon ins selbe Ziel wird abgelehnt (`FILE_EXISTS`).
- **Git lief nach dem Beenden verwaist weiter** (nachgewiesen): Laufende Klone kennt der App-Kern; Beenden bricht sie ab und beendet Git samt Kindprozessen (`taskkill /T`). „Cancel“ (und Escape) bricht einen laufenden Klon ab (`app.cancelClone`).
- **Tests prüften das eigene Aufräumen nicht** (Mutation blieb grün): Kern-Tests mit einer hängenden Quelle (`ext::`, nur im Test erlaubt) für Abbruch und Beenden, dazu tiefe Elternordner und ein Playwright-Test für „Cancel“.
- **Leere Elternordner blieben nach einem Fehler stehen:** werden mit entfernt.
- **Kein Fokus nach einem Fehler:** Der Fokus kommt in die Adresse zurück (Inhalt markiert).
- **Falsche Meldung bei einer Datei als Ziel:** „… exists and is not a folder.“
