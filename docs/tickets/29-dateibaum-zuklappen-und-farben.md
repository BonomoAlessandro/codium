# 29 – Dateibaum: Zuklappen schliesst Unterordner, Git-Farben wie in IntelliJ

Status: `erledigt` (2026-11-26) · Typ: HITL
Blockiert durch: –
User Stories: ergänzt „Dateibaum“ (Auf- und Zuklappen) und „Git: Änderungen und Commit“ (Farben, Ticket 16)
Spezifikation: „Oberfläche“ (Design), Dateibaum, Git-Farben

Dieses Ticket kam nach Ticket 28 dazu, auf Wunsch des Nutzers. Es betrifft zwei Dinge im Dateibaum:
- das Zuklappen von Ordnern;
- die Farben für den Git-Zustand von Dateien und Ordnern.

Typ HITL wegen der Farben. Der Agent legt zuerst Bilder vor, der Nutzer gibt frei oder gibt Rückmeldung, erst dann werden die Farben eingebaut. Das Verhalten beim Zuklappen braucht keine Freigabe.

## Heutiger Stand

### Zuklappen

- **Was passiert:** `collapse` in `src/renderer/project/ProjectView.tsx` entfernt nur den zugeklappten Ordner aus der Liste der aufgeklappten Ordner, nicht dessen Unterordner. Klappt der Nutzer `a`, darin `a/b` und dann `a` wieder zu, erscheint `a/b` beim nächsten Aufklappen von `a` wieder offen.
- **Gespeicherter Zustand:** Auch der Projekt-Zustand (`project.expandedFolders`) behält `a/b`.
- **Collapse All:** „Collapse All“ in der Kopfzeile des Werkzeugfensters setzt dagegen alles zurück.

### Farben

- **Wo sie stehen:** Die Farben für den Git-Zustand sind fest in `src/renderer/styles/app.css` hinterlegt (Abschnitt „Commit und Git-Farben (Ticket 16)“):

  | Zustand | Farbe |
  |---|---|
  | geändert und umbenannt | `#6897bb` |
  | neu | `#629755` |
  | gelöscht und ignoriert | grau, `#6f737a`, gleich `--text-faint` |
  | nicht versioniert | `#d1675a` |
  | Konflikt | `#f75464` |

- **Wo sie wirken:** Die Klassen `git-<Zustand>` färben Zeilen im Dateibaum, in der Änderungsansicht (`CommitToolWindow.tsx`) und in der Dateiliste des Git-Logs (`GitLogView.tsx`).
- **Herkunft:** Die Werte stammen aus dem älteren Design „Darcula“. Sie wirken neben den Farben des neuen IntelliJ-Designs „Dark“ blass.
- **Ignorierte Einträge** erscheinen grau, also wie deaktiviert. Das sind eigene Einträge und alles unter einem ignorierten Ordner, etwa `node_modules`, `out` oder `build`.
- **Ordner** bekommen nur dann eine Farbe, wenn Git sie selbst nennt (ignoriert). Ein Ordner, der nur nicht versionierte Dateien enthält, bleibt ungefärbt. Git meldet wegen `--untracked-files=all` nur die Dateien darin.
- **Datei-Tabs** zeigen den Git-Zustand nicht. In IntelliJ sind auch die Tab-Titel eingefärbt.
- **Was der Nutzer sieht:** Nicht getrackte Dateien und Ordner wirken in Codium ausgegraut. In IntelliJ sind sie deutlich orange markiert. Insgesamt sind die Farben in IntelliJ satter.

## Was gebaut wird

### Zuklappen schliesst alles darin

- **Verhalten:** Wird ein Ordner zugeklappt, gelten auch alle Ordner darin als zugeklappt. Klappt der Nutzer ihn wieder auf, sieht er nur die direkte Ebene, alle Unterordner zu.
- **Gilt überall:** für Klick auf den Pfeil, Doppelklick, Pfeil nach links und jeden anderen Weg, der `collapse` benutzt.
- **Gespeicherter Zustand:** Er vergisst die Unterordner ebenfalls; nach einem Neustart sind sie auch zu.
- **Aufklappen bleibt:** Das Aufklappen zum Anzeigen einer Datei klappt die nötigen Elternordner weiter auf, etwa beim Öffnen aus der Suche oder bei „Select Opened File“.
- **Auswahl:** Ausgewählte Einträge im zugeklappten Teil gehen wie heute an den Ordner.
- **Spezifikation:** Im Abschnitt zum Dateibaum nachführen.

