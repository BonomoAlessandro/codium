# Offene Punkte nach Codium 1

Stand 2026-11-22, nach den Tickets 01 bis 21 und 23 und dem Agenten-Teil von Ticket 22. Die Abnahme von Hand steht in
[abnahme.md](abnahme.md); was Codium 1 bewusst weglässt, in der Spezifikation unter
[„Ausserhalb des Umfangs“](specs/codium-v1.md#ausserhalb-des-umfangs). Die Abschnitte „Review“ der einzelnen Tickets
erklären die Hintergründe.

## Zu entscheiden

1. **dompurify** (Markdown-Vorschau, läuft in der App): `npm audit` meldet eine Lücke mittlerer Stufe für
   dompurify ≤ 3.4.16, insgesamt 6 mittlere Meldungen (darunter minimatch). Das Update gilt laut `npm audit fix --force`
   als Breaking Change. Aktualisieren und die Markdown-Vorschau neu prüfen?
2. **Sehr grosse Werte im Tabelleninhalt** (Ticket 21): Zellen im Megabyte-Bereich (etwa grosses JSON) kommen je Seite
   vollständig in die Oberfläche, und die Zeilen werden beim Tippen ohne Memoisierung neu gezeichnet. Werte gekürzt
   laden (Anzeige) und erst im Editor bzw. für den Vergleich vollständig?
3. **Schliessen mit offenen Tabellen-Änderungen** (Ticket 21): Nur das Schliessen des Tabs fragt nach; das Schliessen
   des Fensters und „Exit“ verwerfen einen offenen Änderungssatz ohne Rückfrage.
4. **Symbol und Signatur des Installers** (Ticket 22): Der Installer hat das Standard-Symbol von Electron und ist nicht
   signiert (SmartScreen fragt beim ersten Start). Ein eigenes Symbol wäre ein kleines Ticket; Code-Signing ist laut
   Spezifikation ausserhalb des Umfangs.
5. **TypeScript fremder Projekte** (Ticket 12): Beim Öffnen eines Projekts startet Codium dessen eigenes TypeScript
   (`tsc.exe` bzw. `tsserver.js` aus `node_modules`) ohne Vertrauensabfrage. So spezifiziert, aber ein bewusstes Risiko
   bei fremden Repositories.

## Bei der Abnahme besonders prüfen

- **PowerShell 7** war auf dem Entwicklungsrechner nicht installiert; der langsame Terminal-Test lief mit Windows
  PowerShell, cmd und Git Bash. PowerShell 7 (Standard-Shell) ist ungetestet.
- **Ältere Java-Stände:** Auf dem Entwicklungsrechner gab es nur JDK 21 und 25; der Test „älterer Java-Stand“ (8, 11,
  17) wurde übersprungen.
- **Farben:** Konstanten auf Modulebene und Globale wie `console` erscheinen in TypeScript in der Grundfarbe (IntelliJ
  zeigt sie womöglich violett bzw. kursiv). Die Git-Farben stammen aus dem klassischen Darcula (#6897BB, #629755,
  #D1675A), nicht aus dem neuen „Dark“.
- **Maven mit Firmen-Mirror** in der eigenen (`~/.m2/settings.xml`) und in der globalen Einstellung
  (`%MAVEN_HOME%\conf\settings.xml`).
- **Statusleiste bei Java:** Interne Arbeiten von jdtls („Building“, „Publish Diagnostics“) blinken kurz auf.

## Bekannte Grenzen (bewusst so gelassen)

- Umbenennen einer offenen Datei verliert ihren Rückgängig-Verlauf (Monaco führt Modelle unter ihrer Adresse; 05).
- Ctrl + Tab wechselt ohne Umschaltliste (IntelliJ zeigt eine; 06).
- Schreibt ein anderes Programm genau zwischen der Stand-Prüfung und dem Schreiben, geht dessen Änderung verloren (07).
- Wird eine Datei mit ungespeicherten Eingaben gelöscht, schliesst ihr Tab und die Eingaben sind weg (Spezifikation; 07).
- Eine `.gitignore` über dem Projektordner gilt nur, wenn das Projekt in einem Repository liegt, wie bei Git (08).
- Das Suchfenster ist kein echtes Modal: Kürzel für Werkzeugfenster und Tabs ruhen darunter (08).
- Ein Terminal direkt nach dem Start zu schliessen dauert im Hintergrund gut 3 s (ConPTY wartet auf die Antwort des
  Terminals); der Tab schliesst sofort (11).
- „Neustart höchstens dreimal in drei Minuten“ des Sprachservers: drei Neustarts, der vierte Absturz gibt auf (12).
- Vervollständigung ohne Herkunftsmodul (`labelDetails`); Ctrl + N findet Type-Aliase mit TypeScript 6 nicht (13).
- Zu Zeile (Ctrl + G) über wenige Zeilen erzeugt keinen Eintrag im Zurück/Vor-Verlauf (erst ab Dateiwechsel oder mehr
  als 10 Zeilen; 13).
- Gradle-Daemons laufen nach Gradle-Art stundenlang weiter; nur die Tests beenden ihre eigenen (14).
- Ohne `pull.rebase` in der Git-Konfiguration verweigert Git den Pull auseinanderlaufender Branches mit seinem Hinweis;
  Codium wählt bewusst keine eigene Strategie (18).
- Picking eines Autors im Log-Filter sucht wie freier Text einen Teil von Name oder E-Mail; steht HEAD auf einem alten
  Branch weit unten, bleibt Spalte 0 des Graphs darüber frei (19).
- Beendet ein Verbindungsfehler den Pool einer Datenbank-Verbindung, scheitern Anfragen, die ihn gerade benutzen, mit
  der Meldung von node-postgres; der nächste Versuch legt einen neuen an (20).
- Ein fehlender oder zusätzlicher Zeilenumbruch am Dateiende ergibt keinen Änderungsbalken (17).

## Wackelige Tests (beobachten)

Unter Last (voller Lauf aller Testsuiten) gelegentlich rot, einzeln jeweils grün:

- UI: „TypeScript: Ctrl + Klick auf die Deklaration zeigt die Verwendungen“ (Auswahl erscheint nicht innert 30 s);
  auch einzeln etwa 1 von 4 Mal direkt nach einem vollen Lauf, danach mit Diagnose 16 Mal grün.
- UI: einzelne Zeitüberschreitungen im Dateibaum, im Terminal und im zeitbasierten Hinweis-Test (layout).
- Langsam: „Gradle 8: Import mit dem Wrapper“ und einmal 4 Terminal-Tests.
- Langsam: einmal ein Absturz des Test-Workers in `terminal.test.ts` (0xC0000005, node-pty).

Das Testgerüst räumt inzwischen liegengebliebene App-Instanzen (nach Zeitüberschreitungen) und verwaiste
PostgreSQL-Hilfsprozesse selbst auf; beides war zuvor eine Ursache für Ausreisser.
