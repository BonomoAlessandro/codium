# Offene Punkte nach Codium 1

Stand 2026-11-22, nach den Tickets 01 bis 21 und 23 und dem Agenten-Teil von Ticket 22. Die Abnahme von Hand steht in
[abnahme.md](abnahme.md); was Codium 1 bewusst weglässt, in der Spezifikation unter
[„Ausserhalb des Umfangs“](specs/codium-v1.md#ausserhalb-des-umfangs). Die Abschnitte „Review“ der einzelnen Tickets
erklären die Hintergründe.

## Zu entscheiden

1. **dompurify** (Markdown-Vorschau, läuft in der App): `npm audit` meldet eine Lücke mittlerer Stufe für
   dompurify ≤ 3.4.16, insgesamt 6 mittlere Meldungen (darunter minimatch). Das Update gilt laut `npm audit fix --force`
   als Breaking Change. Aktualisieren und die Markdown-Vorschau neu prüfen?
2. **Sehr grosse Werte im Tabelleninhalt** (Ticket 21): Zellen im Megabyte-Bereich (etwa grosses JSON) kommen je Seite
   vollständig in die Oberfläche, und die Zeilen werden beim Tippen ohne Memoisierung neu gezeichnet. Werte gekürzt
   laden (Anzeige) und erst im Editor bzw. für den Vergleich vollständig?
3. **Schliessen mit offenen Tabellen-Änderungen** (Ticket 21): Nur das Schliessen des Tabs fragt nach; das Schliessen
   des Fensters und „Exit“ verwerfen einen offenen Änderungssatz ohne Rückfrage.
4. **Symbol und Signatur des Installers** (Ticket 22): Der Installer hat das Standard-Symbol von Electron und ist nicht
   signiert (SmartScreen fragt beim ersten Start). Ein eigenes Symbol wäre ein kleines Ticket; Code-Signing ist laut
   Spezifikation ausserhalb des Umfangs.
5. **TypeScript fremder Projekte** (Ticket 12): Beim Öffnen eines Projekts startet Codium dessen eigenes TypeScript
   (`tsc.exe` bzw. `tsserver.js` aus `node_modules`) ohne Vertrauensabfrage. So spezifiziert, aber ein bewusstes Risiko
   bei fremden Repositories.
6. **Absturz des nativen TypeScript-Servers** (Ticket 30): Die Ursache der wiederholten Abstürze im Projekt des Nutzers
   ist nicht gefunden; kein Nachstellen brachte den Server 7.0.2 zum Absturz, auch nicht das Nachspielen über Codiums
   Kern. Seit Ticket 30 steht jedes unerwartete Ende mit Exit-Code und dem Ende von stderr im Protokoll der
   Sprachserver; beim nächsten Mal dort nachsehen.
   Gefunden, aber nicht als Ursache belegt: Kommen bis zur nächsten Anfrage mehr als 1000 Dateiänderungen zusammen
   (etwa bei einem Build), verliert der Server eine gleichzeitige Bearbeitung einer offenen Datei; Anfragen zu ihr
   enden dann in Panics, die er abfängt (keine Vorschläge, keine Färbung). Ein Entwurf einer Meldung an typescript-go
   steht im Ticket; sie geht nur mit Zustimmung des Nutzers hinaus.
   Vorschlag: Codium meldet `didChangeWatchedFiles.dynamicRegistration: true`, damit der Server seine eigene, erst seit
   Juni 2026 vorhandene Überwachung des ganzen Projektordners nicht startet (Codium meldet die Änderungen ohnehin
   selbst, wie VS Code); die Schübe wären etwa halb so gross. Zusätzlich könnte Codium dem TypeScript-Server nur
   Dateien mit Endungen melden, die er liest, und Ordner; erst das hielte Build-Ausgaben ganz fern. Nicht belegt, dass
   das den Absturz behebt; Änderungen ausserhalb des Projekts sähe dann niemand mehr.
7. **Gemeinsamer Typ-Zwischenspeicher** (Ticket 30): Bei Projekten ohne Konfiguration installiert der native Server
   Typen über `npm` nach `%LOCALAPPDATA%\Microsoft\TypeScript\7.0` (ATA), auch aus Tests heraus, und das mit der
   npm-Registry des Rechners. Der Ordner gehört auch anderen Editoren. Abschalten (Einstellung des Servers) oder
   bewusst so lassen?

## Bei der Abnahme besonders prüfen

- **PowerShell 7** war auf dem Entwicklungsrechner nicht installiert; der langsame Terminal-Test lief mit Windows
  PowerShell, cmd und Git Bash. PowerShell 7 (Standard-Shell) ist ungetestet.
- **Ältere Java-Stände:** Auf dem Entwicklungsrechner gab es nur JDK 21 und 25; der Test „älterer Java-Stand“ (8, 11,
  17) wurde übersprungen.
- **Farben:** Konstanten auf Modulebene und Globale wie `console` erscheinen in TypeScript in der Grundfarbe (IntelliJ
  zeigt sie womöglich violett bzw. kursiv). Die Git-Farben stammen aus dem klassischen Darcula (#6897BB, #629755,
  #D1675A), nicht aus dem neuen „Dark“.
- **Maven mit Firmen-Mirror** in der eigenen (`~/.m2/settings.xml`) und in der globalen Einstellung
  (`%MAVEN_HOME%\conf\settings.xml`).
- **Statusleiste bei Java:** Interne Arbeiten von jdtls („Building“, „Publish Diagnostics“) blinken kurz auf.

## Bekannte Grenzen (bewusst so gelassen)

- Umbenennen einer offenen Datei verliert ihren Rückgängig-Verlauf (Monaco führt Modelle unter ihrer Adresse; 05).
- Ctrl + Tab wechselt ohne Umschaltliste (IntelliJ zeigt eine; 06).
- Schreibt ein anderes Programm genau zwischen der Stand-Prüfung und dem Schreiben, geht dessen Änderung verloren (07).
- Wird eine Datei mit ungespeicherten Eingaben gelöscht, schliesst ihr Tab und die Eingaben sind weg (Spezifikation; 07).
- Eine `.gitignore` über dem Projektordner gilt nur, wenn das Projekt in einem Repository liegt, wie bei Git (08).
- Das Suchfenster ist kein echtes Modal: Kürzel für Werkzeugfenster und Tabs ruhen darunter (08).
- Ein Terminal direkt nach dem Start zu schliessen dauert im Hintergrund gut 3 s (ConPTY wartet auf die Antwort des
  Terminals); der Tab schliesst sofort (11).
- „Neustart höchstens dreimal in drei Minuten“ des Sprachservers: drei Neustarts, der vierte Absturz gibt auf (12);
  seit Ticket 30 mit „Show Log“ und „Restart“ an der Meldung.
- Vervollständigung ohne Herkunftsmodul (`labelDetails`); Ctrl + N findet Type-Aliase mit TypeScript 6 nicht (13).
- Zu Zeile (Ctrl + G) über wenige Zeilen erzeugt keinen Eintrag im Zurück/Vor-Verlauf (erst ab Dateiwechsel oder mehr
  als 10 Zeilen; 13).
- Gradle-Daemons laufen nach Gradle-Art stundenlang weiter; nur die Tests beenden ihre eigenen (14).
- Ohne `pull.rebase` in der Git-Konfiguration verweigert Git den Pull auseinanderlaufender Branches mit seinem Hinweis;
  Codium wählt bewusst keine eigene Strategie (18).
- Picking eines Autors im Log-Filter sucht wie freier Text einen Teil von Name oder E-Mail; steht HEAD auf einem alten
  Branch weit unten, bleibt Spalte 0 des Graphs darüber frei (19).
- Beendet ein Verbindungsfehler den Pool einer Datenbank-Verbindung, scheitern Anfragen, die ihn gerade benutzen, mit
  der Meldung von node-postgres; der nächste Versuch legt einen neuen an (20).
- Ein fehlender oder zusätzlicher Zeilenumbruch am Dateiende ergibt keinen Änderungsbalken (17).
- Im Branch-Dropdown sind Ordnerzeilen Einträge einer Liste (`role="option"`) mit `aria-expanded`, das ARIA 1.2 dort
  nicht vorsieht; ein Screenreader meldet „auf-“ bzw. „zugeklappt“ womöglich nicht. Ein möglicher Weg wäre das Muster
  tree/treeitem (mit `aria-level`) für die Branches, die Aktionen davor als eigene Liste (31).

## Wackelige Tests (beobachten)

Stand 2026-11-24, nach Ticket 27. Gelegentlich rot, einzeln jeweils grün:

- Langsam: „Gradle 8: Import mit dem Wrapper …“. Einmal im vollen Lauf (2026-11-23) nach erfolgreichem Import 240 s
  ohne Definition; das Protokoll des Gradle-Daemons war unauffällig, einzeln 5 von 5 grün. Eine Zeitüberschreitung
  nennt jetzt die Meldungen an App.java und das Ende des Protokolls von jdtls; beim nächsten Mal dort nachsehen
  (Vermutung: jdtls nahm App.java als Datei ausserhalb des Projekts).
- UI: „speichert Eingaben der letzten Sekunde vor „Exit““. Einmal hing im zweiten Start der Doppelklick 30 s in
  Playwright („performing dblclick action“); die Eingabe kam bei der App nicht an. Einzeln 8 von 8 grün, in Codium
  keine Ursache gefunden. Am 2026-11-25 (Ticket 30, nach dem Review) dasselbe Bild in zwei vollen UI-Läufen
  hintereinander, je einmal und in anderen Tests: „bleibt stabil, wenn ein Tab während des Lesens schliesst …“
  (`editor.test.ts`) und „lädt eine von aussen geänderte Datei still neu …“ (`save.test.ts`); kein Standby, kein
  fremder Build. Einzeln danach `editor.test.ts` 3 von 3 grün, `save.test.ts` 6 von 7 (der rote Einzellauf traf einen
  dritten Test, seine Meldung ist nicht festgehalten). Ein dritter voller UI-Lauf vor dem Merge war grün (90 von 90).
  Häufiger als bisher; beobachten.
- UI: „TypeScript: Ctrl + Klick auf die Deklaration zeigt die Verwendungen“ (Auswahl erscheint nicht innert 30 s);
  auch einzeln etwa 1 von 4 Mal direkt nach einem vollen Lauf, danach mit Diagnose 16 Mal grün.
- UI: einzelne Zeitüberschreitungen im Dateibaum, im Terminal und im zeitbasierten Hinweis-Test (layout).
- Langsam: einmal 4 Terminal-Tests; einmal ein Absturz des Test-Workers in `terminal.test.ts` (0xC0000005, node-pty).

Behoben am 2026-11-24 (Ticket 27, Ursachen und Messungen dort):

- UI „öffnet eine JDK-Klasse …“: Codium sprang auf Zeile 1, wenn jdtls kurz nach dem Import die ganze Klassendatei als
  Ziel lieferte; der Sprach-Dienst fragt bei der Definition dann bis zu 4 s lang neu. Dazu ein Wettlauf im Test, der jede
  Sekunde neu klickte.
- Langsam „startet nach einem Absturz neu …“: Codium schickte einem neu startenden Server Anfragen und
  Dateiänderungen vor `initialized`; der native TypeScript-Server stürzte daran ab, und Codium gab ihn zu früh auf.
  Jetzt geht vor `initialized` nichts mehr hinaus; Dateiänderungen aus dieser Zeit kommen danach.
- Schnell „lässt einen gelöschten Projektordner los …“: Ein Git-Aufruf mit dem Projektordner als Arbeitsordner
  verhinderte das Löschen (EPERM); der Test läuft ohne Git. Die Wiederholungen vom 2026-11-23 (unten dem Virenscanner
  zugeschrieben) fingen vermutlich denselben Git-Aufruf ab.
- UI Markdown-Vorschau mit Mermaid: Der Virenscanner hielt die frisch gebaute `mermaid.js` beim ersten Lesen über 10 s
  fest; der UI-Lauf liest `dist/` jetzt vor den Tests einmal, und der Test wartet auf das Laden bis 60 s.

Schneller Lauf, behoben am 2026-11-23: Klonen, Abbrechen einer Suche und die Dateiüberwachung bei übergelaufenem Puffer
waren unter voller Last gelegentlich rot. Ursachen: das Standardlimit von Vitest (5 s) war kürzer als die inneren
Wartezeiten der Tests (bis 10 s), und der Test zum Abbrechen der Suche mass die Dauer der folgenden Suche mit. Jetzt
gilt im schnellen Lauf ein Limit von 30 s (Git-Gruppen 60 s), höchstens halb so viele Testdateien laufen gleichzeitig
wie Prozessorkerne, und der Abbruch wird am Zeitpunkt seines Ereignisses gemessen. Danach 13 volle Läufe in Folge grün.
Zweite Runde am selben Tag, als der Rechner stärker belastet war: Der Geschwindigkeitstest der Dateisuche misst jetzt
das Verhältnis zu einer Vergleichsarbeit statt eines festen Zeitbudgets, das Löschen eines eben überwachten Ordners
wiederholt kurz bei einer Sperre durch den Virenscanner (EPERM), und `expect.poll` wartet im schnellen Lauf bis 10 s
statt 1 s. Danach 6 volle Läufe in Folge grün, auch bei doppelter Laufzeit.

Aufräumen (Ticket 27): Eine Codium-Testinstanz beendet sich samt Kindprozessen, wenn ihr Testprozess endet (Wächter);
ein Test-PostgreSQL räumt mit eigenem Wächter auf, auch Hilfsprozesse ohne Hauptprozess; und eine Schlussprüfung je
Testlauf beendet verwaiste Prozesse aus dem Checkout und entfernt liegengebliebene Temp-Ordner, jeweils mit Meldung.
