# 11 – Terminal

Status: `erledigt` (2026-11-22, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
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

- [x] Langsamer Testlauf mit echtem node-pty:
  - Jede gefundene Shell startet im Projektordner und in einem Unterordner mit Leerzeichen und Umlauten; eine Ausgabe kommt an.
  - Schliessen beendet die Shell und einen von ihr gestarteten Kindprozess.
  - Abbau des Projekt-Kerns beendet alle Shells.
  - Für PowerShell sind `APPDATA` und `USERPROFILE` im Test auf Temp-Ordner umgeleitet.
- [x] Kern-Tests: Shell-Erkennung mit nachgemachtem System; Standard ist PowerShell 7, ohne sie Windows PowerShell; die eingestellte Shell wird verwendet.
- [x] Playwright-Tests (cmd als eingestellte Shell):
  - Werkzeugfenster „Terminal“ öffnen, `echo` ausführen, die Ausgabe erscheint.
  - „Open in Terminal“ im Baum öffnet ein zweites Terminal im richtigen Ordner.
  - Ctrl + R und Esc im Terminal lösen keine IDE-Aktion aus; Alt + 1 wechselt zum Werkzeugfenster „Project“.
- [x] `npm run test:packaged` lädt node-pty im ungepackten Paket.
- [x] Das README sagt unter „Zum Entwickeln“ eindeutig, ob ein C++-Compiler nötig ist.

## Abnahme von Hand

- [ ] PowerShell 7 mit dem eigenen Profil: Prompt, Farben und Aliase wie gewohnt.
- [ ] Einen Dev-Server starten, Terminal-Tab schliessen: Der Server ist beendet.
- [ ] Werkzeugfenster in der Grösse ziehen: Das Terminal passt sich an, ohne Zeichensalat.
- [ ] Claude Code im Terminal starten: Esc und Ctrl-Kürzel kommen bei Claude an.

## Klärung C++-Compiler

node-pty 1.1.0 bringt fertige Binärdateien für Windows x64 und arm64 mit (`prebuilds`); `npm ci` kompiliert nichts. Eingetragen im README unter „Zum Entwickeln“.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-22. Prüfung des Startordners, Schliessen samt Kind- und Enkelprozessen, Abbau, Ausgabe vor bekannter Kennung, Tasten im Terminal (nur die globalen Kürzel wirken, Esc kommt bei der Shell an), Umgebung der Shell, Abschirmung im langsamen Test, Erkennung und Einstellung der Shells, ConPTY wie in THub, Paketierung und README in Ordnung. Eingearbeitet:

- **„Open in Terminal“ als erste Aktion startete im Projektordner** (nachgewiesen; das Werkzeugfenster war noch nicht eingehängt): Der Ordner wird gemerkt und vom ersten Terminal übernommen; Playwright-Test mit „Open in Terminal“ als allererster Aktion.
- **Endete die letzte Shell im Hintergrund, schloss sich etwa „Git“** (nachgewiesen): Das Werkzeugfenster verschwindet nur, wenn das Terminal das sichtbare ist; Playwright-Test.
- **Nach `exit` blieben Worker-Thread und (ConPTY von Windows) conhost.exe** (nachgewiesen): Der Worker wird freigegeben, der Konsolen-Host wie in THub beim Start ermittelt und nach dem Ende beendet. Langsamer Test für beide ConPTY-Wege (der von Windows lässt sich für Tests einstellen), Gegenprobe rot.
- **Tests prüften zu wenig:** Esc kommt nachweislich bei cmd an (leert die Zeile), Ctrl + F4 schliesst im Terminal keinen Editor-Tab, Schliessen und Abbau prüfen auch die Shell selbst und dass keine Pseudokonsole bleibt, das Feld „Terminal shell“ hat einen Playwright-Test.
- **PSModulePath** wie in THub: auch Ordner neben einem pwsh.exe (7-preview, Store).
- **Git Bash** auch bei einer Installation nur für den Benutzer und bei Scoop.
- **Paket:** node-pty ohne macOS- und arm64-Binärdateien, Quellen und Symboldateien (9,8 MB → 4 MB); viele Terminal-Tabs lassen sich waagrecht blättern; doppeltes Entfernen eines Tabs abgesichert.
- **Schliessen direkt nach dem Start dauert gut 3 s** (die mitgelieferte ConPTY wartet auf die Antwort des Terminals): hingenommen; der Tab schliesst sofort, nur der Kern wartet.
- **Bekannt, nicht geändert:** Dass `terminal.start` die eingestellte Shell nimmt, prüft nur der langsame Lauf (node-pty ist kein Port und läuft nicht im schnellen Lauf). PowerShell 7 ist auf dem Rechner nicht installiert und deshalb nicht live geprüft.