### Git-Farben wie im neuen IntelliJ

1. **Klären, was der Nutzer sieht:** Zuerst stellt der Agent fest, in welchem Git-Zustand die heute grauen Einträge sind. Infrage kommen: ignoriert, nicht versioniert in einem nicht versionierten Ordner oder ein Ordner ohne Farbe. Was er findet, schreibt er ins Ticket.
2. **Farben wählen:**
   - Die Farben für alle Zustände übernimmt er aus dem neuen IntelliJ-Design „Dark“: geändert, neu, gelöscht, umbenannt, nicht versioniert, ignoriert und Konflikt.
   - Nicht versionierte und ignorierte Einträge sind dort orange bzw. olivgelb statt grau.
   - Die Quelle der Werte nennt er im Ticket, etwa die Farbschemata von IntelliJ oder Bildschirmfotos.
3. **Design-Variablen:** Die Farben stehen als Design-Variablen in `tokens.css`, etwa `--git-modified`, `--git-added`, `--git-unversioned` und `--git-ignored`. `app.css` benutzt nur noch diese, damit Dateibaum, Änderungsansicht und Git-Log dieselben Farben zeigen.
4. **Nicht versionierte Ordner:** Ein Ordner, in dem nur nicht versionierte Dateien liegen und keine versionierte, bekommt die Farbe „nicht versioniert“, wie in IntelliJ. Bei grossen Bäumen darf das nicht jede Zeile gegen alle Dateien prüfen; Vorbild ist das Nachschlagen über die Elternordner bei den ignorierten Einträgen.
5. **Bilder (HITL):**
   - Aufnahmen aus dem verborgenen Testfenster, über Playwright im Testmodus, nie vom Desktop.
   - Inhalt: ein Projekt mit allen Zuständen, darunter ein ignorierter Ordner, ein nicht versionierter Ordner, eine geänderte, eine neue und eine nicht versionierte Datei.
   - Zu sehen in Dateibaum, Änderungsansicht und, falls gewünscht, Datei-Tabs: heute und neu, nach Möglichkeit neben einem Bildschirmfoto aus IntelliJ, das der Nutzer liefern kann.
   - Der Nutzer entscheidet anhand der Bilder:
     - die Farben;
     - ob ignorierte Einträge orange bzw. olivgelb oder weiter gedämpft erscheinen;
     - ob auch die Datei-Tabs wie in IntelliJ eingefärbt werden.

   Die Entscheidung kommt ins Ticket.
6. **Spezifikation:** Im Abschnitt „Oberfläche“ (Design) und bei den Git-Farben nachführen.

## Befund und Farbwerte (Agent, 2026-11-26)

Vor den Bildern geklärt, nach Schritt 1 und 2 oben. Die Bilder zur Freigabe lagen unter `entwuerfe/29-git-farben/` (Seite `index.html`, Aufnahmeskript in `aufnahmen/`), nicht versioniert; nach dem Abschluss gelöscht (2026-11-26).

### Was heute grau erscheint

Geprüft am Code (`gitStatusOf` in `ProjectWindow.tsx`, `parseStatus` im Git-Dienst, Abschnitt „Commit und Git-Farben“ in `app.css`) und mit einem Temp-Repository mit allen Zuständen. Das Aufnahmeskript liest vor den Bildern jede Zeile des Baums mit Git-Zustand und berechneter Farbe (Protokoll `bilder/analyse.txt` bei den Entwürfen); das Ergebnis steht hier.

