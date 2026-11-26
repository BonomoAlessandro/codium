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

## Befund zu IntelliJ (Agent, 2026-11-26)

Gelesen in den öffentlichen Quellen von JetBrains (intellij-community auf GitHub, Zweig `master`, Commit `0b36d254`, am 2026-11-26). Übernommen werden nur Regeln und Farbwerte, keine Dateien.

### Wann ein Name ohne Endung erscheint

`java/java-impl/src/com/intellij/ide/projectView/impl/ClassesTreeStructureProvider.java`, Zeilen 84 bis 114:
- Eine Java-Datei erscheint als Klasse, also ohne `.java` und mit dem Symbol ihrer Art, wenn sie genau einen obersten Typ hat und dieser so heisst wie die Datei (`equals`, also mit Gross-/Kleinschreibung).
- Sonst erscheint sie als Datei mit Endung. Das gilt auch bei mehreren obersten Typen, gleich ob öffentlich oder nicht, und bei einer impliziten Klasse (eine Datei nur mit `void main()`).
- IntelliJ wendet das nur in Quellordnern und Bibliotheken an. Java-Dateien ausserhalb eines Quellordners zeigt es mit Endung und einem eigenen Symbol. Codium kennt keine Quellordner (eigene Ordnerarten sind ausserhalb des Umfangs); es wendet die Regel überall an.

### Arten und Symbole

`java/java-psi-impl/src/com/intellij/psi/impl/ElementPresentationUtil.java`, Zeilen 39 bis 160 und 233 bis 240:
- **Arten:** Annotation, Enum, Record und Interface nach dem Schlüsselwort, sonst Klasse. Eigene Symbole gibt es für Klasse, abstrakte Klasse, Interface, Enum, Record, Annotation, Ausnahme und **abstrakte Ausnahme**. Codium unterscheidet deshalb auch die abstrakte Ausnahme (`abstractException`).
- **Abstrakt** heisst: der Modifikator `abstract` steht ausdrücklich da; bei Interfaces zählt er nicht.
- **Ausnahme:** IntelliJ prüft die ganze Vererbung (`PsiClassUtil.isThrowable`), und zwar nur, wenn seine Indizes bereit sind.
- **`final`:** kein eigenes Symbol, sondern ein Zusatzzeichen über dem Symbol der Art (`FinalMark`, eine kleine Nadel oben links), nicht bei Enums.
- **`sealed` und `non-sealed`:** weder ein Symbol noch ein Zusatzzeichen. Auch unter den Symbolen (`platform/icons/src/expui/nodes/`, `platform/icons/src/nodes/`) gibt es keines.
- Tests und Klassen mit `main` tragen das Symbol der Klasse mit einem Zusatzzeichen; Zusatzzeichen sind hier ausserhalb des Umfangs.

### Dateien ohne eindeutige Art

`java/java-impl/src/com/intellij/ide/JavaFileIconPatcher.kt`, Zeilen 18 bis 47:
- **Ohne Typ**, also bei `package-info.java`, `module-info.java` und leeren Dateien, zeigt IntelliJ das Symbol des Dateityps Java. Im neuen Design ist das eine Tasse (`platform/icons/src/expui/fileTypes/java_dark.svg`). Ein eigenes Zeichen für `package-info.java` oder `module-info.java` gibt es in diesen Quellen nicht.
- **Mit Typen, aber ohne eindeutige Art** (mehrere oberste Typen, Name passt nicht) erscheint der Name mit Endung, das Symbol aber ist das des Typs mit dem Dateinamen, sonst des letzten Typs. Der Knoten lässt sich dort aufklappen und zeigt die Typen darin. Codium zeigt die Typen einer Datei nicht im Baum; das Ticket sieht für diese Fälle das allgemeine Symbol vor. Die Frage dazu geht an den Nutzer.

### Farben im neuen Design „Dark“

Aus `platform/icons/src/expui/nodes/*_dark.svg`, alle 16 px, ein Kreis mit Radius 6,5 und Rand:

