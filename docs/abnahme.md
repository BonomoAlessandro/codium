# Abnahme von Hand

Alle Punkte „Abnahme von Hand“ der Tickets 01 bis 21 und 23, nach Bereichen geordnet (Ticket 22). In Klammern das
Ticket, aus dem der Punkt stammt; dort steht der Zusammenhang. Abweichungen werden als neue Tickets erfasst. Die Punkte
der Tickets, die nach Codium 1 dazukamen, stehen im Abschnitt „Nach Codium 1“.

Geprüft wird die installierte App (`release\Codium Setup <version>.exe`), ausser ein Punkt nennt ausdrücklich
`npm start` oder `npm run dev`. Am Schluss steht die Prüfung auf einem frischen Rechner bzw. Windows-Benutzer.

## Start, Fenster und Neustart

- [ ] `npm start` öffnet wie bisher ein Fenster; es erscheint nichts Unerwartetes. (01)
- [ ] Zwei Projekte öffnen, „Exit“, neu starten: Beide Fenster sind wieder da, an ihrer Position. (02)
- [ ] Ein offenes Projekt nochmals über „Open Folder“ wählen: Das vorhandene Fenster kommt wirklich nach vorne. (02)
- [ ] Codium ein zweites Mal starten: Das zuletzt benutzte Fenster kommt nach vorne. (02)
- [ ] Ein Projektfenster maximieren, schliessen bzw. „Exit“, neu starten: Es öffnet maximiert, „Wiederherstellen“ führt zur alten Lage. (02)
- [ ] Ein Projektfenster minimieren (einmal aus maximiertem, einmal aus normalem Zustand) und Codium über die Taskleiste schliessen: Beim Neustart stimmen Lage und Maximiert-Zustand. (02)
- [ ] Ein Fenster auf einen zweiten Bildschirm schieben, „Exit“, den Bildschirm abziehen, neu starten: Das Fenster liegt zentriert auf dem Hauptbildschirm. (02)
- [ ] Das Willkommensfenster verschieben und in der Grösse ändern, schliessen, neu starten: Es erscheint an derselben Stelle. (02)
- [ ] Einen Projektordner umbenennen, während Codium beendet ist, dann starten: Hinweis „Project folder not found“, die übrigen Projekte öffnen. (02)
- [ ] Ein Projekt auf einem Netzlaufwerk offen lassen, „Exit“, das Netzlaufwerk trennen, starten: Hinweis „Project folder not reachable“, Codium bleibt bedienbar, auch die Liste der zuletzt geöffneten Projekte. Nach dem Verbinden und einem weiteren Neustart öffnet das Projekt wieder. (02)
- [ ] Mit zwei offenen Projekten von Windows abmelden, wieder anmelden, Codium starten: Beide Projekte sind offen. (02)
- [ ] Ein zuletzt geöffnetes Projekt löschen und im Willkommensfenster anklicken: Es erscheint ein Hinweis, „Remove from List“ entfernt den Eintrag. (02)
- [ ] Ein weiteres Projekt ohne gespeicherte Lage öffnen: Es öffnet um etwa 30 px versetzt zum zuletzt benutzten Projektfenster. (02)
- [ ] Das letzte Fenster schliessen und Codium sofort wieder starten: Codium startet nach dem Beenden neu, statt still wegzubleiben. (02)

## Kopfzeile, Werkzeugfenster und Aussehen

- [ ] Das Fenster sieht aus wie das neue IntelliJ „Dark“: Kopfzeile, Symbolleisten, Statusleiste, Abstände. (03)
- [ ] Die Fensterknöpfe von Windows funktionieren. Das Fenster lässt sich an der Kopfzeile verschieben und per Doppelklick maximieren. (03)
- [ ] Der Nutzer bestätigt die Aufteilung der Symbolleisten: links oben „Project“ und „Commit“, links unten „Terminal“ und „Git“ (später „Find“), rechts „Database“, keine Leiste am unteren Rand. (03)
- [ ] Die Fensterknöpfe sitzen bündig rechts in der Kopfzeile. Beim Überfahren von „Maximieren“ erscheinen die Andock-Layouts von Windows 11. (03)
- [ ] Am oberen Fensterrand (über der Kopfzeile) lässt sich die Fenstergrösse ändern. (03)
- [ ] Die Trennlinie unter der Kopfzeile läuft unter den Fensterknöpfen durch, nichts Bedienbares liegt unter ihnen. (03; im Projektfenster trennt seit Ticket 25 der Abstand zu den Inseln statt einer Linie)
- [ ] Auch das Willkommensfenster lässt sich an seiner Kopfzeile verschieben und per Doppelklick maximieren. (03)
- [ ] Ein Klick auf die leere Kopfzeile schliesst ein offenes Projektmenü. (Unter Windows erreicht ein Klick auf die Zieh-Fläche die Seite womöglich nicht.) (03)
- [ ] Bei hellem Windows-Design blitzt beim Öffnen eines Fensters nichts Helles auf. (03)
- [ ] In einem verkleinerten Fenster verschwindet der Code-Bereich nie; nach dem Vergrössern sind die alten Breiten der Werkzeugfenster wieder da. (03)
- [ ] Die Alt-Kürzel funktionieren auf der Schweizer Tastatur; AltGr + 2 („@“) löst nichts aus. (03)
- [ ] `npm run dev`: Ctrl + R und Ctrl + Shift + I aus dem Entwicklungsmenü funktionieren trotz verborgener Titelleiste. (03)
- [ ] Eine Information bleibt stehen, solange die Maus über ihr steht, und verschwindet danach. (03)