- **Grau sind nur die ignorierten Einträge:** Ordner, die eine Regel in `.gitignore` trifft (etwa `node_modules`, `target`), alles darin und ignorierte Dateien (etwa `.env`, `*.log`). Git meldet sie mit `!` (`--ignored=matching`). Codium zeigt sie in `#6f737a`, derselben Farbe wie gedämpfter Text (`--text-faint`); deshalb wirken sie wie deaktiviert.
- **Nicht versionierte Dateien sind nicht grau,** sondern rotbraun `#d1675a`, auch in einem nicht versionierten Ordner.
- **Ordner ohne Farbe:** Ein Ordner, in dem nur nicht versionierte Dateien liegen, zeigt den Namen in der normalen Schriftfarbe `#dfe1e5`; das Ordnersymbol ist wie bei allen Ordnern grau (`--folder`, `#a5a8ae`). Git nennt mit `--untracked-files=all` nur die Dateien darin. Ebenso ohne Farbe bleibt ein Ordner, in dem nur ignorierte Dateien liegen (Git nennt mit `--ignored=matching` nur die Dateien).
- Gelöschte Dateien sind ebenfalls grau, aber nur in der Änderungsansicht.
- **Folgerung:** Was der Nutzer als „nicht getrackt, ausgegraut“ sieht, sind die ignorierten Einträge. Genau die sind im neuen IntelliJ-Design „Dark“ orange (`#D69A6B`). Nicht versionierte Einträge sind dort hell lachsrot (`#E88F89`), in Codium heute dunkler rotbraun. Das Olivgelb (`#848504`) stammt aus dem älteren Design „Darcula“.

### Farbwerte von IntelliJ

Quelle: die Farbschemata in den öffentlichen Quellen von JetBrains (intellij-community auf GitHub), gelesen am 2026-11-26. Übernommen werden nur die Werte.
- Neues Design „Dark“: `platform/platform-resources/src/themes/expUI/expUI_darkScheme.xml` (Schema „Dark“, vom Theme `expUI_dark.theme.json` als `editorScheme` genannt), Commit `4eaa9b64`, Zeilen 55 bis 74.
- „Islands Dark“: `platform/platform-resources/src/themes/islands/IslandSchemeDark.xml`, gleicher Commit, Zeilen 20 bis 36, dieselben Werte.
- „Darcula“ als Grundlage: `platform/platform-resources/src/DefaultColorSchemesManager.xml`, Schema „Darcula“, Commit `2e2fa9d6`, Zeilen 1580 bis 1597.

| Zustand | Heute (Codium) | IntelliJ „Dark“ | Darcula | Schlüssel |
|---|---|---|---|---|
| geändert | `#6897bb` | `#70AEFF` | `#6897BB` | `FILESTATUS_MODIFIED` |
| umbenannt | `#6897bb` | `#70AEFF` | `#3A8484` | `FILESTATUS_RENAMED` |
| neu | `#629755` | `#73BD79` | `#629755` | `FILESTATUS_ADDED` |
| gelöscht | `#6f737a` | `#6F737A` | `#6C6C6C` | `FILESTATUS_DELETED` |
| nicht versioniert | `#d1675a` | `#E88F89` | `#D1675A` | `FILESTATUS_UNKNOWN` |
| ignoriert | `#6f737a` | `#D69A6B` | `#848504` | `FILESTATUS_IDEA_FILESTATUS_IGNORED` |
| Konflikt | `#f75464` | `#DE6A66` | `#D5756C` | `FILESTATUS_IDEA_FILESTATUS_MERGED_WITH_CONFLICTS` |

Für die gedämpfte Fassung der ignorierten Einträge gibt es keinen Wert von IntelliJ; vorgeschlagen ist dessen Orange zu 70 % auf der Fläche der Werkzeugfenster, `#A37959`.

## Entscheidung (Nutzer, 2026-11-26)

Vorgelegt wurden Dateibaum, Änderungsansicht und Datei-Tabs eines erfundenen Projekts mit allen Zuständen, heute und mit den Werten von IntelliJ „Dark“; dazu drei Fassungen für ignorierte Einträge (orange wie IntelliJ, gedämpft `#A37959`, olivgelb wie Darcula) und die Tabs mit und ohne Farbe. Die Seite lag nach den Spielregeln unversioniert unter `entwuerfe/29-git-farben/`.

Rückmeldung des Nutzers, wörtlich: „deine empfehlung für alle 3 offenen fragen“

Er antwortete auf die drei Fragen mit den Empfehlungen des Koordinators:
1. **Farben:** alle genau wie IntelliJ „Dark“ (`expUI_darkScheme.xml`): geändert und umbenannt `#70AEFF`, neu `#73BD79`, gelöscht `#6F737A`, nicht versioniert `#E88F89`, ignoriert `#D69A6B`, Konflikt `#DE6A66`.
2. **Ignorierte Einträge:** orange wie IntelliJ (`#D69A6B`), nicht gedämpft und nicht olivgelb.
3. **Datei-Tabs:** werden wie in IntelliJ eingefärbt.

