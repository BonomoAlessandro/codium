# 24 – Logo und App-Symbol

Status: `ready-for-human` · Typ: HITL
Blockiert durch: –
User Stories: keine eigene; betrifft das Erscheinungsbild der ganzen App (Spezifikation „Lösung“, „Oberfläche“ und „Auslieferung“)
Spezifikation: „Oberfläche“ (Design), „Auslieferung und Abhängigkeiten“

Dieses Ticket kam nach Codium 1 dazu. Heute zeigen Installer, `Codium.exe`, Taskleiste und Fenster das Standardsymbol von Electron.

Typ HITL, weil die Wahl des Logos beim Nutzer liegt: Der Agent legt Entwürfe vor, der Nutzer wählt aus oder gibt Rückmeldung, erst dann wird eingebaut.

## Was gebaut wird

- **Entwürfe (zuerst, dann Rückmeldung des Nutzers):**
  - Drei bis vier eigenständige Entwürfe als SVG, jeweils mit kurzer Idee dahinter.
  - Eine Vorschauseite (eine lokale HTML-Datei, kein Start der App), die jeden Entwurf in den Grössen 16, 24, 32, 48, 256 px zeigt, auf dunklem und auf hellem Hintergrund, dazu in einer nachgestellten Taskleiste und in der Kopfzeile des Willkommensfensters.
  - Der Agent wartet auf die Wahl des Nutzers, arbeitet Rückmeldungen ein und legt bei Bedarf eine zweite Runde vor.
- **Vorgaben an das Logo:**
  - Eigenständig: Es darf nicht den Logos von IntelliJ bzw. JetBrains, VS Code oder VSCodium ähneln; auch nicht in Form oder Farbverlauf.
  - Einfach: klare Formen, die auch mit 16 px erkennbar bleiben; kein Text ausser höchstens einem Buchstaben.
  - Passend zum dunklen Design von Codium (Farben aus `src/renderer/styles/tokens.css`), und trotzdem gut sichtbar auf einer hellen Taskleiste.
- **Nach der Wahl, einbauen:**
  - Die SVG-Quelle liegt im Repository. Alle abgeleiteten Dateien (ICO mit den Grössen 16, 20, 24, 32, 40, 48, 64, 96, 128 und 256 px, PNG bis 512 px) entstehen reproduzierbar mit einem npm-Skript aus der Quelle. Keine Binärdatei ohne Quelle, kein Online-Werkzeug.
  - Installer, Deinstallierer, `Codium.exe`, die Verknüpfungen in Startmenü und auf dem Desktop tragen das Logo (Konfiguration von electron-builder).
  - Die Fenster setzen das Symbol auch selbst, damit Taskleiste und Alt + Tab es schon in der Entwicklungsversion zeigen.
  - Das Willkommensfenster zeigt das Logo gross über dem Titel; das Farbkürzel im Projektmenü bleibt, wie es ist.
  - Das README erwähnt, wo die Quelle liegt und wie man die Symbole neu erzeugt.

## Akzeptanzkriterien

- [ ] Die Entwürfe und die Vorschauseite liegen vor, und der Nutzer hat einen Entwurf gewählt (im Abschnitt „Entscheidung“ des Tickets festgehalten, mit der Rückmeldung).
- [ ] Das npm-Skript erzeugt aus der SVG-Quelle die ICO- und PNG-Dateien; zweimal ausgeführt entstehen dieselben Dateien.
- [ ] Ein Einheitstest liest die ICO-Datei und prüft, dass alle verlangten Grössen enthalten sind.
- [ ] Ein Playwright-Test (im Testmodus) prüft, dass das Willkommensfenster das Logo zeigt (Bild geladen, nicht leer).
- [ ] `npm run test:packaged` prüft, dass `Codium.exe` im ungepackten Paket ein eigenes Symbol trägt und nicht das von Electron (etwa über den Vergleich der Symbol-Ressource mit dem erzeugten ICO).
- [ ] Alle Testläufe bleiben grün; der Installer lässt sich mit `npm run dist` bauen.

## Abnahme von Hand

- [ ] Das Logo gefällt; es wirkt auch mit 16 px in der Taskleiste und im Explorer noch klar.
- [ ] Installer und Deinstallierer zeigen das Logo, ebenso die Verknüpfungen im Startmenü und auf dem Desktop.
- [ ] Taskleiste und Alt + Tab zeigen das Logo, bei hellem und dunklem Windows-Design und bei 100 % und 150 % Skalierung.
- [ ] Das Willkommensfenster sieht mit dem Logo stimmig aus.

## Hinweise

- **Name:** „Codium“ ist auch der Name anderer Werkzeuge (etwa VSCodium, eine freie Fassung von VS Code). Das Logo soll deshalb erst recht eigenständig sein. Ob der Name bleibt, ist nicht Teil dieses Tickets; falls der Nutzer ihn ändern möchte, wäre das ein eigenes Ticket.
- Die Spielregeln gelten auch hier: Die echte App nur über die Testläufe bzw. `launchCodium` starten, nie direkt; die Vorschauseite ist eine HTML-Datei und braucht die App nicht.
