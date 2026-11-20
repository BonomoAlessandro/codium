# 01 – Kern-Gerüst, Ports, Zustand und Testläufe

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: –
User Stories: Grundlage für alle
Spezifikation: „Architektur im Überblick“, „Vertrag zwischen Oberfläche und Kern“, „Fenster, Projekte und gespeicherter Zustand“ (Zustände und Schemaversion), „Testentscheidungen“ (vollständig, inklusive „Testmodus der App“)

## Was gebaut wird

Das Fundament für alle weiteren Tickets. Für den Nutzer ändert sich fast nichts: Es öffnet sich weiterhin ein Fenster, aber hinter ihm steht der neue Kern.

- **App-Kern und Projekt-Kern** als Module im Hauptprozess ohne direkte Abhängigkeit von Electron. Der Projekt-Kern ist vorerst leer und bekommt seine Dienste in späteren Tickets. Er hat aber schon den Lebenszyklus „erzeugen beim Öffnen, geordnet und asynchron abbauen beim Schliessen“.
- **Alle fünf Ports vollständig**, jeweils mit echter Umsetzung, Testmodus-Verhalten und nachgemachter Umsetzung für Tests:
  - Fenster: öffnen, nach vorne holen, schliessen, Lage, angeschlossene Bildschirme.
  - Ordnerauswahl: im Testmodus über `CODIUM_TEST_PICK_DIR`.
  - Geheimnisse: Verschlüsselung von Windows über Electron.
  - Shell-Aktionen: Papierkorb, Explorer, Zwischenablage; im Testmodus aufgezeichnet bzw. als Ordner.
  - System: Umgebung, Programmsuche, Benutzerordner, Ordner lesen. Die echte Umsetzung kommt ohne Electron aus und funktioniert auch im langsamen Testlauf. `CODIUM_TEST_NO_GIT=1` lässt sie Git als fehlend melden.
- **Vertrag:** Der bestehende Vertrag wird so erweitert, dass er Befehle mit Antwort und Ereignisse vom Kern an genau ein Fenster trägt. Jede Anfrage ist dem Fenster bzw. Projekt-Kern zugeordnet, von dem sie kommt.
- **Gespeicherter Zustand:**
  - App-Zustand und Projekt-Zustand mit Schemaversion 1 im Datenordner, entprellt und atomar geschrieben.
  - Eine kaputte Datei wird beiseitegelegt statt überschrieben.
  - Der Projekt-Zustand liegt unter einem aus dem normalisierten Projektpfad abgeleiteten Namen.
- **Testmodus:** `CODIUM_TEST_HIDDEN`, `CODIUM_TEST_DATA_DIR`, `CODIUM_TEST_PICK_DIR`, `CODIUM_TEST_NO_GIT` wie in den Spielregeln. Die Aufzeichnung (nach vorne geholt, Explorer, externe Programme, Zwischenablage) liegt im Hauptprozess und ist für Playwright über die Auswertung im Hauptprozess lesbar.
- **Testläufe:**
  - `npm test`: schnell, Vitest wie bisher, mit Electron-Sperre.
  - `npm run test:slow`: eigener Vitest-Lauf, vorerst mit einem Platzhaltertest.
  - `npm run test:ui`: Playwright mit eigener Konfiguration ohne Electron-Sperre. Startet `dist/` mit dem Electron aus den Entwicklungsabhängigkeiten im Testmodus; `playwright-core` genügt, es werden keine Browser heruntergeladen.
  - `npm run test:packaged`: Prüfskript gegen `release/win-unpacked` ohne Fenster, vorerst mit einer Platzhalterprüfung.
- **Testgerüst:**
  - Temp-Ordner, Kern mit nachgemachten Ports, Neustart-Simulation (neuer App-Kern auf demselben Datenordner).
  - Hilfen für Temp-Git-Repositories mit Bare-Remote und abgeschirmter Git-Konfiguration.
  - Hilfe zum Start der App mit Playwright, die die Testmodus-Variablen erzwingt, cmd als Shell einstellt und die Git-Konfiguration abschirmt.
  - Ein von Git ausgenommener Test-Zwischenspeicher im Projekt.

## Akzeptanzkriterien

- [ ] `npm test`, `npm run test:slow`, `npm run test:ui`, `npm run test:packaged` und `npm run typecheck` laufen grün.
- [ ] Der App-Kern lässt sich in Node ohne Electron mit nachgemachten Ports erzeugen. Die Electron-Sperre in `npm test` greift weiterhin.
- [ ] Kern-Tests:
  - App-Zustand und Projekt-Zustand überstehen einen simulierten Neustart.
  - Eine kaputte Zustandsdatei wird beiseitegelegt; der Kern startet mit leerem Zustand.
  - Gleiche Projektpfade mit unterschiedlicher Schreibweise (Gross-/Kleinschreibung, Schrägstriche, abschliessender Trenner) ergeben denselben Projekt-Zustand.
  - Ein Projekt-Kern wird beim Abbau benachrichtigt und kann asynchrone Aufräumarbeiten abschliessen, bevor er verschwindet.
- [ ] Die echte System-Umsetzung findet im langsamen Lauf Git und den Benutzerordner. Mit `CODIUM_TEST_NO_GIT=1` meldet sie Git als fehlend.
- [ ] Das Testgerüst legt ein Temp-Repository mit Bare-Remote an. Ein Test zeigt, dass die globale Git-Konfiguration des Rechners nicht hineinwirkt.
- [ ] Ein Playwright-Test startet die App im Testmodus, findet das Fenster, liest die Aufzeichnung des Hauptprozesses und beendet die App wieder. Ohne `CODIUM_TEST_HIDDEN` und `CODIUM_TEST_DATA_DIR` verweigert die Starthilfe den Start.
- [ ] `npm start` verwendet weiterhin den Datenordner „Codium-dev“.

## Abnahme von Hand

- [ ] `npm start` öffnet wie bisher ein Fenster; es erscheint nichts Unerwartetes.

## Hinweise

- Vorlage sind Ports und Testmodus von THub (Fundstellen im Ticket-README).
- Der Vertrag soll so angelegt sein, dass spätere Tickets Befehle und Ereignisse ergänzen, ohne die Grundmechanik zu ändern.