| Art | Fläche | Rand und Zeichen | Zeichen |
|---|---|---|---|
| Klasse | `#25324D` | `#548AF7` (blau) | C |
| abstrakte Klasse | `#25324D` | `#548AF7` | C, Rand gestrichelt |
| Record | `#25324D` | `#548AF7` | R |
| Interface | `#253627` | `#57965C` (grün) | I |
| Annotation | `#253627` | `#57965C` | @, füllt den Kreis, ohne Rand |
| Enum | `#2F2936` | `#A571E6` (violett) | E |
| Ausnahme | `#3D3223` | `#D6AE58` (gelb) | Blitz |
| abstrakte Ausnahme | `#3D3223` | `#D6AE58` | Blitz, Rand gestrichelt |
| Java-Datei (Dateityp) | `#45322B` | `#C77D55` (braun) | Tasse |

### Grenzen der Annäherung

- **Ausnahme** erkennt Codium nur am einfachen Namen der direkten Oberklasse: `…Exception`, `…Error` oder `Throwable`, auch qualifiziert oder mit Generics (`extends java.io.IOException`, `extends BaseException<T>`).
  - Nicht erkannt wird eine Ausnahme über eine Zwischenklasse mit anderem Namen: `class OrderFailed extends ShopFailure` gilt als Klasse, auch wenn `ShopFailure` von `RuntimeException` erbt.
  - Fälschlich erkannt wird eine Oberklasse, die nur so heisst: `class Report extends ValidationError` gilt als Ausnahme, auch wenn `ValidationError` keine ist.
  - Der eigene Name zählt nicht (`class OrderException` ohne `extends` ist eine Klasse), ebenso wenig Interfaces.
- **64 KB:** Ein zweiter oberster Typ hinter den ersten 64 KB bleibt ungesehen; die Datei bekommt dann die Art des ersten.
- **Fehlertoleranz:** Ein Syntaxfehler vor dem ersten Typ oder in seinem Kopf ergibt „Java-Datei“. Ein offener Rumpf (eine fehlende Klammer mitten im Tippen) oder Unerwartetes nach dem ersten vollständigen Typ beendet nur das Lesen; es zählen die Typen bis dahin. So springt das Symbol beim automatischen Speichern nicht bei jeder offenen Klammer auf „Java-Datei“; auch IntelliJ übergeht solche Fehler.
- Unicode-Escapes im Quelltext (`class`) löst Codium nicht auf.

## Stand der Erkennung (Agent, 2026-11-26)

Gebaut vor der Freigabe der Symbole, ohne Anzeige im Baum:
- **Deuten:** reine Funktion `javaKindOf(text, fileName)` in `src/main/core/javaKind.ts`, ohne Electron.
- **Vertrag:** Typ `JavaKind` mit `class`, `abstractClass`, `interface`, `enum`, `record`, `annotation`, `exception`, `abstractException` und `java`.
  - Befehl `files.javaKinds` mit `{ paths }`, gebündelt, etwa alle Java-Dateien eines aufgeklappten Ordners.
  - Ereignis `files.javaKindsChanged` mit den geänderten Arten.
- **Lesen und Zwischenspeicher:** `src/main/core/javaKinds.ts`.
  - Gelesen werden höchstens die ersten 64 KB. Ein abgeschnittener Anfang endet beim letzten Zeilenumbruch, damit ein halbes UTF-8-Zeichen die Kodierung nicht verdirbt.
  - Gemerkt wird je Pfad mit Änderungszeit, Grösse und Schreibweise des Pfads. Eine weitere Anfrage braucht nur `lstat`.
  - Höchstens 50'000 Einträge; die am längsten nicht gebrauchten fallen weg.
- **Neues Bestimmen:**
  - Nach Änderungen der Dateiüberwachung und nach `files.write` bestimmt der Kern gemerkte Dateien neu und meldet geänderte Arten.
  - Löschen und Umbenennen in Codium vergessen den Pfad; unter einem umbenannten Ordner wandert das Gemerkte mit.
  - Nach einem Neueinlesen der Überwachung (verpasste Ereignisse) werden alle gemerkten geprüft.
