# 16 – Änderungsansicht und Commit

Status: `ready-for-agent` · Typ: AFK
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

- [ ] Kern-Tests gegen Temp-Repositories:
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
- [ ] Playwright-Tests:
  - Datei ändern und neue Datei anlegen → beide erscheinen in den richtigen Gruppen, nur die geänderte ist angehakt.
  - Ohne Nachricht ist „Commit“ inaktiv. Nachricht schreiben, „Commit“ → die neue Datei bleibt in der Liste.
  - Ctrl + K mit Fokus im Editor öffnet die Änderungsansicht mit Fokus in der Nachricht.
  - Rollback mit Rückfrage stellt den alten Inhalt wieder her.
  - Der Dateibaum färbt die Dateien.

## Abnahme von Hand

- [ ] Die Farben in Änderungsansicht und Dateibaum entsprechen IntelliJ.
- [ ] Eine Datei per `git add` im Terminal vorbereiten, in Codium nicht anhaken, etwas anderes committen: Die vorbereitete Datei ist weiterhin im Index.
