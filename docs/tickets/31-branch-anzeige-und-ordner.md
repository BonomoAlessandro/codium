# 31 – Branch-Anzeige breiter, Branches im Dropdown in Ordnern, zuletzt benutzte Branches

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: –
User Stories: 94–96 (Branch-Menü)
Spezifikation: „Oberfläche“ (Kopfzeile), „Git“ (Branch-Menü)

Dieses Ticket kam nach Ticket 30 dazu, auf Wunsch des Nutzers. Es geht um drei Verbesserungen am Branch-Menü in der Kopfzeile:
- Der Name des aktuellen Branches darf mehr Platz einnehmen.
- Im Dropdown stehen Branches mit Präfix wie `feature/…` oder `bugfix/…` in Ordnern, wie in IntelliJ.
- Ein Bereich „Recent“ zeigt die zuletzt benutzten Branches.

## Heutiger Stand

- **Kopfzeile:**
  - Der Branch-Knopf (`Header.tsx`, `.branch-widget`) zeigt den Namen des aktuellen Branches in `.header-widget-label`.
  - Die Klasse begrenzt auf 280 px (`app.css`), für den Projektnamen wie für den Branch. Längere Namen werden mit „…“ gekürzt, der volle Name steht im Tooltip.
  - Branchnamen wie `feature/ABC-1234-kurze-beschreibung` werden so oft abgeschnitten, obwohl in der Kopfzeile genug Platz wäre.
- **Dropdown:**
  - `BranchPopup.tsx` ist 380 px breit und listet unter „Local“ und „Remote“ alle Branches flach und alphabetisch.
  - Bei vielen Branches mit Präfixen (`feature/…`, `bugfix/…`, `release/…`) wird die Liste lang und unübersichtlich.
  - IntelliJ gruppiert solche Branches in Ordner, die sich auf- und zuklappen lassen.
  - Einen Bereich mit zuletzt benutzten Branches gibt es nicht. Wer zwischen wenigen Branches hin und her wechselt, muss sie jedes Mal suchen. IntelliJ zeigt sie oben unter „Recent“.

## Was gebaut wird

### Branch-Anzeige breiter

- Die Beschriftung des Branch-Knopfs darf bis zur doppelten Breite einnehmen, also 560 px statt 280 px.
- Der Projektname bleibt bei 280 px.
- Ist das Fenster schmal, wird der Branchname wie heute mit „…“ gekürzt.
  - Kürzen ist besser, als die Fensterknöpfe zu überdecken, die Zieh-Fläche der Kopfzeile ganz zu verdrängen oder andere Elemente aus der Kopfzeile zu schieben.
  - Die Breite steht als Design-Variable bzw. eigene Regel für den Branch-Knopf, nicht als zweiter fester Wert verstreut.
- Der Tooltip mit vollem Namen und Upstream bleibt.
- Das Dropdown wird bei Bedarf breiter, damit lange Branchnamen darin ebenfalls mehr Platz haben. Vorschlag: die Breite folgt dem Inhalt bis zu einer Obergrenze, mindestens die heutigen 380 px. Es bleibt innerhalb des Fensters.

### Branches in Ordnern

- **Gruppieren:**
  - Ein `/` im Branchnamen bildet Ordner, wie in IntelliJ. Aus `feature/login` und `feature/logout` wird ein Ordner „feature“ mit den Einträgen „login“ und „logout“.
  - Mehrere Ebenen ergeben verschachtelte Ordner, etwa `feature/team-a/x`.
  - Branches ohne `/` stehen direkt unter „Local“ bzw. „Remote“.
- **Remote-Branches:**
  - Der Name des Remotes, etwa `origin`, bildet die erste Ebene, darunter die Ordner der Präfixe. Hat das Repository nur ein Remote, darf diese Ebene wegfallen; der Agent entscheidet nach IntelliJ und begründet im Ticket.
