# 18 – Fetch, Pull, Push und Konflikte

Status: `erledigt` (2026-11-22, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
Blockiert durch: 16
User Stories: 92 (Aktualisierung), 93, 95 („Pull“, „Push…“, „Fetch“), 102–104, 111, 127–131
Spezifikation: „Git“ (Fetch, Pull, Push, Konflikte), „Präzisierungen beim Schreiben“ Punkte 3–5, 22

## Was gebaut wird

- **Fetch** von allen Remotes, mit Entfernen verschwundener Remote-Branches. Kein automatischer Fetch.
- **Pull** nach der Git-Konfiguration des Nutzers (Merge oder Rebase), ohne eigene Strategie.
- **Push:**
  - schiebt den aktuellen Branch
  - Ohne Upstream: auf „origin“ (bzw. das einzige Remote) unter demselben Namen, Upstream setzen.
  - Abgelehnt, weil der Remote weiter ist: Fehlerhinweis mit Knopf „Pull“.
  - nie erzwungen
- **Branch-Menü:** Einträge „Pull“, „Push…“, „Fetch“. Kürzel Ctrl + T (Pull) und Ctrl + Shift + K (Push) in der zentralen Tastenbelegung, wirksam auch mit Fokus im Editor.
- **„Commit and Push“** in der Änderungsansicht: nach erfolgreichem Commit Push nach den Regeln oben.
- **Fortschritt** in der Statusleiste („Fetching…“, „Pulling…“, „Pushing…“), Erfolgsmeldungen als Hinweis. Voraus/zurück in der Kopfzeile aktualisiert sich danach.
- **Konflikte** nach einem Pull:
  - Die Änderungsansicht zeigt oben einen Balken „Merge in progress“ bzw. „Rebase in progress“ und die Konfliktdateien rot in der Gruppe „Merge Conflicts“.
  - **Merge:**
    - Die Nachricht ist mit der von Git vorbereiteten Merge-Nachricht vorausgefüllt.
    - „Commit“ nimmt alle Änderungen auf (Häkchen inaktiv) und übernimmt aufgelöste Dateien in den Index.
    - „Abort“ bricht den Merge ab.
  - **Rebase:**
    - „Commit“ ist durch „Continue“ ersetzt.
    - „Continue“ übernimmt alle Änderungen an versionierten Dateien in den Index und setzt ohne Editor fort.
    - „Abort“ bricht ab.
  - **Verbliebene Konfliktmarkierungen:** Vor „Commit“ bzw. „Continue“ prüft Codium die Konfliktdateien, warnt und fährt erst nach Bestätigung fort.

## Akzeptanzkriterien

- [x] Kern-Tests gegen Temp-Repositories mit Bare-Remote und einem zweiten Klon, der den Remote verändert:
  - Fetch zeigt neue Remote-Branches und entfernt gelöschte; voraus/zurück stimmt danach.
  - Pull mit Merge-Konfiguration und mit Rebase-Konfiguration, jeweils ohne und mit Konflikt.
  - **Merge-Konflikt:**
    - Die Nachricht ist vorausgefüllt.
    - Commit nach Auflösen schliesst den Merge ab.
    - Abort stellt den Stand davor her.
  - **Rebase-Konflikt:**
    - Continue nach Auflösen schliesst ab, ohne einen Editor zu öffnen, auch wenn eine weitere versionierte Datei geändert ist.
    - Abort stellt den Stand davor her.
  - Warnung bei verbliebenen Konfliktmarkierungen.
  - Push eines neuen Branches setzt den Upstream; mit zwei Remotes wird „origin“ gewählt.
  - Abgelehnter Push liefert das Kennzeichen „Remote ist weiter“.
  - Commit and Push.
- [x] Playwright-Tests:
  - Push eines neuen Branches mit Ctrl + Shift + K bei Fokus im Editor.
  - Pull mit Konflikt zeigt den Balken „Merge in progress“ und die rote Datei; Auflösen im Editor und „Commit“ schliesst den Merge ab.
  - Ein abgelehnter Push zeigt den Hinweis mit „Pull“.

## Abnahme von Hand

- [ ] Gegen ein echtes Remote (etwa Bitbucket): Fetch, Pull und Push mit Anmeldung über den Git Credential Manager bzw. SSH.
- [ ] Der Knopf „Pull“ im Hinweis nach einem abgelehnten Push funktioniert.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-22. Nie erzwungen (kein `+`, kein `--force`, die ausdrückliche Refspec übersteuert `remote.*.push`), Erkennung des abgelehnten Pushs mit Knopf „Pull“, Merge-Commit mit `add -u`, Continue ohne Editor (auch bei leerem Commit), Abort, vorausgefüllte Merge-Nachricht, Speichern vor Pull und Commit, alle Netz-Aktionen in der Schreib-Reihe, Kürzel vor Monaco und im Terminal nicht, Fortschritt in der Statusleiste und Schutz gegen Remotes mit „-“ in Ordnung. Eingearbeitet:

- **Push auf den falschen Branch (schwer):** Ein Branch, der einem anders benannten Upstream folgt (etwa „New Branch from 'origin/main'…“ setzt `origin/main` als Upstream), wurde auf diesen geschoben, also feature auf main. Jetzt immer unter demselben Namen; der Upstream bestimmt nur das Remote, wenn sein Name passt, sonst „origin“ (bzw. das einzige Remote) mit neuem Upstream. Kern-Test dazu.
- **Push-Ziel des Nutzers:** `branch.<name>.pushRemote` und `remote.pushDefault` (Fork) gehen jetzt vor; der Upstream bleibt dabei unberührt. Kern-Test dazu.
- **Pull während eines Merges:** meldete „Pull stopped with conflicts“; jetzt der Hinweis, den laufenden Merge oder Rebase erst abzuschliessen oder abzubrechen.
- **Meldungen von Git:** Zeilen „From …“ und „To …“ fallen nur noch weg, wenn eine Adresse oder ein Pfad folgt; Sätze wie „To push the current branch …“ bleiben. Unit-Test dazu.
- **Konfliktmarkierungen:** Eine Zeile „=======“ allein (Überschrift in Markdown) warnt nicht mehr; geprüft werden `<<<<<<<` und `>>>>>>>`, Binärdateien nicht.
- **Häkchen der Gruppe „Unversioned Files“** zeigt während eines Merges nicht mehr „angehakt“ (sie kommen nicht in den Commit).

Bewusst so gelassen: Die Warnung vor Konfliktmarkierungen und „Commit and Push“ sind im Kern getestet (`git.conflictMarkers`, Commit und danach Push), der Dialog und der kombinierte Knopf nicht eigens in Playwright; die Liste der Playwright-Tests im Ticket verlangt das nicht.