- **Vorrang:** Das Lesen läuft als nachrangige Arbeit über die Warteschlange des Projekts (`IoLimiter.runInBackground`). Es beginnt nur, wenn kein anderer Dateizugriff wartet, und belegt nie alle Plätze. So hält es das Lesen eines Ordners beim Aufklappen nicht auf.
- **Pfade:** Jeder Pfad wird ohne Dateizugriff geprüft, der echte Pfad seines Ordners einmal je Ordner. Einem Link folgt das Lesen nur, wenn sein Ziel im Projekt liegt.
- **Tests:**
  - `test/main/javaKind.test.ts`: 44 Tests zum Deuten.
  - `test/main/javaKinds.test.ts`: 8 Tests am Vertrag, darunter Zwischenspeicher, neues Bestimmen nach einer Änderung von aussen und nach dem Speichern (von `class` zu `interface`), Umbenennen und Löschen.
  - `test/main/ioLimiter.test.ts`: ein neuer Test zum Vorrang.
  - Gegenproben: Ohne Zwischenspeicher, ohne Meldung der Überwachung oder des Speicherns, mit Vergessen statt Mitwandern, ohne Vergessen beim Löschen, ohne Schnitt am Zeilenumbruch und ohne Überspringen von Strings im Rumpf wird jeweils der passende Test rot.

## Entscheidung (Nutzer, 2026-11-26)

Vorgelegt wurden Dateibaum, Datei-Tabs, „Recent Files“ und „Go to File“ eines erfundenen Projekts, heute und mit zwei Fassungen der Symbole. Fassung A hat eine dunkle Fläche mit farbigem Ring und Zeichen wie IntelliJ, Fassung B einen vollen farbigen Kreis mit dunklem Zeichen. Dazu kamen das allgemeine Symbol als Tasse oder als „J“ im Kreis und jedes Symbol einzeln vergrössert. Die Seite lag nach den Spielregeln unversioniert unter `entwuerfe/32-java-symbole/` (Aufnahmeskript in `aufnahmen/`). Ein Bildschirmfoto aus IntelliJ lag nicht vor; Farben und Gestalt stammen aus dessen Symbolen (siehe Befund).

Rückmeldung des Nutzers, wörtlich: „deine empfehlung“

Damit gelten die sieben Empfehlungen des Agenten:
1. **Symbolsatz:** Fassung A, dunkle Fläche mit farbigem Ring und Zeichen, wie IntelliJ.
2. **Allgemeines Symbol:** die Tasse.
3. **Datei-Tabs:** zeigen das Symbol der Art, mit vollem Namen wie in IntelliJ.
4. **„Recent Files“** (Ctrl + E): ebenso, Namen voll.
5. **„Go to File“** (Ctrl + Shift + N): ebenso, Namen voll.
6. **Mehrere oberste Typen oder ein Name, der zu keinem Typ passt:** allgemeines Symbol mit Endung, wie im Ticket. IntelliJ zeigt dort das Symbol eines der Typen, lässt den Eintrag aber auch aufklappen; Codium zeigt die Typen einer Datei nicht im Baum.
7. **`final`:** kein Zusatzzeichen in diesem Ticket. Möglicher Folgepunkt: ein Ticket für die Zusatzzeichen wie in IntelliJ (`final`, Sichtbarkeit, Klasse mit `main`, Test). Die Erkennung liest `final` im Kopf des Typs schon mit, gibt es aber nicht weiter.

## Akzeptanzkriterien

- [x] Die Bilder (heute, neu, nach Möglichkeit IntelliJ) wurden dem Nutzer vorgelegt, und seine Entscheidung steht im Ticket. (Ein Bildschirmfoto aus IntelliJ lag nicht vor; Farben und Gestalt stammen aus dessen Symbolen.)
- [x] Einheitstests für das Deuten:
  - jede Art erkannt, auch mit Javadoc, Annotationen, `package` und `import` davor, mit Modifikatoren (`public`, `abstract`, `final`, `sealed`, `non-sealed`, `strictfp`) und mit Generics;
  - Kommentare oder Strings, die wie eine Deklaration aussehen, täuschen nicht;
  - ein Name, der nicht zur Datei passt, sowie mehrere oberste Typen ergeben „Java-Datei“;
  - eine leere Datei und ein Syntaxfehler ergeben „Java-Datei“, ohne Ausnahme.