- **Ordnerzeilen:**
  - mit Ordnersymbol und Pfeil, eingerückt nach Ebene;
  - Reihenfolge wie in IntelliJ, etwa Ordner vor einzelnen Branches, beides alphabetisch. Die gewählte Regel kommt ins Ticket.
- **Branchzeilen:**
  - Eine Branchzeile im Ordner zeigt den Namen ohne Präfix. Tooltip, Untermenü, Checkout und die übrigen Aktionen arbeiten mit dem vollen Namen.
  - Der aktuelle Branch trägt sein Etikett wie heute, die Pfeile für voraus und zurück bleiben.
- **Auf- und Zuklappen:**
  - Beim Öffnen des Dropdowns sind die Ordner zu. Ausnahme: Die Ordner, in denen der aktuelle Branch liegt, sind offen.
  - Auf- und zugeklappt wird mit Klick auf die Zeile, mit Enter oder mit Pfeil rechts bzw. links. Pfeil links auf einem Branch im Ordner springt zum Ordner, wie im Dateibaum.
  - Pfeil rechts auf einer Branchzeile öffnet weiterhin ihr Untermenü.
  - Welche Ordner offen sind, merkt sich das Projektfenster für die Dauer der Sitzung; gespeichert wird es nicht.
  - Wie in Ticket 29 klappt ein Ordner beim Zuklappen auch seine Unterordner zu.
- **Suchen:**
  - Tippen im Suchfeld filtert wie heute über den vollen Namen, also findet `feat` auch `feature/login`.
  - Während gefiltert wird, sind alle Ordner mit Treffern offen und zeigen nur die Treffer. Ordner ohne Treffer verschwinden. Nach dem Leeren des Suchfelds gilt wieder der gemerkte Zustand.
  - Pfeil hoch und runter laufen über Ordner- und Branchzeilen; Enter auf einer Branchzeile tut, was es heute tut.
- **Umsetzung:**
  - Das Bilden der Zeilen ist eine reine Funktion ohne DOM, damit sie sich in Node prüfen lässt. Sie erhält Branches, Filter und offene Ordner und gibt sichtbare Zeilen mit Ebene zurück.
  - `BranchPopup.tsx` zeichnet nur.
- **Spezifikation:** Die Abschnitte „Oberfläche“ (Kopfzeile) und „Git“ (Branch-Menü) nachführen.

### Zuletzt benutzte Branches („Recent“)

- **Bereich:**
  - Ein Bereich „Recent“ zwischen den Aktionen und „Local“ zeigt die letzten 5 benutzten Branches, der neueste zuerst.
  - Benutzt heisst ausgecheckt.
  - Der aktuelle Branch zählt nicht mit; er steht ja schon in der Titelzeile des Dropdowns.
- **Nur, was noch existiert:**
  - Gezeigt werden nur lokale Branches, die es noch gibt. Gelöschte fallen weg, und dafür rückt der nächstältere nach, bis 5 erreicht sind.
  - Gibt es keinen, fehlt der Bereich samt Überschrift.
- **Woher:**
  - Vorschlag: aus dem Reflog von `HEAD` (`checkout: moving from … to …`). So zählen auch Wechsel im Terminal oder in anderen Werkzeugen, und Codium muss nichts speichern.
  - Losgelöste Stände (detached HEAD) und Commits zählen nicht.
  - Der Agent prüft, ob das Lesen auch bei einem langen Reflog schnell bleibt, etwa durch Begrenzen der gelesenen Einträge.
  - Entscheidet er sich für einen eigenen Verlauf im Projekt-Zustand, begründet er es im Ticket.
- **Zeilen:**
  - Die Zeilen zeigen den vollen Namen, ohne Ordner.
  - Sie verhalten sich wie die übrigen Branchzeilen: Untermenü, Checkout, Etiketten und die Pfeile für voraus und zurück.
- **Suchen:**
  - Das Suchfeld filtert auch diesen Bereich.
  - Hat er keine Treffer, verschwindet er.
  - Ein Branch darf in „Recent“ und unter „Local“ zugleich stehen.
- **Spezifikation:** Beim Branch-Menü nachführen.

