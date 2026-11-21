# 09 – Einstellungen, JDK-Erkennung, Voraussetzungen und README

Status: `erledigt` (2026-11-22, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
Blockiert durch: 05
User Stories: 7 („Settings“), 172, 173, 177–181
Spezifikation: „Einstellungen, Meldungen und Voraussetzungen“, „Sprachverständnis“ (Laufzeiten, JDK-Erkennung), „Auslieferung und Abhängigkeiten“ (README), „Präzisierungen beim Schreiben“ Punkte 14, 18, 27

## Was gebaut wird

- **Einstellungsdialog** über Ctrl + Alt + S (zentrale Tastenbelegung bzw., falls Ticket 06 noch nicht fertig ist, so angelegt, dass 06 es übernimmt) und „Settings…“ im Projektmenü, auf dem Einstellungsspeicher aus Ticket 05. Felder:
  - „Editor font size“: dieselbe Einstellung, die Ctrl + Mausrad ändert.
  - „JDK for Java language server“: Auswahl aus den erkannten JDKs ab Version 25, Standard „Newest detected“. Wirkt erst ab Ticket 14.
  - Das Feld „Terminal shell“ kommt mit Ticket 11.
- **JDK-Erkennung** im App-Kern über den Port „System“: JAVA_HOME, die üblichen Installationsordner (Oracle, Eclipse Adoptium, Microsoft, Amazon Corretto, Azul Zulu) und die von IntelliJ heruntergeladenen JDKs im Benutzerordner, jeweils mit Version. Ergebnis für Ticket 14 bereitgestellt: alle JDKs und das gewählte JDK für jdtls.
- **Prüfung der Voraussetzungen** beim Start des App-Kerns:
  - **Git:** Wird Git nicht gefunden (oder ist `CODIUM_TEST_NO_GIT=1` gesetzt), erscheint in jedem Projektfenster der Fehlerhinweis „Git not found“ mit „Open README“. Der App-Kern stellt das Ergebnis bereit, damit sich spätere Git-Funktionen abschalten.
  - **JDK:** Ist kein JDK ab 25 erkannt und keines eingestellt, erscheint der Hinweis erst beim Öffnen eines Projekts mit Java-Kennzeichen (Maven- oder Gradle-Baudatei), mit „Open README“.
- **„Open README“** öffnet das mit Codium mitgelieferte README schreibgeschützt in einem Tab und springt zum Abschnitt „Voraussetzungen“. Für das Paket wird das README ausserhalb des App-Archivs abgelegt.
- **README:** Abschnitt „Voraussetzungen“ mit den Teilen „Zum Benutzen“ und „Zum Entwickeln“ nach der Spezifikation (JDK 25, JAVA_HOME nicht nötig). Den Punkt zum C++-Compiler vorerst als „wird geprüft“ vermerken; geklärt wird er in Ticket 11.

## Akzeptanzkriterien

- [x] Kern-Tests mit nachgemachtem System:
  - Einstellungen überstehen einen Neustart; eine Änderung erreicht alle offenen Fenster.
  - JDK-Erkennung findet JDKs in vorgegebenen Ordnern samt Version und erkennt JAVA_HOME. „Newest detected“ wählt das neueste JDK ab 25, auch wenn JAVA_HOME auf JDK 21 zeigt.
  - Ohne Git → Hinweis in jedem Projektfenster.
  - Ohne JDK 25: kein Hinweis bei einem Projekt ohne Java-Kennzeichen, Hinweis bei einem Maven- und einem Gradle-Projekt.
  - JDK 21 und 25 installiert, JAVA_HOME auf 21 → kein Hinweis.
- [x] Playwright-Tests:
  - Ctrl + Alt + S öffnet den Dialog; eine geänderte Schriftgrösse wirkt sofort im Editor.
  - Start mit `CODIUM_TEST_NO_GIT=1` zeigt „Git not found“. „Open README“ öffnet einen schreibgeschützten Tab am Abschnitt „Voraussetzungen“.
- [x] Das README enthält den Abschnitt „Voraussetzungen“ mit beiden Teilen.
- [x] `npm run test:packaged` findet das README im ungepackten Paket.

## Abnahme von Hand

- [ ] Der Einstellungsdialog listet die auf dem Rechner installierten JDKs ab 25.
- [ ] Ohne Git (etwa Git kurz aus dem PATH nehmen): Jedes Projektfenster zeigt „Git not found“, „Open README“ öffnet das README am Abschnitt „Voraussetzungen“, im installierten Codium aus dem Installationsordner.
- [ ] Ein Maven-Projekt auf einem Rechner ohne JDK 25 zeigt den Hinweis; mit JDK 25 nicht.

## Umsetzung

- **Einstellungen:** `AppSettings` hat jetzt `jdk` (`null` heisst „Newest detected“). Der Dialog (`SettingsDialog.tsx`) schickt beim Bestätigen Schriftgrösse und, nur wenn geändert, das JDK an `app.updateSettings`.
- **JDK-Erkennung** im Kern (`jdks.ts`) über den Port „System“: JAVA_HOME, die Herstellerordner unter „Program Files“ und `%LOCALAPPDATA%\Programs` (Oracle/Java, Eclipse Adoptium, Temurin, Microsoft, Amazon Corretto, Zulu, BellSoft, OpenJDK) und `~\.jdks` von IntelliJ. Ein JDK ist ein Ordner mit `bin\java.exe` und `release`. Mehr als verlangt: BellSoft, OpenJDK und `%LOCALAPPDATA%\Programs` (dort liegen die Temurin-JDKs dieses Rechners).
- **Voraussetzungen:** Der App-Kern sucht Git beim Start (`AppCore.gitPath` für Ticket 15) und meldet beim Anlegen jedes Projekt-Kerns ein fehlendes Git bzw. bei Projekten mit Maven- oder Gradle-Baudatei ein fehlendes JDK ab 25, jeweils als Fehlerhinweis mit „Open README“ (`NoticeActions['readme.open']`). Ein Fehlerhinweis bleibt stehen, damit der Knopf nicht mit einer Information verschwindet.
- **„Open README“:** `app.readme` liefert das mitgelieferte README; der Code-Bereich zeigt es in einem schreibgeschützten Dokument-Tab (`openDocument`), der weder gespeichert noch als Datei-Tab gesichert noch nach einem Neustart wiederhergestellt wird. Im Paket liegt das README unter `resources\README.md` (`extraResources`).
- **README:** Abschnitt „Voraussetzungen“ mit „Zum Benutzen“ und „Zum Entwickeln“; der C++-Compiler ist als „wird mit Ticket 11 geprüft“ vermerkt. Die „Offenen Punkte“ ersetzt Ticket 22.

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-22. Der schreibgeschützte README-Tab (nie gespeichert, nie gesichert, kein Cursor, keine zuletzt geöffneten Dateien, schreibgeschützt auch nach Tabwechseln), die Hinweise (einmal je Projektfenster, nicht im Willkommensfenster, JDK nur bei Java-Kennzeichen), Erkennung und Laufzeit, Kürzel unter dem Dialog, README und Paketierung in Ordnung. Eingearbeitet:

- **Enter auf „Cancel“ speicherte** (nachgewiesen): Enter bestätigt nur noch in einem Feld.
- **Kein Fokusfang, Escape ging verloren** (nachgewiesen): Tab bleibt im Dialog (`keepFocusInside` aus den Rückfragen, jetzt mit `select`), Escape wirkt über das Fenster.
- **JAVA_HOME war ungetestet** (Mutation blieb grün): Ein Test findet ein JDK nur über JAVA_HOME.
- **JAVA_HOME mit Anführungszeichen oder „/“** (nachgewiesen): wird bereinigt; alle Pfade kommen in einer Schreibweise, die Einstellung wird in dieser gespeichert, der Dialog vergleicht unabhängig von der Schreibweise.
- **Der Kern nahm jedes absolute JDK an** (nachgewiesen, auch JDK 21 und `Z:\nope`): Einstellen lässt sich nur ein erkanntes JDK ab 25 (sonst `INVALID_PARAMS`); ein früher eingestelltes, inzwischen fehlendes bleibt stehen, bis der Nutzer etwas anderes wählt.
- **Junctions in den Suchordnern** (nachgewiesen): Der Port „System“ listet auch Links auf Ordner.
- **Early-Access-Builds** gewannen „Newest detected“ (nachgewiesen): Ein EA-Build zählt nur, wenn es kein fertiges JDK ab 25 gibt.
- **Tooltip des README-Tabs leer, Hinweis „codium:“:** Dokument-Tabs haben einen eigenen Tooltip („… – comes with Codium (read-only)“) und bei gleichem Namen wie eine Datei den Zusatz „Codium“.
- **Dokument-Tab beim Neueinlesen** nach verpassten Ereignissen: übersprungen.
- **Anzeige während der Suche nach JDKs:** „Newest detected“ ohne Zusatz, das eingestellte JDK als Option; scheitert die Suche, sagt der Hinweis das.

Verworfen: nichts.
