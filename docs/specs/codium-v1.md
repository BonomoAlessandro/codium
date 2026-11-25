# Codium 1: eine kleine IDE nach dem Vorbild IntelliJ

> Status: `ready-for-agent`
> Entstanden aus einer Befragung am 2026-11-20, danach durch zwei Reviews präzisiert; die Markdown-Vorschau kam am selben Tag auf Wunsch des Nutzers dazu. Grundlage ist das bestehende Electron-Grundgerüst (Stand 0.1.0). Punkte, die beim Schreiben oder nach dem Review ergänzt und nicht einzeln abgestimmt wurden, stehen am Ende unter „Präzisierungen beim Schreiben“. Umsetzung in Tickets: [docs/tickets](../tickets/README.md).

## Problemstellung

Für meine tägliche Arbeit brauche ich nur einen Teil von IntelliJ, diesen aber ständig:

- den Projektbaum und eine Liste der geänderten, neuen und gelöschten Dateien,
- Git: den aktuellen Branch sehen, Branches wechseln und anlegen, fetchen, pullen, committen und pushen,
- ein Terminal und die Git-Historie am unteren Rand,
- einen Datenbank-Viewer, mit dem ich Tabellen ansehen und Werte ändern kann,
- und vor allem Code, der schön farbig dargestellt wird und in dem ich mit Ctrl + Linksklick zu Methoden, Klassen und Feldern springen kann, in mehreren Tabs gleichzeitig.

Ich möchte eine eigene, schlanke IDE, die genau diese Teile so bedient wie IntelliJ, damit ich mich nicht umgewöhnen muss, und die ich selbst weiterentwickeln kann. Das Grundgerüst von Codium öffnet heute nur ein Fenster mit einem Platzhalter.

## Lösung

Codium wird eine Desktop-IDE für Windows im Stil des neuen IntelliJ, nur dunkel, mit englischer Oberfläche:

- **Ein Fenster pro Projekt.** Ein Projekt ist ein Ordner. Beim Start öffnen sich die zuletzt offenen Projekte wieder, sonst erscheint ein Willkommensfenster.
- **Aufbau wie IntelliJ:** Kopfzeile mit Projektname und Branch, links Projektbaum oder Änderungen, unten Terminal oder Git-Log, rechts der Datenbank-Viewer, in der Mitte der Code in Tabs, unten eine Statusleiste.
- **Ein echter Editor** (Monaco, der Editor aus VS Code), der automatisch speichert, mit den Code-Farben des IntelliJ-Schemas „Dark“ und der Schrift JetBrains Mono.
- **Markdown wie in IntelliJ:** `.md`-Dateien öffnen geteilt, links der Quelltext, rechts die gerenderte Vorschau mit Mermaid-Diagrammen und Bildern aus dem Projekt.
- **Sprachverständnis für Java und TypeScript/JavaScript:** Ctrl + Linksklick springt zur Definition, auch in Bibliotheken. Dazu kommen Verwendungen, semantische Färbung, Hover-Infos, Fehler und Vervollständigung. Alle anderen Dateiarten werden farbig dargestellt.
- **Git wie in IntelliJ:** Branch-Menü in der Kopfzeile, Commit-Fenster mit Häkchen statt Staging-Bereich, Vergleichsansicht, Änderungsbalken im Editor und ein Git-Log mit Graph.
- **Terminal** mit mehreren Tabs, standardmässig mit PowerShell 7.
- **Datenbank-Viewer für PostgreSQL:** Tabellen durchsehen, filtern, sortieren und Werte bearbeiten, gespeichert in einer Transaktion.
- **Tastenkürzel von IntelliJ**, auch beim Bearbeiten.
- **Klare Voraussetzungen:** Das README listet, was man zum Benutzen und zum Entwickeln braucht, und Codium prüft beim Start, ob Git und ein passendes JDK da sind.

## Begriffe

- **Projektfenster:** ein Fenster von Codium mit genau einem geöffneten Projekt (einem Ordner).
- **Willkommensfenster:** das Fenster ohne Projekt, mit zuletzt geöffneten Projekten, „Open Folder“ und „Clone Repository“.
- **Kopfzeile:** die oberste Leiste eines Projektfensters mit Projektmenü, Branch-Menü und den Fensterknöpfen von Windows.
- **Werkzeugfenster:** die ein- und ausklappbaren Bereiche an den Rändern. Links „Project“ (Dateibaum) und „Commit“ (Änderungsansicht), unten „Terminal“, „Git“ (mit den Reitern „Log“ und „Console“) und „Find“ (Trefferlisten, nur sichtbar, solange es welche gibt), rechts „Database“.
- **Symbolleiste:** die schmale Leiste am linken bzw. rechten Rand mit den Symbolen der Werkzeugfenster, wie im neuen IntelliJ. Die linke trägt oben die Symbole der Werkzeugfenster links und in ihrer unteren Gruppe die der Werkzeugfenster unten; die rechte trägt die der Werkzeugfenster rechts.
- **Code-Bereich:** die Mitte mit den Tabs. Ein Tab zeigt eine Datei, eine Vergleichsansicht, eine Bibliotheksklasse, einen Tabelleninhalt, ein Bild oder einen Hinweis.
- **Änderungsansicht:** das Werkzeugfenster „Commit“ mit den geänderten Dateien, den Häkchen und der Commit-Nachricht.
- **Vergleichsansicht:** ein Tab, der zwei Stände einer Datei nebeneinander oder in einer Spalte zeigt.
- **Markdown-Vorschau:** die gerenderte Ansicht einer `.md`-Datei, neben oder statt dem Quelltext im selben Tab.
- **Änderungsbalken:** die farbigen Markierungen am linken Rand des Editors für Zeilen, die sich seit dem letzten Commit geändert haben.
- **Git-Konsole:** der Reiter „Console“ im Werkzeugfenster „Git“, der die ausgeführten Git-Befehle mit Ausgabe zeigt.
- **Kern:** die gesamte Logik im Hauptprozess, ohne direkte Abhängigkeit von Electron. Er besteht aus dem **App-Kern** (Fenster, Projekte, Einstellungen, Voraussetzungen, JDK-Erkennung) und einem **Projekt-Kern** pro Projektfenster.
- **Dienste:** die Teile eines Projekt-Kerns: Datei-Dienst, Git-Dienst, Sprach-Dienst, Terminal-Dienst und Datenbank-Dienst.
- **Ports:** die schmalen Schnittstellen, über die der Kern Electron- und Systemfunktionen nutzt (Fenster, Ordnerauswahl, Verschlüsselung, Shell-Aktionen, System). Im Betrieb echt, im Test nachgemacht.
- **Vertrag:** die API, die das Preload-Skript der Oberfläche bereitstellt, und die Ereignisse, die der Kern an die Oberfläche schickt. Sie ist an einem Ort definiert.
- **Testmodus:** ein Betriebsmodus der echten App für automatische Prüfungen, gesteuert über Umgebungsvariablen (siehe „Testentscheidungen“).

Die Beschriftungen der Oberfläche sind englisch. Wo diese Spezifikation Menüs oder Knöpfe nennt, steht die englische Beschriftung in Anführungszeichen.

## User Stories

### Projekte und Fenster

1. Als Nutzer möchte ich einen Ordner über „Open Folder“ als Projekt öffnen, damit ich in jedem Ordner arbeiten kann, ohne vorher etwas einzurichten.
2. Als Nutzer möchte ich mehrere Projekte gleichzeitig offen haben, jedes in einem eigenen Fenster, damit ich wie in IntelliJ zwischen Projekten wechseln kann.
3. Als Nutzer möchte ich, dass ein schon offenes Projekt nicht ein zweites Mal geöffnet wird, sondern sein Fenster nach vorne kommt, damit ich nicht zwei Fenster für dasselbe Projekt habe.
4. Als Nutzer möchte ich, dass beim Start alle Projekte wieder aufgehen, die beim Beenden offen waren, damit ich dort weitermache, wo ich aufgehört habe.
5. Als Nutzer möchte ich ohne offenes Projekt ein Willkommensfenster mit den zuletzt geöffneten Projekten sehen, das sich schliesst, sobald ich daraus ein Projekt öffne, damit ich mit einem Klick wieder einsteige.
6. Als Nutzer möchte ich im Willkommensfenster und im Projektmenü ein Repository über „Clone Repository“ mit URL und Zielordner klonen, damit ich ein neues Projekt ohne Terminal hole.
7. Als Nutzer möchte ich über einen Klick auf den Projektnamen in der Kopfzeile ein Menü mit zuletzt geöffneten Projekten, „Open Folder“, „Clone Repository“, „Settings“ und „Exit“ öffnen, damit ich von jedem Fenster aus ein anderes Projekt öffnen oder Codium beenden kann.
8. Als Nutzer möchte ich, dass ein anderes Projekt immer in einem neuen Fenster aufgeht, damit das aktuelle Projekt offen bleibt.
9. Als Nutzer möchte ich, dass ein zweiter Start von Codium das zuletzt benutzte Fenster nach vorne holt, damit nicht eine zweite Instanz entsteht.
10. Als Nutzer möchte ich Codium über „Exit“ mit allen offenen Projekten beenden, und dass sich Codium auch beendet, wenn ich das letzte Projektfenster schliesse, damit es sich wie jedes andere Programm verhält.
11. Als Nutzer möchte ich, dass Codium sich pro Projekt die offenen Tabs, den aktiven Tab und die Cursorposition je Datei merkt, damit nach einem Neustart alles wieder so aussieht.
12. Als Nutzer möchte ich, dass Codium sich pro Projekt die aufgeklappten Ordner im Dateibaum merkt, damit ich nicht jedes Mal neu suchen muss.
13. Als Nutzer möchte ich, dass Codium sich pro Projekt die Grösse und den Zustand der Werkzeugfenster sowie Position und Grösse des Fensters merkt, damit mein Layout erhalten bleibt.
14. Als Nutzer möchte ich, dass ein Projekt aus der Liste der zuletzt geöffneten, dessen Ordner nicht mehr existiert, beim Anklicken eine verständliche Meldung zeigt und aus der Liste entfernt werden kann, damit die Liste sauber bleibt.

### Oberfläche und Werkzeugfenster

15. Als Nutzer möchte ich eine Kopfzeile mit Projektname und aktuellem Branch, damit ich jederzeit sehe, wo ich arbeite.
16. Als Nutzer möchte ich an den Rändern Symbolleisten mit den Werkzeugfenstern, wobei ein Klick ein Fenster öffnet oder schliesst, damit ich Platz für den Code schaffen kann.
17. Als Nutzer möchte ich links zwischen „Project“ und „Commit“ wechseln, indem ich das andere Symbol anklicke, damit ich schnell zwischen Dateibaum und Änderungen hin und her komme.
18. Als Nutzer möchte ich unten zwischen „Terminal“ und „Git“ wechseln, damit Terminal und Historie am selben Ort liegen.
19. Als Nutzer möchte ich rechts das Werkzeugfenster „Database“ öffnen, damit ich die Datenbank neben dem Code habe.
20. Als Nutzer möchte ich die Werkzeugfenster mit der Maus in der Grösse ziehen, damit ich die Aufteilung selbst bestimme.
21. Als Nutzer möchte ich die Werkzeugfenster mit den IntelliJ-Kürzeln öffnen und schliessen (Alt + 1 Project, Alt + 0 Commit, Alt + F12 Terminal, Alt + 9 Git, Alt + 3 Find), damit ich die Hände an der Tastatur behalte.
22. Als Nutzer möchte ich, dass das untere Werkzeugfenster über die ganze Breite geht, wie in IntelliJ, damit Terminal und Log genug Platz haben.
23. Als Nutzer möchte ich eine Statusleiste mit Zeile und Spalte des Cursors, Zeilenende und Kodierung, damit ich diese Angaben ohne Suchen sehe.
24. Als Nutzer möchte ich, dass Codium durchgehend dunkel ist, im Stil des neuen IntelliJ, damit es sich vertraut anfühlt.

### Dateibaum

25. Als Nutzer möchte ich im Werkzeugfenster „Project“ alle Dateien und Ordner des Projekts als Baum sehen, damit ich mich im Projekt zurechtfinde.
26. Als Nutzer möchte ich, dass Dateien nach ihrem Git-Zustand eingefärbt sind (geändert blau, neu grün, nicht versioniert rotbraun, ignoriert grau), damit ich Änderungen schon im Baum erkenne.
27. Als Nutzer möchte ich, dass ignorierte Ordner wie node_modules oder target sichtbar bleiben, aber grau sind, damit ich sie bei Bedarf öffnen kann.
28. Als Nutzer möchte ich, dass sich der Baum selbst aktualisiert, wenn sich auf der Festplatte etwas ändert, damit er nie veraltet ist.
29. Als Nutzer möchte ich mit einem Einfachklick eine Datei nur auswählen und mit Doppelklick oder Enter öffnen, damit ich wie in IntelliJ durch den Baum gehen kann.
30. Als Nutzer möchte ich per Rechtsklick eine neue Datei oder einen neuen Ordner anlegen, damit ich ohne Explorer arbeiten kann.
31. Als Nutzer möchte ich per Rechtsklick eine Datei oder einen Ordner umbenennen, wobei ein offener Tab dem neuen Namen folgt und Git eine versionierte Datei als umbenannt erkennt, damit ich Namen korrigieren kann.
32. Als Nutzer möchte ich per Rechtsklick Dateien und Ordner nach einer Rückfrage in den Papierkorb löschen, damit ein Fehlgriff rückgängig zu machen ist.
33. Als Nutzer möchte ich Dateien und Ordner kopieren und einfügen, damit ich Dateien schnell vervielfältigen kann.
34. Als Nutzer möchte ich per Rechtsklick den Pfad kopieren, die Datei im Explorer zeigen und ein Terminal im Ordner öffnen, damit ich schnell in andere Werkzeuge komme.
35. Als Nutzer möchte ich mit einem Knopf die gerade offene Datei im Baum zeigen lassen, damit ich sehe, wo sie liegt.
36. Als Nutzer möchte ich wissen, dass Umbenennen einer Java-Klasse im Baum nur den Dateinamen ändert und keine Verweise anpasst, damit ich nicht von einem Refactoring ausgehe.

### Editor und Tabs

37. Als Nutzer möchte ich Dateien in Tabs öffnen und mehrere gleichzeitig offen haben, damit ich zwischen Klassen wechseln kann.
38. Als Nutzer möchte ich, dass eine schon offene Datei nicht ein zweites Mal geöffnet wird, sondern ihr Tab aktiv wird, damit ich keine Doppelungen habe.
39. Als Nutzer möchte ich einen Tab per Mittelklick schliessen, damit Aufräumen schnell geht.
40. Als Nutzer möchte ich per Rechtsklick auf einen Tab „Close“, „Close Other Tabs“, „Close All Tabs“, „Close Tabs to the Right“ und „Pin Tab“ wählen, damit ich viele Tabs schnell ordne.
41. Als Nutzer möchte ich, dass angeheftete Tabs links stehen und bei „Close All Tabs“ offen bleiben, damit wichtige Dateien nicht verschwinden.
42. Als Nutzer möchte ich beliebig viele Tabs öffnen können; passen sie nicht in eine Zeile, lässt sich die Leiste scrollen und ein Pfeil listet alle, damit ich nie Tabs verliere.
43. Als Nutzer möchte ich, dass bei gleichen Dateinamen der Tab zusätzlich den Ordner zeigt, damit ich zwei „index.ts“ unterscheiden kann.
44. Als Nutzer möchte ich, dass Code in allen verbreiteten Dateiarten farbig dargestellt wird (Java, TypeScript, JavaScript, JSON, XML, YAML, SQL, Markdown, HTML, CSS, Properties, Shell- und PowerShell-Skripte und weitere, die Monaco kennt), damit ich jede Datei gut lesen kann.
45. Als Nutzer möchte ich die Code-Farben des IntelliJ-Schemas „Dark“ (Schlüsselwörter orange-braun, Strings grün, Zahlen türkis, Methodendeklarationen blau, Felder violett, Annotationen gelblich, Kommentare grau, statische Member kursiv), damit der Code wie in IntelliJ aussieht.
46. Als Nutzer möchte ich die Schrift JetBrains Mono in Grösse 13, verstellbar in den Einstellungen und mit Ctrl + Mausrad, damit ich die Grösse an meinen Bildschirm anpassen kann.
47. Als Nutzer möchte ich Dateien bearbeiten, mit Rückgängig und Wiederholen, damit Codium ein vollwertiger Editor ist.
48. Als Nutzer möchte ich in einer Datei suchen (Ctrl + F) und ersetzen (Ctrl + R), damit ich Stellen schnell finde und ändere.
49. Als Nutzer möchte ich die Bearbeitungs-Kürzel von IntelliJ (Ctrl + D Zeile duplizieren, Ctrl + Y Zeile löschen, Ctrl + / auskommentieren, Ctrl + W Auswahl erweitern, Ctrl + Shift + W Auswahl verkleinern, Shift + Alt + Hoch/Runter Zeile verschieben, Ctrl + Shift + Z Wiederholen), damit meine Finger nicht umlernen müssen.
50. Als Nutzer möchte ich mit Ctrl + G zu einer Zeile springen, damit ich Zeilenangaben aus Fehlermeldungen schnell finde.
51. Als Nutzer möchte ich einen Tab mit Ctrl + F4 schliessen und mit Ctrl + Tab zum zuletzt benutzten Tab wechseln, damit ich auch per Tastatur durch die Tabs komme.
52. Als Nutzer möchte ich, dass Bilder als Bild angezeigt werden, damit ich sie ohne anderes Programm ansehen kann.
53. Als Nutzer möchte ich, dass andere Binärdateien einen Hinweis zeigen statt Zeichensalat, damit ich nicht versehentlich etwas zerstöre.
54. Als Nutzer möchte ich, dass sehr grosse Dateien (über etwa 5 MB) ohne Sprachfunktionen öffnen, damit Codium nicht hängen bleibt.
55. Als Nutzer möchte ich, dass beim Öffnen einer Datei die zuletzt bekannte Cursorposition wiederhergestellt wird, damit ich dort weiterlese.

