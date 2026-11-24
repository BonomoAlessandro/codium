# 32 – Java-Dateien im Dateibaum mit Symbol je Art, ohne Endung

Status: `ready-for-agent` · Typ: HITL
Blockiert durch: –
User Stories: ergänzt „Dateibaum“ und „Oberfläche und Werkzeugfenster“ (Stil des neuen IntelliJ)
Spezifikation: „Oberfläche“ (Design), Dateibaum

Dieses Ticket kam nach Ticket 31 dazu, auf Wunsch des Nutzers. IntelliJ zeigt Java-Dateien im Projektbaum mit einem Symbol je Art der Klasse: Klasse, Interface, Enum, Record, Annotation und so weiter. Den Namen zeigt es ohne `.java`. Codium soll das ebenso tun.

Typ HITL, weil es um Symbole geht. Der Agent legt zuerst Bilder des Symbolsatzes im Dateibaum vor, der Nutzer gibt frei oder gibt Rückmeldung, erst dann wird eingebaut.

## Heutiger Stand

- **Symbole:** Im Dateibaum (`src/renderer/project/ProjectView.tsx`) tragen alle Dateien dasselbe Symbol (`FileIcon` aus `src/renderer/icons.tsx`). Ordner tragen `FolderIcon`, Links `LinkIcon`. Symbole je Dateityp gibt es keine.
- **Namen:** Java-Dateien erscheinen mit vollem Namen, etwa `OrderService.java`.
- **Wissen über Java:** Codium weiss im Baum nichts über den Inhalt einer Java-Datei. Der Java-Sprachserver (jdtls) kennt die Arten, ist aber erst nach dem Import bereit und für den ganzen Baum zu langsam.

## Was gebaut wird

### Art der Java-Datei bestimmen

- Der Kern bestimmt für eine `.java`-Datei die Art ihres obersten Typs. Er liest dazu nur den Anfang der Datei (Richtwert: bis 64 KB) und lässt Kommentare, Strings, Textblöcke, `package`, `import` und Annotationen davor aus.
- **Arten**, wie IntelliJ sie unterscheidet:
  - Klasse;
  - abstrakte Klasse;
  - Interface;
  - Enum;
  - Record;
  - Annotation (`@interface`);
  - Ausnahme: eine Klasse, die erkennbar von `…Exception`, `…Error` oder `Throwable` erbt. Eine Annäherung über den Namen der Oberklasse genügt, die Grenze steht im Ticket.
  - `final` bzw. `sealed` nur, falls IntelliJ dafür ein eigenes Zeichen zeigt; der Agent prüft das.
- **Ohne eindeutige Art:** In diesen Fällen gilt die Datei als „Java-Datei“, mit eigenem allgemeinem Symbol und mit sichtbarer Endung `.java`, wie in IntelliJ:
  - Kein oberster Typ trägt den Namen der Datei.
  - Es gibt mehrere oberste öffentliche Typen.
  - Die Datei lässt sich nicht lesen oder nicht deuten, etwa wegen eines Syntaxfehlers am Anfang.
  - Ebenso `package-info.java` und `module-info.java`, mit passendem Symbol, falls IntelliJ eines zeigt.
- **Wann:**
  - Bestimmt wird nur für Dateien, die im Baum sichtbar werden, gebündelt in einer Anfrage je aufgeklapptem Ordner.
  - Das Ergebnis wird je Pfad mit Änderungszeit und Grösse zwischengespeichert.
  - Ändert die Dateiüberwachung eine Datei, etwa nach dem Speichern von `class` zu `interface`, wird neu bestimmt, und das Symbol wechselt.
  - Ein Ordner mit Tausenden Java-Dateien darf das Aufklappen nicht merklich verzögern. Der Baum zeigt zuerst das allgemeine Symbol und tauscht es, sobald die Art feststeht.
- **Umsetzung:**
  - Das Deuten ist eine reine Funktion (Text rein, Art raus) im Kern, ohne Electron, damit sie sich in Node prüfen lässt.
  - Die Anfrage läuft über den bestehenden Vertrag zwischen Oberfläche und Kern.
  - jdtls wird dafür nicht gebraucht.

### Anzeige im Dateibaum

- **Symbol und Name:** Java-Dateien mit bestimmter Art tragen das Symbol ihrer Art und erscheinen ohne `.java`. Aus `OrderService.java` wird „OrderService“ mit dem Symbol für Klasse.
- **Wo der volle Name bleibt:**
  - im Tooltip;
  - im Dialog „Rename“, der weiter den Dateinamen samt Endung vorschlägt und dessen Hinweis zu Java bleibt;
  - beim Kopieren von Namen und Pfaden;
  - bei der Sortierung, damit sich die Reihenfolge nicht ändert;
  - in allen Dialogen, etwa beim Löschen.
