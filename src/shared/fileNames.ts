// Namen von Dateien und Ordnern unter Windows: was erlaubt ist und wie ein neuer Name mit Unterordnern gelesen wird
// (wie in IntelliJ trennt „/“ Unterordner). Ohne Node und ohne DOM, damit Kern und Oberfläche dieselben Regeln
// benutzen; die Meldungen sind englisch und lassen sich so anzeigen.

/** Zeichen, die Windows in Namen nicht erlaubt, dazu die Steuerzeichen. */
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
/** Gerätenamen von Windows, auch mit Endung („nul.txt“). */
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.[^.]*)?$/i;
/** Längster Name eines einzelnen Eintrags. */
export const MAX_FILE_NAME_LENGTH = 255;

/** Meldung, wenn ein Befehl im Ordner `.git` etwas ändern würde; das bleibt Git vorbehalten. */
export const GIT_FOLDER_PROBLEM = 'Codium does not change the Git folder (.git).';

/** Ob ein Name der Ordner `.git` ist (ohne Unterscheidung der Gross-/Kleinschreibung). */
export function isGitFolderName(name: string): boolean {
  return name.toLowerCase() === '.git';
}

/** Warum ein einzelner Name (ohne Ordner) nicht geht, oder `null`, wenn er erlaubt ist. */
export function fileNameProblem(name: string): string | null {
  if (name.length === 0) return 'A name cannot be empty.';
  if (name === '.' || name === '..') return `“${name}” is not a valid name.`;
  if (INVALID_CHARS.test(name)) return 'A name cannot contain any of these characters: \\ / : * ? " < > |';
  if (/[. ]$/.test(name)) return 'A name cannot end with a space or a period.';
  if (RESERVED.test(name)) return `“${name}” is a reserved name in Windows.`;
  if (name.length > MAX_FILE_NAME_LENGTH) return 'The name is too long.';
  return null;
}

/**
 * Liest einen neuen Namen wie IntelliJ bei „New File“ und „New Directory“: „/“ oder „\“ trennen Unterordner, die
 * dabei mit entstehen. Liefert die Teile oder, warum der Name nicht geht.
 */
export function splitNewName(input: string): { segments: string[] } | { problem: string } {
  if (input.length === 0) return { problem: 'Enter a name.' };
  const segments = input.split(/[\\/]/);
  for (const segment of segments) {
    const problem = fileNameProblem(segment);
    if (problem) return { problem };
    if (isGitFolderName(segment)) return { problem: GIT_FOLDER_PROBLEM };
  }
  return { segments };
}

/**
 * Der Name ohne Endung und die Endung („Main.java“ → „Main“ und „.java“). Ordner und Namen, die mit dem einzigen
 * Punkt beginnen („.gitignore“), haben keine Endung.
 */
export function splitExtension(name: string, isDirectory: boolean): { base: string; extension: string } {
  const dot = name.lastIndexOf('.');
  if (isDirectory || dot <= 0) return { base: name, extension: '' };
  return { base: name.slice(0, dot), extension: name.slice(dot) };
}

/**
 * Der Name einer Kopie bei einem Namenskonflikt: „Name (2).ext“, „Name (3).ext“ usw., der erste, der nicht vergeben
 * ist. Ein schon vorhandener Zusatz zählt weiter („Name (2).ext“ → „Name (3).ext“). `taken` prüft ohne Unterscheidung
 * der Gross-/Kleinschreibung.
 */
export function copyName(name: string, isDirectory: boolean, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const { base, extension } = splitExtension(name, isDirectory);
  const counted = / \((\d+)\)$/.exec(base);
  const stem = counted ? base.slice(0, counted.index) : base;
  for (let n = counted ? Number(counted[1]) + 1 : 2; ; n++) {
    const candidate = `${stem} (${n})${extension}`;
    if (!taken(candidate)) return candidate;
  }
}
