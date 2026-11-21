# 23 – Markdown-Vorschau

Status: `erledigt` (2026-11-22, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
Blockiert durch: 05
User Stories: 183–190
Spezifikation: „Markdown-Vorschau“, „Architektur im Überblick“ (Port „Shell-Aktionen“), „Testentscheidungen“ (Teststelle 2, „Reine Funktionen der Oberfläche“), „Präzisierungen beim Schreiben“ Punkte 31–36

Dieses Ticket kam nach der Zerlegung dazu; es gehört zu Etappe 1 und wird gleich nach Ticket 05 umgesetzt (siehe Ticket-README).

## Was gebaut wird

- **Ansichten:**
  - `.md`-Dateien öffnen als Datei-Tab mit dem Umschalter „Editor“ / „Split“ / „Preview“ oben rechts. Standard ist „Split“: Monaco links, Vorschau rechts, die Trennlinie lässt sich ziehen.
  - Die gewählte Ansicht merkt sich Codium pro Datei im Projekt-Zustand.
  - Dateien über 5 MB öffnen nur im Editor.
- **Rendern** in der Oberfläche mit markdown-it: Tabellen, Durchstreichen, Aufgabenlisten. Die Vorschau entsteht aus dem Modell des Editors, entprellt etwa 200 ms nach der letzten Eingabe, auch vor dem Speichern.
- **HTML im Markdown** mit DOMPurify bereinigt: keine Skripte, keine Ereignis-Attribute, keine eingebetteten Seiten oder Formulare.
- **Code-Blöcke** mit Monacos Einfärbung im Farbschema „Dark“, in der Sprache aus der Angabe nach den Backticks.
- **Mermaid:**
  - Blöcke mit der Sprache `mermaid` als SVG, dunkles Schema, strenge Sicherheitsstufe.
  - Die Bibliothek liegt in einer eigenen gebündelten Datei und wird erst geladen, wenn die Datei ein Mermaid-Diagramm enthält.
  - Ein fehlerhaftes Diagramm zeigt an seiner Stelle die Fehlermeldung.
- **Bilder:** relative Pfade gegen den Ordner der `.md`-Datei aufgelöst und über den Vertrag als Daten geladen, höchstens 10 MB pro Bild. Der Kern lehnt Pfade ausserhalb des Projekts ab; Bilder aus dem Netz werden nicht geladen. Statt eines abgelehnten Bildes steht der Alternativtext.
- **Synchrones Scrollen:** Die Blöcke der Vorschau tragen ihre Quellzeilen. In der geteilten Ansicht scrollt die Vorschau so, dass der Block zur obersten sichtbaren Editorzeile oben steht (nur Editor → Vorschau).
- **Links:**
  - Web-Links (http, https, mailto) öffnen über die Funktion „Web-Adresse öffnen“ des Ports „Shell-Aktionen“, die es seit Ticket 01 gibt (im Testmodus nur aufgezeichnet).
  - Relative Links und Anker werden nicht verfolgt; beim Überfahren zeigt ein Tooltip das Ziel.
- **Aussehen:** dunkel, passend zu Codium, angelehnt an die Markdown-Vorschau von IntelliJ.

## Akzeptanzkriterien

- [x] Einheitstests der reinen Funktionen im schnellen Lauf:
  - Markdown in HTML: Quellzeilen an den Blöcken, Tabellen, Aufgabenlisten, Code-Block mit Sprache, Mermaid-Block erkannt.
  - Bildpfade: relativ zur Datei aufgelöst; Pfade ausserhalb des Projekts, absolute Pfade und Web-Adressen abgelehnt.
  - Links eingeordnet als Web-Link, relativer Link oder Anker.
  - Zuordnung einer Editorzeile zum Block der Vorschau.
- [x] Kern-Tests:
  - Der Befehl zum Laden eines Bildes für die Vorschau liefert Daten für ein Bild im Projekt und lehnt eines ausserhalb des Projekts und eines über 10 MB ab.
  - „Web-Adresse öffnen“ erreicht den Port, im Testmodus nur als Aufzeichnung.
- [x] Playwright-Tests:
  - Eine `.md`-Datei öffnet geteilt; die Vorschau zeigt Überschrift, Tabelle und Aufgabenliste.
  - Ein Mermaid-Block erscheint als SVG; ein fehlerhafter Mermaid-Block zeigt eine Fehlermeldung, der Rest der Vorschau bleibt.
  - Ein relativ verlinktes Bild aus dem Projekt erscheint.
  - Tippen im Editor aktualisiert die Vorschau.
  - Umschalten auf „Preview“; nach einem Neustart öffnet die Datei wieder als „Preview“.
  - Ein Klick auf einen Web-Link landet in der Aufzeichnung des Testmodus mit der richtigen Adresse.
  - Ein `<script>` im Markdown läuft nicht (etwa: Es setzt eine globale Variable nicht).
  - In einer langen Datei folgt die Vorschau dem Scrollen im Editor.
- [x] Mermaid wird lokal geladen; im Netzwerkprotokoll erscheinen keine Zugriffe ausserhalb der eigenen Dateien, und eine Datei ohne Mermaid lädt die Mermaid-Datei nicht.

## Abnahme von Hand

- [ ] Spezifikation und Ticket-README sehen in der Vorschau gut aus; der Mermaid-Graph ist im dunklen Schema lesbar.
- [ ] Das synchrone Scrollen fühlt sich natürlich an.
- [ ] Ein Web-Link öffnet den Standardbrowser.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-22. DOMPurify (Skripte, `javascript:`, Formulare, iframes, Bilder laden nie selbst), Links samt zweiter Prüfung im Kern, `files.readImage` (echter Pfad, 10 MB, nur Bilder), `resolveImagePath`, das Laden von Mermaid nur bei Bedarf, `strict` ohne Umgehung über `%%{init}%%`, die Generationsnummer gegen Wettläufe und der Projekt-Zustand in Ordnung. Eingearbeitet:

- **CSS `url()` lud Dateien von ausserhalb des Projekts** (nachgewiesen; die Richtlinie der Seite hilft unter `file://` nicht, `'self'` deckt jede Datei): `style` ist verboten. Dazu weist der Hauptprozess jetzt jeden Zugriff der Seiten ab, der nicht auf die eigenen Dateien der Oberfläche oder eine `data:`-Adresse geht (auch UNC-Pfade und das Netz, nicht nur im Testmodus).
- **Bilder in Mermaid-Beschriftungen luden beliebige Dateien** (nachgewiesen): Mermaid zeichnet ohne HTML in Beschriftungen, `<` vor einem Tag wird zu Text, und das SVG läuft durch DOMPurify ohne `<image>`, `<foreignObject>` und Verweise.
- **HTML konnte das ganze Fenster überdecken** (`position: fixed`, nachgewiesen): `style` verboten, dazu `contain: paint` auf der Vorschau.
- **Mermaid versuchte einen Ereignis-Handler auszuführen** (nur die Richtlinie hielt ihn auf): durch die Punkte oben behoben; der Test erwartet keine Verstösse.
- **Der Test „nichts aus dem Netz“ war zu schwach:** Das Testdokument enthält alle Angriffswege; jeder Zugriff muss eine vorhandene eigene Datei treffen, keiner die Datei von draussen. Gegenprobe ohne das Verbot von `style`: Test rot.
- **Fehlerhafte Diagramme hinterliessen Knoten im Dokument:** werden entfernt, `suppressErrorRendering`; getestet.
- **`stripEventHandlers` veränderte Text:** wirkt nur noch innerhalb von Tags.
- **Jede Eingabe lud alle Bilder und zeichnete alle Diagramme neu:** Bilder (bis zu einer Dateiänderung im Projekt) und Diagramme (nach Quelle) werden zwischengespeichert.
- **Kleinere Lücken:** In `.md` umbenannte Dateien bekommen den Umschalter; beim Tabwechsel gilt die oberste Zeile des neuen Editors; mitgelieferte Dokumente merken ihre Ansicht nur im Speicher.