## Ausserhalb des Umfangs

- Ein Schalter zum Abschalten der Ordner („Group by Prefix“ in IntelliJ).
- Ordner in anderen Listen mit Branches, etwa in Dialogen oder im Git-Log.

## Akzeptanzkriterien

- [x] Einheitstests für das Bilden der Zeilen:
  - Präfixe werden zu Ordnern, auch verschachtelt.
  - Branches ohne `/` bleiben oben.
  - Remote-Branches stehen unter ihrem Remote bzw. nach der gewählten Regel.
  - Die Reihenfolge stimmt.
  - Die Ordner des aktuellen Branches sind offen.
  - Ein Filter öffnet Ordner mit Treffern und blendet die übrigen aus.
  - Ein zugeklappter Ordner klappt seine Unterordner mit zu.
- [x] Ein Playwright-Test im Testmodus mit einem Repository mit `main`, `feature/a`, `feature/b`, `bugfix/c` und einem Remote prüft:
  - Ordner „feature“ und „bugfix“ erscheinen.
  - Ein Klick klappt auf.
  - Der Checkout von `feature/a` über die Zeile im Ordner gelingt.
  - Danach zeigt die Kopfzeile `feature/a`.
- [x] Ein Playwright-Test prüft die Tastatur: Pfeile und Enter auf Ordnern, Pfeil links springt zum Ordner, Pfeil rechts auf einer Branchzeile öffnet das Untermenü.
- [x] Ein Playwright-Test prüft das Suchen: `feat` zeigt nur die Treffer in einem offenen Ordner „feature“.
- [x] Ein Playwright-Test prüft die Breite: Ein Branchname, der länger ist als 280 px und kürzer als 560 px, steht ungekürzt im Branch-Knopf. Ein noch längerer wird gekürzt. Der Projektname bleibt bei höchstens 280 px.
- [x] Einheitstests für „Recent“:
  - höchstens 5;
  - der neueste zuerst;
  - ohne aktuellen Branch;
  - ohne gelöschte Branches, dafür rücken ältere nach;
  - ohne losgelöste Stände;
  - doppelte Wechsel ergeben nur einen Eintrag.
- [x] Ein Playwright-Test prüft „Recent“:
  - Nach den Wechseln `main` → `feature/a` → `bugfix/c` → `main` stehen unter „Recent“ `bugfix/c` und `feature/a`, in dieser Reihenfolge.
  - Ein gelöschter Branch erscheint dort nicht mehr.
  - Der Checkout über eine Zeile in „Recent“ gelingt.
- [x] Die bestehenden Tests zum Branch-Menü bleiben grün oder sind sinngemäss angepasst.
- [ ] `npm run typecheck`, `npm test` und `npm run test:ui` sind grün. (typecheck und `npm test` grün; im UI-Lauf 94 von 95, rot nur der bekannte wackelige TypeScript-Test, einzeln grün; siehe „Umsetzung“)

## Abnahme von Hand

- [ ] Lange Branchnamen sind in der Kopfzeile ganz lesbar.
- [ ] Im Dropdown finden sich Branches in den Ordnern `feature`, `bugfix` usw. so schnell wie in IntelliJ.
- [ ] Unter „Recent“ stehen die Branches, zwischen denen ich zuletzt gewechselt habe.
- [ ] Im schmalen Fenster mit langem Branchnamen lässt sich das Fenster rechts neben dem Branch-Knopf noch an der Kopfzeile ziehen. (ergänzt bei der Umsetzung)

## Hinweise

- Die Spielregeln gelten: Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Keine echten Eingaben an den Desktop.
- Testrepositories entstehen im Temp-Ordner des Laufs. Nie gegen ein echtes Remote pushen oder fetchen.
- Ticket 29 ändert das Zuklappen im Dateibaum. Das Verhalten der Ordner im Dropdown soll dazu passen.

## Umsetzung (Agent, 2026-11-25)

