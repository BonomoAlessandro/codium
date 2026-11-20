# 08 – Dateisuche, zuletzt geöffnete Dateien, Projektsuche und „Find“

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: 05
User Stories: 21 (Alt + 3), 64, 66–73
Spezifikation: „Dateien, Dateiüberwachung und Suche“ (Dateiliste, Dateisuche nach Namen, Zuletzt geöffnete Dateien, Projektsuche), „Oberfläche“ (Werkzeugfenster „Find“), „Auslieferung und Abhängigkeiten“ (ripgrep), „Präzisierungen beim Schreiben“ Punkte 24, 25

## Was gebaut wird

- **ripgrep** aus dem npm-Paket, das VS Code verwendet, ausserhalb des App-Archivs abgelegt, damit es startbar ist.
- **Dateiliste** im Datei-Dienst über ripgrep: alle Dateien inklusive versteckter (ohne `.git`), mit Rücksicht auf `.gitignore` auch ausserhalb eines Git-Repositorys. Die Dateiüberwachung hält sie aktuell. Eine zweite Liste mit ignorierten Dateien wird nur bei Bedarf erstellt.
- **Dateisuche nach Namen** (Ctrl + Shift + N):
  - Unscharfer Vergleich (Buchstabenfolge, Bevorzugung von Wortanfängen und CamelCase).
  - Popup über dem Editor mit Treffern und Pfad, Schalter „include ignored“; Enter öffnet.
- **Zuletzt geöffnete Dateien** (Ctrl + E): Popup mit den zuletzt geöffneten Dateien des Projekts, im Projekt-Zustand gesichert.
- **Projektsuche** (Ctrl + Shift + F) mit ripgrep:
  - Suchfenster über dem Editor mit Suchfeld, Schaltern „Match case“, „Words“, „Regex“, Dateimaske und „include ignored“.
  - Versteckte Dateien werden durchsucht (ohne `.git`); `.gitignore` gilt auch ausserhalb eines Repositorys.
  - Treffer gestreamt schon während des Tippens. Eine neue Eingabe bricht die laufende Suche ab. Abbruch nach 2'000 Treffern mit dem Hinweis „more results“.
  - Vorschau der Fundstelle mit einigen Zeilen davor und danach, in Monaco mit Farben.
  - Enter oder Doppelklick öffnet die Datei an der Fundstelle.
  - „Open in Find Window“ legt die Trefferliste als Reiter in das Werkzeugfenster „Find“.
- **Werkzeugfenster „Find“** unten: erscheint in der unteren Symbolleiste, sobald es einen Reiter gibt, und verschwindet, wenn alle geschlossen sind. Alt + 3 öffnet es. Ticket 12 legt dort auch Verwendungen ab.
- **Kürzel** Ctrl + Shift + N, Ctrl + E, Ctrl + Shift + F in der zentralen Tastenbelegung (bzw. so angelegt, dass Ticket 06 sie übernimmt, falls 06 noch nicht fertig ist).

## Akzeptanzkriterien

- [ ] Kern-Tests im Temp-Ordner:
  - Dateisuche: „UsrSrv“ findet sowohl „UserService.java“ als auch „users_overview.txt“, wobei „UserService.java“ zuerst kommt.
  - Ignorierte Dateien fehlen ohne Schalter und erscheinen mit „include ignored“. Versteckte Dateien wie `.github/workflow.yml` sind enthalten, `.git` nicht.
  - Eine neu angelegte Datei ist nach dem Dateiereignis auffindbar.
  - Projektsuche mit jedem Schalter (Gross-/Kleinschreibung, ganzes Wort, regulärer Ausdruck, Dateimaske), mit und ohne „include ignored“.
  - Ein Ordner ohne Git-Repository mit `.gitignore` → die ignorierten Dateien werden trotzdem ausgelassen.
  - Abbruch nach 2'000 Treffern mit Kennzeichen „mehr“; Abbruch einer laufenden Suche durch eine neue.
  - Zuletzt geöffnete Dateien überstehen einen Neustart.
- [ ] Playwright-Tests:
  - Ctrl + Shift + N, Teil eines Namens tippen, Enter → Datei offen.
  - Ctrl + Shift + F, Text tippen, Treffer doppelklicken → Datei offen, Cursor auf der Fundstelle.
  - „Open in Find Window“ → das Werkzeugfenster „Find“ erscheint mit der Liste; alle Reiter schliessen → das Symbol verschwindet.
- [ ] `npm run test:packaged` findet ripgrep im ungepackten Paket und führt es aus.

## Abnahme von Hand

- [ ] In einem grossen Projekt erscheinen die ersten Treffer der Projektsuche nach Sekundenbruchteilen.
- [ ] Die Vorschau zeigt die Fundstelle mit Farben.