- [x] Ein Test prüft das Zwischenspeichern und das neue Bestimmen nach einer Änderung der Datei.
- [x] Ein Playwright-Test im Testmodus prüft:
  - Der Baum zeigt „OrderService“ ohne `.java` mit dem Symbol für Klasse, dazu je eine Datei für Interface, Enum und Record mit ihrem Symbol.
  - Eine Java-Datei ohne eindeutige Art erscheint mit Endung und allgemeinem Symbol.
  - Der Tooltip zeigt den vollen Namen.
  - „Rename“ schlägt den vollen Dateinamen vor.
- [x] Ein Playwright-Test prüft, dass sich das Symbol nach dem Speichern ändert, etwa von `class` zu `interface`.
- [x] Werden die Symbole auch in Tabs, „Recent Files“ oder „Go to File“ gezeigt: je ein Test.
- [ ] `npm run typecheck`, `npm test` und `npm run test:ui` sind grün.

## Abnahme von Hand

- [ ] In einem echten Java-Projekt sehen Klassen, Interfaces, Enums und Records im Baum aus wie in IntelliJ, ohne `.java`.
- [ ] Das Aufklappen grosser Pakete bleibt flüssig.
- [ ] Wird eine Klasse zum Interface (Speichern im Editor, ein Branch-Wechsel oder eine Änderung von aussen), wechselt das Symbol im Baum und im Tab. (ergänzt bei der Umsetzung)
- [ ] Die Java-Symbole sind bei 100 % und 150 % Skalierung klar, auch auf der Auswahl, und sie passen in den Tabs, in „Recent Files“ und „Go to File“. (ergänzt bei der Umsetzung)

## Hinweise

- Die Spielregeln gelten: Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Aufnahmen nur vom verborgenen Testfenster über Playwright, nie vom Desktop. Keine echten Eingaben an den Desktop.
- Ticket 29 ändert die Git-Farben und das Zuklappen im Dateibaum. Werden beide nacheinander umgesetzt, baut das spätere auf dem früheren auf; Konflikte in `ProjectView.tsx` sind zu erwarten.

## Umsetzung (Agent, 2026-11-26)

### Kern

- **Erkennung, Zwischenspeicher und Vertrag** wie unter „Stand der Erkennung“ beschrieben (`javaKind.ts`, `javaKinds.ts`, `files.javaKinds`, `files.javaKindsChanged`, `IoLimiter.runInBackground`).
- **Nach dem Abbau** des Projekts liest der Dienst nichts mehr; Bestimmungen, die noch in der Warteschlange stehen, enden ohne Dateizugriff. So liest Codium beim Beenden nicht noch Tausende Dateien.
- **Speichern während des Bestimmens:** Wird eine Datei gespeichert, während der Kern sie gerade bestimmt (womöglich noch mit dem alten Inhalt), bestimmt er sie danach neu.

### Oberfläche

- **Zwischenspeicher je Projektfenster:** `src/renderer/project/javaKinds.ts`, ohne DOM. Das Projektfenster stellt ihn über einen React-Kontext bereit.
  - Er fragt gebündelt an (`ensure`) und nur, was weder bekannt noch unterwegs ist, auch nicht nach dem Zu- und Wiederaufklappen eines Ordners; Änderungen meldet der Kern.
  - Bei grossen Ordnern fragt er in Teilen zu 200 an, nacheinander von oben nach unten (siehe Leistung).
  - Er folgt `files.javaKindsChanged`, vergisst Gelöschtes und lässt unter einem umbenannten Ordner das Bekannte mitwandern. Eine umbenannte Datei fragt er neu an, denn ihre Art hängt vom Namen ab.
  - Scheitert eine Anfrage, gilt das allgemeine Symbol, ohne dauernd neu zu fragen.
- **Symbole:** `JavaKindIcon` in `icons.tsx`, wie freigegeben (Fassung A, Tasse). Die Farben kommen nur aus den Design-Variablen `--java-*` in `tokens.css`, mit den Werten aus dem Befund. Anders als die übrigen Symbole übernehmen sie nicht die Textfarbe; eine Git-Farbe der Zeile färbt deshalb nur den Namen.
- **Dateibaum** (`ProjectView.tsx`):
  - Nach jedem Lesen eines Ordners fragt der Baum die Art seiner Java-Dateien an.
  - Java-Dateien tragen das Symbol ihrer Art und erscheinen ohne `.java`, sobald die Art feststeht; vorher mit vollem Namen und der Tasse.
  - Der volle Name bleibt im Tooltip (neu für alle Java-Dateien), im zugänglichen Namen der Zeile, im Dialog „Rename“ samt Hinweis zu Java, beim Kopieren von Pfaden, beim Sortieren (der Kern sortiert die vollen Namen) und in allen Dialogen.
  - Tippen zum Suchen gibt es im Baum nicht; der Punkt entfällt.