- **Tippen zum Suchen:** Gibt es im Baum ein solches Suchen, findet es die Datei über den gezeigten und über den vollen Namen.
- **Git-Farben:** Die Farben aus den Tickets 16 und 29 gelten für den Namen wie bisher. Das Symbol behält seine eigene Farbe, wie in IntelliJ.

### Symbole

- **Eigene SVG-Symbole** im Stil des neuen IntelliJ: ein farbiges, rundes Zeichen mit Buchstaben.
  - Klasse: „C“;
  - Interface: „I“;
  - Enum: „E“;
  - Record: „R“;
  - Annotation: „@“;
  - abstrakte Klasse und Ausnahme: abgewandelt;
  - dazu ein allgemeines Symbol für Java-Dateien.
- Die Symbole sind selbst gezeichnet. Dateien aus IntelliJ werden nicht übernommen.
- Die Farben stehen als Design-Variablen in `tokens.css`.
- Die Symbole liegen bei den übrigen in `icons.tsx`, in derselben Grösse wie heute, 16 px im Baum.
- **Bilder (HITL):**
  - Aufnahmen aus dem verborgenen Testfenster, über Playwright im Testmodus, nie vom Desktop.
  - Zu sehen ist ein Baum mit je einer Datei jeder Art, einer Java-Datei ohne eindeutige Art, `package-info.java` und gewöhnlichen Dateien: heute und neu, nach Möglichkeit neben einem Bildschirmfoto aus IntelliJ, das der Nutzer liefern kann.
  - Der Nutzer entscheidet anhand der Bilder:
    - den Symbolsatz;
    - ob die Symbole auch in den Datei-Tabs erscheinen, mit vollem Namen wie in IntelliJ;
    - ob sie in „Recent Files“ (Ctrl + E) und „Go to File“ erscheinen.

  Die Entscheidung kommt ins Ticket.
- **Spezifikation:** In den Abschnitten „Oberfläche“ (Design) und Dateibaum nachführen.

## Ausserhalb des Umfangs

- Symbole für andere Dateitypen (XML, JSON, Markdown, TypeScript, `pom.xml`, Gradle …) und für besondere Ordner (Quellordner, Testordner, Ressourcen). Das kann ein eigenes Ticket werden.
- Kompakte Pakete im Baum („com.example.app“ als eine Zeile) und Mitglieder einer Klasse im Baum.
- Kleine Zusatzzeichen für Sichtbarkeit oder einen Einstiegspunkt mit `main`.

## Akzeptanzkriterien

- [ ] Die Bilder (heute, neu, nach Möglichkeit IntelliJ) wurden dem Nutzer vorgelegt, und seine Entscheidung steht im Ticket.
- [ ] Einheitstests für das Deuten:
  - jede Art erkannt, auch mit Javadoc, Annotationen, `package` und `import` davor, mit Modifikatoren (`public`, `abstract`, `final`, `sealed`, `non-sealed`, `strictfp`) und mit Generics;
  - Kommentare oder Strings, die wie eine Deklaration aussehen, täuschen nicht;
  - ein Name, der nicht zur Datei passt, sowie mehrere oberste Typen ergeben „Java-Datei“;
  - eine leere Datei und ein Syntaxfehler ergeben „Java-Datei“, ohne Ausnahme.
- [ ] Ein Test prüft das Zwischenspeichern und das neue Bestimmen nach einer Änderung der Datei.
- [ ] Ein Playwright-Test im Testmodus prüft:
  - Der Baum zeigt „OrderService“ ohne `.java` mit dem Symbol für Klasse, dazu je eine Datei für Interface, Enum und Record mit ihrem Symbol.
  - Eine Java-Datei ohne eindeutige Art erscheint mit Endung und allgemeinem Symbol.
  - Der Tooltip zeigt den vollen Namen.
  - „Rename“ schlägt den vollen Dateinamen vor.
- [ ] Ein Playwright-Test prüft, dass sich das Symbol nach dem Speichern ändert, etwa von `class` zu `interface`.
- [ ] Werden die Symbole auch in Tabs, „Recent Files“ oder „Go to File“ gezeigt: je ein Test.
- [ ] `npm run typecheck`, `npm test` und `npm run test:ui` sind grün.

## Abnahme von Hand

- [ ] In einem echten Java-Projekt sehen Klassen, Interfaces, Enums und Records im Baum aus wie in IntelliJ, ohne `.java`.
- [ ] Das Aufklappen grosser Pakete bleibt flüssig.

## Hinweise

- Die Spielregeln gelten: Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Aufnahmen nur vom verborgenen Testfenster über Playwright, nie vom Desktop. Keine echten Eingaben an den Desktop.
- Ticket 29 ändert die Git-Farben und das Zuklappen im Dateibaum. Werden beide nacheinander umgesetzt, baut das spätere auf dem früheren auf; Konflikte in `ProjectView.tsx` sind zu erwarten.
