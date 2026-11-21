# 08 – Dateisuche, zuletzt geöffnete Dateien, Projektsuche und „Find“

Status: `erledigt` (2026-11-22, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
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

- [x] Kern-Tests im Temp-Ordner:
  - Dateisuche: „UsrSrv“ findet sowohl „UserService.java“ als auch „users_overview.txt“, wobei „UserService.java“ zuerst kommt.
  - Ignorierte Dateien fehlen ohne Schalter und erscheinen mit „include ignored“. Versteckte Dateien wie `.github/workflow.yml` sind enthalten, `.git` nicht.
  - Eine neu angelegte Datei ist nach dem Dateiereignis auffindbar.
  - Projektsuche mit jedem Schalter (Gross-/Kleinschreibung, ganzes Wort, regulärer Ausdruck, Dateimaske), mit und ohne „include ignored“.
  - Ein Ordner ohne Git-Repository mit `.gitignore` → die ignorierten Dateien werden trotzdem ausgelassen.
  - Abbruch nach 2'000 Treffern mit Kennzeichen „mehr“; Abbruch einer laufenden Suche durch eine neue.
  - Zuletzt geöffnete Dateien überstehen einen Neustart.
- [x] Playwright-Tests:
  - Ctrl + Shift + N, Teil eines Namens tippen, Enter → Datei offen.
  - Ctrl + Shift + F, Text tippen, Treffer doppelklicken → Datei offen, Cursor auf der Fundstelle.
  - „Open in Find Window“ → das Werkzeugfenster „Find“ erscheint mit der Liste; alle Reiter schliessen → das Symbol verschwindet.
- [x] `npm run test:packaged` findet ripgrep im ungepackten Paket und führt es aus.

## Abnahme von Hand

- [ ] In einem grossen Projekt erscheinen die ersten Treffer der Projektsuche nach Sekundenbruchteilen.
- [ ] Die Vorschau zeigt die Fundstelle mit Farben.
- [ ] Ctrl + Shift + N in einem grossen Projekt (etwa mit node_modules und „include ignored“): Die Treffer folgen jedem Tastendruck ohne Stocken; ein Präfix wie „app“ steht vor verstreuten CamelCase-Treffern.
- [ ] Projektsuche in einem Projekt mit minifizierten Dateien: Codium bleibt bedienbar, nach 2'000 Treffern steht „more results“.
- [ ] Ein Projekt in einem Ordner, über dem eine fremde `.gitignore` liegt: Dateien des Projekts fehlen nicht.

## Umsetzung

- **ripgrep** aus `@vscode/ripgrep` 1.18 (das Programm kommt über das optionale Paket `@vscode/ripgrep-win32-x64`, ohne Download). Im Paket liegt es unter `app.asar.unpacked` (`build.asarUnpack`); `src/main/ripgrepPath.ts` findet es unpaketiert und gepackt. Monaco und JetBrains Mono sind jetzt Entwicklungsabhängigkeiten: esbuild bündelt sie, im Paket lagen sie sonst ein zweites Mal.
- **Such-Dienst** im Projekt-Kern (`searchService.ts`): Dateiliste und Projektsuche über ripgrep ohne Konfiguration des Nutzers (`--no-config`), mit versteckten Dateien, ohne `.git`, `.gitignore` auch ohne Repository. Die Projektsuche liefert Treffer gestreamt in Paketen alle 50 ms.
- **Unscharfer Vergleich** (`fuzzyMatch.ts`): dynamische Programmierung über Eingabe × Name, Wortanfänge und CamelCase zählen, zusammenhängende Zeichen mehr, ein Grossbuchstabe der Eingabe meint einen Wortanfang; ohne Treffer im Namen zählt der Pfad schwächer, mit „/“ in der Eingabe der Pfad.
- **Zuletzt geöffnete Dateien** im Projekt-Zustand (`recentFiles`, höchstens 50), gemerkt, sobald ein Tab aktiv wird; sie folgen Umbenennen und Löschen.
- **Oberfläche:** Suchfenster über dem Editor (`search/`), Vorschau in einem schreibgeschützten Monaco (mit dem Modell eines offenen Tabs, sonst einem eigenen, das mit dem Fenster verschwindet), Werkzeugfenster „Find“ mit Reitern; es gibt das Werkzeugfenster nur, solange es Reiter gibt.
- **Dabei gefunden:** Getippte Zeichen gingen in einem Suchfenster mit leerer Liste verloren, und der Editor nahm einem schnell geöffneten Suchfenster den Fokus; beides behoben, ein Einheitstest hält das Erste fest.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-22. Keine Einschleusung über Suchtext oder Maske, Junctions nach draussen, Sonderzeichen, Spalten bei UTF-8 und UTF-16, Limit, Paketierung, Alt + 3, Vorschau und zuletzt geöffnete Dateien in Ordnung. Eingearbeitet:

- **Minifizierte Datei liess den Hauptprozess hängen** (nachgewiesen, hoch: 3 MB in 92 s): Die Spalten jedes Teiltreffers wurden aus dem Zeilenanfang neu dekodiert, und alle Teiltreffer einer Zeile vor dem Limit. Jetzt in einem Durchlauf und höchstens bis zum Limit; ein Kern-Test mit 120'000 Treffern in einer Zeile.
- **Windows-1252-Zeilen fehlten** in der Projektsuche (nachgewiesen): ripgrep liefert sie als Base64; sie werden wie beim Lesen dekodiert.
- **`.git` mit Maske „*“ durchsucht** (nachgewiesen): Der Ausschluss steht jetzt nach den Masken (bei ripgrep gewinnt der spätere Glob).
- **Unscharfer Vergleich wich von IntelliJ ab** (nachgewiesen: „app“ fand ApiPathParser vor app.ts): Zusammenhängende Zeichen zählen mehr als ein neuer Wortanfang, ein Grossbuchstabe der Eingabe muss einen Wortanfang treffen.
- **Laufzeit der Suche nach Namen** (nachgewiesen, 100'000 Dateien rund 0,9 s je Tastendruck): Die Rechnung ist jetzt O(m·n) mit wiederverwendeten Puffern; ein Kern-Test begrenzt die Zeit. Die Dateiliste wird bei Änderungen von aussen höchstens einmal pro Sekunde neu gelesen (während eines Builds), nach eigenen Operationen sofort.
- **`.gitignore` über dem Projekt** blendete Dateien aus (nachgewiesen): Ohne Repository um das Projekt gilt nur dessen eigene (`--no-ignore-parent`); liegt es in einem Repository, gelten die darüber bis zu dessen Wurzel, wie bei Git.
- **Kürzel unter dem offenen Suchfenster** (nachgewiesen: Ctrl + F4 schloss den Tab darunter): Werkzeugfenster- und Tab-Kürzel ruhen; Escape schliesst auch ohne Fokus im Fenster.
- **Test des Abbruchs bewies nichts:** Der neue Test lässt eine lange Suche laufen und prüft, dass sie nach einer neuen weit vor ihrer vollen Dauer endet. Kommentare im Oberflächentest berichtigt; die Farben der Vorschau werden jetzt geprüft.
- **Fehlermeldung bei ungültigem regulärem Ausdruck** nennt jetzt die Ursache („regex parse error: unclosed group“).
- **Dateimasken** unterscheiden Gross-/Kleinschreibung nicht mehr.
- **Suchtext beim Wiederöffnen** ist ausgewählt.
- **Antworten und Abbruch im Suchfenster:** Nur die Antwort der letzten Anfrage zählt (ohne Platzhalter-Kennung); eine Suche, deren Antwort erst nach dem Schliessen kommt, wird abgebrochen.
- **„Open in Find Window“** ist erst nach dem Ende der Suche wählbar.

Verworfen: nichts.
