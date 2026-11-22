// Zentrale Tastenbelegung der App nach IntelliJ. Reine Tabelle ohne DOM, damit sie sich in Node prüfen lässt; das
// Projektfenster wertet sie in der Capture-Phase aus, vor Monaco und vor allen anderen Belegungen. Spätere Tickets
// tragen ihre Kürzel nur hier ein.
//
// - Buchstaben zählen nach dem getippten Zeichen (auf der Schweizer Tastatur ist Ctrl + Z die Taste mit „Z“, nicht
//   die Lage von „Z“ auf der amerikanischen), Ziffern und andere Tasten nach ihrer Lage (Alt + 1 ist überall gleich).
// - Kürzel mit `scope: 'editor'` wirken nur mit dem Fokus im Editor, die anderen im ganzen Fenster.
// - `global: true` wirkt auch im Terminal (Ticket 11): nur Werkzeugfenster und Einstellungen.
// - Ein Kürzel ohne Handler (die Funktion kommt mit einem späteren Ticket) wird im Editor trotzdem abgefangen, damit
//   Monacos eigene Belegung (etwa Ctrl + K als Auftakt für Zweierkürzel) nicht wirkt.

import type { ToolWindowId } from '../shared/types';

export type ToolWindowCommand = `toolWindow.${Exclude<ToolWindowId, 'database'>}`;

/** Befehle im Editor; sie lösen Aktionen von Monaco aus (siehe editor/editorActions.ts). */
export type EditorCommand =
  | 'editor.find'
  | 'editor.replace'
  | 'editor.gotoLine'
  | 'editor.duplicateLine'
  | 'editor.deleteLine'
  | 'editor.toggleComment'
  | 'editor.expandSelection'
  | 'editor.shrinkSelection'
  | 'editor.moveLineUp'
  | 'editor.moveLineDown'
  | 'editor.undo'
  | 'editor.redo'
  | 'editor.gotoDeclaration'
  | 'editor.gotoImplementation'
  | 'editor.quickDoc';

/** Verwendungen in das Werkzeugfenster „Find“ (Ticket 12); der Code-Bereich fragt den Sprach-Dienst. */
export type UsagesCommand = 'navigate.usages';

export type TabCommand = 'tab.close' | 'tab.recent' | 'tab.recentForward' | 'file.saveAll';

/** Suchfenster über dem Editor (Ticket 08); das Projektfenster öffnet sie. */
export type SearchCommand = 'file.gotoFile' | 'file.recent' | 'find.inFiles';

/** Kürzel für Funktionen späterer Tickets; sie sind schon belegt, damit Monaco sie nicht nimmt. */
export type ReservedCommand = 'settings.open' | 'vcs.commit' | 'vcs.push' | 'vcs.pull';

export type KeyCommand = ToolWindowCommand | EditorCommand | UsagesCommand | TabCommand | SearchCommand | ReservedCommand;

export interface KeyBinding {
  /** Kürzel in der Schreibweise von `shortcutOf`, etwa „Alt+1“ oder „Ctrl+Shift+K“. */
  shortcut: string;
  command: KeyCommand;
  /** Wirkt nur mit dem Fokus im Editor. */
  scope: 'window' | 'editor';
  /** Wirkt überall, auch im Terminal (Werkzeugfenster und Einstellungen, siehe Spezifikation). */
  global: boolean;
}

const binding = (shortcut: string, command: KeyCommand, scope: KeyBinding['scope'], global = false): KeyBinding => ({
  shortcut,
  command,
  scope,
  global,
});

/** Die Belegung nach IntelliJ. */
export const KEY_BINDINGS: readonly KeyBinding[] = [
  // Werkzeugfenster und Einstellungen, auch im Terminal.
  binding('Alt+1', 'toolWindow.project', 'window', true),
  binding('Alt+0', 'toolWindow.commit', 'window', true),
  binding('Alt+F12', 'toolWindow.terminal', 'window', true),
  binding('Alt+9', 'toolWindow.git', 'window', true),
  binding('Alt+3', 'toolWindow.find', 'window', true),
  binding('Ctrl+Alt+S', 'settings.open', 'window', true),
  // Tabs.
  binding('Ctrl+F4', 'tab.close', 'window'),
  binding('Ctrl+Tab', 'tab.recent', 'window'),
  binding('Ctrl+Shift+Tab', 'tab.recentForward', 'window'),
  binding('Ctrl+S', 'file.saveAll', 'window'),
  // Bearbeiten.
  binding('Ctrl+F', 'editor.find', 'editor'),
  binding('Ctrl+R', 'editor.replace', 'editor'),
  binding('Ctrl+G', 'editor.gotoLine', 'editor'),
  binding('Ctrl+D', 'editor.duplicateLine', 'editor'),
  binding('Ctrl+Y', 'editor.deleteLine', 'editor'),
  binding('Ctrl+/', 'editor.toggleComment', 'editor'),
  binding('Ctrl+W', 'editor.expandSelection', 'editor'),
  binding('Ctrl+Shift+W', 'editor.shrinkSelection', 'editor'),
  binding('Alt+Shift+ArrowUp', 'editor.moveLineUp', 'editor'),
  binding('Alt+Shift+ArrowDown', 'editor.moveLineDown', 'editor'),
  binding('Ctrl+Z', 'editor.undo', 'editor'),
  binding('Ctrl+Shift+Z', 'editor.redo', 'editor'),
  // Suchen (Ticket 08).
  binding('Ctrl+Shift+N', 'file.gotoFile', 'window'),
  binding('Ctrl+E', 'file.recent', 'window'),
  binding('Ctrl+Shift+F', 'find.inFiles', 'window'),
  // Sprachfunktionen (Ticket 12): Definition, Implementierungen, Dokumentation, Verwendungen.
  binding('Ctrl+B', 'editor.gotoDeclaration', 'editor'),
  binding('Ctrl+Alt+B', 'editor.gotoImplementation', 'editor'),
  binding('Ctrl+Q', 'editor.quickDoc', 'editor'),
  binding('Alt+F7', 'navigate.usages', 'editor'),
  // Spätere Tickets: Git (15, 16, 18).
  binding('Ctrl+K', 'vcs.commit', 'window'),
  binding('Ctrl+Shift+K', 'vcs.push', 'window'),
  binding('Ctrl+T', 'vcs.pull', 'window'),
];

