# 04 – Datei-Dienst und Dateibaum

Status: `erledigt` (2026-11-21, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
Blockiert durch: 03
User Stories: 12, 25, 27 (sichtbar, ohne Graufärbung bis Ticket 16), 28–30, 31 (ohne Tab und Git), 32–35, 36
Spezifikation: „Dateien, Dateiüberwachung und Suche“ (Dateibaum, Dateiüberwachung, Dateioperationen)

## Was gebaut wird

- **Datei-Dienst** im Projekt-Kern:
  - Ordnerinhalte auf Anfrage, Ordner vor Dateien, alphabetisch ohne Unterscheidung der Gross-/Kleinschreibung; `.git` wird nicht angezeigt.
  - **Dateiüberwachung:**
    - Rekursiv über den Projektordner; Ereignisse werden kurz gesammelt, danach wird geprüft, was wirklich existiert, und gebündelt an das Fenster gemeldet.
    - „Gelöscht und neu angelegt“ gilt als Änderung.
    - Ereignisse ohne Dateinamen führen zum Neueinlesen der betroffenen Ordner.
    - Änderungen in `.git` lösen keine Dateiereignisse aus; ein eigenes Ereignis „Git-Daten geändert“ (HEAD, Index, Refs) wird für Ticket 15 bereitgestellt.
    - Die Überwachung endet beim Abbau des Projekt-Kerns.
  - **Dateioperationen:**
    - neue Datei, neuer Ordner, Umbenennen
    - Löschen in den Papierkorb über den Port
    - Kopieren und Einfügen; bei Namenskonflikt Vorschlag mit Zusatz, etwa „Name (2).ext“
    - Pfad kopieren, im Explorer zeigen
    - Jede Operation erzeugt ein Ereignis, auf das spätere Dienste reagieren können (Tabs in Ticket 07, Sprachserver in Ticket 12, Git in Ticket 16).
- **Pfade nur innerhalb des Projekts:** Jeder Befehl des Datei-Dienstes prüft, dass die übergebenen Pfade (nach dem Auflösen von `..`, Junctions und symbolischen Links) innerhalb des Projektordners liegen, und lehnt andere mit einem Fehlercode ab. Die Oberfläche ist zwar eigener Code, aber der Datei-Dienst ist die Stelle, an der Pfade auf die Festplatte treffen (Review von Ticket 01).
- **Werkzeugfenster „Project“:**
  - Baum mit Auf- und Zuklappen, Einfachklick wählt aus, Doppelklick oder Enter löst „Datei öffnen“ aus (ein Ereignis, das Ticket 05 aufnimmt).
  - Rechtsklick-Menü: „New“ (File, Directory), „Rename…“, „Delete…“ (mit Rückfrage aus Ticket 03), „Copy“, „Paste“, „Copy Path“, „Open in Explorer“, „Open in Terminal“ (inaktiv bis Ticket 11).
  - Der Umbenennen-Dialog zeigt bei Java-Dateien den Hinweis, dass Verweise nicht angepasst werden.
  - Knopf „Select Opened File“ (wirkt ab Ticket 05).
  - Der Baum aktualisiert sich bei Dateiereignissen, ohne aufgeklappte Ordner oder Auswahl zu verlieren.
- **Zustand pro Projekt:** aufgeklappte Ordner.

## Akzeptanzkriterien

- [x] Kern-Tests im Temp-Ordner:
  - Ordnerinhalt mit Sortierung und ohne `.git`.
  - Dateioperationen inklusive Namenskonflikt beim Einfügen und Löschen in den nachgemachten Papierkorb.
  - Eine von aussen angelegte, geänderte, umbenannte oder gelöschte Datei erzeugt ein gebündeltes Ereignis.
  - Löschen und sofortiges Neuanlegen derselben Datei meldet eine Änderung, kein Löschen.
  - Änderungen in `.git` erzeugen kein Dateiereignis, aber bei HEAD, Index oder Refs das Ereignis „Git-Daten geändert“.
  - Nach dem Abbau des Projekt-Kerns kommen keine Ereignisse mehr.
  - Aufgeklappte Ordner überstehen einen Neustart.
  - Pfade ausserhalb des Projekts (mit `..`, absolut, über eine Junction nach draussen) werden bei jedem Befehl abgelehnt.
- [x] Playwright-Tests: Ordner aufklappen, neue Datei über das Rechtsklick-Menü anlegen, umbenennen, löschen mit Rückfrage (landet im Papierkorb-Ordner des Testmodus). Eine von aussen angelegte Datei erscheint im Baum.

## Abnahme von Hand

- [ ] In einem grossen Projekt (etwa mit node_modules) bleibt der Baum flüssig.
- [ ] „Open in Explorer“ öffnet den Explorer mit der markierten Datei; „Delete…“ landet im Windows-Papierkorb.
- [ ] Im Explorer eine Datei anlegen, umbenennen und löschen: Der Baum folgt, aufgeklappte Ordner und Auswahl bleiben.
- [ ] `npm install` oder ein `git checkout` mit vielen Änderungen bei aufgeklapptem `node_modules`: Der Baum bleibt bedienbar und zeigt danach den richtigen Stand; zugeklappte Ordner kosten dabei nichts.
- [ ] Ein aufgeklappter Ordner verschwindet bei einem Branch-Wechsel und kommt beim Zurückwechseln wieder: Er ist wieder aufgeklappt, auch nach einem Neustart.
- [ ] Projekt auf einem Netzlaufwerk offen, Laufwerk trennen: Codium und andere Projekte bleiben bedienbar. Nach dem Verbinden ist der Baum wieder aktuell.
- [ ] Den Ordner eines offenen Projekts im Explorer löschen: keine Dauer-CPU-Last, Codium bleibt bedienbar.
- [ ] Ein Projektfenster schliessen und den Ordner sofort im Explorer umbenennen oder löschen: Das geht, die Überwachung hat ihn losgelassen.
- [ ] „Copy Path“ landet in der echten Zwischenablage (in Notepad einfügen).
- [ ] Eine Junction auf einen Ordner ausserhalb des Projekts: Sie erscheint mit Kettensymbol und Hinweis und klappt nicht auf; „Delete…“ legt nur den Link in den Windows-Papierkorb, das Ziel bleibt.
- [ ] Einen grossen Ordner kopieren oder viele Einträge löschen: Nach etwa einer Sekunde zeigt die Statusleiste den Fortschritt.
- [ ] Rechtsklick-Menü mit Untermenü „New“, Dialoge und Auswahlfarben sehen aus wie in IntelliJ „Dark“.
- [ ] Tasten mit der Schweizer Tastatur: Pfeile, Enter, F2 und Shift+F6, Entf, Shift+F10 bzw. die Kontextmenütaste.
- [ ] Dateinamen mit Umlauten werden richtig einsortiert.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-21. Akzeptanzkriterien, Kern ohne Electron, Testmodus und Aufräumen sind in Ordnung, die meisten Angriffe auf die Pfadprüfung scheiterten. Eingearbeitet:

- **Pfadprüfung über Unicode-Kleinschreibung umgehbar** (nachgewiesen): Auch die echten Pfade wurden mit `toLowerCase()` verglichen. JavaScript faltet das Kelvin-Zeichen (U+212A) zu „k“ und „ẞ“ zu „ß“, NTFS nicht; bei Projekt `…\kodium` liessen sich so im Nachbarordner `…\Kodium` (mit Kelvin-Zeichen) Dateien lesen und anlegen. Jetzt vergleicht `pathGuard.ts` die echten Pfade genau, mit Schreibweise; beide kommen aus `realpath`. Die lexikalische Vorprüfung bleibt unempfindlich, sie lehnt nur ab.
- **Kopieren mit Links** (nachgewiesen): `fs.promises.cp` legte Links als symbolische Links an, ohne Entwicklermodus EPERM, und liess eine unsichtbare halbe Kopie zurück. Jetzt kopiert der Datei-Dienst selbst:
  - Ein Link auf einen Ordner wird als Junction auf dasselbe Ziel neu angelegt (geht ohne Rechte), ein Link auf eine Datei im Projekt als Kopie ihres Inhalts, ein toter Link als toter Link. Ein Link auf eine Datei ausserhalb wird als Link angelegt; ohne Entwicklermodus kommt eine verständliche Meldung, den Inhalt von draussen holt die Kopie nicht.
  - „Nicht in sich selbst“ prüft die echten Pfade, auch über eine Junction in einen Unterordner der Quelle.
  - Nach einem Fehler wird die Anmeldung der eigenen Änderung verworfen und die halbe Kopie entfernt (Links nur als Link). Geht das nicht, meldet der Dienst den Rest als angelegt, damit der Baum ihn zeigt. Ein Ziel, das ein anderer Vorgang belegt hat, wird nie entfernt.
- **Umbenennen konnte eine vorhandene Datei überschreiben** (nachgewiesen mit `k.txt` → `K.txt` mit Kelvin-Zeichen): `fs.rename` ersetzt unter Windows das Ziel. Ein vorhandenes Ziel ist jetzt nur erlaubt, wenn es dieselbe Datei ist (Datei-Nummer und Laufwerk, `lstat` mit `bigint`); meldet ein Laufwerk keine Datei-Nummer, gilt nur ein Unterschied in der Schreibweise von A bis Z. `lstat` liefert nur bei ENOENT/ENOTDIR „fehlt“. Das verbleibende Zeitfenster zwischen Prüfung und Umbenennen steht im Kommentar.
- **Links nach draussen waren sichtbar, aber nicht bedienbar:** Löschen (der Papierkorb nimmt den Link, nicht das Ziel), Umbenennen, „Copy Path“ und „Open in Explorer“ prüfen jetzt den Eintrag selbst: Der echte Pfad des Elternordners liegt im Projekt, der Eintrag existiert per `lstat` (`PathGuard.entry`). Durchgreifen bleibt abgelehnt. `FileEntry.blockedLink` markiert Links nach draussen und tote Links; der Baum zeigt sie mit Kettensymbol und Hinweis, ohne Aufklappen und ohne Fehlermeldung.
- **Ein Schwall von Ereignissen kostete unnötig viel:** Der Kern merkt sich nur noch den Inhalt der aufgeklappten Ordner (`project.setExpandedFolders` liefert die Menge). Bei zu vielen Pfaden werden nur ihre Elternordner neu eingelesen, soweit aufgeklappt; nur ein Ereignis ohne Dateinamen liest alle aufgeklappten neu ein. Der Baum vergisst beim Zuklappen den gelesenen Inhalt und liest nur Aufgeklapptes neu.
- **„Git-Daten geändert“ ging bei übergelaufenem Puffer verloren** (in 1 von 7 Läufen nachgewiesen): Jedes Neueinlesen meldet zusätzlich `git.dataChanged`.
- **Gleichzeitige Kopien wählten denselben Namen:** Kopien in denselben Zielordner laufen nacheinander; ist ein Name trotzdem belegt, wird der nächste versucht.
- **Ereignisse einer Operation, die während des Abbaus fertig wird, gingen verloren:** Abonnenten im Kern hören bis zum Ende des Abbaus mit, nur das Fenster bekommt nichts mehr.
- **Von aussen gelöschte Ordner löschten den gespeicherten Zustand:** Verschwindet ein aufgeklappter Ordner von aussen, bleibt er unter den aufgeklappten und ist wieder aufgeklappt, sobald er zurückkommt. Gespeichert werden nur Änderungen durch den Nutzer; den Projektordner entfernt eine Löschung nie. Ein Ordner, der sich nicht lesen lässt, erscheint zugeklappt, bleibt aber gemerkt.
- **Datei wird zu Ordner oder umgekehrt:** Bei `changed` liest der Baum auch den Elternordner neu.
- **Zeitfenster zwischen Prüfung und Zugriff:** als bekannte Grenze in `pathGuard.ts` festgehalten. Anlegen und Kopieren prüfen ihr Ergebnis danach noch einmal auf den echten Pfad.
- **`.git` war über die Befehle beschreibbar:** Anlegen, Umbenennen, Kopieren als Ziel und Löschen lehnen Pfadteile namens `.git` ab (ohne Unterscheidung der Gross-/Kleinschreibung), mit `INVALID_PARAMS` bzw. bei neuen Namen `INVALID_FILE_NAME`. Die Dialoge prüfen das schon beim Tippen.
- **Zwischenablage:** Sie bleibt im Fenster (Entscheidung, siehe unten); ihre Pfade folgen jetzt Umbenennungen und verschwinden beim Löschen. Kopieren und Einfügen zwischen Explorer und Codium bzw. zwischen zwei Codium-Fenstern steht in der Spezifikation unter „Ausserhalb des Umfangs“ und als Präzisierung 38.
- **Lange Operationen** zeigen nach etwa einer Sekunde Fortschritt in der Statusleiste (Löschen mit Anteil, Kopieren ohne).
- **Vertrag:** Der Kommentar an `files.changed` hält für die Tickets 07 und 08 fest, dass bei `rescanned` geänderte Inhalte und Änderungen in zugeklappten Ordnern nicht einzeln gemeldet werden.
- **Tests:** Zu den Befunden 1 bis 4, 7, 9 und 13 je ein Kern-Test, dazu Junction im Quellordner, gescheiterte Kopie mit gesperrter Datei, Fortschritt und Git-Daten nach Überlauf. Alle neuen Kern-Tests scheitern gegen den Stand vor der Korrektur. Oberflächentests für einen Link nach draussen und für einen Ordner, der verschwindet und zurückkommt.

Vorgemerkt: **Worktree und Submodul** (`.git` als Datei) löst die Dateiüberwachung noch nicht auf; der Hinweis steht in Ticket 15.

Bewusst so geblieben:

- **Zwischenablage nur im Fenster:** „Copy“ und „Paste“ wirken innerhalb eines Projekts; die Windows-Zwischenablage bekommt nur „Copy Path“.
- **Interne Vergleiche ohne Gross-/Kleinschreibung:** Die gemerkten Ordner, die Anmeldungen eigener Änderungen und die Schlüssel des Baums vergleichen weiterhin mit der Faltung von JavaScript. Bei Namen, die nur so gleich sind, kann ein Ereignis ungenau sein; die Sicherheit hängt daran nicht, weil Pfadprüfung und Umbenennen genau vergleichen.
- **Kopieren eines Links nach draussen** als Eintrag bleibt abgelehnt; es griffe durch den Link hindurch.

Entscheidungen bei der Umsetzung, die Ticket und Spezifikation nicht vorgeben:

- **Pfade im Vertrag** sind absolut, in der Schreibweise des Projektpfads; im Projekt-Zustand liegen die aufgeklappten Ordner relativ (`expandedFolders`). Ohne gespeicherten Zustand ist der Projektordner aufgeklappt.
- **„Datei öffnen“** ist bis Ticket 05 ein DOM-Ereignis `codium:open-file` am Dokument (`OPEN_FILE_EVENT` in `ProjectWindow.tsx`); auch eine neu angelegte Datei löst es aus, wie in IntelliJ.
- **Namenskonflikt beim Einfügen:** Mehrere Einträge bekommen automatisch einen Zusatz; ein einzelner zeigt nur bei einem Konflikt den Dialog „Copy“ mit dem Vorschlag (IntelliJ zeigt ihn immer).
- **Neue Namen** dürfen wie in IntelliJ Unterordner enthalten (`a/b/c.txt`); gemeldet wird der oberste neue Eintrag. Ziel ist der ausgewählte Ordner bzw. der Ordner der ausgewählten Datei.
- **Tasten:** F2 zusätzlich zu Shift+F6 (Wunsch im Auftrag), dazu Ctrl+C, Ctrl+V, Ctrl+Shift+C (absoluter Pfad, mehrere getrennt durch Zeilenumbruch), Shift+F10 und die Kontextmenütaste. Mehrfachauswahl mit Ctrl und Shift wie in IntelliJ; nach dem Löschen geht die Auswahl auf den nächsten Eintrag, beim Zuklappen auf den Ordner.
- **`.git`** ist auf jeder Ebene ausgeblendet; „Git-Daten geändert“ gilt für das `.git` im Projektordner und geht auch ans Fenster.
- **Ereignisse:** `files.changed` meldet nur Änderungen von aussen (eigene Operationen werden über Änderungszeit und Grösse erkannt, bis 3 s nach ihrem Ende), `files.operation` die eigenen. Eine Änderung an einem Ordner gilt für alles darunter. Dienste im Kern abonnieren beides über `ProjectCore.subscribe`.
- **`project.setExpandedFolders`** prüft nur lexikalisch, weil der Befehl die Festplatte nicht berührt; gelesen wird später über das geprüfte `files.list`.
- **Den Projektordner** kann man weder umbenennen noch löschen oder kopieren.
- **Sortierung** mit `Intl.Collator('en')` ohne Unterscheidung der Gross-/Kleinschreibung, nicht numerisch.
- **Dateiüberwachung:** Bündel nach 75 ms Ruhe, spätestens nach 500 ms; ab 2000 Pfaden nur noch Elternordner; Neustart nach einem Abbruch mit Pausen von 1 bis 30 s. Wird der Projektordner selbst gelöscht, meldet libuv das unter Windows ohne Ende; die Überwachung lässt den Ordner dann los. Sie endet synchron beim Beginn des Abbaus.
- **Höchstens 4 gleichzeitige Dateizugriffe** pro Projekt; beim Abbau darf eine laufende Operation noch fertig werden, höchstens bis zum Zeitlimit der Aufräumarbeiten (5 s).
- **Knopf „Collapse All“** im Kopf des Werkzeugfensters, wie in IntelliJ; „Select Opened File“ ist bis Ticket 05 inaktiv.

Nachprüfung durch denselben Agenten: Alle 16 Befunde sind bestätigt behoben, auch gezielte Angriffe auf die neue Kopierlogik scheiterten. Ein letzter Punkt ist eingearbeitet:

- **Die Sperre für `.git` liess sich über eine Junction umgehen** (nachgewiesen): Geprüft wurde nur der übergebene Pfad. Mit einer Junction `hooks-link` auf `.git\hooks` legte `files.createFile` die Datei in `.git\hooks` an. Jetzt prüft `PathGuard.assertOutsideGit` zusätzlich den echten Pfad gegen den echten Projektpfad: bei Anlegen und Kopieren den Zielordner (samt Links als Zwischenordner in neuen Namen), bei Umbenennen und Löschen den Eintrag selbst (echter Elternordner plus Name; den Link selbst darf man weiterhin umbenennen und löschen). Anlegen und Kopieren prüfen ihr Ergebnis danach noch einmal. Ein Kern-Test mit genau diesem Fall scheitert ohne die Korrektur.
