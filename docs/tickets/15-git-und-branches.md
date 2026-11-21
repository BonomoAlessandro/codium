# 15 – Git-Dienst, Git-Konsole und Branches

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: 07, 09
User Stories: 15 (Branch), 18 (Git), 21 (Alt + 9 mit Inhalt), 91, 92, 94, 95 („New Branch…“), 96–101, 126, 132–134, 143 (nur Anzeige des abgekoppelten Zustands), 182
Spezifikation: „Git“ (Grundsätze, Git-Konsole, Zustand, Kein Repository, Branches), „Oberfläche“ (Kopfzeile), „Präzisierungen beim Schreiben“ Punkte 7, 23

## Was gebaut wird

- **Git-Dienst** im Projekt-Kern:
  - Ruft das installierte Git auf und liest maschinenlesbare Ausgaben (nullterminiert, Umlaute in Pfaden unverändert).
  - Lesende Abfragen sperren den Index nicht.
  - Jeder Aufruf ohne interaktiven Editor und ohne Eingabeaufforderung im Terminal; die Anmeldung läuft über die eingerichteten Helfer.
  - Schreibende Aktionen eines Projekts laufen nacheinander.
  - Vor jeder schreibenden Aktion wartet die Oberfläche auf offene Speichervorgänge (Ticket 07).
  - Ohne Git (Ticket 09) sind alle Git-Funktionen aus.
- **Zustand:**
  - Aktueller Branch oder abgekoppelter Commit, Upstream, voraus/zurück, laufender Merge oder Rebase, Dateizustände (für Ticket 16 bereitgestellt).
  - Aktualisierung nach eigenen Aktionen, nach dem Ereignis „Git-Daten geändert“ (Ticket 04), nach Dateiereignissen (gebündelt) und bei Fokus des Fensters.
- **Kein Repository:** Kopfzeile ohne Branch-Menü; die Werkzeugfenster „Commit“ und „Git“ zeigen „Not a Git repository“.
- **Kopfzeile:** Branchname bzw. kurzer Hash im abgekoppelten Zustand, dazu ↑n ↓m gegenüber dem Upstream.
- **Branch-Menü** mit Suchfeld:
  - Lokale und Remote-Branches getrennt, der aktuelle markiert.
  - Aktion „New Branch…“ oben. Die Einträge „Commit…“, „Pull“, „Push…“ und „Fetch“ kommen mit den Tickets 16 und 18.
  - Untermenü pro lokalem Branch: „Checkout“, „New Branch from '…'…“, „Rename…“, „Delete“.
  - Untermenü pro Remote-Branch: „Checkout“ (legt einen lokalen Branch an, der folgt; existiert der Name schon, wird dieser ausgecheckt), „New Branch from '…'…“.
  - **New Branch** checkt den neuen Branch standardmässig aus (Häkchen im Dialog).
  - **Delete:** Nicht gemergte Branches nach Rückfrage erzwungen löschen; der aktuelle Branch lässt sich nicht löschen.
  - **Verweigerter Checkout** wegen lokaler Änderungen: Meldung von Git mit der Liste der betroffenen Dateien.
- **Werkzeugfenster „Git“** mit dem Reiter „Console“:
  - Jeder Git-Aufruf mit Zeitpunkt, Befehl, Ausgabe, Exit-Code und Kennzeichen „Hintergrund“, die letzten 1'000 pro Projektfenster, nicht gespeichert.
  - Standardmässig sichtbar sind vom Nutzer ausgelöste, schreibende und Netzwerk-Befehle; Hintergrundabfragen blendet der Schalter „Show background commands“ dazu.
  - Der Reiter „Log“ ist ein Platzhalter bis Ticket 19.
- **Fehlermeldungen** von Git erscheinen im Wortlaut als Fehlerhinweis.

## Akzeptanzkriterien

- [ ] Kern-Tests gegen Temp-Repositories mit Bare-Remote:
  - Zustand: Branch, Upstream, voraus/zurück, abgekoppelter Zustand, laufender Merge, kein Repository, Projektordner als Unterordner eines Repositories.
  - Ein Branch-Wechsel von aussen (Git direkt im Test) aktualisiert den Zustand über das Ereignis „Git-Daten geändert“.
  - Branch anlegen (vom aktuellen Stand, von einem anderen Branch), mit und ohne Auschecken.
  - Wechseln, Umbenennen, Löschen eines gemergten Branches, Löschen eines nicht gemergten nach Bestätigung, Weigerung beim aktuellen Branch.
  - Remote-Branch auschecken legt einen folgenden lokalen Branch an; bei vorhandenem Namen wird dieser ausgecheckt.
  - Verweigerter Checkout liefert die Liste der betroffenen Dateien.
  - Pfade mit Umlauten und Leerzeichen.
  - Jeder Aufruf erscheint in der Konsole mit Exit-Code und richtigem Hintergrund-Kennzeichen; die Konsole ist auf 1'000 Einträge begrenzt.
  - Zwei gleichzeitig ausgelöste schreibende Aktionen laufen nacheinander.
  - Kein Aufruf öffnet einen Editor (etwa: ein Test mit gesetztem Git-Editor auf ein Programm, das fehlschlagen würde).
  - Ohne Git sind die Funktionen aus.
- [ ] Playwright-Tests: Branch-Menü öffnen, neuen Branch anlegen, die Kopfzeile zeigt ihn; zurück auf den alten Branch wechseln; die Git-Konsole zeigt die Befehle, Hintergrundabfragen erst mit dem Schalter.

## Abnahme von Hand

- [ ] In einem echten Repository mit vielen Branches findet das Suchfeld den richtigen Branch.

## Hinweise

- **Git-Daten bei Worktrees, Submodulen und Unterordnern** (aus dem Review von Ticket 04): Die Dateiüberwachung meldet „Git-Daten geändert“ nur für einen Ordner `.git` direkt im Projektordner. Ist `.git` eine Datei (Worktree, Submodul), steht darin der Pfad zum Git-Verzeichnis (`gitdir: …`); dieses Verzeichnis auflösen und HEAD, Index und Refs dort mitüberwachen, bei Worktrees auch die gemeinsamen Refs des Haupt-Repositorys. Dasselbe gilt, wenn der Projektordner ein Unterordner eines Repositorys ist und `.git` ausserhalb des Projekts liegt.
