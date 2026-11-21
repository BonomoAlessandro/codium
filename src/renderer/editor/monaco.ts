// Monaco für Codium einrichten: lokal gebündelt (ohne eingebaute Sprachdienste, siehe build.mjs), mit seinem
// allgemeinen Editor-Worker aus den eigenen Dateien, dem Farbschema nach IntelliJ „Dark“, JetBrains Mono und einer
// eigenen JSON-Sprache. Wird einmal beim ersten Import ausgeführt.

import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/400-italic.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/jetbrains-mono/700-italic.css';
import * as monaco from 'monaco-editor';
import { baseName } from '../project/filePaths';
import { JSON_CONFIGURATION, JSON_LANGUAGE, JSON_MONARCH } from './jsonLanguage';
import { languageForFile } from './languages';
import { THEME_NAME, codiumTheme } from './theme';

/** Schrift aller Editoren; JetBrains Mono wird mitgeliefert (OFL). */
export const EDITOR_FONT_FAMILY = "'JetBrains Mono', monospace";

// Der Worker kommt aus den eigenen Dateien neben der Seite; die Sicherheitsrichtlinie erlaubt nur diese.
(globalThis as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new Worker(new URL('./editor.worker.js', document.baseURI), { name: 'monaco-editor-worker' }),
};

monaco.languages.register(JSON_LANGUAGE);
monaco.languages.setLanguageConfiguration('json', JSON_CONFIGURATION);
monaco.languages.setMonarchTokensProvider('json', JSON_MONARCH as monaco.languages.IMonarchLanguage);
monaco.editor.defineTheme(THEME_NAME, codiumTheme());
monaco.editor.setTheme(THEME_NAME);

/** Die Sprache (Farben nach Wortarten) einer Datei. */
export function languageOf(filePath: string): string {
  return languageForFile(baseName(filePath), monaco.languages.getLanguages());
}

/**
 * Wartet, bis JetBrains Mono geladen ist, damit Monaco die Zeichenbreite richtig misst. Lädt die Schrift später nach
 * (etwa ein anderer Schnitt), misst Monaco neu.
 */
export function editorFontReady(): Promise<void> {
  fontReady ??= (async () => {
    document.fonts.addEventListener('loadingdone', () => monaco.editor.remeasureFonts());
    try {
      await Promise.all([document.fonts.load("13px 'JetBrains Mono'"), document.fonts.load("italic 13px 'JetBrains Mono'")]);
    } catch {
      // Ohne Schrift misst Monaco die Ersatzschrift; sobald sie da ist, misst er neu (oben).
    }
  })();
  return fontReady;
}

let fontReady: Promise<void> | null = null;

export { monaco };
