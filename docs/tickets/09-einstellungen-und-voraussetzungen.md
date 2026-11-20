# 09 – Einstellungen, JDK-Erkennung, Voraussetzungen und README

Status: `ready-for-agent` · Typ: AFK
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

- [ ] Kern-Tests mit nachgemachtem System:
  - Einstellungen überstehen einen Neustart; eine Änderung erreicht alle offenen Fenster.
  - JDK-Erkennung findet JDKs in vorgegebenen Ordnern samt Version und erkennt JAVA_HOME. „Newest detected“ wählt das neueste JDK ab 25, auch wenn JAVA_HOME auf JDK 21 zeigt.
  - Ohne Git → Hinweis in jedem Projektfenster.
  - Ohne JDK 25: kein Hinweis bei einem Projekt ohne Java-Kennzeichen, Hinweis bei einem Maven- und einem Gradle-Projekt.
  - JDK 21 und 25 installiert, JAVA_HOME auf 21 → kein Hinweis.
- [ ] Playwright-Tests:
  - Ctrl + Alt + S öffnet den Dialog; eine geänderte Schriftgrösse wirkt sofort im Editor.
  - Start mit `CODIUM_TEST_NO_GIT=1` zeigt „Git not found“. „Open README“ öffnet einen schreibgeschützten Tab am Abschnitt „Voraussetzungen“.
- [ ] Das README enthält den Abschnitt „Voraussetzungen“ mit beiden Teilen.
- [ ] `npm run test:packaged` findet das README im ungepackten Paket.

## Abnahme von Hand

- [ ] Der Einstellungsdialog listet die auf dem Rechner installierten JDKs ab 25.