### Speichern

56. Als Nutzer möchte ich, dass meine Änderungen automatisch gespeichert werden, sobald ich etwa eine Sekunde aufhöre zu tippen, damit ich nie ans Speichern denken muss.
57. Als Nutzer möchte ich, dass auch beim Tabwechsel, beim Schliessen eines Tabs, beim Verlassen des Fensters und vor jeder Git-Aktion gespeichert wird, damit Git und andere Programme immer den aktuellen Stand sehen.
58. Als Nutzer möchte ich trotzdem Ctrl + S drücken können, damit ich sofort speichern kann, wenn ich will.
59. Als Nutzer möchte ich während des Tippens kurz sehen, dass ein Tab noch ungespeichert ist, damit ich weiss, dass das Speichern gleich folgt.
60. Als Nutzer möchte ich, dass ein offener Tab still neu lädt, wenn die Datei von aussen geändert wird (Branch-Wechsel, Pull, Claude Code, anderer Editor). Habe ich im selben Tab noch ungespeicherte Eingaben, möchte ich stattdessen einen Hinweis mit „Load from Disk“ und „Keep Mine“ bekommen, damit nie eine Fassung still verloren geht.
61. Als Nutzer möchte ich, dass sich der Tab einer von aussen gelöschten Datei schliesst, damit keine Geister-Tabs bleiben.
62. Als Nutzer möchte ich, dass Zeilenenden und Kodierung einer Datei beim Speichern erhalten bleiben, neue Dateien UTF-8 bekommen und beim Speichern nichts formatiert oder entfernt wird, damit Git keine Scheinänderungen zeigt.

### Suchen und Navigieren

63. Als Nutzer möchte ich nach einem Sprung mit Ctrl + Alt + Links und Ctrl + Alt + Rechts sowie mit den Seitentasten der Maus zurück und vor gehen, damit ich nach einem Ctrl + Linksklick wieder zurückfinde.
64. Als Nutzer möchte ich mit Ctrl + Shift + N eine Datei nach Namen suchen, auch mit unvollständigen Namen, damit ich jede Datei in Sekunden öffne.
65. Als Nutzer möchte ich mit Ctrl + N eine Klasse und mit Ctrl + Alt + Shift + N ein Symbol suchen, damit ich direkt zu einer Klasse oder Methode springe.
66. Als Nutzer möchte ich mit Ctrl + E die zuletzt geöffneten Dateien sehen, damit ich schnell zwischen ihnen wechsle.
67. Als Nutzer möchte ich mit Ctrl + Shift + F im ganzen Projekt suchen, in einem Suchfenster über dem Editor, damit ich Fundstellen schnell überblicke.
68. Als Nutzer möchte ich bei der Projektsuche Gross-/Kleinschreibung, ganzes Wort, reguläre Ausdrücke und eine Dateimaske wählen, damit ich gezielt suchen kann.
69. Als Nutzer möchte ich die Treffer schon während des Tippens sehen, mit einer Vorschau der Fundstelle samt umgebendem Code, damit ich die richtige Stelle ohne Öffnen erkenne.
70. Als Nutzer möchte ich mit Enter oder Doppelklick auf einen Treffer die Datei genau an der Fundstelle öffnen, damit ich sofort weiterarbeiten kann.
71. Als Nutzer möchte ich die Trefferliste mit einem Knopf dauerhaft im Werkzeugfenster „Find“ unten ablegen, damit ich viele Treffer nacheinander abarbeiten kann.
72. Als Nutzer möchte ich, dass von Git ignorierte Dateien standardmässig nicht durchsucht werden und sich per Schalter einbeziehen lassen, damit node_modules und target die Suche nicht fluten.
73. Als Nutzer möchte ich bei sehr vielen Treffern einen Hinweis bekommen, dass es mehr gibt, damit Codium nicht hängt und ich die Suche verfeinere.
74. Als Nutzer möchte ich mit Alt + F7 die Verwendungen des Symbols unter dem Cursor im Werkzeugfenster „Find“ sehen, damit ich sehe, wo etwas benutzt wird.

### Sprachverständnis

75. Als Nutzer möchte ich mit Ctrl + Linksklick (oder Ctrl + B) auf eine Methode, Klasse, ein Feld oder eine Variable zur Definition springen, damit ich Code wie in IntelliJ erkunde.
76. Als Nutzer möchte ich, dass beim Halten von Ctrl ein Bezeichner unterstrichen wird, wenn er ein Sprungziel hat, damit ich sehe, wohin ich klicken kann.
77. Als Nutzer möchte ich mit Ctrl + Linksklick auf eine Deklaration die Liste ihrer Verwendungen sehen, damit ich wie in IntelliJ vom Ziel zu den Aufrufern komme.
78. Als Nutzer möchte ich bei mehreren möglichen Zielen eine Auswahl bekommen und mit Ctrl + Alt + B die Implementierungen eines Interfaces oder einer Methode sehen, damit ich das richtige Ziel wähle.
79. Als Nutzer möchte ich mit Ctrl + Linksklick auch in Klassen aus Bibliotheken (etwa Spring) springen und ihren Quelltext schreibgeschützt in einem Tab sehen, damit ich verstehe, was eine Bibliothek tut.
80. Als Nutzer möchte ich, dass bei fehlenden Quellen einer Bibliothek wenigstens die Signaturen angezeigt werden, damit der Sprung nie ins Leere geht.
81. Als Nutzer möchte ich eine semantische Färbung, bei der Felder, lokale Variablen, Parameter und statische Member unterschiedlich aussehen, damit der Code so lesbar ist wie in IntelliJ.
82. Als Nutzer möchte ich beim Überfahren eines Bezeichners mit der Maus (oder mit Ctrl + Q an der Cursorposition) seinen Typ und seine Dokumentation (Javadoc bzw. JSDoc) sehen, damit ich nicht springen muss, um etwas nachzulesen.
83. Als Nutzer möchte ich Fehler rot und Warnungen gelb unterstrichen sehen, mit der Meldung beim Überfahren, damit ich Probleme sofort bemerke.
84. Als Nutzer möchte ich beim Tippen Vorschläge zur Vervollständigung bekommen (automatisch und mit Ctrl + Leertaste), damit ich schneller schreibe.
85. Als Nutzer möchte ich, dass das Sprachverständnis für Java mit Maven- und Gradle-Projekten funktioniert, auch mit Lombok, damit meine Java-Projekte ohne Einrichtung gehen.
86. Als Nutzer möchte ich, dass Codium meine Maven-Einstellungen (inklusive Firmen-Mirror) automatisch nutzt, damit Abhängigkeiten aufgelöst werden wie auf der Kommandozeile.
87. Als Nutzer möchte ich, dass Codium die installierten JDKs erkennt und ein Projekt gegen das JDK prüft, das zu seiner Java-Version passt, damit ein Java-8- oder Java-17-Projekt richtig verstanden wird.
88. Als Nutzer möchte ich, dass ein TypeScript-Projekt mit der TypeScript-Version aus dem Projekt verstanden wird, damit Fehler und Vervollständigung zum Projekt passen.
89. Als Nutzer möchte ich in der Statusleiste sehen, dass ein Java-Projekt gerade importiert wird, damit ich verstehe, warum Ctrl + Linksklick noch nicht geht.
90. Als Nutzer möchte ich, dass Änderungen von aussen (Branch-Wechsel, Pull) auch im Sprachverständnis ankommen, damit Sprünge und Fehler stimmen.

### Git: Branches

91. Als Nutzer möchte ich den aktuellen Branch in der Kopfzeile sehen, damit ich nie auf dem falschen Branch arbeite.
92. Als Nutzer möchte ich neben dem Branchnamen sehen, wie viele Commits ich gegenüber dem Remote voraus und zurück bin (etwa ↑2 ↓3), damit ich weiss, ob ich pushen oder pullen muss.
93. Als Nutzer möchte ich, dass diese Zahlen nach Fetch, Pull und Push aktualisiert werden, ohne dass Codium selbst im Hintergrund fetcht, damit Codium nur dann mit dem Server spricht, wenn ich es will.
94. Als Nutzer möchte ich mit einem Klick auf den Branch ein Branch-Menü mit Suchfeld öffnen, damit ich auch bei vielen Branches schnell den richtigen finde.
95. Als Nutzer möchte ich im Branch-Menü „Pull“, „Commit…“, „Push…“, „Fetch“ und „New Branch…“ finden, damit die häufigsten Aktionen einen Klick entfernt sind.
96. Als Nutzer möchte ich im Branch-Menü die lokalen und die Remote-Branches getrennt sehen, mit Markierung des aktuellen, damit ich den Überblick behalte.
97. Als Nutzer möchte ich einen lokalen Branch über „Checkout“ auschecken, damit ich den Branch wechseln kann.
98. Als Nutzer möchte ich einen neuen Branch vom aktuellen Stand oder von einem anderen Branch anlegen und direkt auschecken, damit ich neue Arbeit sauber trenne.
99. Als Nutzer möchte ich einen lokalen Branch umbenennen, damit ich Tippfehler korrigieren kann.
100. Als Nutzer möchte ich einen lokalen Branch löschen, damit ich aufräumen kann.
101. Als Nutzer möchte ich einen Remote-Branch als lokalen Branch auschecken, der dem Remote-Branch folgt, damit ich an fremden Branches mitarbeiten kann.
102. Als Nutzer möchte ich „Fetch“ ausführen, damit ich neue Branches und Commits vom Server sehe.
103. Als Nutzer möchte ich „Pull“ ausführen (Kürzel Ctrl + T), damit mein Branch auf dem Stand des Remotes ist.
104. Als Nutzer möchte ich „Push“ ausführen (Kürzel Ctrl + Shift + K), damit meine Commits auf den Server kommen.

### Git: Änderungen und Commit

105. Als Nutzer möchte ich im Werkzeugfenster „Commit“ alle geänderten, hinzugefügten, gelöschten und umbenannten Dateien in der Gruppe „Changes“ sehen, farbig wie in IntelliJ, damit ich weiss, was ich geändert habe.
106. Als Nutzer möchte ich neue Dateien, die Git noch nicht kennt, in einer eigenen Gruppe „Unversioned Files“ sehen, damit ich sie bewusst aufnehme oder ignoriere.
107. Als Nutzer möchte ich jede Datei und jede Gruppe mit einem Häkchen in den Commit aufnehmen oder ausschliessen, wobei „Changes“ anfangs angehakt ist und „Unversioned Files“ nicht, damit ich nur committe, was dazugehört.
108. Als Nutzer möchte ich, dass ein Häkchen an einer neuen Datei genügt, um sie in den Commit aufzunehmen, ohne separates „git add“, damit es so einfach ist wie in IntelliJ.
109. Als Nutzer möchte ich, dass Codium den Staging-Bereich von Git nicht zeigt und nicht verlangt, damit ich mich nur um Häkchen kümmern muss.
110. Als Nutzer möchte ich eine Commit-Nachricht schreiben und mit „Commit“ committen (Kürzel Ctrl + K öffnet die Änderungsansicht), damit ich ohne Terminal committen kann.
111. Als Nutzer möchte ich mit „Commit and Push“ in einem Schritt committen und pushen, damit ich nicht zweimal klicken muss.
112. Als Nutzer möchte ich mit dem Häkchen „Amend“ den letzten Commit ergänzen, wobei die bisherige Nachricht vorausgefüllt wird, damit ich Vergessenes nachreichen kann.
113. Als Nutzer möchte ich per Doppelklick auf eine Datei die Vergleichsansicht öffnen, damit ich vor dem Commit sehe, was sich geändert hat.
114. Als Nutzer möchte ich per Rechtsklick „Rollback…“ wählen und nach einer Rückfrage die Änderungen an einer oder mehreren Dateien verwerfen, damit ich missglückte Änderungen loswerde.
115. Als Nutzer möchte ich per Rechtsklick eine Datei öffnen, damit ich direkt aus der Änderungsansicht weiterarbeite.
116. Als Nutzer möchte ich eine neue Datei per Rechtsklick „Add to .gitignore“ ignorieren, damit sie nicht mehr auftaucht.
117. Als Nutzer möchte ich die Liste wahlweise flach oder nach Ordnern gruppiert sehen, damit ich bei vielen Änderungen den Überblick behalte.
118. Als Nutzer möchte ich, dass sich die Änderungsansicht nach jedem Speichern und jeder Änderung von aussen selbst aktualisiert, damit sie immer stimmt.

### Vergleichsansicht und Änderungsbalken

119. Als Nutzer möchte ich die Vergleichsansicht als Tab im Code-Bereich sehen, links den alten und rechts den neuen Stand, damit ich Unterschiede direkt vergleiche.
120. Als Nutzer möchte ich die Vergleichsansicht auf eine Spalte umschalten, damit ich bei schmalen Fenstern trotzdem alles sehe.
121. Als Nutzer möchte ich mit Pfeilen zur nächsten und vorherigen Änderung springen, damit ich lange Dateien schnell durchgehe.
122. Als Nutzer möchte ich in der Vergleichsansicht gegen den aktuellen Stand die rechte Seite bearbeiten können, mit automatischem Speichern, damit ich Korrekturen direkt dort mache.
123. Als Nutzer möchte ich, dass Vergleiche aus der Historie auf beiden Seiten schreibgeschützt sind, damit ich nichts Vergangenes zu ändern versuche.
124. Als Nutzer möchte ich im Editor am linken Rand Änderungsbalken sehen (blau geändert, grün neu, grauer Keil für gelöschte Zeilen), damit ich beim Lesen sehe, was ich seit dem letzten Commit geändert habe.
125. Als Nutzer möchte ich mit einem Klick auf einen Änderungsbalken den alten Stand dieses Blocks sehen und genau diesen Block zurücksetzen können, damit ich einzelne Änderungen verwerfe, ohne die ganze Datei zu verlieren.

### Git: Problemfälle und Konsole