## Akzeptanzkriterien

- [x] Ein Playwright-Test im Testmodus prüft:
  - `a` auf, `a/b` auf, `a` zu, `a` wieder auf: `a/b` ist zu.
  - Dasselbe mit der Tastatur (Pfeil nach links bzw. rechts).
  - Nach erneutem Öffnen des Projekts ist `a/b` ebenfalls zu.
- [x] Ein Test prüft, dass das Anzeigen einer Datei in einem zugeklappten Unterordner die Elternordner weiter aufklappt.
- [x] Die Bilder (heute, neu, nach Möglichkeit IntelliJ) wurden dem Nutzer vorgelegt; seine Entscheidung und die Herkunft der Farbwerte stehen im Ticket. (Ein Bildschirmfoto aus IntelliJ lag nicht vor; die Werte stammen aus dessen Farbschema.)
- [x] Die Git-Farben stehen als Design-Variablen in `tokens.css`. In `app.css` gibt es keine fest eingetragenen Git-Farben mehr.
- [x] Ein Playwright-Test prüft im Dateibaum die freigegebenen Farben einer nicht versionierten Datei, eines nicht versionierten Ordners und eines ignorierten Eintrags. Dazu prüft er eine geänderte Datei in der Änderungsansicht.
- [x] Einheitstests prüfen die Färbung von Ordnern:
  - nur nicht versionierte Dateien: Farbe „nicht versioniert“;
  - gemischt mit versionierten Dateien: keine Farbe;
  - ignoriert: Farbe „ignoriert“.
- [x] Werden die Datei-Tabs eingefärbt: ein Test, dass ein Tab einer geänderten bzw. nicht versionierten Datei die Farbe trägt.
- [x] `npm run typecheck`, `npm test` und `npm run test:ui` sind grün (siehe Umsetzung, Testläufe).

## Abnahme von Hand

- [ ] Zuklappen und Aufklappen eines Ordners zeigt die Unterordner zu, wie erwartet.
- [ ] Nicht getrackte Dateien und Ordner sind auf einen Blick orange erkennbar, die Farben wirken so satt wie in IntelliJ.
- [ ] Die Titel der Datei-Tabs tragen die Farbe des Git-Zustands und folgen ihm, etwa nach einem Commit oder Rollback. (ergänzt bei der Umsetzung)
- [ ] In einem grossen Repository, auch mit einem grossen nicht versionierten Ordner, folgen Baum und Änderungsansicht Änderungen so flüssig wie bisher. (ergänzt bei der Umsetzung)

## Hinweise

- Die Spielregeln gelten: Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Aufnahmen nur vom verborgenen Testfenster über Playwright, nie vom Desktop. Keine echten Eingaben an den Desktop.
- Ticket 28 (Scrollbalken) arbeitet ebenfalls an Farben im Design. Werden beide nacheinander umgesetzt, baut das spätere auf den Design-Variablen des früheren auf.

## Umsetzung (Agent, 2026-11-26)

### Zuklappen

- **Reine Funktionen** in `src/renderer/project/fileTree.ts`:
  - `collapseFolder(expanded, folder)` nimmt den Ordner samt allen aufgeklappten Ordnern darin aus den aufgeklappten.
  - `withoutHiddenFolders(expanded, root)` lässt nur Ordner stehen, deren Eltern bis zum Projektordner alle aufgeklappt sind.
- **`ProjectView.tsx`:**
  - `collapse` benutzt `collapseFolder`; das gilt für Pfeil, Doppelklick, Pfeil links und Enter. Der gespeicherte Zustand bekommt dieselbe Liste.
  - Beim Laden räumt `withoutHiddenFolders` einen Zustand von vor diesem Ticket auf, in dem etwa `a/b` unter dem zugeklappten `a` gemerkt ist. Gespeichert wird das erst mit der nächsten Änderung durch den Nutzer, wie bisher nur bei Aktionen des Nutzers.
  - Auswahl, „Collapse All“ und „Select Opened File“ sind unverändert. „Select Opened File“ klappt die Elternordner auf, auch wenn sie mit einem zugeklappten Ordner vergessen wurden.
  - Der Datei-Dienst im Kern führt einen beim Laden bereinigten Ordner (etwa `a/b`) noch in seiner Liste der aufgeklappten Ordner, bis der Nutzer den Baum das nächste Mal ändert. Das ist harmlos: Er merkt sich nur den Inhalt gelesener Ordner, und `a/b` wird nicht gelesen, solange `a` zu ist.

