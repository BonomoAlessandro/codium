// Namen neuer Terminal-Tabs wie in IntelliJ: „Local“, „Local (2)“, „Local (3)“ … Reine Funktion ohne DOM.

/** Der kleinste freie Name unter den vorhandenen Tab-Namen. */
export function nextTerminalTitle(existing: readonly string[]): string {
  const taken = new Set(existing);
  if (!taken.has('Local')) return 'Local';
  for (let n = 2; ; n++) {
    const title = `Local (${n})`;
    if (!taken.has(title)) return title;
  }
}