126. Als Nutzer möchte ich beim Branch-Wechsel, den Git wegen lokaler Änderungen verweigert, die Meldung und die betroffenen Dateien sehen, damit ich entscheiden kann, was ich tue.
127. Als Nutzer möchte ich, dass ein Push eines Branches, den es auf dem Remote noch nicht gibt, ihn dort automatisch unter demselben Namen anlegt, damit der erste Push eines neuen Branches einfach funktioniert.
128. Als Nutzer möchte ich bei einem abgelehnten Push eine Meldung mit dem Angebot bekommen, zuerst zu pullen, damit ich weiss, wie es weitergeht.
129. Als Nutzer möchte ich, dass Pull nach meiner Git-Einstellung arbeitet (Merge oder Rebase), damit Codium sich wie mein Git auf der Kommandozeile verhält.
130. Als Nutzer möchte ich, dass bei einem Konflikt nach einem Pull die betroffenen Dateien rot in einer Gruppe „Merge Conflicts“ erscheinen, damit ich sie finde.
131. Als Nutzer möchte ich die Konfliktmarkierungen direkt im Editor auflösen und danach committen bzw. fortsetzen, mit einer Warnung, falls noch Markierungen übrig sind, damit ich einen Konflikt ohne anderes Werkzeug sauber abschliesse.
132. Als Nutzer möchte ich beim Löschen eines Branches, der noch nicht gemerged ist, eine Rückfrage bekommen und ihn danach trotzdem löschen können, damit ich keine Arbeit versehentlich verliere.
133. Als Nutzer möchte ich, dass Fehlermeldungen von Git im Wortlaut angezeigt werden, damit ich sie verstehe oder nachschlagen kann.
134. Als Nutzer möchte ich im Werkzeugfenster „Git“ einen Reiter „Console“ mit den ausgeführten Git-Befehlen und ihrer Ausgabe, damit ich nachvollziehen kann, was Codium getan hat.

### Git-Log

135. Als Nutzer möchte ich im Reiter „Log“ alle Commits über alle Branches sehen, mit Commit-Nachricht, Branch- und Tag-Etiketten, Autor und Datum, damit ich die Historie überblicke.
136. Als Nutzer möchte ich Graph-Linien, die zeigen, wie Branches auseinander- und zusammenlaufen, damit ich die Geschichte wie in IntelliJ lesen kann.
137. Als Nutzer möchte ich, dass beim Scrollen weitere Commits nachgeladen werden, damit auch grosse Repositories schnell öffnen.
138. Als Nutzer möchte ich nach Text (Nachricht oder Hash), Branch und Autor filtern, damit ich einen bestimmten Commit schnell finde.
139. Als Nutzer möchte ich zum gewählten Commit rechts die geänderten Dateien und die Details (vollständige Nachricht, Hash, Autor, Datum) sehen, damit ich weiss, was der Commit enthält.
140. Als Nutzer möchte ich per Doppelklick auf eine Datei eines Commits die Vergleichsansicht dieses Commits öffnen, damit ich die Änderung im Detail sehe.
141. Als Nutzer möchte ich per Rechtsklick auf einen Commit den Hash kopieren, damit ich ihn woanders verwenden kann.
142. Als Nutzer möchte ich per Rechtsklick auf einen Commit einen neuen Branch ab diesem Commit anlegen, damit ich von einem alten Stand aus weiterarbeiten kann.
143. Als Nutzer möchte ich per Rechtsklick einen Commit auschecken, wobei die Kopfzeile dann den Commit statt eines Branches zeigt, damit ich einen alten Stand ansehen kann.
144. Als Nutzer möchte ich, dass sich der Log nach eigenen Git-Aktionen und nach Fetch aktualisiert, damit er immer den aktuellen Stand zeigt.

### Terminal

145. Als Nutzer möchte ich im Werkzeugfenster „Terminal“ ein echtes Terminal, das im Projektordner startet, damit ich Befehle wie gewohnt ausführen kann.
146. Als Nutzer möchte ich mehrere Terminals in Tabs gleichzeitig offen haben, damit ich etwa einen Server und eine Shell nebeneinander laufen lassen kann.
147. Als Nutzer möchte ich, dass PowerShell 7 die Standard-Shell ist und Windows PowerShell einspringt, wenn PowerShell 7 fehlt, damit ich ohne Einstellung eine moderne Shell bekomme.
148. Als Nutzer möchte ich die Shell in den Einstellungen wählen (unter den gefundenen: PowerShell 7, Windows PowerShell, cmd, Git Bash), damit ich meine Lieblings-Shell nutzen kann.
149. Als Nutzer möchte ich aus dem Dateibaum „Open in Terminal“ wählen und ein Terminal in diesem Ordner bekommen, damit ich nicht erst „cd“ tippen muss.
150. Als Nutzer möchte ich, dass ein Terminal-Tab beim Schliessen seine Shell samt gestarteter Programme beendet, damit keine Prozesse liegen bleiben.
151. Als Nutzer möchte ich nach einem Neustart ein frisches Terminal bekommen, damit ich in einem sauberen Zustand beginne.

### Datenbank

152. Als Nutzer möchte ich im Werkzeugfenster „Database“ eine Verbindung zu einer PostgreSQL-Datenbank anlegen (Host, Port, Datenbank, Benutzer, Passwort, SSL ja oder nein), damit ich meine Datenbank in Codium sehe.
153. Als Nutzer möchte ich eine Verbindung vor dem Speichern mit „Test Connection“ prüfen, damit ich Tippfehler sofort bemerke.
154. Als Nutzer möchte ich, dass Verbindungen zum Projekt gehören und nicht im Projektordner liegen, damit sie im richtigen Projekt erscheinen und nie in Git landen.
155. Als Nutzer möchte ich, dass das Passwort mit der Verschlüsselung von Windows für mein Benutzerkonto gespeichert wird, nie im Klartext, damit es sicher ist.
156. Als Nutzer möchte ich pro Verbindung „Ask for password every time“ wählen können, damit sensible Passwörter gar nicht gespeichert werden.
157. Als Nutzer möchte ich Verbindungen bearbeiten und löschen, damit ich sie aktuell halte.
158. Als Nutzer möchte ich einen Baum aus Verbindung, Datenbank, Schemas, Tabellen und Views sehen, damit ich mich in der Datenbank zurechtfinde.
159. Als Nutzer möchte ich beim Aufklappen einer Tabelle ihre Spalten mit Typ und Primärschlüssel sehen, damit ich die Struktur kenne.
160. Als Nutzer möchte ich per Doppelklick den Inhalt einer Tabelle als Tab im Code-Bereich öffnen, damit ich genug Platz für viele Spalten habe.
161. Als Nutzer möchte ich den Inhalt seitenweise mit 500 Zeilen sehen und blättern, damit auch grosse Tabellen schnell laden.
162. Als Nutzer möchte ich mit einem Klick auf einen Spaltenkopf sortieren, ausgeführt von der Datenbank, damit die Sortierung über die ganze Tabelle stimmt.
163. Als Nutzer möchte ich eine WHERE-Bedingung in ein Filterfeld schreiben (etwa status = 'aktiv'), damit ich nur die Zeilen sehe, die mich interessieren.
164. Als Nutzer möchte ich eine Zelle per Doppelklick bearbeiten und geänderte Zellen farbig markiert sehen, bis sie gespeichert sind, damit ich weiss, was noch offen ist.
165. Als Nutzer möchte ich Zeilen hinzufügen und löschen, wobei gelöschte Zeilen bis zum Speichern durchgestrichen sind, damit ich Daten pflegen kann.
166. Als Nutzer möchte ich alle offenen Änderungen mit „Submit“ (Ctrl + Enter) in einer einzigen Transaktion speichern, damit entweder alles oder nichts in der Datenbank landet.
167. Als Nutzer möchte ich mit „Revert“ alle offenen Änderungen verwerfen, damit ich einen Fehler ohne Folgen zurücknehme.
168. Als Nutzer möchte ich bei einem Fehler beim Speichern die Meldung der Datenbank sehen, wobei meine Änderungen offen bleiben, damit ich sie korrigieren und erneut speichern kann.
169. Als Nutzer möchte ich, dass Tabellen ohne Primärschlüssel und Views schreibgeschützt sind, mit einem Hinweis warum, damit nie die falsche Zeile geändert wird.
170. Als Nutzer möchte ich einen Wert per Rechtsklick auf NULL setzen und NULL grau angezeigt sehen, damit ich NULL von einem leeren Text unterscheiden kann.
171. Als Nutzer möchte ich lange Texte und JSON in einem grösseren Bearbeitungsfeld öffnen, damit ich sie bequem lesen und ändern kann.

### Einstellungen, Meldungen und Voraussetzungen

172. Als Nutzer möchte ich einen Einstellungsdialog (Ctrl + Alt + S oder über das Projektmenü) mit Shell, Schriftgrösse und JDK für den Java-Sprachserver, damit ich die wenigen Einstellungen schnell finde.
173. Als Nutzer möchte ich, dass die Einstellungen für alle Projekte gemeinsam gelten, damit ich sie nur einmal setze.
174. Als Nutzer möchte ich in der Statusleiste links laufende Hintergrundarbeit mit Fortschritt sehen (etwa „Importing Java project…“ oder „Pushing…“), damit ich weiss, dass Codium arbeitet.
175. Als Nutzer möchte ich Meldungen als kleine Hinweise unten rechts bekommen, damit sie mich nicht unterbrechen.
176. Als Nutzer möchte ich, dass Erfolgsmeldungen nach einigen Sekunden verschwinden und Fehler bleiben, bis ich sie schliesse, damit ich keinen Fehler übersehe.
177. Als Nutzer möchte ich, dass Codium beim Start prüft, ob Git gefunden wird, und mir sonst einen verständlichen Hinweis mit Verweis auf das README zeigt, damit Git-Funktionen nicht still fehlen.
178. Als Nutzer möchte ich, dass Codium prüft, ob ein JDK 25 oder neuer für den Java-Sprachserver installiert ist, und mir sonst einen Hinweis zeigt, damit ich weiss, warum Ctrl + Linksklick in Java nicht geht.
179. Als Nutzer möchte ich im README eine Liste der Voraussetzungen zum Benutzen der App sehen, damit ich vor der Installation weiss, was ich brauche.
180. Als Entwickler möchte ich im README eine Liste der Voraussetzungen zum Bauen aus dem Quellcode sehen, damit ich ohne Ausprobieren loslegen kann.
181. Als Nutzer möchte ich Codium über den bestehenden Windows-Installer installieren, damit die Installation wie gewohnt geht.
182. Als Nutzer möchte ich, dass Projekte ohne Git-Repository trotzdem öffnen und nur die Git-Funktionen fehlen, damit ich auch einfache Ordner bearbeiten kann.

### Markdown

183. Als Nutzer möchte ich, dass eine `.md`-Datei wie in IntelliJ geteilt öffnet, links der Quelltext und rechts die gerenderte Vorschau, damit ich Dokumentation gleichzeitig lesen und bearbeiten kann.
184. Als Nutzer möchte ich oben im Tab zwischen „Editor“, „Split“ und „Preview“ umschalten, wobei Codium sich die Ansicht pro Datei merkt, damit ich reine Lesedateien als Vorschau und Arbeitsdateien geteilt sehe.
185. Als Nutzer möchte ich, dass sich die Vorschau beim Tippen aktualisiert, damit ich sofort sehe, wie der Text aussieht.
186. Als Nutzer möchte ich in der Vorschau Überschriften, Listen, Tabellen, Aufgabenlisten, Zitate, Links und Code-Blöcke mit denselben Farben wie im Editor sehen, damit Dokumentation so aussieht wie auf GitHub oder in IntelliJ.
187. Als Nutzer möchte ich, dass Mermaid-Blöcke als Diagramm erscheinen, damit ich Abläufe und Abhängigkeiten wie in meinen Ticket-Übersichten direkt sehe.
188. Als Nutzer möchte ich, dass relativ verlinkte Bilder aus dem Projekt in der Vorschau erscheinen, damit Skizzen und Screenshots neben dem Text stehen.
189. Als Nutzer möchte ich, dass die Vorschau in der geteilten Ansicht dem Scrollen im Editor folgt, damit ich immer die Stelle sehe, an der ich schreibe.
190. Als Nutzer möchte ich, dass ein Klick auf einen Web-Link in der Vorschau ihn im Standardbrowser öffnet, damit ich verlinkte Seiten lesen kann.

## Implementierungsentscheidungen

### Architektur im Überblick

- Der **Hauptprozess bleibt die einzige Quelle der Wahrheit**, wie im Grundgerüst angelegt: Die Logik liegt im Kern im Hauptprozess, ohne direkte Abhängigkeit von Electron. Die Oberfläche zeigt an und schickt Befehle.
- Der **App-Kern** besitzt:
  - die offenen Projektfenster und die zuletzt geöffneten Projekte, das Wiederöffnen beim Start
  - die Einzelinstanz-Regel (zweiter Start holt das zuletzt benutzte Fenster nach vorne) und die Regel „ein Projekt nur einmal offen“
  - die Einstellungen, die Prüfung der Voraussetzungen und die JDK-Erkennung
  - das Klonen und den App-Zustand
- Pro Projektfenster entsteht ein **Projekt-Kern**. Er wird beim Öffnen des Fensters erzeugt und beim Schliessen geordnet abgebaut: Sprachserver (samt Kindprozessen), Terminals, Datenbankverbindungen und Dateiüberwachung werden beendet. Er besteht aus den Diensten:
  - **Datei-Dienst:** Dateibaum, Lesen und Schreiben (mit Erhalt von Kodierung und Zeilenende), Dateiüberwachung, Dateioperationen, Dateisuche nach Namen und Projektsuche.
  - **Git-Dienst:** alle Git-Funktionen über das installierte Git, inklusive Log mit Graph-Spuren und Änderungsblöcken für die Änderungsbalken.
  - **Sprach-Dienst:** startet und verwaltet die Sprachserver für Java und TypeScript/JavaScript und bietet ihre Funktionen mit eigenen, typisierten Methoden an.
  - **Terminal-Dienst:** Shells über node-pty.
  - **Datenbank-Dienst:** Verbindungen, Metadaten, seitenweises Laden und Speichern von Änderungen für PostgreSQL.
- Der Kern hängt nur über schmale **Ports** von Electron und vom System ab. Im Betrieb echt, im Test nachgemacht:
  - **Fenster:** Projektfenster und Willkommensfenster öffnen, nach vorne holen, schliessen; Position und Grösse lesen und setzen; angeschlossene Bildschirme.
  - **Ordnerauswahl:** der Ordnerdialog von Windows. Rückfragen sind dagegen Dialoge in der Oberfläche selbst, nicht über einen Port.
  - **Geheimnisse:** Text mit der Verschlüsselung von Windows ver- und entschlüsseln.
  - **Shell-Aktionen:** in den Papierkorb verschieben, im Explorer zeigen, Zwischenablage, eine Web-Adresse im Standardbrowser öffnen.
  - **System:** Umgebungsvariablen, Suche nach Programmen (Git, Shells), Benutzerordner, Lesen von Ordnern für die JDK-Erkennung. Die echte Umsetzung kommt ohne Electron aus, damit auch die langsamen Tests sie verwenden können.
- Dateisystem, Git, ripgrep, Sprachserver, node-pty und PostgreSQL sind **keine** Ports: Der Kern benutzt sie direkt, und die Tests verwenden sie echt (siehe „Testentscheidungen“).
- Schreibzugriffe des Kerns auf seinen Zustand laufen entprellt und atomar (in eine Temp-Datei schreiben, dann umbenennen). Eine kaputte Zustandsdatei wird beiseitegelegt statt überschrieben.

### Vertrag zwischen Oberfläche und Kern

- Der Vertrag ist weiterhin an einem Ort definiert (Typen der API und Namen der IPC-Kanäle) und wird von Preload und Hauptprozess gemeinsam benutzt.
- **Befehle** gehen von der Oberfläche an den Kern als Anfrage mit Antwort, etwa „Datei lesen“, „Datei schreiben“, „Commit“, „Definition an Position“, „Tabellenseite laden“.
- **Ereignisse** gehen vom Kern an das Fenster seines Projekts, etwa „Datei geändert oder gelöscht“, „Git-Zustand geändert“, „Fehler und Warnungen einer Datei“, „Terminal-Ausgabe“, „Fortschritt“, „Meldung“.
- Jedes Projektfenster spricht nur mit seinem eigenen Projekt-Kern. Der Kern ordnet Anfragen dem Fenster zu, von dem sie kommen.
- Der Sprach-Dienst bietet **typisierte Methoden** an (Definition, Verwendungen, Implementierungen, Hover, Vervollständigung, semantische Token, Symbolsuche, Inhalt eines schreibgeschützten Ziels) statt rohe Nachrichten des Language Server Protocol durchzureichen. So bleibt die Oberfläche unabhängig vom Protokoll, und die Funktionen lassen sich am Vertrag testen.
- Die Oberfläche meldet dem Sprach-Dienst geöffnete, geänderte und geschlossene Dokumente mit ihrem aktuellen Text, auch vor dem Speichern, damit Vervollständigung und Fehler zum getippten Stand passen.
- Das Fenster bleibt abgeschottet wie im Grundgerüst (Kontext-Isolation, Sandbox, keine Navigation, keine fremden Fenster). Monaco, sein Web Worker und die Schrift werden lokal mitgeliefert, nichts wird aus dem Netz geladen. Bilder aus dem Projekt kommen als Daten über den Vertrag und werden als data-URL angezeigt; die Sicherheitsrichtlinie der Seite erlaubt zusätzlich nur Worker aus den eigenen Dateien.

