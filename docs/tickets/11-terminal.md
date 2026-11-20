# 11 – Terminal

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: 06, 09
User Stories: 18 (Terminal), 21 (Alt + F12 mit Inhalt), 34 („Open in Terminal“), 145–151, 172 (Feld „Terminal shell“)
Spezifikation: „Terminal“, „Oberfläche“ (Tastenkürzel im Terminal), „Auslieferung und Abhängigkeiten“ (node-pty), „Präzisierungen beim Schreiben“ Punkt 30

## Was gebaut wird

- **Terminal-Dienst** im Projekt-Kern mit node-pty, technisch wie in THub (Fundstelle im Ticket-README). Die Oberfläche zeigt die Terminals mit xterm.js im Werkzeugfenster „Terminal“.
- **Shells erkennen:** PowerShell 7, Windows PowerShell, cmd, Git Bash. Standard PowerShell 7, sonst Windows PowerShell. Feld „Terminal shell“ im Einstellungsdialog mit den gefundenen Shells. Profile werden normal geladen.
- **Tabs:** „+“ öffnet ein weiteres Terminal; Tabs heissen „Local“, „Local (2)“ usw. und lassen sich per Doppelklick umbenennen. Schliessen beendet die Shell samt Prozessbaum.
- **Ordner:**
  - Ein neues Terminal startet im Projektordner.
  - „Open in Terminal“ im Dateibaum öffnet ein Terminal im gewählten Ordner bzw. im Ordner der gewählten Datei und zeigt das Werkzeugfenster.
  - Beim ersten Öffnen des leeren Werkzeugfensters startet automatisch ein Terminal.
- **Tasten:** Im Terminal gehören alle Tasten der Shell, ausser der Liste aus der zentralen Tastenbelegung (Ticket 06). Esc bleibt bei der Shell.
- **Grösse:** Das Terminal passt sich der Grösse des Werkzeugfensters an.
- **Lebensdauer:** Beim Abbau des Projekt-Kerns beendet der Dienst alle Shells. Nach einem Neustart werden Terminals nicht wiederhergestellt.
- **Auslieferung:** node-pty ausserhalb des App-Archivs wie in THub. Klären, ob für `npm install` ein C++-Compiler nötig ist, und das Ergebnis im README unter „Zum Entwickeln“ eintragen.

## Akzeptanzkriterien

- [ ] Langsamer Testlauf mit echtem node-pty:
  - Jede gefundene Shell startet im Projektordner und in einem Unterordner mit Leerzeichen und Umlauten; eine Ausgabe kommt an.
  - Schliessen beendet die Shell und einen von ihr gestarteten Kindprozess.
  - Abbau des Projekt-Kerns beendet alle Shells.
  - Für PowerShell sind `APPDATA` und `USERPROFILE` im Test auf Temp-Ordner umgeleitet.
- [ ] Kern-Tests: Shell-Erkennung mit nachgemachtem System; Standard ist PowerShell 7, ohne sie Windows PowerShell; die eingestellte Shell wird verwendet.
- [ ] Playwright-Tests (cmd als eingestellte Shell):
  - Werkzeugfenster „Terminal“ öffnen, `echo` ausführen, die Ausgabe erscheint.
  - „Open in Terminal“ im Baum öffnet ein zweites Terminal im richtigen Ordner.
  - Ctrl + R und Esc im Terminal lösen keine IDE-Aktion aus; Alt + 1 wechselt zum Werkzeugfenster „Project“.
- [ ] `npm run test:packaged` lädt node-pty im ungepackten Paket.
- [ ] Das README sagt unter „Zum Entwickeln“ eindeutig, ob ein C++-Compiler nötig ist.

## Abnahme von Hand

- [ ] PowerShell 7 mit dem eigenen Profil: Prompt, Farben und Aliase wie gewohnt.
- [ ] Einen Dev-Server starten, Terminal-Tab schliessen: Der Server ist beendet.
- [ ] Werkzeugfenster in der Grösse ziehen: Das Terminal passt sich an, ohne Zeichensalat.
- [ ] Claude Code im Terminal starten: Esc und Ctrl-Kürzel kommen bei Claude an.