### Git-Farben

- **Design-Variablen** in `tokens.css`: `--git-modified`, `--git-renamed` (gleich `--git-modified`), `--git-added`, `--git-deleted`, `--git-unversioned`, `--git-ignored`, `--git-conflict`, mit den freigegebenen Werten. Seit dem Review stehen auch die übrigen Git-Farben aus `app.css` dort, mit unveränderten Werten: die Änderungsbalken im Editor (`--git-change-modified`, `--git-change-added`, `--git-change-deleted`) und die Etiketten im Git-Log (`--git-ref-local`, `--git-ref-remote`, `--git-ref-tag`). Die Markierungen der Änderungsbalken im Streifen rechts setzt `changeBars.ts` für Monaco mit denselben Werten; Monaco liest keine CSS-Variablen.
- **`app.css`:** Im Abschnitt „Commit und Git-Farben“ setzt jede Klasse `git-<Zustand>` nur noch `color: var(--git-<Zustand>)`; es gibt keine fest eingetragenen Git-Farben mehr. Dateibaum (Name der Zeile), Änderungsansicht und Dateiliste des Git-Logs (Zeile samt Symbol) und Datei-Tabs (Titel) nutzen dieselben Klassen.
- **Ein Ort für den Zustand je Pfad:** `src/renderer/git/fileStatus.ts`, ohne DOM.
  - `changeKind` ist aus `CommitToolWindow.tsx` hierher umgezogen.
  - `gitStatusLookup(state)` liefert den Zustand für Dateien und Ordner und ersetzt die Funktion in `ProjectWindow.tsx`.
  - Ignorierte Ordner und nicht versionierte Ordner gelten für alles darin. Nachgeschlagen wird über die Elternordner, vom nächsten aufwärts: Der nächste entscheidet, etwa bei einem ignorierten Ordner in einem nicht versionierten.
- **Tabs:**
  - `EditorArea` bekommt `gitStatusOf` vom Projektfenster.
  - Der Titel eines Datei-Tabs trägt die Klasse `git-<Zustand>`, der Tab selbst `data-git`. `gitStatusOf` ist in `EditorArea` und `ProjectView` als `ChangeKind` getypt (seit dem Review).
  - Symbol, Hinweis bei gleichnamigen Dateien und Schliessknopf behalten ihre Farben.
  - Unveränderte Dateien und Tabs ohne Datei im Repository bleiben in der normalen Farbe.

### Nicht versionierte Ordner: Statusabfrage umgebaut statt zweiter voller Aufruf

- **Woher die Ordner kommen:** Mit `--untracked-files=all` nennt Git nur Dateien. Welcher Ordner keine versionierte Datei enthält, weiss nur Git; aus der Statusausgabe allein geht das nicht hervor, weil unveränderte versionierte Dateien darin fehlen.
- **Erster Aufruf:** Der bestehende Aufruf läuft jetzt mit `--untracked-files=normal`. Dann nennt Git einen solchen Ordner als Ganzes (`? drafts/`, nur den obersten). Der Git-Dienst führt diese Ordner im Zustand als `untrackedDirs`.
- **Zweiter Aufruf, nur bei Bedarf:** Gibt es solche Ordner, liest ein zweiter `git status --untracked-files=all` nur für sie die Dateien darin. Änderungsansicht und Commit haben sie so weiter einzeln.
  - Die Pfade gehen relativ zur Wurzel des Repositorys mit `-C <Wurzel>` hinein, wörtlich: `--literal-pathspecs` doppelt `GIT_LITERAL_PATHSPECS`, das jeder Aufruf ohnehin hat, macht es aber in der Konsole sichtbar.
  - `git status` liest keine Pfade über stdin; deshalb gehen sie auf der Befehlszeile hinein, in Teilen zu höchstens 16'000 Zeichen (`pathChunks`). Die Konsole zeigt bei mehreren Pfaden nur ihre Zahl, etwa `-- (400 paths)`, wie bei den Pfaden über stdin.
  - Ordner mit eigenem `.git` (Ordner oder Datei, also ein eigenes Repository oder ein Worktree im Projekt) gehen nicht in den zweiten Aufruf; Git fände darin nichts (seit dem Review).
  - Ignorierte Einträge in solchen Ordnern meldet schon der erste Aufruf.
  - Scheitert der zweite Aufruf, bleibt der Zustand des ersten ohne die Dateien dieser Ordner; der Fehler steht im Protokoll (seit dem Review). Baum und Ordnerfarben stimmen dann, nur die Änderungsansicht kennt diese Dateien nicht.