### Fenster, Projekte und gespeicherter Zustand

- Ein Projekt wird über seinen **normalisierten absoluten Pfad** identifiziert (unter Windows ohne Unterscheidung der Gross-/Kleinschreibung). So erkennt der App-Kern, dass ein Projekt schon offen ist.
- **App-Zustand** im Datenordner von Codium: zuletzt geöffnete Projekte (die letzten 20, neueste zuerst), beim Beenden offene Projekte, Einstellungen, Position und Grösse des Willkommensfensters, zuletzt gewählter Elternordner fürs Klonen.
- **Projekt-Zustand** pro Projekt im Datenordner von Codium (nicht im Projektordner), unter einem aus dem Pfad abgeleiteten Namen: offene Tabs in Reihenfolge mit angehefteten Tabs, aktiver Tab, Cursorposition und Scrollstand je Datei, zuletzt geöffnete Dateien, aufgeklappte Ordner, Werkzeugfenster (welche offen, welches pro Seite aktiv, Grössen), Fensterposition und -grösse, Ansicht der Änderungsansicht (flach oder nach Ordnern), Datenbankverbindungen.
- Beide Zustände tragen eine **Schemaversion**, damit spätere Versionen übernehmen können.
- **Beim Start** öffnet der App-Kern alle Projekte, die beim Beenden offen waren. Fehlt ein Projektordner, erscheint ein Hinweis, und das Projekt wird übersprungen. Bleibt kein Projekt, erscheint das Willkommensfenster.
- **Fensterlage:** Eine gespeicherte Lage auf einem Bildschirm, der nicht mehr angeschlossen ist, wird auf den Hauptbildschirm verschoben.
- **Willkommensfenster:** Öffnet der Nutzer daraus ein Projekt, schliesst es sich, ohne dass Codium sich beendet.
- **Beenden:**
  - „Exit“ im Projektmenü beendet Codium mit allen offenen Projekten; sie gelten als „beim Beenden offen“. Ebenso das Abmelden oder Herunterfahren von Windows.
  - Schliesst der Nutzer das letzte Projektfenster, beendet sich Codium; dieses letzte Projekt gilt als „beim Beenden offen“.
  - Ein Projektfenster, das geschlossen wurde, während noch andere offen waren, gehört nicht dazu.
  - Schliesst der Nutzer das Willkommensfenster als einziges Fenster, beendet sich Codium.
- **Klonen:** „Clone Repository“ fragt nach URL und Zielordner (Vorschlag: Ordnername aus der URL unter dem zuletzt gewählten Elternordner), führt das Klonen über das installierte Git mit Fortschritt aus und öffnet danach das Projekt in einem neuen Fenster.
- Die bestehende Trennung bleibt: Unpaketiert verwendet Codium den Datenordner „Codium-dev“ und damit eigenen Zustand und eine eigene Einzelinstanz-Sperre.

### Oberfläche

- **Fensterrahmen:** Die Kopfzeile wird von Codium selbst gezeichnet; die Fensterknöpfe von Windows bleiben über die Titelleisten-Überlagerung von Electron erhalten. Der Fenstertitel in der Taskleiste lautet „Projektname – Codium“.
- **Kopfzeile:** links das Projektmenü (Projektname mit Pfeil), daneben das Branch-Menü (Branchname, voraus/zurück). In einem Ordner ohne Git-Repository fehlt das Branch-Menü.
  - Der Projektname ist höchstens 280 px breit, der Branchname doppelt so breit, also höchstens 560 px (Ticket 31). Längere Namen werden mit „…“ gekürzt; der Tooltip nennt den vollen Namen, beim Branch mit Upstream.
  - Ist das Fenster schmal, wird der Branchname weiter gekürzt. Rechts bleibt immer ein Stück Zieh-Fläche frei (48 px), und nichts reicht unter die Fensterknöpfe.
  - Die Breiten stehen als Design-Variablen in `tokens.css`.
- **Werkzeugfenster:**
  - Symbolleisten links und rechts wie im neuen IntelliJ: links oben „Project“ und „Commit“, links in der unteren Gruppe „Terminal“, „Git“ und „Find“, rechts „Database“. Die Symbole der unteren Gruppe öffnen ihr Werkzeugfenster unten.
  - Pro Seite ist höchstens ein Werkzeugfenster sichtbar; ein Klick auf das Symbol des sichtbaren Fensters schliesst es, ein Klick auf ein anderes wechselt.
  - Grössen per Ziehen an den Griffen zwischen den Flächen (seit Ticket 25 im Abstand zwischen den Inseln); Mindest- und Höchstgrössen verhindern, dass der Code-Bereich verschwindet.
  - Das untere Werkzeugfenster geht über die ganze Breite zwischen den Symbolleisten.
  - Das Werkzeugfenster „Find“ erscheint in der unteren Gruppe der linken Symbolleiste, sobald es Trefferlisten gibt (abgelegte Projektsuche, Verwendungen über Alt + F7), und verschwindet, wenn der Nutzer alle schliesst. Jede Trefferliste ist ein eigener Reiter.
- **Rückfragen** (Löschen, Rollback, nicht gemergter Branch, offene Änderungen in der Datenbank) sind Dialoge in der Oberfläche, nicht Dialoge von Windows.
- **Statusleiste:** links Fortschritt laufender Arbeiten, rechts Zeile:Spalte, Zeilenende, Kodierung.
- **Meldungen:** Hinweise unten rechts, gestapelt. Erfolg und Information verschwinden nach etwa fünf Sekunden, Fehler bleiben, bis sie geschlossen werden. Ein Hinweis kann Knöpfe tragen (etwa „Pull“ nach einem abgelehnten Push, „Open README“ bei fehlenden Voraussetzungen, „Show Log“ und „Restart“ nach wiederholten Abstürzen eines Sprachservers). Ein Klick führt den Knopf aus und schliesst den Hinweis; ein Knopf kann ihn stehen lassen, damit ein zweiter Knopf danach noch geht („Show Log“, Ticket 30).
- **Design:**
  - Nur dunkel, angelehnt an das neue IntelliJ-Design „Dark“.
  - Die bestehenden Design-Variablen werden auf ein einziges dunkles Schema reduziert.
  - Die Fensterfarbe beim Öffnen ist immer die dunkle Hintergrundfarbe dieses Schemas, unabhängig vom Windows-Design; das Grundgerüst wechselt heute bei hellem Windows auf Weiss, das entfällt.
  - Scrollbalken in allen Monaco-Editoren (Code-Bereich, Vergleich, Vorschau der Projektsuche, Zelleditor) wie im neuen IntelliJ (Ticket 28): rechts ein 16 px breiter Rand, darin links eine Kapsel (6 px, beim Darüberfahren und Ziehen 9 px, gegriffen wird auf 10 px) und ganz rechts ein eigener Streifen von 5 px mit allen Markierungen (Fehler, Warnungen, Suchtreffer, Git-Änderungen, Cursorzeile) in voller Breite. Keine Spur, kein Schatten; Farben wie IntelliJ „Dark“. Die Kapsel ist ausgeblendet, solange nicht gescrollt wird, und erscheint beim Scrollen, beim Darüberfahren und beim Ziehen; der Streifen bleibt sichtbar und anklickbar. In der Vergleichsansicht entfällt der eckige Kasten in Monacos Vergleichsübersicht; deren rote und grüne Markierungen bleiben, und mit der Maus über der Übersicht erscheint die Kapsel des rechten Editors. Die Werte stehen in `src/renderer/editor/theme.ts`. Die Scrollbalken ausserhalb von Monaco (Listen, Baum, Terminal, Markdown-Vorschau) sehen anders aus.
- **Code-Farben:** Ein Monaco-Farbschema nach dem IntelliJ-Editorschema „Dark“ deckt die Wortarten ab (Schlüsselwörter, Strings, Zahlen, Kommentare, Annotationen, Typen). Die semantischen Token der Sprachserver werden auf dieselben Farben abgebildet (Felder violett, statische Member kursiv, Methodendeklarationen blau, Parameter und lokale Variablen in der Grundfarbe, Konstanten violett kursiv), so wie IntelliJ sie zeigt.
- **Schrift:**
  - JetBrains Mono wird mitgeliefert (freie Lizenz OFL), Standardgrösse 13 wie in IntelliJ (Monaco-Schriftgrösse 13).
  - Verstellbar im Einstellungsdialog und mit Ctrl + Mausrad. Die Grösse gilt dann für alle Editoren und wird als Einstellung gespeichert.
- **Tastenkürzel:**
  - IntelliJ-Belegung für alle Funktionen dieser Version; die vollständige Liste steht in den User Stories, Git- und Fensterkürzel siehe Präzisierungen.
  - Eine zentrale Tastenbelegung der Oberfläche gibt den App-Kürzeln Vorrang vor Monaco.
  - Monacos eigene Belegungen, die kollidieren, werden entfernt oder überschrieben: Ctrl + K als Auftakt für Zweierkürzel, Ctrl + Shift + K (Zeile löschen), Alt + F12 (Definition einblenden), Ctrl + Y (Wiederholen), Ctrl + D, Ctrl + W, Ctrl + R, Ctrl + G, Ctrl + E und Ctrl + B.
  - **Im Terminal** gehören alle Tasten der Shell, ausser den Kürzeln für Werkzeugfenster und Einstellungen: Alt + 1, Alt + 0, Alt + 3, Alt + 9, Alt + F12, Ctrl + Alt + S. Esc bleibt bei der Shell. Zweimal Shift öffnet auch dort die Dateisuche; Shift allein schickt der Shell nichts (Ticket 26).
- **Oberflächensprache:** Englisch, ohne Sprachumschaltung (auch die Sprachangabe der Seite). README und Code-Kommentare bleiben deutsch.

### Editor, Tabs und Speichern

- **Monaco** ist der Editor für Dateien, Bibliotheksklassen und die Vergleichsansicht.
  - Monacos eingebaute Sprachfunktionen (TypeScript, JavaScript, JSON, CSS, HTML) werden abgeschaltet; es bleiben die Farben nach Wortarten. Mitgeliefert wird daher nur Monacos allgemeiner Editor-Worker. Sprachfunktionen kommen ausschliesslich vom Sprach-Dienst.
  - **Ein Modell pro Datei:** Datei-Tab, rechte Seite einer Vergleichsansicht und Sprach-Dienst nutzen dasselbe Monaco-Modell, damit nie zwei Fassungen derselben Datei gleichzeitig gespeichert werden.
  - **Sprungziele** in anderen Dateien öffnet ein eigener Editor-Opener von Codium als Tab. Bevor Definition, Verwendungen oder Implementierungen an Monaco zurückgehen, legt die Oberfläche Modelle für alle Ziele an (Dateiinhalt bzw. Inhalt der Bibliotheksklasse), damit Auswahl und Vorschau funktionieren.
- **Tabs** gehören zur Oberfläche, ihr Zustand wird aber im Projekt-Zustand gesichert. Ein Tab ist eines von: Datei, Vergleichsansicht, Bibliotheksklasse, Tabelleninhalt, Bild, Hinweis. Beim Wiederherstellen werden nur Datei-Tabs wiederhergestellt; Tabs fehlender Dateien entfallen still.
- **Tab-Beschriftung:** Dateiname; bei gleichen Namen zusätzlich der kürzeste unterscheidende Teil des Ordnerpfads.
- **Automatisches Speichern:**
  - Die Oberfläche speichert etwa eine Sekunde nach der letzten Eingabe, sofort beim Tabwechsel, beim Schliessen des Tabs, wenn das Fenster den Fokus verliert, und bei Ctrl + S.
  - Bevor sie eine Git-Aktion auslöst, speichert sie ebenfalls; die Git-Aktion wartet, bis alle offenen Speichervorgänge des Fensters fertig sind.
  - Die Markierung „ungespeichert“ am Tab ist nur zwischen Eingabe und Speichern sichtbar.
- **Lesen:** Erkennung in dieser Reihenfolge:
  1. BOM: UTF-8, UTF-16 LE oder BE
  2. Null-Bytes in den ersten 8 KB: Binärdatei
  3. gültiges UTF-8
  4. sonst Windows-1252

  Das Zeilenende ist das in der Datei überwiegende (LF oder CRLF).
- **Schreiben** im Datei-Dienst: Kodierung, BOM und Zeilenende der Datei bleiben erhalten. Neue Dateien bekommen UTF-8 ohne BOM und das Zeilenende, das im Projekt überwiegt (Rückfall LF). Beim Speichern wird nichts verändert, also kein Formatieren und kein Entfernen von Leerzeichen.
- **Änderungen von aussen:**
  - Der Datei-Dienst meldet geänderte und gelöschte Dateien. Eigene Schreibvorgänge erkennt er und meldet sie nicht als Änderung von aussen.
  - **Ohne ungespeicherte Eingaben:** Ist eine geänderte Datei offen, lädt der Tab still neu, mit Erhalt von Cursor und Scrollstand, so gut es geht.
  - **Mit ungespeicherten Eingaben:** Codium speichert nicht automatisch, sondern zeigt im Tab einen Hinweis „File changed on disk“ mit „Load from Disk“ (fremde Fassung übernehmen, eigene Eingaben verwerfen) und „Keep Mine“ (eigene Fassung speichern). Bis zur Entscheidung ruht das automatische Speichern für diesen Tab.
  - **Gelöscht:** Wird eine offene Datei gelöscht, schliesst sich ihr Tab. Gelöscht heisst: Die Datei fehlt noch, nachdem die Ereignisse gebündelt wurden. „Gelöscht und neu angelegt“, wie Git es beim Checkout tut, gilt als Änderung.
- **Bilder:** PNG, JPEG, GIF, WebP, BMP und ICO erscheinen als Bild. SVG öffnet als Text.
- **Grosse Dateien:** Ab etwa 5 MB öffnet die Datei ohne Sprachfunktionen und ohne Änderungsbalken. Ab 50 MB öffnet sie gar nicht, sondern zeigt einen Hinweis.
- **Zurück und Vor:** Die Oberfläche führt pro Projektfenster einen Navigationsverlauf von Positionen (Datei und Cursor). Ein Eintrag entsteht bei Sprüngen (Ctrl + Linksklick, Suche, Verwendungen, Zu Zeile) und bei grösseren Cursorbewegungen über mehr als einige Zeilen. Die Seitentasten der Maus lösen Zurück und Vor aus.
- **Ctrl + Tab** wechselt zum zuletzt benutzten Tab, wiederholtes Drücken bei gehaltenem Ctrl weiter zurück.

### Markdown-Vorschau

- **Ansichten:** `.md`-Dateien sind Datei-Tabs mit drei Ansichten: „Editor“ (nur Monaco), „Split“ (Monaco links, Vorschau rechts, Trennlinie verschiebbar) und „Preview“ (nur die Vorschau). Der Umschalter sitzt oben rechts im Tab. Standard ist „Split“; die gewählte Ansicht merkt sich Codium pro Datei im Projekt-Zustand.
- **Rendern** in der Oberfläche mit markdown-it: CommonMark mit Tabellen, Durchstreichen und Aufgabenlisten wie auf GitHub. Die Vorschau entsteht aus demselben Modell wie der Editor, also auch vor dem Speichern, entprellt etwa 200 ms nach der letzten Eingabe.
- **HTML im Markdown** wird dargestellt, aber vorher mit DOMPurify bereinigt: keine Skripte, keine Ereignis-Attribute, keine eingebetteten Seiten oder Formulare.
- **Code-Blöcke** erscheinen mit Monacos Einfärbung im Farbschema „Dark“, in der Sprache aus der Angabe nach den drei Backticks.
- **Mermaid:**
  - Blöcke mit der Sprache `mermaid` zeichnet die mitgelieferte Mermaid-Bibliothek als SVG, im dunklen Schema und mit strenger Sicherheitsstufe.
  - Die Bibliothek ist gross und wird erst geladen, wenn eine Datei ein Mermaid-Diagramm enthält.
  - Ein fehlerhaftes Diagramm zeigt an seiner Stelle die Fehlermeldung; der Rest der Vorschau bleibt.