- **Datei-Tabs, „Recent Files“ und „Go to File“:** `FileTypeIcon` zeigt bei Java-Dateien das Symbol der Art, die Namen bleiben voll. Die Tabs und die Listen fragen ihre Java-Dateien selbst an.
  - Neu zeichnet bei einer geänderten Art nur das Symbol, nicht der ganze Code-Bereich (`useJavaKindStore` ohne Abo zum Anfragen, `useJavaKinds` mit Abo zum Zeichnen).
  - Dokument-Tabs und Klassen aus Bibliotheken (jdtls) behalten das Dateisymbol.

### Leistung

Gemessen im verborgenen Testfenster (Playwright im Testmodus) mit einem Ordner aus 5'000 Java-Dateien von je etwa 1,5 KB. Zum Vergleich dienten ein gleich grosser Ordner mit Textdateien und ein kleiner Ordner mit 10 Dateien. Rechner: Intel Core i7-12800H, Windows 11. Gemessen wurde im Fenster vom Ereignis, das den Ordner aufklappt, bis die erste Zeile erscheint bzw. ihr Symbol wechselt. Die Zahlen stammen aus drei Läufen mit der eingebauten Fassung, Lauf 3 mit dem endgültigen Stand; das Messskript lag bei den Entwürfen.

| Messung | Lauf 1 | Lauf 2 | Lauf 3 |
|---|---|---|---|
| Aufklappen, 5'000 Java-Dateien, zum ersten Mal: erste Zeile | 143 ms | 83 ms | 78 ms |
| dasselbe: erstes Symbol der Art | 261 ms | 155 ms | 141 ms |
| Wiederaufklappen (Arten bekannt): erste Zeile mit Symbol, Median aus 3 | 110 ms | 61 ms | 61 ms |
| Aufklappen, 5'000 Textdateien: erste Zeile, Median aus 3 | 89 ms | 52 ms | 47 ms |
| kleiner Ordner allein: erste Zeile, Median aus 3 | 7 ms | 4 ms | 3 ms |
| zweiter kalter Java-Ordner und gleich danach der kleine Ordner: erste Zeile im kleinen | 10 ms | 6 ms | 7 ms |
| dasselbe: erstes Symbol im Java-Ordner | 203 ms | 136 ms | 143 ms |
| Kern allein: alle 5'000 Arten in einer Anfrage, zum ersten Mal | 2,2 s | 1,8 s | 1,2 s |
| Kern allein: dieselben aus dem Zwischenspeicher (nur `lstat`) | 0,6 s | 0,4 s | 0,3 s |

- **Folgerung:** Die erste Zeile eines Ordners mit 5'000 Java-Dateien erscheint 15 bis 55 ms später als bei 5'000 Textdateien (Anfragen der Arten und Zeichnen der Symbole), in allen Läufen unter 0,15 s; das ist nicht merklich. Die obersten Symbole wechseln nach 0,14 bis 0,26 s von der Tasse zur Art. Ein anderer Ordner, der währenddessen aufgeklappt wird, wartet nicht (3 bis 10 ms).
- **Zwei Änderungen aus der Messung:**
  - Zuerst gingen die Teile eines Ordners (damals zu 500) gleichzeitig an den Kern. Dort reihten sie sich nach der Prüfung des Ordners in zufälliger Folge ein, und im zweiten kalten Ordner kam das erste Symbol erst nach 1,6 bis 2,1 s. Seit die Teile nacheinander gehen, sind es 0,14 bis 0,2 s.
  - Das erste Lesen eines Ordners fragte zuerst alle Arten neu an, als Schutz vor veralteten Arten. Das kostete bei jedem Wiederaufklappen 5'000 `lstat` und ist entfallen; der Kern meldet Änderungen selbst.
