# 29 – Dateibaum: Zuklappen schliesst Unterordner, Git-Farben wie in IntelliJ

Status: `ready-for-agent` · Typ: HITL
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

Vor den Bildern geklärt, nach Schritt 1 und 2 oben. Die Bilder zur Freigabe liegen unter `entwuerfe/29-git-farben/` (Seite `index.html`, Aufnahmeskript in `aufnahmen/`); nicht versioniert, nach Abschluss gelöscht.

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

## Akzeptanzkriterien

- [ ] Ein Playwright-Test im Testmodus prüft:
  - `a` auf, `a/b` auf, `a` zu, `a` wieder auf: `a/b` ist zu.
  - Dasselbe mit der Tastatur (Pfeil nach links bzw. rechts).
  - Nach erneutem Öffnen des Projekts ist `a/b` ebenfalls zu.
- [ ] Ein Test prüft, dass das Anzeigen einer Datei in einem zugeklappten Unterordner die Elternordner weiter aufklappt.
- [ ] Die Bilder (heute, neu, nach Möglichkeit IntelliJ) wurden dem Nutzer vorgelegt; seine Entscheidung und die Herkunft der Farbwerte stehen im Ticket.
- [ ] Die Git-Farben stehen als Design-Variablen in `tokens.css`. In `app.css` gibt es keine fest eingetragenen Git-Farben mehr.
- [ ] Ein Playwright-Test prüft im Dateibaum die freigegebenen Farben einer nicht versionierten Datei, eines nicht versionierten Ordners und eines ignorierten Eintrags. Dazu prüft er eine geänderte Datei in der Änderungsansicht.
- [ ] Einheitstests prüfen die Färbung von Ordnern:
  - nur nicht versionierte Dateien: Farbe „nicht versioniert“;
  - gemischt mit versionierten Dateien: keine Farbe;
  - ignoriert: Farbe „ignoriert“.
- [ ] Werden die Datei-Tabs eingefärbt: ein Test, dass ein Tab einer geänderten bzw. nicht versionierten Datei die Farbe trägt.
- [ ] `npm run typecheck`, `npm test` und `npm run test:ui` sind grün.

## Abnahme von Hand

- [ ] Zuklappen und Aufklappen eines Ordners zeigt die Unterordner zu, wie erwartet.
- [ ] Nicht getrackte Dateien und Ordner sind auf einen Blick orange erkennbar, die Farben wirken so satt wie in IntelliJ.

## Hinweise

- Die Spielregeln gelten: Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Aufnahmen nur vom verborgenen Testfenster über Playwright, nie vom Desktop. Keine echten Eingaben an den Desktop.
- Ticket 28 (Scrollbalken) arbeitet ebenfalls an Farben im Design. Werden beide nacheinander umgesetzt, baut das spätere auf den Design-Variablen des früheren auf.