- **Bilder:** Relative Bildpfade werden gegen den Ordner der `.md`-Datei aufgelöst und über den Vertrag als Daten geladen, wie bei Bild-Tabs, höchstens 10 MB pro Bild. Pfade ausserhalb des Projekts und Bilder aus dem Netz werden nicht geladen; an ihrer Stelle steht der Alternativtext.
- **Synchrones Scrollen:** markdown-it liefert zu jedem Block die Quellzeilen. In der geteilten Ansicht scrollt die Vorschau so, dass der Block zur obersten sichtbaren Editorzeile oben steht. Die Richtung ist nur Editor → Vorschau.
- **Links:** Web-Links (http, https, mailto) öffnen im Standardbrowser über den Port „Shell-Aktionen“, im Testmodus nur aufgezeichnet. Relative Links und Anker werden in dieser Version nicht verfolgt; beim Überfahren zeigt ein Tooltip das Ziel.
- **Grenze:** Die Vorschau gibt es für Dateien bis 5 MB, wie die Sprachfunktionen; darüber öffnet nur der Editor.
- **Aussehen:** dunkel, passend zum übrigen Codium und angelehnt an die Markdown-Vorschau von IntelliJ.

### Dateien, Dateiüberwachung und Suche

- **Dateibaum:** Der Datei-Dienst liefert Ordnerinhalte auf Anfrage (nur aufgeklappte Ordner), sortiert Ordner vor Dateien, alphabetisch ohne Unterscheidung der Gross-/Kleinschreibung. Der Ordner `.git` wird nicht angezeigt.
- **Git-Farben im Baum** kommen aus dem Zustand des Git-Dienstes (geändert, neu, nicht versioniert, ignoriert, Konflikt). Ein Ordner erbt die Farbe nicht, das bleibt wie in IntelliJ den Dateien vorbehalten; ignorierte Ordner sind grau.
- **Dateiüberwachung:**
  - Rekursive Überwachung des Projektordners mit den Mitteln von Node. Ereignisse werden kurz gesammelt und gebündelt gemeldet; danach wird geprüft, was wirklich existiert.
  - Kommt ein Ereignis ohne Dateinamen (etwa bei übergelaufenem Puffer unter Windows), liest der Dienst die betroffenen Ordner neu ein.
  - Änderungen in `.git` lösen keine Dateiereignisse aus, aber eine Aktualisierung des Git-Zustands, wenn HEAD, Index oder Refs betroffen sind.
- **Dateioperationen:**
  - Neu (Datei, Ordner), Umbenennen, Löschen in den Papierkorb (über den Port), Kopieren und Einfügen (bei Namenskonflikt wird ein Name mit Zusatz vorgeschlagen), Pfad kopieren, im Explorer zeigen.
  - Ein Umbenennen in Codium benachrichtigt die Sprachserver über die Dateiänderung, passt aber keine Verweise an.
  - Bei einer versionierten Datei merkt der Git-Dienst die Umbenennung im Index vor (wie „git mv“), damit Änderungsansicht und Commit sie als Umbenennung führen.
- **Dateiliste:** Grundlage für die Dateisuche nach Namen ist die Liste aller Dateien des Projekts über ripgrep, inklusive versteckter Dateien (ohne `.git`), mit Rücksicht auf `.gitignore` auch ausserhalb eines Git-Repositorys. Die Dateiüberwachung hält die Liste aktuell.
- **Dateisuche nach Namen** (Ctrl + Shift + N oder, wie „Search Everywhere“ in IntelliJ, zweimal kurz Shift allein; Ticket 26): unscharfer Vergleich (Buchstabenfolge, Bevorzugung von Wortanfängen und CamelCase, wie in IntelliJ). Ignorierte Dateien fehlen standardmässig; ein Schalter „include ignored“ nimmt sie dazu, damit auch Dateien wie `.env` auffindbar sind.
- **Zuletzt geöffnete Dateien** (Ctrl + E) führt die Oberfläche pro Projekt; die Liste wird im Projekt-Zustand gesichert.
- **Projektsuche** (Ctrl + Shift + F):
  - Über ripgrep, das mit Codium ausgeliefert wird.
  - Wie die Dateiliste mit versteckten Dateien und mit `.gitignore` auch ausserhalb eines Git-Repositorys; der Schalter „include ignored“ hebt die Rücksicht auf `.gitignore` auf.
  - Die Treffer kommen gestreamt. Die Suche bricht nach 2'000 Treffern ab und meldet „more results“. Eine neue Eingabe bricht die laufende Suche ab.
  - Die Vorschau zeigt die Fundstelle mit einigen Zeilen davor und danach in Monaco mit Farben.
  - „Open in Find Window“ legt die Trefferliste als Reiter in das Werkzeugfenster „Find“.

### Sprachverständnis

- **Sprachserver Java:** Eclipse JDT Language Server (jdtls), in einer festen Version mit Codium ausgeliefert, zusammen mit Lombok.
- **Sprachserver TypeScript/JavaScript:** Seit TypeScript 7 gibt es den alten tsserver nicht mehr; TypeScript 7 bringt einen eigenen, nativen Sprachserver mit. Codium wählt deshalb pro Projekt:
  - **Projekt mit eigenem TypeScript ab Version 7:** dessen nativer Sprachserver.
  - **Projekt mit eigenem TypeScript bis Version 6:** typescript-language-server mit dem tsserver des Projekts.
  - **Projekt ohne eigenes TypeScript:** der native Sprachserver eines mitgelieferten TypeScript 7.
  - **Kein Rückfall nötig:** Der native Sprachserver liefert alle Funktionen dieser Version (geklärt in Ticket 12, siehe „Grundlage der Entscheidungen“); ein mitgeliefertes TypeScript 6 gibt es nicht.
- **Start:**
  - Pro Projektfenster höchstens ein Server je Sprache.
  - Er startet beim Öffnen des Projekts, wenn das Projekt Kennzeichen der Sprache hat (Java: Maven- oder Gradle-Baudatei; TypeScript/JavaScript: tsconfig, jsconfig oder package.json), sonst beim Öffnen der ersten Datei dieser Sprache.
  - Stürzt ein Server ab, startet der Sprach-Dienst ihn neu, höchstens dreimal in drei Minuten, danach erscheint ein Fehlerhinweis. Er trägt die Knöpfe „Show Log“ (öffnet das Protokoll der Sprachserver, die Meldung bleibt stehen) und „Restart“ (startet den Server neu, ohne das Projekt neu zu öffnen; die Zählung beginnt von vorn). Seit Ticket 30.
  - **Protokoll der Sprachserver** (Ticket 30): Jede Verbindung hebt die letzten 64 KB dessen auf, was ihr Server auf stderr schreibt. Endet ein Server unerwartet, schreibt der Sprach-Dienst Zeitpunkt, Projekt, Server, Art (`kind`), Programm, Exit-Code bzw. Signal, wie es weitergeht, und das aufgehobene stderr nach `logs\language-servers.log` im Datenordner (im Testmodus im Datenordner des Tests). Würde ein Eintrag das Protokoll über 1 MB bringen, wird es zu `language-servers.old.log`, und ein neues beginnt; „Show Log“ zeigt erst das ersetzte, dann das aktuelle. Ein normales Beenden durch Codium kommt nicht ins Protokoll. Beim Beenden von Codium wartet der Kern bis 2 s auf Einträge, die noch geschrieben werden.
  - Beim Abbau des Projekt-Kerns beendet der Dienst alle Server samt Kindprozessen.
- **Laufzeiten:**
  - jdtls braucht seit Oktober 2026 mindestens **Java 25**. Codium startet es mit dem neuesten erkannten JDK ab 25, unabhängig von JAVA_HOME; in den Einstellungen lässt sich ein anderes JDK ab 25 wählen.
  - Der TypeScript-Server läuft als native Programmdatei (TypeScript 7) bzw. mit der Node-Laufzeit von Electron (typescript-language-server); ein installiertes Node.js ist nicht nötig.
- **JDK-Erkennung** (App-Kern, über den Port „System“): JAVA_HOME, die üblichen Installationsordner von Oracle, Eclipse Adoptium, Microsoft, Amazon Corretto und Azul Zulu sowie die von IntelliJ heruntergeladenen JDKs im Benutzerordner, jeweils mit Version. Die erkannten JDKs werden jdtls als verfügbare Laufzeiten gemeldet; jdtls wählt pro Projekt die Laufzeit, die zum Java-Stand des Projekts passt.
- **Maven:** jdtls importiert Maven-Projekte mit seinem eingebauten Maven und übernimmt die Maven-Einstellungen des Benutzers (inklusive Mirror). Quellen von Bibliotheken lädt es herunter; das Herunterladen ist ausdrücklich eingeschaltet, weil es bei jdtls standardmässig aus ist.
- **Gradle:** jdtls importiert Gradle-Projekte über den Wrapper im Projekt. Der Gradle-Daemon läuft mit einem erkannten JDK, das zur Gradle-Version des Wrappers passt (nach der Verträglichkeitstabelle von Gradle). Sonst liesse sich ein Projekt mit Gradle 8 auf dem Java 25 von jdtls nicht importieren.
- **Lombok:** jdtls startet mit Lombok als Java-Agent, damit erzeugte Methoden bekannt sind und keine falschen Fehler erscheinen.
- **Arbeitsdaten** von jdtls liegen pro Projekt im Datenordner von Codium, ebenso eine beschreibbare Kopie seines Konfigurationsordners. Der Programmordner der installierten App ist nicht beschreibbar.
- **Funktionen dieser Version:**
  - **Definition:** Ctrl + Linksklick mit Unterstreichung beim Halten von Ctrl, oder Ctrl + B. Mehrere Ziele zeigt Monaco als Auswahl.
  - **Verwendungen:** Liefert die Definition die Stelle selbst, also steht der Cursor auf einer Deklaration, zeigt Codium stattdessen die Verwendungen als Auswahl; Monaco unterstützt das als Ersatzbefehl beim Sprung. Alt + F7 legt die Verwendungen als Reiter in das Werkzeugfenster „Find“.
  - **Implementierungen:** Ctrl + Alt + B.
  - **Bibliotheksklassen:** Ziele in Klassendateien (JDK, Bibliotheken) liefert jdtls nur, wenn Codium beim Start die Unterstützung für Klasseninhalte anmeldet. Der Sprach-Dienst holt den Inhalt über die zugehörige Erweiterung von jdtls und öffnet ihn als schreibgeschützten Tab, mit Quelltext oder, wenn keiner da ist, mit den Signaturen, die jdtls erzeugt. Für TypeScript öffnen Ziele in Typdefinitionen unter node_modules schreibgeschützt.
  - **Semantische Färbung** über die semantischen Token der Server.
  - **Hover:** Typ und Dokumentation, als Markdown dargestellt; Ctrl + Q zeigt dasselbe an der Cursorposition.
  - **Fehler und Warnungen:** Die Meldungen der Server werden als Markierungen in Monaco gezeigt.
  - **Vervollständigung:** automatisch beim Tippen und mit Ctrl + Leertaste, inklusive nachgeladener Details der gewählten Vorschläge.
  - **Symbolsuche:** Ctrl + N (Klassen, Interfaces, Enums) und Ctrl + Alt + Shift + N (alle Symbole), über alle Sprachserver des Projekts. Bei Java liefert jdtls Typen und, mit eingeschalteter Option, Methoden aus dem Quelltext, aber keine Felder; Ctrl + Alt + Shift + N ist für Java entsprechend eingeschränkt.
- **Dateiänderungen von aussen** und Dateioperationen in Codium (neu, umbenannt, gelöscht) meldet der Sprach-Dienst den Servern, damit Branch-Wechsel und Pull ankommen.
- **Fortschritt:** Fortschrittsmeldungen der Server, etwa der Import eines Java-Projekts, erscheinen in der Statusleiste.
- **Dateiarten ohne Sprachserver** bekommen nur die Farben nach Wortarten von Monaco.

### Git

- Der Git-Dienst ruft das **installierte Git** auf, mit dem Projektordner als Arbeitsordner.
  - Er liest Ausgaben in maschinenlesbaren Formaten (Porcelain, nullterminiert), mit unveränderten Umlauten in Pfaden.
  - Abfragen, die nur lesen, sperren den Index nicht.
  - Git wird **nie mit einem interaktiven Editor oder einer Eingabeaufforderung im Terminal** gestartet: Der Editor ist für jeden Aufruf auf ein Programm gesetzt, das nichts tut, und Eingabeaufforderungen im Terminal sind abgeschaltet.
  - Die Anmeldung läuft über die eingerichteten Helfer (Git Credential Manager mit eigenem Fenster, SSH-Agent).
- **Git-Konsole:** Jeder Aufruf wird mit Zeitpunkt, Befehl, Ausgabe und Exit-Code festgehalten, die letzten 1'000 pro Projektfenster, nicht gespeichert. Angezeigt werden standardmässig die vom Nutzer ausgelösten, schreibenden und Netzwerk-Befehle. Automatische Abfragen im Hintergrund (Zustand, Refs, Inhalte für die Änderungsbalken) blendet der Schalter „Show background commands“ dazu.
- Schreibende Git-Aktionen eines Projekts laufen nacheinander, nie gleichzeitig.
- **Zustand:** Der Git-Dienst ermittelt aktuellen Branch oder abgekoppelten Commit, Upstream, voraus/zurück, laufenden Merge oder Rebase und den Zustand jeder Datei: geändert, hinzugefügt, gelöscht, umbenannt, nicht versioniert, ignoriert, Konflikt. Er aktualisiert ihn nach eigenen Aktionen, nach Dateiereignissen (gebündelt) und wenn das Fenster den Fokus bekommt.
- **Kein Repository:** Ist der Projektordner kein Git-Repository und liegt auch in keinem, fehlen Branch-Menü und Git-Farben, und die Werkzeugfenster „Commit“ und „Git“ zeigen „Not a Git repository“.
- **Branches:**
  - Lokale und Remote-Branches mit Upstream und voraus/zurück liest der Git-Dienst aus den Refs.
  - **Checkout** wechselt den Branch. Verweigert Git wegen lokaler Änderungen, zeigt Codium die Meldung von Git mit der Liste der betroffenen Dateien. Es legt nichts automatisch beiseite.
  - **New Branch** legt den Branch vom aktuellen Stand, von einem gewählten Branch oder von einem Commit an und checkt ihn direkt aus (abschaltbar per Häkchen im Dialog).
  - **Remote-Branch auschecken** legt einen lokalen Branch gleichen Namens an, der dem Remote-Branch folgt. Gibt es den lokalen Namen schon, checkt Codium diesen aus.
  - **Rename** benennt einen lokalen Branch um.
  - **Delete** löscht einen lokalen Branch. Ist er nicht gemerged, verweigert Git, Codium fragt nach und löscht dann erzwungen. Der aktuelle Branch lässt sich nicht löschen.
