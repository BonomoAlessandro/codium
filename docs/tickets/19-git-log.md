# 19 – Git-Log mit Graph

Status: `erledigt` (2026-11-22, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
Blockiert durch: 17
User Stories: 135–144
Spezifikation: „Git-Log und Graph“, „Git“ (Vergleichsansicht aus der Historie), „Präzisierungen beim Schreiben“ Punkt 8

## Was gebaut wird

- **Log im Git-Dienst:**
  - Alle Branches oder ein gefilterter Branch, topologische Reihenfolge, mit Hash, Elterncommits, Refs, Autor, Datum, Betreff.
  - Pro Log-Ansicht ein Git-Prozess, dessen Ausgabe seitenweise zu 500 Commits gelesen wird.
  - Ein geänderter Filter oder geänderte Refs starten ihn neu; beim Schliessen des Fensters wird er beendet.
- **Graph-Spuren im Git-Dienst:** pro Zeile die Spalte des Commit-Punkts und die Linien zur nächsten Zeile. Die Berechnung setzt seitenweise fort, ohne frühere Zeilen neu zu berechnen; die Spur des aktuellen Branches bleibt nach Möglichkeit links. Die Oberfläche zeichnet nur.
- **Reiter „Log“** im Werkzeugfenster „Git“:
  - Liste mit Graph, Betreff, Branch- und Tag-Etiketten, Autor, Datum; lädt beim Scrollen nach.
  - **Filter:** Textsuche (Nachricht oder Hash-Anfang), Branch, Autor (Auswahl aus den geladenen Autoren oder freier Text). Mit Text- oder Autorfilter entfällt der Graph.
  - **Rechts** für den gewählten Commit: geänderte Dateien mit Zustand und Details (vollständige Nachricht, Hash, Autor, Datum). Doppelklick auf eine Datei öffnet die schreibgeschützte Vergleichsansicht aus Ticket 17.
  - **Rechtsklick:** „Copy Revision Number“, „New Branch…“, „Checkout Revision“ (abgekoppelter Zustand; die Kopfzeile zeigt den kurzen Hash).
  - Lädt nach eigenen Git-Aktionen und bei Änderungen an den Refs neu (damit auch nach Fetch) und behält die Auswahl, falls der Commit noch existiert.

## Akzeptanzkriterien

- [x] Kern-Tests gegen Temp-Repositories:
  - Graph-Spuren für linear, Verzweigung, Merge, Octopus-Merge und mehrere Wurzeln. Über eine Seitengrenze hinweg sind sie gleich wie bei einer Berechnung in einem Stück.
  - Die Spur des aktuellen Branches liegt in Spalte 0, wo möglich.
  - Seiten kommen aus einem laufenden Prozess; ein Refs-Wechsel startet ihn neu.
  - Filter nach Text, Hash-Anfang, Branch und Autor; mit Text- oder Autorfilter liefert der Dienst keine Graph-Spuren.
  - Details und geänderte Dateien eines Commits, inklusive Merge-Commit gegen den ersten Elterncommit.
  - Checkout Revision ergibt den abgekoppelten Zustand.
  - New Branch von einem Commit.
- [x] Playwright-Tests:
  - Der Log zeigt die Commits des Temp-Repositorys mit Graph.
  - Auswahl eines Commits zeigt seine Dateien; Doppelklick öffnet die Vergleichsansicht.
  - „Copy Revision Number“ legt den Hash in die aufgezeichnete Zwischenablage des Testmodus.

## Abnahme von Hand

- [ ] In einem echten Repository mit vielen Branches und Merges ist der Graph lesbar und gleicht dem von IntelliJ.
- [ ] Scrollen durch einige tausend Commits bleibt flüssig.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-22. Graph-Spuren mit 5000 zufälligen Graphen geprüft (keine hängende Spur, keine Linie ins Leere, richtige Zahl Elternlinien), seitenweises Lesen ohne Datenverlust und ohne Verklemmung, Schutz gegen Argumente über Hash, Branch-Filter und Pfad in Ordnung. Eingearbeitet:

- **Log blieb nach einem Branch-Wechsel stehen:** Der Stand der Refs enthielt HEAD nur als Hash; ein Wechsel auf einen Branch desselben Commits (etwa „New Branch“ mit „Checkout“) lud nicht neu, das Etikett blieb beim alten Branch. Jetzt gehört das Ziel von HEAD dazu. Kern-Test dazu.
- **Auswahl ging verloren**, wenn der gewählte Commit nicht auf der ersten Seite lag. Beim Neuladen wird jetzt so weit nachgeladen, wie vorher geladen war, bis er wieder da ist.
- **Liegengebliebener Git-Prozess:** Schloss das Fenster, während der Log startete, lief Git weiter. Jetzt startet dann keiner mehr; der Test prüft, dass der Prozess wirklich endet.
- **Stash und Notes im Log:** `--all` nahm alle Refs; jetzt Branches, Remotes, Tags und HEAD. Kern-Test dazu.
- **Lange Suche nicht abbrechbar:** Eine Text- oder Autorsuche las bis zum Ende der Geschichte, alle späteren Anfragen warteten. Jetzt bricht sie ab, sobald eine neuere Anfrage wartet.
- **Gescheiterter Log:** zeigte danach still einen leeren Log und in der Konsole Exit-Code 0. Jetzt Fehlerhinweis, die nächste Anfrage beginnt neu, die Konsole zeigt Exit-Code und Meldung.
- **Spalte 0 leer über einem alten HEAD:** Die Spur wird nur noch reserviert, wenn HEAD auf einem Branch steht (nicht nach „Checkout Revision“).
- **Zufallsprüfung** der Graph-Spuren als Kern-Test (1500 Graphen): jede Linie kommt an, jede Spur kommt von oben, jeder Elterncommit ist verbunden.

Bewusst so gelassen: Der Autorfilter sucht auch bei Auswahl aus der Liste einen Teil von Name oder E-Mail (wie freier Text). Steht HEAD auf einem alten Branch weit unten, bleibt Spalte 0 über ihm frei (die Spur des aktuellen Branches bleibt dafür durchgehend links).