- **Branch-Anzeige in der Kopfzeile:**
  - Die Breiten stehen als Design-Variablen in `tokens.css`: `--header-label-max-width: 280px` für den Projektnamen und `--header-branch-label-max-width: calc(2 * var(--header-label-max-width))`, also 560 px, für den Branchnamen (eigene Regel `.branch-widget .header-widget-label` in `app.css`).
  - **Schmales Fenster:** Das Branch-Menü darf schrumpfen (`min-width: 0` an `.header-branch` und `.branch-widget`), der Name wird dann mit „…“ gekürzt. Rechts in der Kopfzeile bleiben immer 48 px Zieh-Fläche frei (`--header-drag-min-width` als Innenabstand von `.header-content`). Der Projektname gibt wie bisher nicht nach. Bei der kleinsten Fensterbreite (720 px) bleiben für einen langen Branchnamen gut 130 px.
  - Der Tooltip mit vollem Namen und Upstream ist unverändert.
- **Breite des Dropdowns:** Es folgt dem Inhalt (`width: max-content`), mindestens 380 px, höchstens 680 px (`--branch-dropdown-min-width`, `--branch-dropdown-max-width`), und bleibt im Fenster.
  - 680 px, weil eine Branchzeile neben dem Namen etwa 100 px für Pfeilspalte, Symbol, Abstände und den Pfeil zum Untermenü braucht: So steht ein Name, der in der Kopfzeile ganz steht (bis 560 px), auch unter „Recent“ oder direkt unter „Local“ ganz. Der Upstream daneben wird zuerst gekürzt.
  - Damit das Dropdown beim Tippen, Auf- und Zuklappen nicht springt, wird es, solange es offen ist, nur breiter, nie schmaler. Nach dem Verkleinern des Fensters bemisst es sich neu.
- **Ordner:**
  - **Reine Funktion** `src/renderer/git/branchRows.ts`: `branchRows(branches, query, expanded)` gibt die sichtbaren Zeilen (Überschrift, Ordner, Branch) mit Ebene zurück; dazu `filterFolders`, `withCurrentBranchOpen`, `expandFolder`, `collapseFolder` und `parentRow`. `BranchPopup.tsx` zeichnet nur und hält den Zustand. Ein Ordner heisst nach Bereich und Pfad, etwa `local:feature/team-a` oder `remote:origin/feature`.
  - **Ebene des Remotes:** Sie bleibt auch bei nur einem Remote. In IntelliJ steht unter „Remote“ der Knoten „origin“, darunter die Ordner der Präfixe; der Name wird dort wie bei lokalen Branches an jedem „/“ geteilt. Das stammt aus der Erinnerung an IntelliJ; der Versuch, es im Quelltext von IntelliJ Community nachzulesen, brachte kein Ergebnis. Unabhängig davon spricht dafür: Der Pfad der Zeile entspricht dem vollen Namen, nach dem auch das Suchfeld filtert (`origin/feature/a`). Mit einem zweiten Remote ordnet sich nichts um. Und zugeklappt ist „Remote“ eine einzige Zeile, auch bei hundert Remote-Branches.
  - **Reihenfolge:** Je Ebene stehen die Ordner vor den Branches, beides alphabetisch ohne Rücksicht auf Gross und Klein, Zahlen nach ihrem Wert (`release/1.9` vor `release/1.10`); bei Gleichstand entscheiden die Zeichen. Bisher galt die Reihenfolge von Git (nach Bytes, Grossbuchstaben zuerst). Favoriten, die IntelliJ mit Stern nach oben stellt (standardmässig `main` bzw. `master`), gibt es in Codium nicht. Der aktuelle Branch bleibt an seinem Platz und trägt sein Etikett.
  - **Darstellung wie im Dateibaum:** Ordner mit Pfeil und Ordnersymbol, 16 px Einzug je Ebene; Branchzeilen haben eine leere Pfeilspalte, damit die Symbole in allen Bereichen bündig stehen. Eine Branchzeile im Ordner zeigt den Namen ohne Präfix; zugänglicher Name, Tooltip, Untermenü und Aktionen nutzen den vollen Namen. Ordnerzeilen sind wählbare Einträge der Liste mit `aria-expanded`.
  - **Bereiche als Gruppen:** „Recent“, „Local“ und „Remote“ sind Gruppen (`role="group"`) mit ihrem Namen, für Screenreader und für Tests. Nötig wurde das, weil ein Branch jetzt in „Recent“ und unter „Local“ zugleich stehen kann.
  - **Offene Ordner:** Das Projektfenster merkt sie sich für die Sitzung (`ProjectWindow.tsx`, ohne Speichern). Beim Öffnen kommen die Ordner des aktuellen Branches dazu, damit er sichtbar ist; klappt der Nutzer einen davon zu, ist er beim nächsten Öffnen wieder offen. Zuklappen entfernt auch alle Unterordner aus dem gemerkten Zustand, wie im Dateibaum nach Ticket 29.
  - **Suchen:** Beim Filtern sind zunächst alle Ordner mit Treffern offen. Klappt der Nutzer dabei einen zu, gilt das nur für diesen Suchtext; nach dem Leeren des Suchfelds gilt wieder der gemerkte Zustand.
  - **Tastatur:** wie im Dateibaum. Pfeil rechts klappt einen Ordner auf und geht auf einem offenen zum ersten Eintrag; Pfeil links klappt zu und springt sonst zum Ordner darüber. Auf Zeilen ohne Ordner und auf den Aktionen bewegen Pfeil rechts und links wie bisher die Schreibmarke im Suchfeld (ausser Pfeil rechts auf einem Branch, der sein Untermenü öffnet).
