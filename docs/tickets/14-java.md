# 14 – Java-Sprachserver

Status: `erledigt` (2026-11-22, Abnahme von Hand am Schluss in Ticket 22) · Typ: AFK
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

- [x] Das Beschaffungsskript lädt jdtls und Lombok, prüft die Prüfsummen und bricht bei Abweichung ab (getestet mit einer absichtlich falschen Prüfsumme). `npm run test:packaged` startet jdtls im ungepackten Paket und findet Lombok.
- [x] Langsamer Testlauf (übersprungen ohne JDK 25, ohne jdtls oder ohne Netz):
  - **Maven-Beispiel:** Definition, Verwendungen, Implementierungen, Hover mit Javadoc, Fehler, Vervollständigung, semantische Token (Feld, statisches Feld, Parameter), Symbolsuche (Klasse und Methode).
  - **Lombok-Beispiel:** Ein Getter aus `@Getter` ist Sprungziel, und es erscheint kein falscher Fehler.
  - **JDK-Klasse:** Ein Sprung auf `String` liefert ein schreibgeschütztes Ziel mit Quelltext.
  - **Älterer Java-Stand:** Ein Projekt mit Java 8 bzw. 17 als Ziel wird gegen ein passendes erkanntes JDK geprüft, etwa: eine API, die erst später existiert, wird als Fehler gemeldet. Übersprungen, wenn kein passendes JDK installiert ist.
  - **Gradle-Beispiel** mit Wrapper Gradle 8 (feste Version, Prüfsumme der Verteilung in der Wrapper-Konfiguration): wird importiert, der Daemon läuft mit einem passenden JDK, Definition funktioniert.
  - Geändertes JDK in den Einstellungen startet den Server neu.
  - Nach den Tests laufen keine jdtls-Prozesse und keine Gradle-Daemons mehr.
- [x] Kern-Test: Ohne JDK 25 startet kein Java-Server, und das gilt nicht als Absturz.

## Abnahme von Hand

- [ ] Ein echtes Maven-Projekt mit Spring und Lombok: Import läuft mit Fortschritt durch, Ctrl + Linksklick auf eine Spring-Klasse zeigt ihren Quelltext.
- [ ] Ein Projekt hinter dem Firmen-Mirror aus der eigenen settings.xml löst seine Abhängigkeiten auf.
- [ ] Ein echtes Gradle-Projekt mit älterem Wrapper lässt sich importieren.
- [ ] Die Färbung von Java-Code entspricht IntelliJ „Dark“.
- [ ] Ein Maven-Projekt mit Firmen-Mirror in den globalen Einstellungen (`%MAVEN_HOME%\conf\settings.xml`) löst seine Abhängigkeiten auf.

## Umsetzung

- **Versionen:** jdtls 1.63.0 (download.eclipse.org, Oktober 2026), Lombok 1.18.48 (Maven Central); Prüfsummen in `scripts/java-tools.json`, Zwischenspeicher `.cache/java-tools` (feste Namen `jdtls`, `lombok.jar`). `node build.mjs` und `npm run fetch:java` beschaffen sie; ohne Netz geht das Bauen weiter.
- **Im Testmodus** startet jdtls nur mit `CODIUM_TEST_JAVA=1` und eigenen Maven-Einstellungen (`CODIUM_TEST_MAVEN_SETTINGS`), sonst nähme es die des Nutzers.
- **Älterer Java-Stand:** Der Test läuft nur mit einem erkannten JDK 17; auf diesem Rechner gibt es nur JDK 21 und 25, er ist deshalb übersprungen. Laut Review wirken die gemeldeten Laufzeiten tatsächlich (ein Projekt mit Ziel 21 bekommt eine Java-24-API als Fehler).

## Review

Unabhängiges Review durch einen zweiten Agenten am 2026-11-22. Beschaffung samt Prüfsummen, Paket, JDK-Wahl unabhängig von JAVA_HOME, Lombok, Arbeitsdaten pro Projekt, Laufzeiten, Gradle-Tabelle und Daemon-JDK, Maven-Einstellungen im Test, Umbau auf mehrere Server ohne Rückschritt für TypeScript, Klassendateien samt Sicherheit von `readTarget`, Neustart, Abbau und semantische Token in Ordnung. Eingearbeitet:

- **jdtls schrieb .project, .classpath, .factorypath und .settings in die Projekte** (nachgewiesen): `-Djava.import.generatesMetadataFilesAtProjectRoot=false`; der Lombok-Test prüft, dass keine davon entsteht.
- **Die Kopie der Konfiguration wurde nach einem jdtls-Update nicht erneuert** (im Paket ist der Pfad bei jeder Version gleich): Stempel aus config.ini und Launcher; Kern-Test.
- **„Kein jdtls mehr nach den Tests“ prüfte nichts:** jetzt nach Prozessnummer; am Ende des Laufs läuft nichts mehr aus `.cache\java-tools` oder dem Gradle-Ordner der Tests.
- **Der Kern-Test „ohne JDK 25“ unterschied nicht:** vollständiges nachgemachtes jdtls, kein Startversuch im Protokoll, der JDK-Hinweis erscheint. Dabei aufgefallen: Ein Programm, das sich gar nicht starten lässt, warf beim Start ungefangen; jetzt protokolliert.
- **Ein HTTP-Fehler galt als „ohne Netz“:** Nur echte Netzfehler lassen das Bauen weiterlaufen; Test mit einer falschen Adresse.
- **Versionen doppelt festgelegt, falsche Sortierung im Zwischenspeicher:** feste Namen ohne Version.
- **JDK-Erkennung bei jeder Anfrage:** einmal ermittelt, neu bei einem JDK-Wechsel. **Neustart auch ohne echten Wechsel:** nur, wenn sich das verwendete JDK ändert (Kern-Test mit zwei nachgemachten JDKs; der langsame Test prüft, dass dasselbe JDK nicht neu startet). **Symbolsuche wartete auf jdtls:** höchstens 5 s je Server.
- **Dekompilierter Code statt Signaturen:** Einstellung entfernt; ohne Quellen zeigt jdtls seine Signaturen (wie spezifiziert).
- **Gradle-JDK:** auch mit dem Wrapper in einem Unterordner; der Test berechnet das erwartete JDK und schliesst das von jdtls aus.
- **Globale Maven-Einstellungen** (`%MAVEN_HOME%\conf\settings.xml`) gehen an jdtls, ausser in Tests; in die Abnahme von Hand aufgenommen.
- **Offen, nicht geändert:** Interne Jobnamen von jdtls („Building“, „Publish Diagnostics“) erscheinen kurz in der Statusleiste; der Fortschritt „Importing Java project…“ hat keinen eigenen Test.