- **Kosten** (berichtigt nach dem Review, gemessen vom Prüfer):
  - Wegen `--ignored=matching` steigt schon der erste Aufruf in die nicht versionierten Ordner ab; der zweite liest sie noch einmal und kostet je Aufruf einen Prozessstart. Die Arbeitskopie wird also nicht nur einmal durchsucht, wie hier zuerst stand.
  - Bei 20'000 Dateien dauerte das Lesen des Zustands mit einem nicht versionierten Ordner etwa 30 % länger als vorher, mit 400 solchen Ordnern etwa doppelt so lang. Ohne solche Ordner gibt es keinen zweiten Aufruf und keine Mehrkosten.
- **Warum trotzdem so:**
  - Die Kosten fallen nur an, wenn es nicht versionierte Ordner gibt, und wachsen mit ihnen, nicht mit der Grösse des Repositorys.
  - Die Alternativen kosten in jedem Fall: ein zweiter voller Aufruf daneben (etwa `git ls-files --others --directory`) hätte die Suche nach nicht versionierten Dateien bei jeder Aktualisierung verdoppelt, auch ohne solche Ordner; die Ordner aus der Liste aller versionierten Dateien (`git ls-files`) abzuleiten, hiesse, in grossen Repositorys bei jeder Änderung am Index alle Dateien zu lesen.
- **Nebenwirkungen:**
  - Ein eigenes Repository oder ein Worktree in einem Unterordner meldet Git als `? sub/`. Es erschien bisher als namenlose Datei in der Änderungsansicht; jetzt ist es samt Inhalt als „nicht versioniert“ gefärbt und erscheint nicht in der Änderungsansicht (Spezifikation und „Bekannte Grenzen“ in `offene-punkte.md`).
  - Ist der Projektordner selbst ein Unterordner des Repositorys ohne versionierte Dateien, trägt auch seine Zeile die Farbe.

### Abweichungen und Hinweise

- Das Ticket nannte für ignorierte Einträge „olivgelb“; das ist der Wert aus „Darcula“ (`#848504`). Im neuen „Dark“ sind sie orange, und so ist es freigegeben.
- Ein Ordner, in dem nur ignorierte Dateien liegen, bleibt ohne Farbe; Git nennt ihn nicht als ignoriert.
- Spezifikation nachgeführt:
  - User Stories 26 und 27 (Farben);
  - „Oberfläche“, Design (Git-Farben und Tabs);
  - Dateibaum (Zuklappen, Färbung der Ordner);
  - „Git“, Zustand (zwei Aufrufe).
- Bilder des eingebauten Stands lagen unversioniert unter `entwuerfe/29-git-farben/` (Abschnitt „Eingebaut“), aufgenommen mit `AUFNAHME_EINGEBAUT=1`; nach dem Abschluss gelöscht.

### Tests

- **Einheitstests:**
  - `test/renderer/fileTree.test.ts`, Abschnitt „Zuklappen schliesst die Ordner darin“: 3 Tests (Zuklappen samt Unterordnern, unverändert ohne Unterordner, älterer Zustand).
  - `test/renderer/gitColors.test.ts`: 9 Tests (einer seit dem Review).
    - Ordner nur mit nicht versionierten Dateien: „nicht versioniert“, samt Unterordnern.
    - Gemischt mit versionierten Dateien: keine Farbe.
    - Ignoriert samt Inhalt; Ordner nur mit ignorierten Dateien: keine Farbe.
    - Der nächste Ordner entscheidet; doppelte Einträge; Zuordnung der Zustände.
    - `tokens.css` hat die freigegebenen Werte; `app.css` färbt jede Klasse nur über ihre Variable.
    - Auch Änderungsbalken und Etiketten im Git-Log haben in `app.css` keine festen Farben; ihre Variablen stehen mit unveränderten Werten in `tokens.css` (seit dem Review).
