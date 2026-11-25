// Zuletzt benutzte Branches aus dem Reflog von HEAD (Ticket 31), als reine Funktionen ohne Git und ohne Dateien.
//
// Jeder Wechsel steht im Reflog als „checkout: moving from <vorher> to <nachher>“, auch Wechsel im Terminal oder in
// anderen Werkzeugen; Codium muss nichts speichern. Gezählt wird der verlassene Stand („from“), wie bei Git selbst
// für `@{-1}` und `git checkout -`: Dort steht der Branch, an dem HEAD wirklich hing, und bei einem losgelösten Stand
// dessen voller Hash. Der Name nach „to“ ist dagegen nur das Argument des Befehls; nach `git checkout --detach main`
// stünde dort „main“, obwohl HEAD an keinem Branch hing.

/** So viele zuletzt benutzte Branches zeigt das Dropdown. */
export const RECENT_LIMIT = 5;

/**
 * Ein Wechsel. Das Ziel nach „ to “ kann Leerzeichen enthalten (etwa `git checkout ':/Nachricht mit Leerzeichen'`); Git
 * sucht für `@{-1}` ebenso nur nach „ to “. Ein Branchname vorher enthält nie ein Leerzeichen.
 */
const CHECKOUT = /^checkout: moving from (\S+) to /;

/**
 * Die Nachrichten der Zeilen eines Reflogs, die neueste zuerst. Eine Zeile lautet
 * `<alt> <neu> <Name> <E-Mail> <Zeit> <Zone>\t<Nachricht>`. Eine letzte Zeile ohne Zeilenende schreibt Git womöglich
 * gerade noch; sie zählt nicht.
 */
export function reflogMessages(text: string): string[] {
  const lines = text.split('\n');
  lines.pop();
  const messages: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const tab = lines[i].indexOf('\t');
    if (tab >= 0) messages.push(lines[i].slice(tab + 1).replace(/\r$/, ''));
  }
  return messages;
}

/**
 * Die zuletzt benutzten Branches, der neueste zuerst: höchstens `limit`, nur lokale Branches, die es noch gibt, ohne
 * den aktuellen und jeder nur einmal. Losgelöste Stände zählen nicht (ihr Hash ist kein Branch).
 * @param messages die Nachrichten des Reflogs von HEAD, die neueste zuerst
 * @param local die Namen der lokalen Branches
 * @param current der aktuelle Branch; `null` bei losgelöstem HEAD
 */
export function recentBranches(messages: readonly string[], local: readonly string[], current: string | null, limit = RECENT_LIMIT): string[] {
  const existing = new Set(local);
  const result: string[] = [];
  for (const message of messages) {
    if (result.length >= limit) break;
    const name = CHECKOUT.exec(message)?.[1];
    if (name === undefined || name === current || !existing.has(name) || result.includes(name)) continue;
    result.push(name);
  }
  return result;
}
