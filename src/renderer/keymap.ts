// Tastenkürzel der App, unabhängig vom Tastaturlayout über `KeyboardEvent.code`. Reine Zuordnung ohne DOM, damit
// sie sich in Node prüfen lässt. Ticket 06 baut daraus die zentrale Tastenbelegung (Vorrang vor Monaco, weitere
// Kürzel); Ticket 11 lässt im Terminal nur die Kürzel mit `global: true` durch.

import type { ToolWindowId } from '../shared/types';

/** Was ein Tastenkürzel auslöst. */
export type KeyCommand = `toolWindow.${Exclude<ToolWindowId, 'database'>}`;

export interface KeyBinding {
  /** Kürzel in der Schreibweise von `shortcutOf`, etwa „Alt+1“ oder „Ctrl+Shift+K“. */
  shortcut: string;
  command: KeyCommand;
  /** Wirkt überall, auch im Terminal (Werkzeugfenster und Einstellungen, siehe Spezifikation). */
  global: boolean;
}

/** Die Belegung nach IntelliJ. */
export const KEY_BINDINGS: readonly KeyBinding[] = [
  { shortcut: 'Alt+1', command: 'toolWindow.project', global: true },
  { shortcut: 'Alt+0', command: 'toolWindow.commit', global: true },
  { shortcut: 'Alt+F12', command: 'toolWindow.terminal', global: true },
  { shortcut: 'Alt+9', command: 'toolWindow.git', global: true },
  { shortcut: 'Alt+3', command: 'toolWindow.find', global: true },
];

/** Der Teil eines Tastaturereignisses, den die Zuordnung braucht. */
export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * Das Kürzel eines Tastendrucks, etwa „Alt+1“: Modifikatoren in fester Reihenfolge, dann die Taste. Ziffern und
 * Buchstaben zählen nach ihrer Lage auf der Tastatur (auf der Schweizer Tastatur ist Alt+1 dasselbe wie auf der
 * amerikanischen). `null` für einen Druck nur auf einen Modifikator. AltGr meldet Windows als Ctrl+Alt; so
 * kollidieren Zeichen wie „@“ (AltGr+2) nie mit Alt-Kürzeln.
 */
export function shortcutOf(event: KeyLike): string | null {
  const key = keyName(event.code);
  if (key === null) return null;
  const parts = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', key];
  return parts.filter((part): part is string => typeof part === 'string').join('+');
}

/** Der Befehl zu einem Tastendruck, falls er belegt ist. */
export function commandForKey(event: KeyLike): KeyCommand | undefined {
  const shortcut = shortcutOf(event);
  return shortcut === null ? undefined : KEY_BINDINGS.find((b) => b.shortcut === shortcut)?.command;
}

/** Das Kürzel eines Befehls zur Anzeige (Tooltip, Hinweise), falls er eines hat. */
export function shortcutLabel(command: KeyCommand): string | undefined {
  return KEY_BINDINGS.find((b) => b.command === command)?.shortcut;
}

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;

function keyName(code: string): string | null {
  if (code === '' || MODIFIER_CODES.test(code)) return null;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  return code;
}