- **Branch-Menü** (Dropdown unter dem Branch-Knopf, Tickets 25 und 31): Titelzeile mit „Fetch“, Suchfeld, die Aktionen „Pull“, „Commit…“, „Push…“ und „New Branch…“, darunter die Bereiche „Recent“, „Local“ und „Remote“. Jede Branchzeile hat ein Untermenü (lokal „Checkout“, „New Branch from …“, „Rename…“, „Delete“; remote „Checkout“, „New Branch from …“); der aktuelle Branch trägt das gelbe Etikett, voraus und zurück stehen als farbige Pfeile.
  - **Recent:** die letzten 5 ausgecheckten lokalen Branches, der neueste zuerst, mit vollem Namen. Der aktuelle Branch zählt nicht mit, gelöschte fallen weg (dafür rücken ältere nach), losgelöste Stände zählen nicht. Ohne Eintrag fehlt der Bereich samt Überschrift. Ein Branch kann zugleich unter „Recent“ und „Local“ stehen.
    - Quelle ist der Reflog von HEAD: Aus „checkout: moving from <vorher> to <nachher>“ zählt der verlassene Stand, wie bei Git selbst für `@{-1}`. So zählen auch Wechsel im Terminal oder in anderen Werkzeugen, und Codium speichert nichts.
    - Der Git-Dienst liest höchstens die letzten 512 KB der Datei (2'500 bis 4'000 Einträge), weil Git für `git log -g` immer den ganzen Reflog liest. Ohne Datei (Ref-Speicher „reftable“) fragt er Git nach den neuesten 3'000 Einträgen.
  - **Ordner:** Unter „Local“ und „Remote“ bildet ein „/“ im Namen Ordner wie in IntelliJ: `feature/login` steht als „login“ im Ordner „feature“, mehrere Ebenen ergeben verschachtelte Ordner. Bei Remote-Branches ist das Remote die erste Ebene, auch bei nur einem Remote (wie in IntelliJ). Je Ebene stehen Ordner vor Branches, beides alphabetisch ohne Rücksicht auf Gross und Klein, Zahlen nach ihrem Wert. Untermenü, Checkout und Tooltip arbeiten mit dem vollen Namen.
  - **Auf- und Zuklappen** mit Klick, Enter oder Pfeil rechts bzw. links; Pfeil rechts auf einem offenen Ordner geht zum ersten Eintrag, Pfeil links auf einem Branch im Ordner zum Ordner. Pfeil rechts auf einer Branchzeile öffnet ihr Untermenü. Mit Shift, Ctrl oder Alt gehören Pfeil links und rechts dem Suchfeld. Zuklappen schliesst auch die Ordner darin. Beim Öffnen des Dropdowns sind die Ordner offen, die der Nutzer aufgeklappt hat (das Projektfenster merkt sie sich für die Sitzung, gespeichert wird nichts), und dazu die Ordner des aktuellen Branches; diese gehen nicht in den gemerkten Zustand ein.
  - **Suchen** filtert über den vollen Namen, in allen Bereichen: `feat` findet auch `feature/login`. Während gefiltert wird, sind alle Ordner mit Treffern offen und zeigen nur die Treffer; Ordner und Bereiche ohne Treffer verschwinden. Nach dem Leeren des Suchfelds gilt wieder der gemerkte Zustand.
  - **Breite:** Das Dropdown folgt dem Inhalt, mindestens 380 px, höchstens 680 px, und bleibt im Fenster. Solange es offen ist, wird es beim Aufklappen höchstens breiter, nie schmaler. Meldungen (etwa ein Fehler beim Laden) machen es nicht breiter, sie brechen um.
- **Fetch** holt von allen Remotes und entfernt Remote-Branches, die es auf dem Server nicht mehr gibt (siehe Präzisierungen). Es gibt keinen automatischen Fetch.
- **Pull** holt und führt zusammen nach der Git-Konfiguration des Nutzers. Codium gibt keine Strategie vor.
- **Push:**
  - Push schiebt den aktuellen Branch.
  - Hat der Branch noch keinen Upstream, pusht Codium auf das Remote „origin“ (gibt es nur ein Remote, auf dieses) unter demselben Namen und setzt den Upstream.
  - Lehnt der Server ab, weil der Remote weiter ist, erscheint ein Hinweis mit dem Knopf „Pull“. Codium pusht nie erzwungen.
- **Commit ohne Staging-Bereich:**
  - Codium committet genau die angehakten Dateien: Neu angehakte, nicht versionierte Dateien werden dem Index zuerst hinzugefügt, dann wird nur mit den angehakten Pfaden committet. Was der Nutzer anderswo im Index vorbereitet hat, bleibt für nicht angehakte Dateien unberührt.
  - Umbenennungen werden mit altem und neuem Pfad committet.
  - Beim Erscheinen sind Dateien in „Changes“ angehakt, nicht versionierte nicht.
  - „Amend“ ergänzt den letzten Commit und füllt dessen Nachricht vor.
  - „Commit and Push“ pusht nach einem erfolgreichen Commit nach den Regeln oben.
  - Eine leere Commit-Nachricht oder keine angehakte Datei lassen den Knopf inaktiv, ausser bei Amend nur mit geänderter Nachricht.
- **Rollback:**
  - Geänderte und gelöschte Dateien werden auf den Stand des letzten Commits zurückgesetzt, in Arbeitsordner und Index.
  - Hinzugefügte Dateien, also im Index vorgemerkte neue Dateien, werden aus dem Index entfernt und in den Papierkorb verschoben.
  - Umbenennungen werden rückgängig gemacht.
  - Für nicht versionierte Dateien gibt es kein Rollback, nur Löschen im Dateibaum.
  - Immer mit Rückfrage, die die betroffenen Dateien nennt.
- **Konflikte:**
  - Läuft nach einem Pull ein Merge oder Rebase mit Konflikten, zeigt die Änderungsansicht oben einen Balken „Merge in progress“ bzw. „Rebase in progress“ und die Dateien mit Konflikt rot in der Gruppe „Merge Conflicts“.
  - Der Nutzer löst die Konfliktmarkierungen im Editor auf.
  - **Merge:**
    - Die Commit-Nachricht ist mit der Nachricht vorausgefüllt, die Git für den Merge vorbereitet hat.
    - Ein Commit nimmt alle Änderungen auf, ohne Auswahl per Häkchen, weil Git während eines Merges keinen Teil-Commit erlaubt. Die aufgelösten Dateien werden dabei automatisch in den Index übernommen.
    - „Abort“ bricht den Merge ab.
  - **Rebase:**
    - Der Knopf „Commit“ ist durch „Continue“ ersetzt, weil Git während eines Rebase keinen Commit mit Pfaden erlaubt.
    - „Continue“ übernimmt alle Änderungen an versionierten Dateien in den Index (sonst verweigert Git das Fortsetzen) und setzt den Rebase ohne Editor fort.
    - „Abort“ bricht den Rebase ab.
  - **Verbliebene Konfliktmarkierungen:** Vor „Commit“ und „Continue“ prüft Codium die betroffenen Dateien auf verbliebene Konfliktmarkierungen, warnt und lässt erst nach Bestätigung fortfahren.
  - Diese Knöpfe sind keine eigenständigen Merge- oder Rebase-Funktionen; sie schliessen nur ab, was ein Pull begonnen hat.
- **Änderungsblöcke für die Änderungsbalken:**
  - Der Git-Dienst holt pro offener Datei einmal den Stand im letzten Commit, und zwar so, wie Git ihn auschecken würde (mit Zeilenende-Umwandlung und Filtern). Er dekodiert ihn mit der Kodierung der Datei und hält ihn zwischengespeichert, bis sich HEAD oder Index ändern.
  - Zu einem aktuellen Text aus dem Editor berechnet er die Blöcke (geändert, neu, gelöscht) samt alten Zeilen, zeilenweise und ohne Rücksicht auf das Zeilenende, ohne für jede Anfrage Git aufzurufen.
  - Die Oberfläche fragt entprellt während des Tippens nach. Das Zurücksetzen eines Blocks ersetzt im Editor die Zeilen durch die alten; danach greift das automatische Speichern.
  - Neue, nicht versionierte Dateien haben keine Balken.
- **Vergleichsansicht:** Der Git-Dienst liefert den Inhalt einer Datei in einem Commit (oder leer, wenn sie dort nicht existiert), dekodiert wie oben. Die Oberfläche zeigt ihn mit Monacos Vergleichsansicht. Fälle:
  - Änderungsansicht: letzter Commit gegen Arbeitsordner; die rechte Seite ist das gemeinsame Modell der Datei und bearbeitbar.
  - Log: Elterncommit gegen Commit, beide schreibgeschützt. Bei Merge-Commits wird gegen den ersten Elterncommit verglichen.
  - Umbenennungen vergleichen alten mit neuem Pfad.
- **Ignorieren:** „Add to .gitignore“ hängt den Pfad relativ zum Repository an die `.gitignore` im Wurzelordner an und legt sie bei Bedarf an.

### Git-Log und Graph

- Der Git-Dienst liest den Log aller Branches (oder des gefilterten Branches) in topologischer Reihenfolge, mit Hash, Elterncommits, Refs, Autor, Datum und Betreff. Pro Log-Ansicht läuft ein Git-Prozess, dessen Ausgabe seitenweise zu 500 Commits gelesen wird, statt für jede Seite neu von vorne zu beginnen. Ein geänderter Filter oder geänderte Refs starten ihn neu.
- **Graph-Spuren:** Der Git-Dienst berechnet aus den Elterncommits für jede Zeile die Spalte des Commit-Punkts und die Linien zur nächsten Zeile. Die Berechnung setzt seitenweise fort, ohne frühere Zeilen neu zu berechnen. Die Oberfläche zeichnet nur noch. Die Spur des aktuellen Branches bleibt nach Möglichkeit ganz links.
- **Filter:**
  - Textsuche: Nachricht oder Hash-Anfang.
  - Branch: einer oder alle.
  - Autor: Auswahl aus den Autoren der geladenen Commits oder freier Text.
  - Mit Text- oder Autorfilter entfällt der Graph, weil die Linien zwischen gefilterten Commits nichts mehr aussagen; mit Branchfilter bleibt er.
- **Details:** geänderte Dateien mit Zustand und vollständige Nachricht, Hash, Autor und Datum des gewählten Commits.
- **Aktionen:** „Copy Revision Number“, „New Branch…“ (vom Commit), „Checkout Revision“ (abgekoppelter Zustand; die Kopfzeile zeigt dann den kurzen Hash).
- Der Log lädt nach eigenen Git-Aktionen und bei Änderungen an den Refs (also auch nach Fetch) neu und behält dabei die Auswahl, falls der Commit noch da ist.

### Terminal

- Der Terminal-Dienst startet Shells über node-pty, die Oberfläche zeigt sie mit xterm.js, technisch wie in THub. Jeder Terminal-Tab gehört zu einem Projektfenster.
- **Shells:** Der Dienst erkennt PowerShell 7, Windows PowerShell, cmd und Git Bash. Standard ist PowerShell 7, sonst Windows PowerShell. Die gewählte Shell kommt aus den Einstellungen. Die Profile der Shell werden normal geladen.
- **Ordner:** Ein neues Terminal startet im Projektordner, über „Open in Terminal“ im gewählten Ordner. Ist das Werkzeugfenster „Terminal“ beim ersten Öffnen leer, startet automatisch ein Terminal.
- **Tabs:** „+“ öffnet ein weiteres Terminal; Tabs sind nummeriert („Local“, „Local (2)“ …) und lassen sich per Doppelklick umbenennen. Schliessen beendet die Shell samt Prozessbaum.
- **Tasten:** siehe „Oberfläche“, Tastenkürzel im Terminal.
- **Neustart:** Terminals werden nicht wiederhergestellt; beim nächsten Öffnen des Werkzeugfensters startet ein frisches.
- Beim Schliessen des Projektfensters beendet der Dienst alle Shells dieses Fensters.

### Datenbank

- **Treiber:** node-postgres. Werte werden in ihrer Textdarstellung aus PostgreSQL übertragen und angezeigt, ohne Umwandlung in JavaScript-Zahlen oder -Daten, damit nichts verloren geht (grosse Zahlen, Zeitzonen, Genauigkeit).
- **Verbindungen** gehören zum Projekt und liegen im Projekt-Zustand: Name, Host, Port (Standard 5432), Datenbank, Benutzer, SSL, „Ask for password every time“ und das verschlüsselte Passwort (über den Port „Geheimnisse“). Ein abgefragtes Passwort hält der Dienst nur bis zum Schliessen des Fensters im Arbeitsspeicher.
- **SSL:** „ja“ verbindet verschlüsselt, ohne das Zertifikat zu prüfen (wie sslmode=require); „nein“ unverschlüsselt.
- Pro Verbindung hält der Dienst einen kleinen Pool und baut ihn beim Schliessen des Fensters ab.
- **Baum:** Verbindung, darunter die konfigurierte Datenbank, darunter die Schemas (ohne die Systemschemas von PostgreSQL), darin Tabellen und Views, darin die Spalten mit Typ, Nullbarkeit und Primärschlüssel. Geladen wird beim Aufklappen. „Refresh“ lädt einen Ast neu.
- **Tabelleninhalt** als Tab im Code-Bereich:
  - Je Seite 500 Zeilen mit „Next“/„Previous“ und Anzeige der Zeilen.
  - Ohne gewählte Sortierung wird nach dem Primärschlüssel sortiert, damit die Seiten stabil sind; bei Views und Tabellen ohne Primärschlüssel ohne Sortierung.
  - **Sortieren:** Klick auf einen Spaltenkopf wechselt zwischen aufsteigend, absteigend und ohne.
  - **Filter:** Das Filterfeld nimmt eine WHERE-Bedingung, die der Nutzer selbst schreibt, und wird so in die Abfrage übernommen. Es ist die eigene Datenbank des Nutzers, Codium schützt hier nicht vor dem Nutzer selbst.
  - Ein ungültiger Filter zeigt die Meldung der Datenbank.
- **Bearbeiten:**
  - **Nur mit Primärschlüssel:** Bearbeitet werden nur Tabellen mit Primärschlüssel. Views und Tabellen ohne Primärschlüssel sind schreibgeschützt, mit Hinweis.
  - **Änderungssatz:** Änderungen sammeln sich, bis gespeichert wird: geänderte Zellen je Zeile (identifiziert über den Primärschlüssel beim Laden, mit den ursprünglichen Werten), neue Zeilen, gelöschte Zeilen.
  - **„Submit“** (Ctrl + Enter) führt alle Änderungen in einer Transaktion aus, mit Parametern statt eingesetzten Werten. PostgreSQL wandelt die Textwerte selbst in den Spaltentyp um.
  - **Neue Zeilen:** Leere Zellen werden ausgelassen, damit Standardwerte und automatische Schlüssel greifen; ausdrücklich gesetztes NULL wird als NULL geschrieben.
  - **Fremde Änderung:** Ein Update trifft die Zeile nur, wenn Primärschlüssel und die ursprünglichen Werte der geänderten Spalten noch stimmen (Vergleich der Textdarstellung, NULL-sicher). Ein Delete trifft die Zeile über den Primärschlüssel. Trifft eine Anweisung keine Zeile, weil sie inzwischen geändert oder gelöscht wurde, bricht die Transaktion mit einer klaren Meldung ab.
  - **Fehler:** Bei jedem Fehler wird zurückgerollt, die Meldung der Datenbank erscheint, und der Änderungssatz bleibt offen.
  - **Nach Erfolg** lädt die Seite neu.
  - **„Revert“** verwirft den Änderungssatz.
  - Wechsel der Seite, Sortierung oder Filter und Schliessen des Tabs mit offenen Änderungen fragt nach.
  - Das Speichern eines Änderungssatzes erscheint als Fortschritt in der Statusleiste.
- **NULL** wird grau als „null“ angezeigt und lässt sich per Rechtsklick setzen.
- **Lange Werte** (Text über einer Zeile, json, jsonb) öffnen per Rechtsklick „Open Editor“ in einem grösseren Feld, bei JSON mit Farben.
- **Binäre Spalten** (bytea) werden als „binary, N bytes“ angezeigt und sind schreibgeschützt.

### Einstellungen, Meldungen und Voraussetzungen

- **Einstellungen** (gemeinsam für alle Projekte, im App-Zustand):
  - Shell fürs Terminal
  - Schriftgrösse im Editor
  - JDK für den Java-Sprachserver: Auswahl aus den erkannten JDKs ab Version 25, Standard „Newest detected“
  - Änderungen wirken sofort in allen Fenstern; ein geändertes JDK startet laufende Java-Sprachserver neu.
  - Neue Felder kommen nur dazu, wenn eine Funktion sie braucht.