/**
 * Belegungen von Monaco, die mit IntelliJ kollidieren (Spezifikation „Oberfläche“). Die zentrale Belegung muss jede
 * davon abfangen; ein Test prüft das.
 */
export const MONACO_CONFLICTS: readonly string[] = [
  'Ctrl+K',
  'Ctrl+Shift+K',
  'Alt+F12',
  'Ctrl+Y',
  'Ctrl+D',
  'Ctrl+W',
  'Ctrl+R',
  'Ctrl+G',
  'Ctrl+E',
  'Ctrl+B',
];

/** Der Teil eines Tastaturereignisses, den die Zuordnung braucht. */
export interface KeyLike {
  code: string;
  /** Das getippte Zeichen bzw. der Name der Taste; fehlt es, zählt nur die Lage. */
  key?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * Das Kürzel eines Tastendrucks, etwa „Alt+1“: Modifikatoren in fester Reihenfolge, dann die Taste. Ziffern zählen
 * nach ihrer Lage, Buchstaben nach dem Zeichen (sonst nach der Lage), „/“ als Zeichen (auch auf dem Ziffernblock).
 * `null` für einen Druck nur auf einen Modifikator. AltGr meldet Windows als Ctrl+Alt; so kollidieren Zeichen wie „@“
 * (AltGr+2) nie mit Alt-Kürzeln.
 */
export function shortcutOf(event: KeyLike): string | null {
  const { key } = event;
  // AltGr (Ctrl + Alt) mit einem Zeichen, das kein lateinischer Buchstabe ist (etwa „ś“ auf polnischer Tastatur):
  // Das ist Text, kein Kürzel (Review von Ticket 06).
  if (event.ctrlKey && event.altKey && key !== undefined && key.length === 1 && !/^[a-z]$/i.test(key) && key !== '/') return null;
  const name = keyName(event);
  if (name === null) return null;
  // „/“ zählt als Zeichen, auch wenn es Shift braucht (Schweizer und deutsche Tastatur: Shift + 7).
  const shift = event.shiftKey && !(name === '/' && key === '/');
  const parts = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', shift && 'Shift', event.metaKey && 'Meta', name];
  return parts.filter((part): part is string => typeof part === 'string').join('+');
}

/** Die Belegung zu einem Tastendruck, falls er belegt ist. */
export function bindingForKey(event: KeyLike): KeyBinding | undefined {
  const shortcut = shortcutOf(event);
  return shortcut === null ? undefined : KEY_BINDINGS.find((b) => b.shortcut === shortcut);
}

/** Der Befehl zu einem Tastendruck, falls er belegt ist. */
export function commandForKey(event: KeyLike): KeyCommand | undefined {
  return bindingForKey(event)?.command;
}

/** Das Kürzel eines Befehls zur Anzeige (Tooltip, Hinweise, Menüs), falls er eines hat. */
export function shortcutLabel(command: KeyCommand): string | undefined {
  return KEY_BINDINGS.find((b) => b.command === command)?.shortcut;
}

/** Die Kürzel, die im Terminal als IDE-Kürzel wirken (Ticket 11); alle anderen Tasten gehören der Shell. */
export function globalShortcuts(): string[] {
  return KEY_BINDINGS.filter((b) => b.global).map((b) => b.shortcut);
}

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;

function keyName(event: KeyLike): string | null {
  const { code, key } = event;
  if (code === '' || MODIFIER_CODES.test(code)) return null;
  if (key === '/' || code === 'NumpadDivide') return '/';
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  if (key !== undefined && /^[a-z]$/i.test(key)) return key.toUpperCase();
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  return code;
}
