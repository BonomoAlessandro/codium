// Welche Sprache (Farben nach Wortarten) eine Datei bekommt: nach dem ganzen Dateinamen (etwa „Dockerfile“), sonst
// nach der längsten passenden Endung, ohne Unterscheidung der Gross-/Kleinschreibung. Ohne Monaco und ohne DOM,
// damit es sich in Node prüfen lässt; die Liste der Sprachen kommt von Monaco.

/** Was Monaco über eine Sprache weiss (Auszug aus `monaco.languages.ILanguageExtensionPoint`). */
export interface LanguageInfo {
  id: string;
  extensions?: string[];
  filenames?: string[];
}

/** Sprache ohne Farben. */
export const PLAIN_TEXT = 'plaintext';

export function languageForFile(fileName: string, languages: readonly LanguageInfo[]): string {
  const name = fileName.toLowerCase();
  const byName = languages.find((l) => l.filenames?.some((f) => f.toLowerCase() === name));
  if (byName) return byName.id;
  let best: { id: string; length: number } | null = null;
  for (const language of languages) {
    for (const extension of language.extensions ?? []) {
      const ext = extension.toLowerCase();
      // Eine Endung passt nur hinter einem Punkt oder als ganzer Name (etwa „.gitignore“).
      if (name.endsWith(ext) && ext.length > (best?.length ?? 0) && (ext.startsWith('.') || name === ext)) {
        best = { id: language.id, length: ext.length };
      }
    }
  }
  return best?.id ?? PLAIN_TEXT;
}
