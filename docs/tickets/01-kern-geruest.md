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

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-20 (20 Befunde). Eingearbeitet:

- **Beenden während eines Abbaus:** Der App-Kern hält laufende Abbauten fest; Beenden wartet auf sie, auch wenn das letzte Fenster den Abbau schon gestartet hat.
- **Wiederöffnen während eines Abbaus:** Das Öffnen eines Projekts wartet auf den laufenden Abbau desselben Projekts und liest so den zuletzt gesicherten Stand. Der Abbau schreibt den Zustand gleich zu Beginn.
- **Fenster-Port für Ticket 02:** Meldung „geschlossen“ mit letzter Lage (im Testmodus ohne), „Fokus bekommen“, „Seite bereit“ und „Sitzung von Windows beendet“.
- **Zustandsdateien:**
  - Schreibfehler werden gemeldet, ohne zu werfen; der Stand bleibt für den nächsten Versuch vorgemerkt.
  - Vorübergehende Fehler werden einige Male wiederholt.
  - Eine unlesbare Datei und eine Datei einer neueren Version werden nicht überschrieben.
  - Die Felder werden pro Schema geprüft.
- **Aufräumarbeiten** haben ein Zeitlimit (5 s). Wer sich erst während oder nach dem Abbau anmeldet, wird sofort aufgeräumt.
- **Ereignisse vor dem Laden der Seite:** Der Kern hält sie zurück, bis das Fenster bereit ist. Das Preload hat nur noch einen Listener und hält Ereignisse ohne Abonnenten zurück.
- **Testmodus:**
  - Eine nicht abgefangene Ausnahme beendet die App, statt einen Dialog auf dem Desktop zu zeigen. Scheitert der Start, beendet sich die App mit Meldung.
  - Aufgezeichnet wird nur im Testmodus.
- **Lebenszyklus im Kern:** Der App-Kern reagiert selbst auf geschlossene Fenster; das lässt sich an Teststelle 1 testen.
- **Tests:**
  - Der Weg von `CODIUM_TEST_NO_GIT` bis zum System-Port ist getestet.
  - Der Oberflächentest prüft, dass das Fenster auf keinem Bildschirm liegt und keinen Fokus hat.
  - Ein Test durchsucht Kern und System-Port nach Electron.
  - Die Zeitabhängigkeiten sind entschärft.
- **Vertrag:** Fehler tragen einen Code und Daten. Befehle, die ein Projekt brauchen, lehnen ohne Projekt mit `NO_PROJECT` ab. Ereignisse lassen sich auch an Fenster ohne Projekt schicken.
- **Port „Shell-Aktionen“:**
  - Er kann eine Web-Adresse öffnen, im Testmodus nur aufgezeichnet (gebraucht ab Ticket 23).
  - Der Papierkorb im Testmodus vergibt eindeutige Namen.
- **Projektpfade:** Kurznamen wie `ALESSA~1` und Junctions werden zum echten Pfad aufgelöst.
- **Testgerüst:**
  - Die Starthilfe mischt cmd als Shell in einen vorhandenen Zustand und verlangt einen Datenordner im Temp-Ordner.
  - Neu: eine Hilfe für den Test-Zwischenspeicher.
  - `test:packaged` räumt die leeren Download-Ordner von electron-builder weg.

Verworfen bzw. verschoben:

- **Prüfung der Befehlsparameter zur Laufzeit:** Die Oberfläche ist eigener, abgeschotteter Code. Geprüft wird in den Befehlen, die Pfade oder Werte von aussen verarbeiten, sobald es sie gibt (ab Ticket 04).
- **Haken für Migrationen des Zustands:** Es gibt noch kein älteres Schema. Der Schutz einer neueren Datei vor dem Überschreiben ist umgesetzt, Migrationen kommen mit der ersten Schemaänderung.

Beobachtung: Ein einzelner Lauf von `npm run test:ui` hing einmal bis zum Zeitlimit; in sechs weiteren Läufen trat das nicht mehr auf (vermutlich ein langsamer erster Start nach dem Bauen). Falls es wiederkommt, als eigenes Ticket erfassen.