- **„Recent“:**
  - **Quelle:** der Reflog von HEAD, wie vorgeschlagen; kein eigener Verlauf im Projekt-Zustand. Gezählt wird aus „checkout: moving from <vorher> to <nachher>“ der verlassene Stand, so wie Git selbst `@{-1}` und `git checkout -` bestimmt. Der Name nach „to“ ist nur das Argument des Befehls: Nach `git checkout --detach main` stünde dort „main“, obwohl HEAD an keinem Branch hing. Nach „from“ steht dagegen der Branch, an dem HEAD wirklich hing, bei einem losgelösten Stand dessen voller Hash. Ausserdem zählt so auch der Branch, auf dem ein Klon begann. Gezeigt werden nur lokale Branches, die es noch gibt, ohne den aktuellen, jeder einmal, höchstens 5.
  - **Wo:** reine Funktion `src/main/core/git/recentBranches.ts` im Kern; der Git-Dienst liefert das Ergebnis mit `git.branches` (Vertrag: neues Feld `GitBranches.recent`) und liest den Reflog gleichzeitig mit den Refs.
  - **Begrenzung, gemessen** mit Git 2.48 an einem Reflog mit 200'000 Einträgen (28 MB), je zwei Läufe: `git log -g -n 1000` 0,76 und 0,96 s, mit `--grep-reflog` und `-n 100` 1,0 und 1,7 s, `git reflog show -n 1000` 0,8 und 1,7 s, der ganze Reflog 1,2 und 1,8 s. Git liest also immer den ganzen Reflog; `-n` begrenzt nur die Ausgabe. Deshalb liest der Dienst die Datei `logs/HEAD` im Git-Verzeichnis selbst (bei einem Worktree dessen eigenes), höchstens die letzten 512 KB, je nach Länge der Nachrichten 2'500 bis 4'000 Einträge, in wenigen Millisekunden. Er schneidet an einem Zeilenende; eine letzte Zeile, die Git gerade noch schreibt, zählt nicht. Ältere Wechsel zählen nicht mehr; Git selbst entfernt Einträge ohnehin nach 90 Tagen.
  - **Ohne Datei:** Gibt es noch keinen Eintrag (etwa ohne Commit), ist „Recent“ leer. Liegen die Refs im Ref-Speicher „reftable“ (Ordner `reftable` im Git-Verzeichnis; seit Git 2.45 wählbar), fragt der Dienst Git nach den neuesten 3'000 Einträgen (`git log -g --format=%gs -n3000 HEAD`).
