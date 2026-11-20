# 14 – Java-Sprachserver

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: 09, 13
User Stories: 75–87, 89, 90 für Java; 172 (Feld „JDK“ wirksam)
Spezifikation: „Sprachverständnis“ (Java, Laufzeiten, JDK-Erkennung, Maven, Gradle, Lombok, Arbeitsdaten, Bibliotheksklassen, Symbolsuche), „Auslieferung und Abhängigkeiten“ (jdtls, Lombok), „Präzisierungen beim Schreiben“ Punkte 18, 20

## Was gebaut wird

- **jdtls und Lombok beschaffen:**
  - Ein npm-Skript, das der Build aufruft, holt jdtls in einer festen Version von download.eclipse.org. Die erwartete SHA-256-Prüfsumme liegt im Repository; bei Abweichung bricht es ab.
  - Lombok kommt in fester Version ebenfalls mit Prüfsumme.
  - Zwischenspeicher in einem von Git ausgenommenen Ordner, damit nicht jeder Build neu lädt.
  - `npm start` und `test:slow` finden jdtls dort. Fehlt es (etwa ohne Netz), überspringt `test:slow` die Java-Tests mit klarer Meldung.
  - Für das Paket liegen jdtls und Lombok ausserhalb des App-Archivs.
- **Start** im Sprach-Dienst aus Ticket 12:
  - Mit dem JDK aus der JDK-Erkennung (Ticket 09): „Newest detected“ ab 25 oder das eingestellte. Ohne JDK 25 startet kein Java-Server.
  - Beim Öffnen eines Projekts mit Maven- oder Gradle-Baudatei, sonst bei der ersten Java-Datei.
  - Arbeitsdaten und eine beschreibbare Kopie des Konfigurationsordners pro Projekt im Datenordner.
  - Mit Lombok als Java-Agent.
  - Ein geändertes JDK in den Einstellungen startet laufende Java-Server neu.
- **Einstellungen für jdtls:**
  - Unterstützung für Klasseninhalte anmelden, damit jdtls Ziele in Klassendateien liefert.
  - Quellen herunterladen für Maven und Gradle einschalten.
  - Methoden in der Symbolsuche einschalten.
  - Die erkannten JDKs als Laufzeiten melden.
  - Den Gradle-Daemon mit einem JDK starten, das zur Gradle-Version des Wrappers passt: Version aus der Wrapper-Konfiguration lesen, nach der Verträglichkeitstabelle von Gradle wählen.
- **Maven:** übernimmt die Maven-Einstellungen des Benutzers. Im Test werden stattdessen eigene Einstellungen mit Maven Central und ein lokales Repository im Test-Zwischenspeicher verwendet (Spielregeln).
- **Bibliotheksklassen:** Ziele in Klassendateien (JDK, Bibliotheken) öffnet der Sprach-Dienst über die Erweiterung von jdtls für Klasseninhalte als schreibgeschützten Tab, mit Quelltext oder den von jdtls erzeugten Signaturen. Die Oberfläche legt dafür Modelle an (wie in Ticket 12). Ctrl + Linksklick funktioniert auch innerhalb dieser Tabs.
- **Fortschritt** des Imports in der Statusleiste („Importing Java project…“).
- **Semantische Token** für Java auf die Farben von IntelliJ „Dark“ abgebildet (Felder, statische Member, Konstanten, Methodendeklarationen, Annotationen).

## Akzeptanzkriterien

- [ ] Das Beschaffungsskript lädt jdtls und Lombok, prüft die Prüfsummen und bricht bei Abweichung ab (getestet mit einer absichtlich falschen Prüfsumme). `npm run test:packaged` startet jdtls im ungepackten Paket und findet Lombok.
- [ ] Langsamer Testlauf (übersprungen ohne JDK 25, ohne jdtls oder ohne Netz):
  - **Maven-Beispiel:** Definition, Verwendungen, Implementierungen, Hover mit Javadoc, Fehler, Vervollständigung, semantische Token (Feld, statisches Feld, Parameter), Symbolsuche (Klasse und Methode).
  - **Lombok-Beispiel:** Ein Getter aus `@Getter` ist Sprungziel, und es erscheint kein falscher Fehler.
  - **JDK-Klasse:** Ein Sprung auf `String` liefert ein schreibgeschütztes Ziel mit Quelltext.
  - **Älterer Java-Stand:** Ein Projekt mit Java 8 bzw. 17 als Ziel wird gegen ein passendes erkanntes JDK geprüft, etwa: eine API, die erst später existiert, wird als Fehler gemeldet. Übersprungen, wenn kein passendes JDK installiert ist.
  - **Gradle-Beispiel** mit Wrapper Gradle 8 (feste Version, Prüfsumme der Verteilung in der Wrapper-Konfiguration): wird importiert, der Daemon läuft mit einem passenden JDK, Definition funktioniert.
  - Geändertes JDK in den Einstellungen startet den Server neu.
  - Nach den Tests laufen keine jdtls-Prozesse und keine Gradle-Daemons mehr.
- [ ] Kern-Test: Ohne JDK 25 startet kein Java-Server, und das gilt nicht als Absturz.

## Abnahme von Hand

- [ ] Ein echtes Maven-Projekt mit Spring und Lombok: Import läuft mit Fortschritt durch, Ctrl + Linksklick auf eine Spring-Klasse zeigt ihren Quelltext.
- [ ] Ein Projekt hinter dem Firmen-Mirror aus der eigenen settings.xml löst seine Abhängigkeiten auf.
- [ ] Ein echtes Gradle-Projekt mit älterem Wrapper lässt sich importieren.
- [ ] Die Färbung von Java-Code entspricht IntelliJ „Dark“.
