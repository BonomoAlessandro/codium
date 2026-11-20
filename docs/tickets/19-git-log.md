# 19 – Git-Log mit Graph

Status: `ready-for-agent` · Typ: AFK
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

- [ ] Kern-Tests gegen Temp-Repositories:
  - Graph-Spuren für linear, Verzweigung, Merge, Octopus-Merge und mehrere Wurzeln. Über eine Seitengrenze hinweg sind sie gleich wie bei einer Berechnung in einem Stück.
  - Die Spur des aktuellen Branches liegt in Spalte 0, wo möglich.
  - Seiten kommen aus einem laufenden Prozess; ein Refs-Wechsel startet ihn neu.
  - Filter nach Text, Hash-Anfang, Branch und Autor; mit Text- oder Autorfilter liefert der Dienst keine Graph-Spuren.
  - Details und geänderte Dateien eines Commits, inklusive Merge-Commit gegen den ersten Elterncommit.
  - Checkout Revision ergibt den abgekoppelten Zustand.
  - New Branch von einem Commit.
- [ ] Playwright-Tests:
  - Der Log zeigt die Commits des Temp-Repositorys mit Graph.
  - Auswahl eines Commits zeigt seine Dateien; Doppelklick öffnet die Vergleichsansicht.
  - „Copy Revision Number“ legt den Hash in die aufgezeichnete Zwischenablage des Testmodus.

## Abnahme von Hand

- [ ] In einem echten Repository mit vielen Branches und Merges ist der Graph lesbar und gleicht dem von IntelliJ.
- [ ] Scrollen durch einige tausend Commits bleibt flüssig.