- **Abweichungen und Auslegung:**
  - „Branches ohne `/` bleiben oben“ (Akzeptanzkriterien) ist wie unter „Was gebaut wird“ verstanden: Sie stehen direkt unter „Local“ bzw. „Remote“, auf der obersten Ebene. Innerhalb dieser Ebene stehen sie nach den Ordnern.
  - Ergänzt: ein Punkt in „Abnahme von Hand“ und in `docs/abnahme.md`, dass sich das schmale Fenster rechts neben dem Branch-Knopf noch ziehen lässt. Das Ziehen lässt sich nicht automatisch prüfen; der UI-Test prüft nur, dass die 48 px frei bleiben.
  - Testhilfe: `createRepoWithRemote` nimmt optional den Ordnernamen der Arbeitskopie (für den langen Projektnamen im Breitentest).
- **Tests:**
  - Schneller Lauf: `test/renderer/branchRows.test.ts` (8 Tests: Ordner auch verschachtelt, Branches ohne `/` auf der obersten Ebene, Remote unter seinem Remote auch bei nur einem, Reihenfolge, Ordner des aktuellen Branches, Filter, Zuklappen samt Unterordnern, „Recent“, Elternordner). `test/main/recentBranches.test.ts` (9 Tests: höchstens 5, neuester zuerst, ohne aktuellen, ohne gelöschte mit Nachrücken, ohne losgelöste Stände, Doppeltes einmal, fremde Einträge, Lesen der Reflog-Zeilen, Lesen nur des Endes der Datei). `test/main/git.test.ts`: zwei neue Tests am Git-Dienst (Wechsel über Codium und im Terminal, losgelöst, gelöscht, Umlaut im Namen; Ref-Speicher „reftable“), der Test ohne Commit prüft jetzt das ganze Ergebnis.
  - UI-Lauf: `test/ui/branchFolders.test.ts` mit 5 Tests: Ordner, Aufklappen, Checkout über die Zeile im Ordner und gemerkte Ordner; Tastatur; Suchen; „Recent“ mit Löschen und Checkout; Breite samt schmalem Fenster und Breite des Dropdowns. Die Namen im Breitentest sind so gewählt, dass die Pfade unter `.git/refs` die Grenze von Windows (260 Zeichen) nicht erreichen; ein erster Entwurf scheiterte daran.
  - Angepasst: `test/ui/git.test.ts` wählt `main` beim Suchen unter „Local“, weil es nun auch unter „Recent“ steht. `test/ui/branchDropdown.test.ts` blieb unverändert grün.
- **Testläufe** (2026-11-25, nacheinander und allein auf dem Rechner):

  | Lauf | Ergebnis | Dauer |
  |---|---|---|
  | `npm run typecheck` | grün | wenige Sekunden |
  | `npm test` | 475 von 475 grün (54 Dateien) | 100 s |
  | `npm run test:ui` | 94 von 95 grün (27 Dateien) | 565 s |
  | `test/ui/typescript.test.ts` einzeln danach | 1 von 1 grün | 38 s |

  Rot war im UI-Lauf nur „springt mit Ctrl + Linksklick zur Definition, zeigt auf der Deklaration die Verwendungen, Alt + F7 füllt „Find““ (`typescript.test.ts:106`, die Auswahl der Verwendungen erschien nicht innert 30 s). Das ist der bekannte wackelige Test aus `docs/offene-punkte.md`; er berührt das Branch-Menü nicht und lief einzeln grün. Alle Tests zum Branch-Menü (`branchFolders`, `branchDropdown`, `git`) waren im vollen Lauf grün, vorher auch in einem eigenen Lauf (10 von 10). Das Vorlesen der gebauten App meldete `mermaid.js` mit 18,9 s (Virenscanner). Das Kriterium „`npm run test:ui` grün“ bleibt deshalb offen, bis ein voller Lauf ganz grün ist.
