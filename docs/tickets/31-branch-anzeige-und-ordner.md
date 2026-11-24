# 31 – Branch-Anzeige breiter, Branches im Dropdown in Ordnern

Status: `ready-for-agent` · Typ: AFK
Blockiert durch: –
User Stories: 94–96 (Branch-Menü)
Spezifikation: „Oberfläche“ (Kopfzeile), „Git“ (Branch-Menü)

Dieses Ticket kam nach Ticket 30 dazu, auf Wunsch des Nutzers. Es geht um zwei Verbesserungen am Branch-Menü in der Kopfzeile:
- Der Name des aktuellen Branches darf mehr Platz einnehmen.
- Im Dropdown stehen Branches mit Präfix wie `feature/…` oder `bugfix/…` in Ordnern, wie in IntelliJ.

## Heutiger Stand

- **Kopfzeile:**
  - Der Branch-Knopf (`Header.tsx`, `.branch-widget`) zeigt den Namen des aktuellen Branches in `.header-widget-label`.
  - Die Klasse begrenzt auf 280 px (`app.css`), für den Projektnamen wie für den Branch. Längere Namen werden mit „…“ gekürzt, der volle Name steht im Tooltip.
  - Branchnamen wie `feature/ABC-1234-kurze-beschreibung` werden so oft abgeschnitten, obwohl in der Kopfzeile genug Platz wäre.
- **Dropdown:**
  - `BranchPopup.tsx` ist 380 px breit und listet unter „Local“ und „Remote“ alle Branches flach und alphabetisch.
  - Bei vielen Branches mit Präfixen (`feature/…`, `bugfix/…`, `release/…`) wird die Liste lang und unübersichtlich.
  - IntelliJ gruppiert solche Branches in Ordner, die sich auf- und zuklappen lassen.

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

## Ausserhalb des Umfangs

- Ein Schalter zum Abschalten der Ordner („Group by Prefix“ in IntelliJ).
- Ordner in anderen Listen mit Branches, etwa in Dialogen oder im Git-Log.

## Akzeptanzkriterien

- [ ] Einheitstests für das Bilden der Zeilen:
  - Präfixe werden zu Ordnern, auch verschachtelt.
  - Branches ohne `/` bleiben oben.
  - Remote-Branches stehen unter ihrem Remote bzw. nach der gewählten Regel.
  - Die Reihenfolge stimmt.
  - Die Ordner des aktuellen Branches sind offen.
  - Ein Filter öffnet Ordner mit Treffern und blendet die übrigen aus.
  - Ein zugeklappter Ordner klappt seine Unterordner mit zu.
- [ ] Ein Playwright-Test im Testmodus mit einem Repository mit `main`, `feature/a`, `feature/b`, `bugfix/c` und einem Remote prüft:
  - Ordner „feature“ und „bugfix“ erscheinen.
  - Ein Klick klappt auf.
  - Der Checkout von `feature/a` über die Zeile im Ordner gelingt.
  - Danach zeigt die Kopfzeile `feature/a`.
- [ ] Ein Playwright-Test prüft die Tastatur: Pfeile und Enter auf Ordnern, Pfeil links springt zum Ordner, Pfeil rechts auf einer Branchzeile öffnet das Untermenü.
- [ ] Ein Playwright-Test prüft das Suchen: `feat` zeigt nur die Treffer in einem offenen Ordner „feature“.
- [ ] Ein Playwright-Test prüft die Breite: Ein Branchname, der länger ist als 280 px und kürzer als 560 px, steht ungekürzt im Branch-Knopf. Ein noch längerer wird gekürzt. Der Projektname bleibt bei höchstens 280 px.
- [ ] Die bestehenden Tests zum Branch-Menü bleiben grün oder sind sinngemäss angepasst.
- [ ] `npm run typecheck`, `npm test` und `npm run test:ui` sind grün.

## Abnahme von Hand

- [ ] Lange Branchnamen sind in der Kopfzeile ganz lesbar.
- [ ] Im Dropdown finden sich Branches in den Ordnern `feature`, `bugfix` usw. so schnell wie in IntelliJ.

## Hinweise

- Die Spielregeln gelten: Die App nur über die Testläufe bzw. `launchCodium` starten, nie direkt. Keine echten Eingaben an den Desktop.
- Testrepositories entstehen im Temp-Ordner des Laufs. Nie gegen ein echtes Remote pushen oder fetchen.
- Ticket 29 ändert das Zuklappen im Dateibaum. Das Verhalten der Ordner im Dropdown soll dazu passen.