- Der **Einstellungsdialog** öffnet mit Ctrl + Alt + S und über das Projektmenü.
- **Prüfung der Voraussetzungen** beim Start des App-Kerns:
  - **Git:** Wird Git nicht gefunden, erscheint in jedem Projektfenster ein Fehlerhinweis „Git not found“ mit dem Knopf „Open README“, und die Git-Funktionen sind aus.
  - **JDK:** Ist kein JDK ab 25 erkannt (und keines eingestellt), erscheint der Hinweis erst, wenn ein Projekt mit Java-Kennzeichen geöffnet wird. Die Java-Sprachfunktionen bleiben dann aus, alles andere geht.
  - „Open README“ öffnet das mit Codium mitgelieferte README schreibgeschützt in einem Tab, am Abschnitt „Voraussetzungen“.
- **Fortschritt** in der Statusleiste: Der Kern meldet Beginn, Fortschritt (wenn bekannt) und Ende von Arbeiten (Git-Aktionen mit Netzwerk, Import durch Sprachserver, Klonen, Speichern eines Änderungssatzes). Mehrere laufende Arbeiten werden zusammengefasst angezeigt.

### Auslieferung und Abhängigkeiten

- **Neue Abhängigkeiten:**
  - Monaco
  - xterm.js mit Zusatz zum Einpassen der Grösse
  - node-pty
  - node-postgres
  - ripgrep als mitgeliefertes Programm (aus dem npm-Paket, das VS Code verwendet)
  - TypeScript 7 (als Laufzeit-Bestandteil für den nativen Sprachserver) und typescript-language-server (für Projekte mit eigenem TypeScript bis Version 6); ein TypeScript 6 als Rückfall entfällt (geklärt in Ticket 12)
  - jdtls und Lombok
  - JetBrains Mono
  - markdown-it, DOMPurify und Mermaid für die Markdown-Vorschau
- **jdtls** wird beim Bauen in einer festen Version geholt und anhand einer im Repository hinterlegten Prüfsumme kontrolliert, nicht im Repository abgelegt; ein lokaler Zwischenspeicher vermeidet erneutes Herunterladen. Der Installer wird dadurch etwa 50 MB grösser.
- **Native und ausführbare Teile** werden ausserhalb des App-Archivs abgelegt, damit sie gestartet werden können: node-pty wie in THub, ripgrep, jdtls, Lombok, die TypeScript-Sprachserver und das README für „Open README“. Das Bauen bleibt ohne erneutes Kompilieren nativer Module, wie im Grundgerüst eingestellt.
- **Monaco und sein Worker** werden mit esbuild gebündelt und lokal geladen.
- **README:** Ein Abschnitt „Voraussetzungen“ mit zwei Teilen.
  - **Zum Benutzen:**
    - Windows 10 oder 11
    - Git für Windows im PATH
    - JDK 25 oder neuer installiert, nur für die Java-Sprachfunktionen; JAVA_HOME muss nicht darauf zeigen, und ältere JDKs für ältere Projekte dürfen zusätzlich installiert sein
    - optional PowerShell 7
    - ausdrücklich nicht nötig: Node.js, Maven, Gradle, ein PostgreSQL-Client
  - **Zum Entwickeln:**
    - Node.js 22 oder neuer mit npm
    - Git
    - Netzzugang beim ersten Bauen (jdtls) und für einzelne langsame Tests
    - ob ein C++-Compiler nötig ist, wird bei der Umsetzung geprüft und eingetragen
  - Die „Offenen Punkte“ im README werden durch eine Beschreibung des Umfangs ersetzt.
- Installiert wird über den bestehenden NSIS-Installer. Es gibt keine automatischen Updates.

## Testentscheidungen

### Was einen guten Test ausmacht

- Getestet wird **äusseres Verhalten** an einer der beiden Teststellen, nicht das Innenleben. Ein Test beschreibt, was ein Nutzer erleben würde („nach Commit mit zwei angehakten von drei geänderten Dateien bleibt die dritte geändert“), und bleibt grün, wenn der Kern intern umgebaut wird.
- Nachgemacht wird nur an den Ports. Git, Dateisystem, ripgrep, Sprachserver, node-pty und PostgreSQL laufen echt.
- Tests laufen in Temp-Ordnern mit eigenem Datenordner und hinterlassen weder Prozesse noch Temp-Ordner.
- **Git in Tests:** Die globale und die systemweite Git-Konfiguration des Rechners werden abgeschirmt; Benutzername, E-Mail und Standardbranch setzen die Tests selbst, damit Hooks, Signierung oder Aliase des Nutzers nicht hineinwirken. Als Remote dient ein lokales Bare-Repository im Temp-Ordner; echte Git-Server werden nie angesprochen.
- **Netz in Tests:** Downloads aus öffentlichen Paketquellen sind erlaubt (Maven Central, die Gradle-Verteilung). Tests, die sie brauchen, laufen nur im langsamen Testlauf und werden ohne Netz mit klarer Meldung übersprungen.
- **Java in Tests:** Die Maven-Tests verwenden eigene Maven-Einstellungen mit Maven Central und ein lokales Repository in einem Test-Zwischenspeicher, nicht die Einstellungen und das Repository des Nutzers. Gradle verwendet ein eigenes Gradle-Benutzerverzeichnis im Test-Zwischenspeicher; Gradle-Daemons werden nach den Tests beendet. Der Test-Zwischenspeicher ist von Git ausgenommen.
- **Datenbank in Tests:** embedded-postgres läuft immer auf einem freien Zufallsport, nie auf 5432; Host und Port werden ausdrücklich gesetzt, der Server nach den Tests gestoppt.

### Testmodus der App

Für Teststelle 2 und jede automatische Prüfung der echten App gibt es einen Testmodus, der den Desktop des Nutzers unberührt lässt (Vorbild THub):

- Eine Variable schaltet den Testmodus ein:
  - Fenster öffnen ausserhalb des Bildschirms, nicht aktivierbar (Windows bringt sie nie in den Vordergrund) und ohne Taskleisten-Eintrag, und speichern ihre Lage nicht.
  - „Nach vorne holen“, „Im Explorer zeigen“, das Öffnen externer Programme und die echte Zwischenablage werden nicht ausgeführt, sondern aufgezeichnet. Der Test kann die Aufzeichnung abfragen.
  - Der Papierkorb ist ein Ordner im Test-Datenordner.
- Eine zweite Variable ersetzt die Wurzel des Datenordners (eigene Daten, eigene Einzelinstanz-Sperre).
- Eine dritte beantwortet jede Ordnerauswahl mit einem vorgegebenen Ordner; ohne sie gilt die Auswahl als abgebrochen.
- Eine vierte lässt den Port „System“ melden, dass Git fehlt.
- Eine fünfte nennt eine benannte Pipe des Testprozesses (Wächter): Schliesst sie sich, weil der Testprozess endet, beendet sich die App samt Kindprozessen selbst.
- Ohne die ersten beiden Variablen startet kein Test die App.

### Teststelle 1: Kern am Vertrag (Node, ohne Electron)

- Der App-Kern und die Projekt-Kerne werden in Node erzeugt und über denselben Vertrag angesprochen, den die Oberfläche benutzt. Die Ports sind nachgemacht:
  - Fenster: zeichnet Öffnen, Nach-vorne-Holen und Schliessen auf; vorgegebene Bildschirme.
  - Ordnerauswahl: liefert vorbereitete Antworten.
  - Geheimnisse: umkehrbare Testverschlüsselung.
  - Shell-Aktionen: Papierkorb als Temp-Ordner, Zwischenablage im Speicher.
  - System: vorgegebene Umgebung, gefundene Programme und JDK-Ordner. Für den langsamen Lauf auch die echte Umsetzung ohne Electron.
- Ein **Neustart** wird simuliert, indem ein neuer App-Kern auf demselben Datenordner erzeugt wird.
- **Schneller Testlauf** (bei jedem `npm test`):
  - **Fenster und Projekte:**
    - Öffnen, ein Projekt nicht doppelt öffnen, zweiter Start, Wiederöffnen beim Start
    - Beenden über „Exit“, über das letzte Fenster und über das Abmelden von Windows
    - Willkommensfenster ohne Projekte und sein Schliessen beim Öffnen eines Projekts, fehlender Projektordner
    - zuletzt geöffnete Projekte, Projekt-Zustand über einen Neustart, kaputte Zustandsdatei, Fensterlage auf fehlendem Bildschirm
  - **Dateien:**
    - Baum mit Sortierung und ohne `.git`
    - Lesen und Schreiben mit Erhalt von UTF-8 mit und ohne BOM, UTF-16 LE und BE mit BOM, Windows-1252, LF und CRLF; Reihenfolge der Erkennung
    - neue Dateien mit dem überwiegenden Zeilenende
    - Ereignisse für Änderungen von aussen, aber nicht für eigene Schreibvorgänge; „gelöscht und neu angelegt“ als Änderung
    - Dateioperationen inklusive Papierkorb und Umbenennen versionierter Dateien
    - Dateiliste und Dateisuche nach Namen mit unscharfem Vergleich, versteckten Dateien und „include ignored“
    - Projektsuche mit allen Schaltern, Rücksicht auf `.gitignore` innerhalb und ausserhalb eines Repositorys, Abbruch nach 2'000 Treffern
    - Erkennung von Binärdateien und Grössengrenzen
  - **Git** gegen echte Temp-Repositories mit Bare-Remote:
    - Zustand aller Dateiarten
    - Branch anlegen, wechseln, umbenennen, löschen (gemerged und nicht gemerged), Remote-Branch auschecken
    - verweigerter Checkout mit Dateiliste
    - Fetch mit Entfernen verschwundener Remote-Branches
    - Pull mit Merge und mit Rebase, Konflikt mit beiden, Abort und Continue (ohne Editor), Commit nach aufgelöstem Merge mit vorausgefüllter Nachricht, Warnung bei verbliebenen Markierungen
    - Push ohne Upstream, abgelehnter Push
    - Commit nur der angehakten Dateien mit vorbereitetem Index für andere Dateien, neue Dateien, Umbenennung, Amend
    - Rollback aller Dateiarten
    - voraus/zurück, abgekoppelter Zustand, kein Repository
    - Änderungsblöcke für einen Text, auch mit Zeilenende-Umwandlung und Windows-1252; Inhalt einer Datei in einem Commit
    - Git-Konsole mit Befehl und Exit-Code, Hintergrundbefehle nur mit Schalter
    - Add to .gitignore
  - **Git-Log:**
    - Seiten aus einem laufenden Prozess
    - Graph-Spuren für linear, Verzweigung, Merge, Octopus-Merge und mehrere Wurzeln, auch über eine Seitengrenze
    - Filter, Details, Checkout Revision, New Branch vom Commit
  - **Einstellungen und Voraussetzungen:**
    - Speichern und Wirkung
    - Hinweise bei fehlendem Git und fehlendem JDK 25 (über das nachgemachte System)
    - JDK-Erkennung aus vorgegebenen Ordnern
- **Langsamer Testlauf** (eigener Befehl, getrennt vom schnellen):
  - **TypeScript** an kleinen Beispielprojekten, je eines mit TypeScript 7, mit TypeScript 6 und ohne eigenes TypeScript:
    - Definition über Dateigrenzen, Verwendungen, Implementierungen, Hover, Fehler vor dem Speichern, Vervollständigung, semantische Token, Symbolsuche
    - Ziel in einer Typdefinition unter node_modules
    - Neustart nach Absturz, Beenden beim Abbau
  - **Java** an kleinen Beispielprojekten mit Maven, mit Lombok und mit Gradle-Wrapper (ein älterer Gradle 8):
    - Definition, Verwendungen, Implementierungen, Hover, Fehler, Vervollständigung, semantische Token, Symbolsuche
    - Sprung in eine JDK-Klasse mit Quelltext
    - Projekt mit älterem Java-Stand gegen das passende JDK
    - Gradle-Daemon mit passendem JDK
    - wird übersprungen, wenn kein JDK 25 vorhanden ist
  - **Terminal:** Start der gefundenen Shells im Projektordner und in einem Unterordner, Ausgabe kommt an, Schliessen beendet den Prozessbaum. Für PowerShell werden Benutzerprofil und Verlauf auf Temp-Ordner umgeleitet, damit nichts im PowerShell-Verlauf des Nutzers landet.
  - **Datenbank** gegen ein echtes PostgreSQL über embedded-postgres (ohne Docker, ohne Installation):
    - Baum, Primärschlüssel-Erkennung, Seiten mit Standardsortierung, Sortierung, Filter, ungültiger Filter
    - Änderungssatz mit Update, Insert (Standardwerte, NULL) und Delete in einer Transaktion
    - Rollback bei Fehler, bei fremd geänderter und bei verschwundener Zeile
    - Schreibschutz ohne Primärschlüssel und für Views
    - verlustfreie Werte (numeric, bigint, timestamptz, json)
    - verschlüsseltes und abgefragtes Passwort

### Teststelle 2: die ganze App in Electron (Playwright)

- Die gebaute App (gebündelt, mit dem Electron aus den Entwicklungsabhängigkeiten, nicht das gepackte Installationspaket) wird mit Playwright im Testmodus gestartet. Gesteuert wird sie über die Entwicklerwerkzeuge der App (Klicks, Tastatur und Mausrad über das Chrome DevTools Protocol), gegen ein Temp-Projekt mit Temp-Repository und Bare-Remote.
- Für die gestartete App gelten dieselben Abschirmungen wie in Teststelle 1 (Git-Konfiguration, Datenordner).
- **Weitere Regeln:**
  - keine echten Maus- oder Tastatureingaben, kein Holen von Fenstern in den Vordergrund, keine Änderung von Systemeinstellungen
  - zufällige hohe Debug-Ports, nie 9222 oder 9333
  - kein Kopieren und Einfügen in Editor oder Terminal (das ginge in die echte Zwischenablage)
  - als Shell ist cmd eingestellt, damit keine PowerShell mit dem Profil des Nutzers startet
- Geprüft werden die wichtigsten Klickwege:
  - Werkzeugfenster öffnen, schliessen, wechseln und in der Grösse ziehen, Zustand nach einem Neustart
  - mehrere Projektfenster, zweites Öffnen desselben Projekts holt das vorhandene nach vorne (über die Aufzeichnung des Testmodus)
  - Datei per Doppelklick im Baum öffnen, Tabs (Mittelklick, Anheften, Rechtsklick-Menü), gleiche Dateinamen, Ctrl + Mausrad
  - Tippen speichert automatisch, Datei von aussen ändern lädt den Tab neu, Konflikt mit ungespeicherten Eingaben zeigt den Hinweis
  - Ctrl + Linksklick springt im TypeScript-Beispielprojekt zur Definition, Ctrl + Alt + Links und die Seitentaste der Maus springen zurück
  - Ctrl + Shift + N und Ctrl + Shift + F finden und öffnen an der richtigen Stelle
  - Änderungsansicht zeigt eine geänderte und eine neue Datei, Commit mit Auswahl (auch Ctrl + K mit Fokus im Editor), Vergleichsansicht per Doppelklick, Rollback mit Rückfrage
  - Änderungsbalken erscheinen nach dem Tippen, Block zurücksetzen
  - Branch-Menü: neuen Branch anlegen, wechseln, Push ohne Upstream (auch Ctrl + Shift + K mit Fokus im Editor); Ordner, Tastatur, Suchen und „Recent“ im Dropdown, Breite des Branchnamens in der Kopfzeile (Ticket 31)
  - Git-Log zeigt Commits mit Graph, Details eines Commits
  - Terminal öffnet im Projektordner mit cmd und führt einen Befehl aus
  - Datenbank (embedded-postgres): Verbindung anlegen, Tabelle öffnen, Zellen ändern, Submit
  - Hinweis bei fehlendem Git (über die Testmodus-Variable)
  - Markdown: `.md` öffnet geteilt, die Vorschau zeigt Überschrift, Tabelle, ein Mermaid-Diagramm als SVG und ein Bild aus dem Projekt; Tippen aktualisiert die Vorschau; die Ansicht „Preview“ übersteht einen Neustart; ein Web-Link landet in der Aufzeichnung des Testmodus; ein Skript im Markdown läuft nicht
- Diese Tests bilden einen dritten Testlauf mit eigener Konfiguration, getrennt vom schnellen und vom langsamen; die Electron-Sperre der Kern-Tests gilt dort nicht.
- Prüfungen am gepackten Installationspaket (ob ripgrep, node-pty, die Sprachserver und das README startbar bzw. auffindbar sind) laufen über ein eigenes Prüfskript ohne Fenster.

### Reine Funktionen der Oberfläche

