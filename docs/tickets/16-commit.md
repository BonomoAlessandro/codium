# 16 – Änderungsansicht und Commit

Status: `erledigt` (2026-11-22, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
Blockiert durch: 06, 15
User Stories: 26, 27 (Graufärbung), 31 (Git-Teil), 95 („Commit…“), 105–110, 112, 114–118
Spezifikation: „Git“ (Commit ohne Staging-Bereich, Rollback, Ignorieren), „Dateien, Dateiüberwachung und Suche“ (Git-Farben im Baum, Dateioperationen), „Präzisierungen beim Schreiben“ Punkte 6, 21

## Was gebaut wird

- **Werkzeugfenster „Commit“:**
  - Gruppe „Changes“ (geändert, hinzugefügt, gelöscht, umbenannt; farbig wie in IntelliJ) und Gruppe „Unversioned Files“.
  - Häkchen pro Datei und Gruppe; beim Erscheinen sind Dateien in „Changes“ angehakt, nicht versionierte nicht. Häkchen bleiben bei Aktualisierungen erhalten.
  - Feld für die Commit-Nachricht, Häkchen „Amend“ (füllt die letzte Nachricht vor), Knopf „Commit“.
    - Der Knopf ist inaktiv ohne Nachricht oder ohne angehakte Datei, ausser bei Amend mit geänderter Nachricht.
    - Der Knopf „Commit and Push“ kommt mit Ticket 18.
  - Schalter „Group by Directory“ (flach oder nach Ordnern), im Projekt-Zustand gemerkt.
  - Doppelklick auf eine Datei öffnet sie (die Vergleichsansicht folgt mit Ticket 17 und ersetzt dann diese Aktion).
  - Rechtsklick: „Rollback…“, „Jump to Source“, bei nicht versionierten Dateien „Add to .gitignore“.
  - Aktualisiert sich nach jedem Speichern, nach Änderungen von aussen und nach Git-Aktionen.
- **Commit** im Git-Dienst: neu angehakte, nicht versionierte Dateien zuerst in den Index, dann Commit nur mit den angehakten Pfaden. Für andere Dateien vorbereitete Index-Einträge bleiben unberührt. Umbenennungen mit altem und neuem Pfad. Amend ergänzt den letzten Commit.
- **Umbenennen im Dateibaum** (Ticket 04): Bei einer versionierten Datei merkt der Git-Dienst die Umbenennung im Index vor, damit die Änderungsansicht sie als Umbenennung zeigt.
- **Rollback** mit Rückfrage, die die Dateien nennt:
  - geänderte und gelöschte Dateien auf den letzten Commit, in Arbeitsordner und Index
  - hinzugefügte Dateien aus dem Index entfernen und in den Papierkorb verschieben
  - Umbenennungen rückgängig
- **Add to .gitignore** hängt den Pfad relativ zum Repository an die `.gitignore` im Wurzelordner an, legt sie bei Bedarf an.
- **Git-Farben im Dateibaum:** geändert blau, neu grün, nicht versioniert rotbraun, ignoriert grau, Konflikt rot. Ignorierte Ordner grau.
- **Kürzel** Ctrl + K öffnet die Änderungsansicht und setzt den Fokus in die Commit-Nachricht (zentrale Tastenbelegung, wirkt auch mit Fokus im Editor). Eintrag „Commit…“ im Branch-Menü.

## Akzeptanzkriterien

- [x] Kern-Tests gegen Temp-Repositories:
  - Commit mit zwei von drei geänderten Dateien → die dritte bleibt geändert.
  - Eine im Index vorbereitete, nicht angehakte Datei bleibt nach dem Commit im Index.
  - Neue Datei angehakt → ist im Commit; nicht angehakt → bleibt nicht versioniert.
  - Gelöschte Datei wird richtig committet.
  - Eine in Codium umbenannte versionierte Datei erscheint als Umbenennung und wird als solche committet.
  - Amend ergänzt den letzten Commit und übernimmt eine geänderte Nachricht.
  - Rollback für geänderte, gelöschte, hinzugefügte und umbenannte Dateien; die hinzugefügte landet im nachgemachten Papierkorb.
  - Add to .gitignore legt die Datei an bzw. ergänzt sie; die Datei erscheint danach als ignoriert.
  - Dateizustände inklusive ignoriert und Konflikt für den Dateibaum.
  - „Group by Directory“ übersteht einen Neustart.
- [x] Playwright-Tests:
  - Datei ändern und neue Datei anlegen → beide erscheinen in den richtigen Gruppen, nur die geänderte ist angehakt.
  - Ohne Nachricht ist „Commit“ inaktiv. Nachricht schreiben, „Commit“ → die neue Datei bleibt in der Liste.
  - Ctrl + K mit Fokus im Editor öffnet die Änderungsansicht mit Fokus in der Nachricht.
  - Rollback mit Rückfrage stellt den alten Inhalt wieder her.
  - Der Dateibaum färbt die Dateien.

## Abnahme von Hand

- [ ] Die Farben in Änderungsansicht und Dateibaum entsprechen IntelliJ.
- [ ] Eine Datei per `git add` im Terminal vorbereiten, in Codium nicht anhaken, etwas anderes committen: Die vorbereitete Datei ist weiterhin im Index.
- [ ] Die Git-Farben stammen aus dem klassischen Darcula (#6897BB, #629755, #D1675A); mit dem neuen IntelliJ „Dark“ vergleichen.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-22. Commit nur mit den angehakten Pfaden (`--only`), vorbereitete Index-Einträge bleiben, Umbenennungen und Löschungen, Amend auch nur mit Nachricht, Meldung eines Hooks im Wortlaut, Unterordner-Projekt, Rollback im Normalfall, .gitignore (Zeilenende, Ordner, keine Doppeleinträge), ignoriert und Konflikt, Gruppen und Häkchen, Ctrl + K, „Commit…“ im Branch-Menü und die Farben im Dateibaum in Ordnung. Eingearbeitet:

- **Dateinamen mit [ ] wurden als Muster gelesen: Rollback setzte fremde Dateien zurück, Commit nahm nicht angehakte mit** (nachgewiesen, Datenverlust): Alle Aufrufe des Git-Dienstes mit `GIT_LITERAL_PATHSPECS=1`; Test mit `[ab].txt` neben `a.txt` (Gegenprobe rot).
- **Viele Dateien scheiterten an der Länge der Befehlszeile:** Pfade für add, commit, rm und restore über stdin (`--pathspec-from-file=- --pathspec-file-nul`); Test mit 700 Dateien.
- **Ordner umbenennen nahm nicht versionierte Dateien in den Index; schnelles zweimaliges Umbenennen verlor die Umbenennung:** Übertragen werden nur die versionierten Dateien, in der Schreibreihe, erst `add`, dann `rm --cached`; Ketten (a → b → c) werden zusammengefasst. Tests für beides.
- **„Add to .gitignore“ maskierte Musterzeichen nicht:** `[ ] * ? \` und Leerzeichen am Ende maskiert; in der Schreibreihe; vorher wird gespeichert.
- **„Rollback…“ wirkte auf alle angehakten Dateien:** Es gibt eine Zeilenauswahl (Klick, Ctrl + Klick); Rollback wirkt auf die Auswahl bzw. die geklickte Datei.
- **Leistung bei vielen ignorierten Dateien:** Ignorierte stehen getrennt (`ignored`, mit Ordner-Kennzeichen); der Dateibaum schlägt ignorierte Ordner über die Elternordner nach und berechnet den Zustand je Zeile einmal.
- **Doppelter Eintrag „D“ und „?“ für denselben Pfad:** der versionierte gilt (Kern und Oberfläche). **„Group by Directory“** sortiert nach (Ordner, Name), ohne doppelte Köpfe.
- **Ein Hook lehnt ab:** Die eben aufgenommenen Dateien sind wieder unversioniert; Test.
- **Kleinigkeiten:** Meldung bei Amend nur mit Nachricht, Abhaken von „Amend“ nimmt die vorausgefüllte Nachricht zurück, Häkchen bleiben auch nach einer leeren Abfrage.
- **Fremde Teständerung (test/ui/typescript.test.ts):** Der Klick auf die Deklaration wird wiederholt, bis die Auswahl erscheint. Das war nötig, weil der Test im vollen Lauf unter Last vor der Antwort des Servers klickte; der erste Sprung im selben Test wiederholte schon so. Ebenso prüft der langsame TypeScript-Test das geordnete Beenden jetzt über das Protokoll („hart beendet“) statt über eine Dauer unter 1 s, die unter Last auch an anderen Diensten hängt.
- **Offen, nicht geändert:** UI-Tests für Amend, „Group by Directory“, „Add to .gitignore“ und graue ignorierte Ordner fehlen (Kern-Tests decken die Logik); „Add to .gitignore“ wirkt auf eine Datei.
