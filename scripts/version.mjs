// Versionsnummer von Codium für neue Installer. Solange Codium bei 0.x ist, zählt jeder Installer die zweite Stelle
// hoch (0.1.0 → 0.2.0 → 0.3.0); die erste Stelle bleibt 0. Ein Schritt auf 1.0 ist eine bewusste Entscheidung und
// geschieht von Hand.

/**
 * Die nächste Version für einen neuen Installer.
 * @param {string} version die bisherige Version, etwa „0.1.0“
 * @returns {string} die nächste, etwa „0.2.0“
 */
export function nextInstallerVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Unerwartete Version „${version}“; erwartet wird etwa „0.1.0“.`);
  const [major, minor] = [Number(match[1]), Number(match[2])];
  if (major !== 0) {
    throw new Error(`Codium ist bei Version ${version}. Das automatische Hochzählen gilt nur für 0.x.`);
  }
  return `0.${minor + 1}.0`;
}

/**
 * Setzt die Version im Text einer package.json bzw. package-lock.json. Format und Zeilenenden bleiben erhalten;
 * geändert wird nur der Wert von „version“ an oberster Stelle und, in der package-lock.json, beim Paket selbst.
 * @param {string} text der Dateiinhalt
 * @param {string} from die bisherige Version
 * @param {string} to die neue Version
 * @param {'package' | 'lock'} kind welche Datei
 * @returns {string} der neue Dateiinhalt
 */
export function replaceVersion(text, from, to, kind) {
  const parsed = JSON.parse(text);
  if (parsed.version !== from) throw new Error(`Die Datei hat Version ${parsed.version}, erwartet wurde ${from}.`);
  // Das erste "version" in der Datei ist das oberste (es steht vor den Abhängigkeiten).
  let result = text.replace(`"version": "${from}"`, `"version": "${to}"`);
  if (kind === 'lock') {
    // In der package-lock.json steht die Version ein zweites Mal beim Paket selbst (packages[""]).
    result = result.replace(/("packages": \{\s*"": \{[^}]*?"version": )"[^"]*"/, `$1"${to}"`);
  }
  const check = JSON.parse(result);
  if (check.version !== to || (kind === 'lock' && check.packages?.['']?.version !== to)) {
    throw new Error('Die Version liess sich nicht eindeutig ersetzen.');
  }
  return result;
}