- **Beenden:** Bei einem Projekt mit drei aufgeklappten Ordnern zu je 5'000 Dateien streute die Dauer bis zum Ende von Electron in der Testinstanz zwischen 0,4 und 22 s, auch mit Textdateien statt Java-Dateien. Der Kern selbst war jeweils nach etwa 10 ms abgebaut. Eine Gegenprobe mit und ohne den Abbruch nach dem Abbau (je zwei bis drei Läufe) zeigte keinen nachweisbaren Unterschied; die Streuung überwiegt. Das liegt nicht an diesem Ticket und steht unter „Bei der Abnahme besonders prüfen“ in `offene-punkte.md`. Nach zwei der Messläufe hat die Schlussprüfung einen Renderer-Prozess der Messinstanz beendet; eine Nachmessung zeigte, dass ein solcher Prozess sich etwa 1 s später von selbst beendet.

### Entscheidungen und Abweichungen

- **Abstrakte Ausnahme** als eigene Art (`abstractException`), weil IntelliJ dafür ein eigenes Symbol hat.
- **Fehlertoleranz:** Ein offener Rumpf zählt den Typ, damit das Symbol beim automatischen Speichern nicht springt. Das Ticket verlangt „Java-Datei“ nur bei einem Syntaxfehler am Anfang.
- **Tooltip:** Alle Java-Dateien im Baum zeigen den vollen Namen als Tooltip, auch die mit Endung; andere Dateien wie bisher keinen.
- **Bilder:** Die Bilder des eingebauten Stands lagen unversioniert unter `entwuerfe/32-java-symbole/` (Abschnitt „Eingebaut“), aufgenommen mit `AUFNAHME_EINGEBAUT=1`.
- **Grenzen:** wie unter „Grenzen der Annäherung“, dazu in `offene-punkte.md` unter „Bekannte Grenzen“: Codium kennt keine Quellordner und kürzt überall. Ab 50'000 verschiedenen Java-Dateien in einer Sitzung meldet der Kern Änderungen an den am längsten nicht angefragten nicht mehr; deren Symbol stimmt dann erst nach dem nächsten Öffnen des Fensters.
- **Spezifikation nachgeführt:** User Story 25; „Oberfläche“, Design (Java-Symbole); „Dateien, Dateiüberwachung und Suche“, Dateibaum (Java-Dateien im Baum).

### Tests

- **Einheitstests:**
  - `test/main/javaKind.test.ts`: 44 Tests zum Deuten.
  - `test/main/javaKinds.test.ts`: 8 Tests am Vertrag, darunter Zwischenspeicher und neues Bestimmen.
  - `test/main/ioLimiter.test.ts`: ein neuer Test zum Vorrang.
  - `test/renderer/javaKinds.test.ts`: 10 Tests. Sie prüfen den Zwischenspeicher der Oberfläche (einmal anfragen, Teile nacheinander, Löschen, Umbenennen, Fehler, Ereignisse), den Namen im Baum, die Symbole (je Art verschieden, gestrichelt nur Abstraktes, nur Design-Variablen) und die Werte in `tokens.css`.
- **Oberfläche:** `test/ui/javaSymbols.test.ts`, 5 Tests.
  - Baum: Symbol je Art ohne `.java`, Java-Datei mit Endung und Tasse, Reihenfolge, Tooltip, Git-Farbe nur am Namen (das Symbol behält seine Farbe), „Rename“ mit vollem Namen, Markierung ohne Endung und Hinweis zu Java.
  - Speichern von `class` zu `interface`: Symbol im Baum und im Tab wechselt; danach von aussen zur Ausnahme.
  - je ein Test für Datei-Tabs, „Recent Files“ und „Go to File“.
- **Gegenproben** (je eine Stelle zurückgebaut, der passende Test wird rot):
  - Kern: ohne Zwischenspeicher, ohne Meldung der Überwachung oder des Speicherns, mit Vergessen statt Mitwandern, ohne Vergessen beim Löschen, ohne Schnitt am Zeilenumbruch, ohne Überspringen von Strings im Rumpf.
  - Oberfläche: Name nicht gekürzt, ohne Tooltip, Listen ohne Java-Symbol (3 Tests rot), ohne Meldung des Speicherns.
  - Die erste Prüfung des gestrichelten Rings war zu schwach (sie hätte auch ohne Striche bestanden) und ist geschärft: acht Bögen, ein Kreis ohne Rand.