Wo die Oberfläche eigene Logik ohne DOM hat (etwa Markdown in HTML samt Quellzeilen, Auflösen von Bildpfaden, Einordnen von Links), testet der schnelle Lauf diese Funktionen direkt in Node.

### Nicht automatisch getestet

- Das Aussehen (Farben, Abstände, Schrift) wird an der echten App von Hand abgenommen.
- Anmeldung an echten Git-Servern (Git Credential Manager, SSH), echte Datenbankserver mit SSL und Maven-Projekte hinter dem Firmen-Mirror werden von Hand geprüft.
- Der Installer und die gebaute App auf einem frischen Rechner werden von Hand geprüft, anhand der Voraussetzungen im README.

### Werkzeuge und Vorlagen

- Vitest bleibt der Testlauf für Teststelle 1, mit dem bestehenden Gerüst: Electron ist in diesen Tests gesperrt, getesteter Kern-Code darf es nicht laden. Vorlage ist der bestehende Test für den Datenordner.
- Neue Entwicklungsabhängigkeiten: Playwright (für die Teststelle 2, ohne Browser-Downloads) und embedded-postgres (für die Datenbank-Tests).
- Vorbild für Ports, Neustart-Simulation, Testmodus und die Regeln zum Schutz des Desktops ist THub (siehe Ticket-README für die Fundstellen).

## Ausserhalb des Umfangs

- **Git:**
  - Stash, auch automatisches Beiseitelegen beim Branch-Wechsel
  - Merge und Rebase als eigene Aktionen und eine Drei-Wege-Ansicht für Konflikte
  - Cherry-Pick, Revert, Reset, Tags anlegen
  - Teil-Commits einzelner Blöcke
  - Löschen von Remote-Branches
  - automatischer Fetch, erzwungener Push
  - Git-Repository anlegen (git init)
  - Changelists wie in IntelliJ
- **Sprachfunktionen:**
  - Umbenennen über alle Dateien und andere Refactorings
  - Imports organisieren, Code formatieren
  - Sprachserver für weitere Sprachen (Kotlin, Python, C# usw.)
  - eigene Sprachfunktionen für JSON, CSS und HTML
  - „Neue Java-Klasse“ mit Gerüst
- **Ausführen und Debuggen**, also Run-Konfigurationen, Testläufe aus der IDE, Debugger, Build-Werkzeugfenster für Maven oder Gradle.
- **Editor und Navigation:**
  - geteilter Code-Bereich, Vorschau-Tab
  - in der Markdown-Vorschau: Folgen relativer Links und Anker, Bilder aus dem Netz, Bearbeiten in der Vorschau, Scrollen von der Vorschau zurück in den Editor, Export nach HTML oder PDF
  - Ziehen und Ablegen im Dateibaum
  - Kopieren und Einfügen von Dateien zwischen dem Explorer und Codium oder zwischen zwei Codium-Fenstern (siehe Präzisierung 38)
  - Überall suchen (ein Fenster für Dateien, Klassen, Symbole und Aktionen; zweimal Shift öffnet nur die Dateisuche, Ticket 26), Ersetzen im ganzen Projekt, Aktionen suchen
  - Umstellen der Kodierung einer Datei
- **Datenbank:**
  - SQL-Konsole
  - weitere Datenbanken (MySQL/MariaDB, SQL Server, Oracle, SQLite)
  - SSH-Tunnel, Prüfung von SSL-Zertifikaten
  - Bearbeiten von Views und Tabellen ohne Primärschlüssel
  - Ändern der Struktur (Tabellen, Spalten)
- **App:**
  - helles Design, Sprachumschaltung
  - Öffnen über Kommandozeile oder Kontextmenü im Explorer
  - Plugins
  - Abgleich von Einstellungen zwischen Rechnern
  - automatische Updates, Code-Signing
  - weitere Einstellungen ohne konkreten Bedarf

## Weitere Hinweise

### Etappen

Die Umsetzung folgt dieser Reihenfolge; nach jeder Etappe steht eine benutzbare App. Die Zuordnung zu Tickets steht im Ticket-README.

1. **Grundlage:**
   - Fenster, Kopfzeile, Werkzeugfenster, Statusleiste, Meldungen und Rückfragen
   - Projekte öffnen, Willkommensfenster, mehrere Fenster, Beenden, Klonen, gespeicherter Zustand
   - Dateibaum (ohne Git-Farben)
   - Editor mit Tabs, Farben und automatischem Speichern
   - Markdown-Vorschau
   - Dateisuche und Projektsuche, Werkzeugfenster „Find“
   - Einstellungen, JDK-Erkennung, Prüfung der Voraussetzungen, README-Abschnitt „Voraussetzungen“
   - User Stories 1–14, 15–17, 19–25, 28–33, 34 (ohne Terminal), 35–62, 64, 66–73, 172–190; dazu 21 ohne die Kürzel für Terminal und Git
2. **Terminal:** User Stories 18 (Terminal), 34 („Open in Terminal“), 145–151.
3. **Sprachverständnis Java und TypeScript:** User Stories 63, 65, 74–90. Technisch der riskanteste Teil, deshalb früh.
4. **Git-Grundlagen:**
   - Branch-Menü, Änderungsansicht, Commit, Rollback
   - Vergleichsansicht, Änderungsbalken, Git-Farben im Dateibaum
   - Fetch, Pull, Push, Problemfälle, Git-Konsole
   - User Stories 15 (Branch), 18 (Git), 26, 27, 31 (Git-Teil), 91–134
5. **Git-Log mit Graph:** User Stories 135–144.
6. **Datenbank-Viewer:** User Stories 152–171.

Die Klickwege der Teststelle 2 kommen jeweils mit dem Ticket dazu, dessen Funktion sie prüfen. Das Gerüst für Playwright und den Testmodus entsteht im ersten Ticket.

### Grundlage der Entscheidungen

- **Rechner des Nutzers** (Stand 2026-11-20):
  - JDK 8, 11, 17, 21 und 25 installiert, JAVA_HOME auf JDK 21
  - Maven 3.9.9 mit eigener settings.xml, Gradle nur über Wrapper
  - Git 2.48, PowerShell 7, Docker vorhanden, kein lokales PostgreSQL
  - Das Grundgerüst selbst verwendet TypeScript 7.
  - Die Entscheidungen setzen nichts davon voraus ausser dem, was im README steht.
- **jdtls** läuft laut seinem README seit Oktober 2026 nur noch mit Java 25 oder neuer. Deshalb wählt Codium das JDK für jdtls selbst und nicht über JAVA_HOME (mit dem Nutzer nach dem Review abgestimmt).
- **TypeScript 7** (Juli 2026) ist die native Umsetzung mit eigenem Sprachserver und ohne tsserver; typescript-language-server funktioniert nur mit TypeScript bis Version 6.
- **Nativer Sprachserver von TypeScript 7** (geklärt in Ticket 12, am 2026-11-22 mit TypeScript 7.0.2, `tsc --lsp --stdio`): Er liefert alle Funktionen dieser Version: Definition, Verwendungen, Implementierungen, Hover mit Typ und JSDoc als Markdown, Fehler und Warnungen (als Pull-Diagnosen, `textDocument/diagnostic`), Vervollständigung mit nachgeladenen Details, semantische Token (mit der vom Client gemeldeten Legende) und Symbolsuche (`workspace/symbol`). Der Rückfall auf typescript-language-server mit einem mitgelieferten TypeScript 6 entfällt deshalb: Projekte ohne eigenes TypeScript bekommen den nativen Server des mitgelieferten TypeScript 7. typescript-language-server wird nur für Projekte mit eigenem TypeScript bis Version 6 mitgeliefert, mit dem tsserver des Projekts.
- **THub** (ein Projekt desselben Nutzers) dient als technische Vorlage für Terminal (node-pty mit xterm.js), Testmodus, Ports und die Spielregeln der Tickets.

### Präzisierungen beim Schreiben

Diese Punkte wurden beim Schreiben der Spezifikation oder nach dem Review ergänzt oder geschärft. Sie liegen im Sinn der getroffenen Entscheidungen, wurden aber nicht einzeln abgestimmt, ausser wo vermerkt:

1. **Kodierungen:** Codium erkennt UTF-8 mit und ohne BOM sowie UTF-16 mit BOM. Eine Datei, die kein gültiges UTF-8 ist, öffnet als Windows-1252 und wird so zurückgeschrieben. Die Statusleiste zeigt die erkannte Kodierung. Umstellen lässt sie sich in dieser Version nicht.
2. **Neue Dateien** bekommen das Zeilenende, das im Projekt überwiegt, mit Rückfall auf LF.
3. **Fetch entfernt verschwundene Remote-Branches** (prune), damit das Branch-Menü keine toten Branches zeigt.
4. **Rebase und Merge nach einem Pull** lassen sich über „Continue“ und „Abort“ abschliessen. Sonst bliebe ein Pull mit Rebase-Konflikt in Codium unlösbar.
5. **Commit während eines Merges** nimmt alle Änderungen auf, weil Git dort keinen Teil-Commit erlaubt; die Nachricht ist mit der von Git vorbereiteten vorausgefüllt.
6. **Rollback einer hinzugefügten Datei** entfernt sie aus dem Index und verschiebt sie in den Papierkorb.
7. **Ordner ohne Git** öffnen normal, nur die Git-Funktionen fehlen. „git init“ gehört nicht zu dieser Version.
8. **Graph nur ohne Text- und Autorfilter.**
9. **Git- und Fensterkürzel nach IntelliJ:** Ctrl + K Commit, Ctrl + Shift + K Push, Ctrl + T Pull, Alt + 1 Project, Alt + 0 Commit, Alt + F12 Terminal, Alt + 9 Git, Alt + 3 Find. Dazu die IntelliJ-Kürzel Ctrl + B (Definition), Ctrl + Alt + B (Implementierungen), Ctrl + Q (Dokumentation) und Ctrl + Tab (letzter Tab).
10. **Grenzen:** 50 MB als Obergrenze zum Öffnen, 2'000 Treffer in der Projektsuche, 1'000 Einträge in der Git-Konsole, 20 zuletzt geöffnete Projekte, Neustart abgestürzter Sprachserver höchstens dreimal in drei Minuten.
11. **SVG** öffnet als Text, nicht als Bild.
12. **Datenbank:**
    - SSL ohne Zertifikatsprüfung
    - bytea schreibgeschützt
    - leere Zellen neuer Zeilen fallen weg, damit Standardwerte greifen
    - ein Update prüft die ursprünglichen Werte der geänderten Spalten; eine fremd geänderte oder verschwundene Zeile bricht das Speichern ab
    - ohne gewählte Sortierung wird nach dem Primärschlüssel sortiert
    - Rückfrage auch beim Schliessen eines Tabs mit offenen Änderungen
    - der Baum zeigt nur die konfigurierte Datenbank der Verbindung, nicht alle Datenbanken des Servers
13. **Wiederherstellen nach Neustart** betrifft nur Datei-Tabs, nicht Vergleiche, Bibliotheksklassen oder Tabelleninhalte.
14. **JDK-Hinweis erst bei einem Java-Projekt**, damit Nutzer ohne Java nicht gestört werden.
15. **Kein Design-Prototyp vorab** (anders als bei THub): Das Aussehen ist durch das Vorbild IntelliJ „Dark“ weitgehend festgelegt und wird an der echten App abgenommen.
16. **Beenden:** „Exit“ im Projektmenü und das Abmelden von Windows beenden Codium mit allen offenen Projekten, die beim nächsten Start wieder aufgehen. Beendet das Schliessen des letzten Projektfensters die App, gilt dieses Projekt als offen. Ein Projektfenster, das geschlossen wurde, während noch andere offen waren, öffnet beim nächsten Start nicht.
17. **Konflikt beim automatischen Speichern** (mit dem Nutzer nach dem Review abgestimmt): Ändert sich eine Datei von aussen, während der Tab ungespeicherte Eingaben hat, erscheint ein Hinweis mit „Load from Disk“ und „Keep Mine“ statt automatisch zu speichern.
18. **JDK für jdtls** (mit dem Nutzer nach dem Review abgestimmt): das neueste erkannte JDK ab 25, unabhängig von JAVA_HOME, in den Einstellungen änderbar.
19. **TypeScript-Server nach Projektversion:** nativer Server ab TypeScript 7, typescript-language-server bis TypeScript 6, für Projekte ohne eigenes TypeScript der native Server des mitgelieferten TypeScript 7 (ein Rückfall ist nicht nötig, geklärt in Ticket 12).
20. **Lombok** wird mitgeliefert und ist immer aktiv; der Gradle-Daemon bekommt ein JDK passend zur Gradle-Version.
21. **Umbenennen im Dateibaum** merkt bei versionierten Dateien die Umbenennung im Index vor, damit Git sie als Umbenennung erkennt.
22. **Konfliktmarkierungen:** Vor „Commit“ bzw. „Continue“ warnt Codium, wenn in Konfliktdateien noch Markierungen stehen.
23. **Git-Konsole** zeigt standardmässig nur vom Nutzer ausgelöste, schreibende und Netzwerk-Befehle; Hintergrundabfragen per Schalter.
24. **Werkzeugfenster „Find“** unten (Alt + 3) für abgelegte Projektsuchen und Verwendungen; sein Symbol steht in der unteren Gruppe der linken Symbolleiste.
25. **Dateisuche nach Namen** schliesst ignorierte Dateien standardmässig aus, mit Schalter „include ignored“; Dateiliste und Projektsuche schliessen versteckte Dateien ein (ohne `.git`).
26. **Ctrl + Mausrad** ändert die Schriftgrösse aller Editoren und speichert sie als Einstellung (in IntelliJ wirkt es nur auf den aktuellen Editor).
27. **„Open README“** öffnet das mitgelieferte README schreibgeschützt in einem Codium-Tab, nicht im Browser.
28. **Keine eigenen Sprachfunktionen für JSON, CSS und HTML:** Monacos eingebaute Prüfungen sind abgeschaltet, diese Dateien bekommen nur Farben.
29. **Rückfragen in der Oberfläche** statt Dialogen von Windows, damit sie einheitlich aussehen und sich automatisch testen lassen.
30. **Tastenkürzel im Terminal:** Nur die Kürzel für Werkzeugfenster und Einstellungen wirken dort als IDE-Kürzel, alles andere geht an die Shell.
31. **Markdown-Vorschau** (mit dem Nutzer abgestimmt): wie in IntelliJ mit „Editor“, „Split“ und „Preview“, Standard „Split“, mit Mermaid-Diagrammen, Bildern aus dem Projekt und synchronem Scrollen. Relative Links werden nicht verfolgt.
32. **HTML in Markdown** wird dargestellt, aber mit DOMPurify bereinigt.
33. **Bilder in der Vorschau** nur aus dem Projekt und höchstens 10 MB, keine Bilder aus dem Netz.
34. **Web-Links in der Vorschau** öffnen im Standardbrowser; dafür bekommt der Port „Shell-Aktionen“ eine Funktion zum Öffnen von Web-Adressen.
35. **Synchrones Scrollen** nur vom Editor zur Vorschau.
36. **Ansicht pro Datei** im Projekt-Zustand gemerkt; Vorschau nur für Dateien bis 5 MB.
37. **Aufteilung der Symbolleisten** (bei der Umsetzung von Ticket 03 geschärft, nach der Skizze aus der Befragung und dem neuen IntelliJ): Es gibt keine eigene Leiste am unteren Rand. Die linke Symbolleiste trägt oben „Project“ und „Commit“ und in ihrer unteren Gruppe „Terminal“, „Git“ und „Find“, die rechte „Database“. Die Bestätigung durch den Nutzer steht in der Prüfliste von Ticket 03.
38. **Kopieren und Einfügen im Dateibaum** (bei der Umsetzung von Ticket 04 geschärft): Die Zwischenablage für Dateien gehört zum Projektfenster, nicht zu Windows; „Copy“ und „Paste“ wirken innerhalb eines Projekts, und die gemerkten Pfade folgen Umbenennungen und Löschungen. „Copy Path“ schreibt dagegen in die Zwischenablage von Windows. Bei einem Namenskonflikt bekommen mehrere Einträge automatisch einen Zusatz („Name (2).ext“); bei einem einzelnen schlägt der Dialog „Copy“ diesen Namen vor.