## Dateibaum

- [ ] In einem grossen Projekt (etwa mit node_modules) bleibt der Baum flüssig. (04)
- [ ] „Open in Explorer“ öffnet den Explorer mit der markierten Datei; „Delete…“ landet im Windows-Papierkorb. (04)
- [ ] Im Explorer eine Datei anlegen, umbenennen und löschen: Der Baum folgt, aufgeklappte Ordner und Auswahl bleiben. (04)
- [ ] `npm install` oder ein `git checkout` mit vielen Änderungen bei aufgeklapptem `node_modules`: Der Baum bleibt bedienbar und zeigt danach den richtigen Stand; zugeklappte Ordner kosten dabei nichts. (04)
- [ ] Ein aufgeklappter Ordner verschwindet bei einem Branch-Wechsel und kommt beim Zurückwechseln wieder: Er ist wieder aufgeklappt, auch nach einem Neustart. (04)
- [ ] Projekt auf einem Netzlaufwerk offen, Laufwerk trennen: Codium und andere Projekte bleiben bedienbar. Nach dem Verbinden ist der Baum wieder aktuell. (04)
- [ ] Den Ordner eines offenen Projekts im Explorer löschen: keine Dauer-CPU-Last, Codium bleibt bedienbar. (04)
- [ ] Ein Projektfenster schliessen und den Ordner sofort im Explorer umbenennen oder löschen: Das geht, die Überwachung hat ihn losgelassen. (04)
- [ ] „Copy Path“ landet in der echten Zwischenablage (in Notepad einfügen). (04)
- [ ] Eine Junction auf einen Ordner ausserhalb des Projekts: Sie erscheint mit Kettensymbol und Hinweis und klappt nicht auf; „Delete…“ legt nur den Link in den Windows-Papierkorb, das Ziel bleibt. (04)
- [ ] Einen grossen Ordner kopieren oder viele Einträge löschen: Nach etwa einer Sekunde zeigt die Statusleiste den Fortschritt. (04)
- [ ] Rechtsklick-Menü mit Untermenü „New“, Dialoge und Auswahlfarben sehen aus wie in IntelliJ „Dark“. (04)
- [ ] Tasten mit der Schweizer Tastatur: Pfeile, Enter, F2 und Shift+F6, Entf, Shift+F10 bzw. die Kontextmenütaste. (04)
- [ ] Dateinamen mit Umlauten werden richtig einsortiert. (04)

## Editor, Tabs und Tastenkürzel

- [ ] Java-, TypeScript-, JSON-, XML-, YAML- und SQL-Dateien sehen farblich wie in IntelliJ „Dark“ aus. (05)
- [ ] Die Schrift ist JetBrains Mono und wirkt gleich gross wie in IntelliJ mit Grösse 13. (05)
- [ ] Die Tableiste sieht aus wie im neuen IntelliJ (aktiver Tab als runde Fläche seit Ticket 25, Kreuz beim Überfahren, Punkt bei „ungespeichert“). (05)
- [ ] Ein Bild (PNG mit Transparenz) erscheint mit Schachbrett dahinter; eine Binärdatei und eine Datei über 50 MB zeigen ihren Hinweis. (05)
- [ ] Doppelklick auf eine Datei im Baum setzt den Fokus in den Editor; „Select Opened File“ findet die Datei des aktiven Tabs auch in zugeklappten Ordnern. (05)
- [ ] Nach „Exit“ und Neustart stehen Tabs, aktiver Tab und Cursor wie vorher; auch eine Cursorbewegung kurz vor „Exit“ ist gesichert. (05)
- [ ] Die Bearbeitungs-Kürzel fühlen sich an wie in IntelliJ. (06)
- [ ] Viele Tabs: Die Tableiste scrollt flüssig. (06)
- [ ] Schweizer Tastatur: Ctrl + Z ist Rückgängig (nicht „Zeile löschen“), Ctrl + Shift + 7 (also Ctrl + /) und Ctrl + Ziffernblock-/ kommentieren aus. (06)
- [ ] Ctrl + Mausrad mit Maus und mit Touchpad: Die Schrift ändert sich in ruhigen Schritten, die Seite selbst zoomt nicht. (06)
- [ ] Angeheftete Tabs zeigen die Stecknadel; ein Klick darauf löst den Tab. (06)