- **Kern mit echtem Git** (`test/main/gitCommit.test.ts`):
  - Ordner ohne versionierte Dateien als `untrackedDirs`, verschachtelt und mit Klammern und Umlaut im Namen, die Dateien darin einzeln. Gemischte, nur ignorierte und leere Ordner gehören nicht dazu. Ignorierte Einträge darin bleiben gemeldet. Nach dem Commit einer Datei daraus ist der Ordner nicht mehr dabei.
  - Ein eigenes Repository und ein Worktree im Projekt sind `untrackedDirs`, gehen aber nicht in den zweiten Aufruf; dessen Konsolenzeile nennt nur die beiden übrigen Ordner (`-- (2 paths)`). Die Reihenfolge der Dateien wird nicht mehr geprüft (seit dem Review).
  - 400 nicht versionierte Ordner, gelesen in mindestens zwei Aufrufen; jeder davon bleibt unter 16'000 Zeichen (seit dem Review, statt nur die Aufrufe zu zählen), dazu `pathChunks`.
  - In `test/main/git.test.ts` ist der Projektordner als nicht versionierter Unterordner eines Repositorys geprüft.
- **Oberfläche:**
  - `test/ui/fileTree.test.ts`: 2 neue Tests. Der erste prüft Maus, Tastatur, den älteren Zustand und den Neustart, seit dem Review auch die gespeicherte Datei: Nach dem Zuklappen von `a` fehlt `a/b` dort sofort, nicht erst beim nächsten Laden. Der zweite prüft „Select Opened File“ bei einem zugeklappten Unterordner.
  - `test/ui/commit.test.ts`: neuer Test zu den Farben.
    - Im Baum: geänderte und nicht versionierte Datei, nicht versionierter Ordner und Unterordner, versionierter Ordner ohne Farbe, ignorierter Ordner samt Inhalt und ignorierte Datei.
    - Tabs: geänderte und nicht versionierte Datei mit Farbe, unveränderte ohne; nach `git add` wechselt der Tab auf „neu“.
    - Änderungsansicht mit denselben Farben.
    - Die bestehende Farbprüfung im Rollback-Test erwartet die neuen Werte.
  - `test/ui/gitLog.test.ts`: Die Datei in der Dateiliste des Git-Logs hat das Blau von „geändert“.

### Testläufe (2026-11-26, nacheinander, allein auf dem Rechner)

- `npm run typecheck`: sauber.
- `npm test`: 56 Dateien, 497 Tests grün.
- `npm run test:ui` (ab 09:59): 28 Dateien, 101 Tests grün, 682 s. Kein Standby: Das letzte Kernel-Power-Ereignis davor war 507 um 09:07:55, während des Laufs und danach kam kein 506. Keine Meldung der Schlussprüfung, keine übrigen Prozesse.

## Review

Ein zweiter Agent hat den Branch gegen Ticket, Spezifikation und Spielregeln geprüft; keine Muss-Befunde, alle Kriterien erfüllt. Eingearbeitet ist alles, verworfen nichts. Die Tests sind jeweils mit Gegenprobe geprüft (mit dem alten Verhalten rot).

Sollte behoben werden:
- **S1, Doku:** In `docs/abnahme.md` ist der Punkt zu den Darcula-Farben (16) als durch Ticket 29 ersetzt gekennzeichnet, mit Verweis auf die Punkte (29). In `docs/offene-punkte.md` nennt der Satz zu den Git-Farben jetzt Ticket 29.
- **S2, Leistung:**
  - Die Begründung unter „Umsetzung“ ist berichtigt, samt den gemessenen Kosten: Schon der erste Aufruf steigt in nicht versionierte Ordner ab, der zweite hat feste Kosten.
  - Ordner mit eigenem `.git` (Ordner oder Datei) gehen nicht mehr in den zweiten Aufruf. Test in `gitCommit.test.ts` mit einem eigenen Repository und einem Worktree; Gegenprobe ohne den Filter: rot (4 statt 2 Pfade).
