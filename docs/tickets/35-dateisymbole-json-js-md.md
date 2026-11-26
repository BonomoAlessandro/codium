# 35 – Symbole für JSON-, JavaScript-, JSX- und Markdown-Dateien wie in IntelliJ

Status: `ready-for-agent` · Typ: HITL
Blockiert durch: –
User Stories: ergänzt „Dateibaum“ und „Oberfläche und Werkzeugfenster“ (Stil des neuen IntelliJ)
Spezifikation: „Oberfläche“ (Design), Dateibaum

Dieses Ticket kam nach Ticket 32 dazu, auf Wunsch des Nutzers. Seit Ticket 32 zeigen Java-Dateien im Projektbaum ein Symbol je Art. Der Nutzer will nun, dass auch `.json`-, `.jsx`- und `.js`-Dateien so dargestellt werden wie in IntelliJ. Wichtig ist ihm ausserdem, dass `.md`-Dateien gleich behandelt werden.

Typ HITL, weil es um Symbole geht. Der Agent legt zuerst Bilder vor, der Nutzer gibt frei oder gibt Rückmeldung, erst dann wird eingebaut.

## Heutiger Stand

- **Symbole im Baum:** Im Dateibaum (`src/renderer/project/ProjectView.tsx`) tragen Java-Dateien seit Ticket 32 das Symbol ihrer Art (`JavaKindIcon`, `FileTypeIcon` in `src/renderer/project/`, Farben `--java-*` in `tokens.css`). Alle übrigen Dateien tragen dasselbe allgemeine Symbol (`FileIcon` aus `src/renderer/icons.tsx`).
- **Weitere Orte:** Dieselben Symbole erscheinen in den Datei-Tabs, in „Recent Files“ (Ctrl + E) und in „Go to File“. So hat es der Nutzer bei Ticket 32 entschieden.
- **In IntelliJ** haben JSON, JavaScript, JSX (React) und Markdown je ein eigenes, farbiges Symbol. Die Namen erscheinen dort mit Endung, anders als bei Java-Klassen.

## Was gebaut wird

- **Eigene Symbole** im Stil des neuen IntelliJ „Dark“ für:
  - `.json`;
  - `.js`, auch `.mjs` und `.cjs`;
  - `.jsx`;
  - `.md`, auch `.markdown`.
- **Herkunft der Symbole:**
  - Gestalt und Farben lehnen sich an IntelliJ an; der Agent sieht dort nach und nennt die Quelle im Ticket.
  - Die Symbole sind selbst gezeichnet. Werte übernehmen ist in Ordnung, Dateien aus IntelliJ nicht.
- **Ablage:**
  - Die Farben stehen als Design-Variablen in `tokens.css`.
  - Die Symbole liegen bei den übrigen, in derselben Grösse wie heute, 16 px im Baum.
- **Endung bleibt:** Der Name zeigt weiter die Endung, etwa `package.json`, `App.jsx` oder `README.md`, wie in IntelliJ.
- **Erkennung:**
  - Das Symbol folgt der Endung, ohne Rücksicht auf Gross- und Kleinschreibung.
  - Den Inhalt der Datei liest Codium dafür nicht, anders als bei Java.
- **Wo:**
  - überall dort, wo seit Ticket 32 die Java-Symbole stehen: Dateibaum, Datei-Tabs, „Recent Files“ und „Go to File“;
  - der Nutzer kann auf den Bildern anders entscheiden.
- **Git-Farben:** Wie bei Ticket 32 färben sie nur den Namen; das Symbol behält seine Farbe.
- **Weitere Dateitypen (Frage an den Nutzer):**
  - Der Agent darf auf der Bilderseite vorschlagen, gleich weitere häufige Typen mitzunehmen, etwa `.ts`, `.tsx`, `.css`, `.html`, `.xml`, `pom.xml`, `.properties`, `.yml`/`.yaml` und `.gitignore`.
  - Dazu zeigt er Entwürfe der Symbole. Der Nutzer entscheidet, was in dieses Ticket kommt.
- **Bilder (HITL):**
  - Aufnahmen aus dem verborgenen Testfenster, über Playwright im Testmodus, nie vom Desktop.
  - Ablage nach der Spielregel zu Bildern: Seite `entwuerfe/35-dateisymbole/index.html`, nicht versioniert, nach Abschluss gelöscht.
  - Zu sehen ist ein Baum mit je einer Datei jedes Typs, dazu Java-Dateien und gewöhnliche Dateien, heute und neu. Ebenso Tabs, „Recent Files“ und „Go to File“.
  - Dazu jedes Symbol einzeln vergrössert, und nach Möglichkeit ein Bildschirmfoto aus IntelliJ, das der Nutzer liefern kann.
  - Der Nutzer entscheidet anhand der Bilder:
    - die Symbole;
    - die Orte;
    - ob weitere Dateitypen dazukommen.

  Die Entscheidung kommt ins Ticket, in Worten.
- **Spezifikation:** In den Abschnitten „Oberfläche“ (Design) und Dateibaum nachführen.

## Ausserhalb des Umfangs

- Besondere Ordner (Quellordner, Testordner, Ressourcen) und kompakte Pakete im Baum.
- Weitere Dateitypen, soweit der Nutzer sie auf den Bildern nicht ausdrücklich dazunimmt.

## Akzeptanzkriterien

- [ ] Die Bilder (heute, neu, nach Möglichkeit IntelliJ) wurden dem Nutzer vorgelegt, und seine Entscheidung steht im Ticket.
- [ ] Ein Einheitstest prüft die Zuordnung von Endung zu Symbol:
  - `.json`, `.js`, `.mjs`, `.cjs`, `.jsx`, `.md`, `.markdown` und die freigegebenen weiteren Typen;
  - Gross- und Kleinschreibung, etwa `README.MD`;
  - Dateien ohne Endung;
  - Java bleibt bei den Symbolen aus Ticket 32.
- [ ] Ein Playwright-Test im Testmodus prüft im Baum je eine `.json`-, `.js`-, `.jsx`- und `.md`-Datei mit ihrem Symbol und vollem Namen samt Endung.
- [ ] Je ein Test für Tabs, „Recent Files“ und „Go to File“, soweit freigegeben.
- [ ] Die Farben der Symbole stehen als Design-Variablen in `tokens.css`.
- [ ] `npm run typecheck`, `npm test` und `npm run test:ui` sind grün.

## Abnahme von Hand

- [ ] In einem echten Projekt sehen JSON-, JavaScript-, JSX- und Markdown-Dateien im Baum aus wie in IntelliJ.
- [ ] Die Symbole sind bei 100 % und 150 % klar, auch auf der ausgewählten Zeile, und passen in Tabs, „Recent Files“ und „Go to File“.

## Hinweise

- **Spielregeln:**
  - Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt.
  - Aufnahmen nur vom verborgenen Testfenster über Playwright, nie vom Desktop.
  - Keine echten Eingaben an den Desktop.
  - Keine Messungen oder Proben mit Tausenden Dateien auf der Platte ohne Rückfrage.
- **Ticket 34:** Es ändert die Scrollbalken in der ganzen App, also auch im Dateibaum. Werden beide nacheinander umgesetzt, baut das spätere auf dem früheren auf.