## Speichern und Änderungen von aussen

- [ ] Eine Datei mit CRLF bearbeiten: `git diff` im Terminal zeigt nur die echte Änderung, keine Zeilenende-Änderungen. (07)
- [ ] Während Claude Code eine offene Datei ändert, erscheint beim gleichzeitigen Tippen der Hinweis, und keine Fassung geht still verloren. (07)
- [ ] Eine Datei mit gemischten Zeilenenden (etwa aus einem Windows-Repository) an einer Stelle bearbeiten: `git diff` zeigt nur die bearbeiteten Zeilen. (07)
- [ ] Tippen und sofort „Exit“, Alt + F4 oder das Kreuz des Fensters: Die Eingaben sind gespeichert. (07)
- [ ] In einer Windows-1252-Datei ein Zeichen wie „→“ tippen: Die Meldung erklärt es; Schliessen des Tabs fragt, bevor die Eingaben verloren gehen. (07)

## Suche

- [ ] In einem grossen Projekt erscheinen die ersten Treffer der Projektsuche nach Sekundenbruchteilen. (08)
- [ ] Die Vorschau zeigt die Fundstelle mit Farben. (08)
- [ ] Ctrl + Shift + N in einem grossen Projekt (etwa mit node_modules und „include ignored“): Die Treffer folgen jedem Tastendruck ohne Stocken; ein Präfix wie „app“ steht vor verstreuten CamelCase-Treffern. (08)
- [ ] Projektsuche in einem Projekt mit minifizierten Dateien: Codium bleibt bedienbar, nach 2'000 Treffern steht „more results“. (08)
- [ ] Ein Projekt in einem Ordner, über dem eine fremde `.gitignore` liegt: Dateien des Projekts fehlen nicht. (08)

## Einstellungen und Voraussetzungen

- [ ] Der Einstellungsdialog listet die auf dem Rechner installierten JDKs ab 25. (09)
- [ ] Ohne Git (etwa Git kurz aus dem PATH nehmen): Jedes Projektfenster zeigt „Git not found“, „Open README“ öffnet das README am Abschnitt „Voraussetzungen“, im installierten Codium aus dem Installationsordner. (09)
- [ ] Ein Maven-Projekt auf einem Rechner ohne JDK 25 zeigt den Hinweis; mit JDK 25 nicht. (09)

## Markdown-Vorschau

- [ ] Spezifikation und Ticket-README sehen in der Vorschau gut aus; der Mermaid-Graph ist im dunklen Schema lesbar. (23)
- [ ] Das synchrone Scrollen fühlt sich natürlich an. (23)
- [ ] Ein Web-Link öffnet den Standardbrowser. (23)

## Terminal

- [ ] PowerShell 7 mit dem eigenen Profil: Prompt, Farben und Aliase wie gewohnt. (11)
- [ ] Einen Dev-Server starten, Terminal-Tab schliessen: Der Server ist beendet. (11)
- [ ] Werkzeugfenster in der Grösse ziehen: Das Terminal passt sich an, ohne Zeichensalat. (11)
- [ ] Claude Code im Terminal starten: Esc und Ctrl-Kürzel kommen bei Claude an. (11)

## Sprachfunktionen: TypeScript

- [ ] Ctrl halten und über Bezeichner fahren: Unterstreichung nur, wo ein Ziel existiert. (12)
- [ ] In einem echten TypeScript-Projekt fühlen sich Sprünge und Fehler an wie in IntelliJ. (12)
- [ ] Die semantische Färbung entspricht IntelliJ „Dark“. (13)
- [ ] Die Vervollständigung erscheint beim Tippen ohne spürbare Verzögerung. (13)
- [ ] Farben im Detail (Review): Konstanten auf Modulebene und Globale der Standardbibliothek (etwa `console`) erscheinen in der Grundfarbe; prüfen, ob IntelliJ sie violett bzw. kursiv zeigt. (13)