- **S3, Test:** `test/ui/fileTree.test.ts` liest nach dem Zuklappen die gespeicherte Projekt-Zustandsdatei (`readProjectState` in `test/support/launchApp.ts`): `a/b` fehlt.
  - Erste Fassung: Sie wartete auf „enthält `a/b`“ und dann auf „ohne `a`“. Der erste volle UI-Lauf nach dem Review war deshalb rot (100 von 101, `[ '', 'a/b' ]`). Der Kern speichert 200 ms nach der letzten Änderung; folgen die Schritte im Test schneller aufeinander, liegt noch der Zustand vom Start in der Datei, und der enthält `a/b` ohne `a`. Beide Abfragen trafen so auf die alte Datei. Damit war auch die erste Gegenprobe nicht aussagekräftig.
  - Jetzt wartet der Test auf Stände, die nur ein neues Speichern ergibt: erst `['', 'a', 'a/b']`, nach dem Zuklappen `['']`. Einzeln zweimal grün. Neue Gegenprobe mit einem Stand, der den Baum richtig zeigt, `a/b` aber weiter speichert: Die erste Abfrage wird erfüllt, die zweite bleibt rot (`[ '', 'a/b' ]`).
- **S4, Test:** Der Test mit 400 Ordnern prüft jetzt für jeden zweiten Aufruf, dass seine Pfade höchstens 16'000 Zeichen lang sind. Gegenprobe ohne Aufteilung: rot.

Hinweise:
- **H1:** Scheitert der zweite Aufruf, bleibt der Zustand des ersten ohne die Dateien dieser Ordner, und der Fehler geht mit `this.options.log` ins Protokoll. Ohne Test: Ein scheiternder zweiter Aufruf lässt sich mit echtem Git nicht verlässlich herbeiführen, und der Git-Dienst ist im Kern-Test nicht von aussen erreichbar.
- **H2:** Die Konsole kürzt den zweiten Aufruf wie die Pfade über stdin (`-- (400 paths)`), über die neue Laufoption `commandLinePaths`.
- **H3:** `inGitOrder` ist gestrichen; die Änderungsansicht sortiert selbst. Die Erwartungen in `gitCommit.test.ts` sortieren selbst.
- **H4:** `--literal-pathspecs` bleibt, mit Kommentar (doppelt zu `GIT_LITERAL_PATHSPECS`, in der Konsole erkennbar).
- **H5:** Eigene Repositorys und Worktrees im Projekt sind in der Spezifikation („Git“, Zustand) und unter „Bekannte Grenzen“ in `offene-punkte.md` beschrieben: samt Inhalt „nicht versioniert“ gefärbt, nicht in der Änderungsansicht.
- **H6:** Auch die Änderungsbalken und die Etiketten im Git-Log nutzen Design-Variablen aus `tokens.css` (`--git-change-*`, `--git-ref-*`, Werte unverändert). Der Test sucht in allen Regeln mit `.git-` oder `.change-bar` nach festen Farben; Gegenprobe mit einem festen Wert: rot.
- **H7:** Kommentar in `gitColors.test.ts` richtiggestellt; `gitStatusOf` als `ChangeKind` getypt; Enter in der Spezifikation beim Zuklappen ergänzt; der Satz zu `FileService.expandedKeys` steht unter „Umsetzung“.

Bilder: Am Aussehen hat sich nichts geändert, die Bilder des eingebauten Stands bleiben.


Testläufe nach dem Review (2026-11-26, nacheinander, allein auf dem Rechner):
- `npm run typecheck`: sauber, auch nach der letzten Änderung am Test zu S3.
- `npm test`: 56 Dateien, 498 Tests grün.
- `npm run test:ui`, erster Lauf (ab 10:43): 100 von 101; rot war der neue Prüfpunkt zu S3 (siehe oben). Der Rechner war zudem von 10:47:49 bis 10:50:34 im Standby (Kernel-Power 506 und 507), der Lauf zählt also ohnehin nicht.
- `npm run test:ui`, zweiter Lauf mit dem berichtigten Test (ab 10:57, letztes Kernel-Power-Ereignis davor 507 um 10:50:34, während des Laufs und danach kein 506): 28 Dateien, 101 Tests grün, 486 s. Keine Meldung der Schlussprüfung, keine übrigen Prozesse.