## Sprachfunktionen: Java

- [ ] Ein echtes Maven-Projekt mit Spring und Lombok: Import läuft mit Fortschritt durch, Ctrl + Linksklick auf eine Spring-Klasse zeigt ihren Quelltext. (14)
- [ ] Ein Projekt hinter dem Firmen-Mirror aus der eigenen settings.xml löst seine Abhängigkeiten auf. (14)
- [ ] Ein echtes Gradle-Projekt mit älterem Wrapper lässt sich importieren. (14)
- [ ] Die Färbung von Java-Code entspricht IntelliJ „Dark“. (14)
- [ ] Ein Maven-Projekt mit Firmen-Mirror in den globalen Einstellungen (`%MAVEN_HOME%\conf\settings.xml`) löst seine Abhängigkeiten auf. (14)

## Git: Klonen, Branches und Commit

- [ ] Ein echtes Repository (etwa von Bitbucket) über HTTPS klonen: Die Anmeldung über den Git Credential Manager erscheint und funktioniert. (10)
- [ ] In einem echten Repository mit vielen Branches findet das Suchfeld den richtigen Branch. (15)
- [ ] Die Farben in Änderungsansicht und Dateibaum entsprechen IntelliJ. (16)
- [ ] Eine Datei per `git add` im Terminal vorbereiten, in Codium nicht anhaken, etwas anderes committen: Die vorbereitete Datei ist weiterhin im Index. (16)
- [ ] ~~Die Git-Farben stammen aus dem klassischen Darcula (#6897BB, #629755, #D1675A); mit dem neuen IntelliJ „Dark“ vergleichen.~~ Ersetzt durch Ticket 29: Die Farben sind jetzt die des neuen IntelliJ „Dark“; geprüft wird mit den Punkten (29) unter „Nach Codium 1“. (16)

## Git: Vergleich, Änderungsbalken, Fetch/Pull/Push und Log

- [ ] Die Vergleichsansicht sieht aus wie in IntelliJ; Umschalten auf eine Spalte und die Pfeile funktionieren. (17)
- [ ] Die Änderungsbalken folgen dem Tippen ohne spürbare Verzögerung. (17)
- [ ] Gegen ein echtes Remote (etwa Bitbucket): Fetch, Pull und Push mit Anmeldung über den Git Credential Manager bzw. SSH. (18)
- [ ] Der Knopf „Pull“ im Hinweis nach einem abgelehnten Push funktioniert. (18)
- [ ] In einem echten Repository mit vielen Branches und Merges ist der Graph lesbar und gleicht dem von IntelliJ. (19)
- [ ] Scrollen durch einige tausend Commits bleibt flüssig. (19)

## Datenbank

- [ ] Verbindung zu einer echten PostgreSQL-Datenbank mit SSL. (20)
- [ ] Nach einem Neustart verbindet Codium ohne erneute Passworteingabe; mit „Ask for password every time“ wird gefragt. (20)
- [ ] Eine grosse Tabelle (über 100'000 Zeilen) öffnet schnell, Blättern und Sortieren sind flüssig. (21)

## Nach Codium 1

- [ ] Das Logo gefällt; es wirkt auch mit 16 px in der Taskleiste und im Explorer (`Codium.exe`) noch klar. (24)
- [ ] Installer und Deinstallierer zeigen das Logo, ebenso die Verknüpfungen im Startmenü und auf dem Desktop. Nach dem Aktualisieren einer bestehenden Installation kann Windows eine Weile noch das alte Symbol aus seinem Zwischenspeicher zeigen; dann nach einer Neuanmeldung nochmals ansehen. (24)
- [ ] Taskleiste und Alt + Tab zeigen das Logo, bei hellem und dunklem Windows-Design und bei 100 % und 150 % Skalierung. (24)
- [ ] `npm start`: Auch die Entwicklungsversion zeigt das Logo in Taskleiste und Alt + Tab, nicht das Symbol von Electron. (24)
- [ ] Das Willkommensfenster sieht mit dem Logo über dem Titel stimmig aus. (24)
- [ ] Zweimal Shift öffnet „Go to File“ und fühlt sich an wie in IntelliJ: weder zu träge noch löst es beim normalen Tippen (Grossbuchstaben, Shift + Klick, Alt + Shift) versehentlich aus. (26)
- [ ] Codium wirkt neben IntelliJ stimmig: Rundungen, Auswahlbalken, Menüs und Dialoge fühlen sich vertraut an. (25)
- [ ] Werkzeugfenster und Editor als Inseln: Bei normalem und maximiertem Fenster sind die Abstände gleichmässig, und nichts ragt über die runden Ecken hinaus (Editor, Vergleichsansicht, Markdown-Vorschau, Terminal, Git-Log, Datenbank, Tabellen). (25)
- [ ] Die Griffe zwischen den Inseln lassen sich mit der Maus gut treffen und ziehen. (25)
- [ ] Das Branch-Dropdown bedient sich wie das von IntelliJ, mit Maus und Tastatur: öffnet unter dem Branch-Knopf, Untermenü rechts daneben beim Überfahren, mit Enter oder Pfeil rechts, Pfeil links und Escape schliessen. (25)
- [ ] Ein Klick auf die leere Kopfzeile schliesst das Branch-Dropdown. (Unter Windows erreicht ein Klick auf die Zieh-Fläche die Seite womöglich nicht.) (25)
- [ ] Die Symbole sind bei 100 % und 150 % Skalierung klar und eindeutig. (25)
- [ ] Lange Branchnamen sind in der Kopfzeile ganz lesbar. (31)
- [ ] Im Branch-Dropdown finden sich Branches in den Ordnern `feature`, `bugfix` usw. so schnell wie in IntelliJ. (31)
- [ ] Unter „Recent“ stehen die Branches, zwischen denen ich zuletzt gewechselt habe. (31)
- [ ] Im schmalen Fenster mit langem Branchnamen lässt sich das Fenster rechts neben dem Branch-Knopf noch an der Kopfzeile ziehen. (31)
- [ ] Die Scrollbalken im Code-Bereich sehen aus wie in IntelliJ und lassen sich mit der Maus gut greifen, auch in der Vergleichsansicht, in der Vorschau der Projektsuche, im Peek und im Zelleditor einer Tabelle. (28)
- [ ] Fehler und Git-Änderungen sind im schmalen Streifen am rechten Rand weiter gut zu erkennen. (28)
- [ ] Die Kapsel erscheint beim Scrollen mit Mausrad, Touchpad und Tastatur und verschwindet kurz danach wieder; das Ausblenden stört nicht beim Suchen der Lage in der Datei. (28)
- [ ] Der schmale Streifen ist bei 100 % und 150 % Skalierung scharf, und ein Klick auf eine Markierung springt an die richtige Stelle. Bei 150 % können der Streifen (5 px, also 7,5 Bildpunkte) und die 9 px breite Kapsel leicht unscharf wirken; die Masse sind so freigegeben. (28)
- [ ] Die Kapsel blitzt auch auf, wenn die App selbst scrollt: beim Tabwechsel, beim nächsten Suchtreffer, bei der Auswahl in der Projektsuche. Stört das kurze Aufblitzen? (28)
- [ ] Zuklappen und Aufklappen eines Ordners im Dateibaum zeigt die Unterordner zu, auch nach einem Neustart. (29)
- [ ] Nicht getrackte Dateien und Ordner sind auf einen Blick erkennbar (ignorierte orange, nicht versionierte lachsrot), die Farben wirken so satt wie in IntelliJ. (29)
- [ ] Die Titel der Datei-Tabs tragen die Farbe des Git-Zustands und folgen ihm, etwa nach einem Commit oder Rollback. (29)
- [ ] In einem grossen Repository, auch mit einem grossen nicht versionierten Ordner, folgen Baum und Änderungsansicht Änderungen so flüssig wie bisher. (29)

## Frischer Rechner bzw. Windows-Benutzer (22)

Auf einem zweiten Rechner oder unter einem neuen Windows-Benutzer ohne Codium-Daten, mit Git und JDK 25 nach dem README:

- [ ] Installation über den Installer ohne weitere Einrichtung.
- [ ] Ein Java-Projekt (Maven) und ein TypeScript-Projekt öffnen: Ctrl + Linksklick funktioniert in beiden.
- [ ] Git-Funktionen gegen ein echtes Remote.
- [ ] Terminal mit PowerShell 7 bzw. Windows PowerShell.
- [ ] Verbindung zu einer PostgreSQL-Datenbank.
- [ ] Ohne JDK 25: Codium startet ohne Fehler, der JDK-Hinweis erscheint erst bei einem Java-Projekt, alles andere funktioniert.
- [ ] Ohne Git: Hinweis „Git not found“, alles ausser Git funktioniert.
