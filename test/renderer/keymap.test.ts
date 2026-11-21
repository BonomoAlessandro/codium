import { describe, expect, it } from 'vitest';
import {
  KEY_BINDINGS,
  MONACO_CONFLICTS,
  commandForKey,
  globalShortcuts,
  shortcutLabel,
  shortcutOf,
  type KeyLike,
} from '../../src/renderer/keymap';

const press = (code: string, mods: Partial<Omit<KeyLike, 'code'>> = {}): KeyLike => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe('Tastenkürzel', () => {
  it('schreibt Kürzel mit Modifikatoren in fester Reihenfolge, Tasten nach ihrer Lage', () => {
    expect(shortcutOf(press('Digit1', { altKey: true }))).toBe('Alt+1');
    expect(shortcutOf(press('KeyK', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+K');
    expect(shortcutOf(press('F12', { altKey: true }))).toBe('Alt+F12');
    expect(shortcutOf(press('AltLeft', { altKey: true }))).toBeNull();
  });

  it('belegt die Werkzeugfenster nach IntelliJ', () => {
    expect(commandForKey(press('Digit1', { altKey: true }))).toBe('toolWindow.project');
    expect(commandForKey(press('Digit0', { altKey: true }))).toBe('toolWindow.commit');
    expect(commandForKey(press('F12', { altKey: true }))).toBe('toolWindow.terminal');
    expect(commandForKey(press('Digit9', { altKey: true }))).toBe('toolWindow.git');
    expect(commandForKey(press('Digit3', { altKey: true }))).toBe('toolWindow.find');
    expect(shortcutLabel('toolWindow.terminal')).toBe('Alt+F12');
  });

  it('hat keine doppelt belegten Kürzel und fängt alle kollidierenden Monaco-Belegungen ab', () => {
    const shortcuts = KEY_BINDINGS.map((b) => b.shortcut);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    const commands = KEY_BINDINGS.map((b) => b.command);
    expect(new Set(commands).size).toBe(commands.length);
    // Die Liste aus der Spezifikation: Jede dieser Belegungen von Monaco wird von der zentralen Belegung überschrieben.
    expect([...MONACO_CONFLICTS].sort()).toEqual(
      ['Ctrl+K', 'Ctrl+Shift+K', 'Alt+F12', 'Ctrl+Y', 'Ctrl+D', 'Ctrl+W', 'Ctrl+R', 'Ctrl+G', 'Ctrl+E', 'Ctrl+B'].sort(),
    );
    for (const shortcut of MONACO_CONFLICTS) expect(shortcuts, shortcut).toContain(shortcut);
  });

  it('liefert für das Terminal nur die Kürzel der Werkzeugfenster und Einstellungen', () => {
    expect(globalShortcuts().sort()).toEqual(['Alt+0', 'Alt+1', 'Alt+3', 'Alt+9', 'Alt+F12', 'Ctrl+Alt+S'].sort());
  });

  it('belegt die Bearbeitungs-Kürzel von IntelliJ, Buchstaben nach dem getippten Zeichen', () => {
    expect(commandForKey(press('KeyD', { ctrlKey: true, key: 'd' }))).toBe('editor.duplicateLine');
    expect(commandForKey(press('KeyW', { ctrlKey: true, shiftKey: true, key: 'W' }))).toBe('editor.shrinkSelection');
    expect(commandForKey(press('ArrowUp', { altKey: true, shiftKey: true, key: 'ArrowUp' }))).toBe('editor.moveLineUp');
    expect(commandForKey(press('F4', { ctrlKey: true, key: 'F4' }))).toBe('tab.close');
    expect(commandForKey(press('Tab', { ctrlKey: true, key: 'Tab' }))).toBe('tab.recent');
    // Schweizer Tastatur: Die Taste mit „Z“ liegt dort, wo amerikanisch „Y“ liegt. Ctrl + Z ist trotzdem Rückgängig,
    // nicht „Zeile löschen“.
    expect(commandForKey(press('KeyY', { ctrlKey: true, key: 'z' }))).toBe('editor.undo');
    expect(commandForKey(press('KeyZ', { ctrlKey: true, key: 'y' }))).toBe('editor.deleteLine');
    // „/“ als Zeichen oder auf dem Ziffernblock.
    expect(commandForKey(press('Slash', { ctrlKey: true, key: '/' }))).toBe('editor.toggleComment');
    expect(commandForKey(press('NumpadDivide', { ctrlKey: true, key: '/' }))).toBe('editor.toggleComment');
    // Ohne bekanntes Zeichen (etwa ein kyrillisches Layout) zählt die Lage.
    expect(commandForKey(press('KeyD', { ctrlKey: true, key: 'в' }))).toBe('editor.duplicateLine');
  });

  it('reagiert nicht auf andere Modifikatoren, AltGr (Ctrl + Alt) oder den Ziffernblock', () => {
    expect(commandForKey(press('Digit1'))).toBeUndefined();
    expect(commandForKey(press('Digit1', { altKey: true, shiftKey: true }))).toBeUndefined();
    // AltGr + 2 ist auf der Schweizer Tastatur „@“.
    expect(commandForKey(press('Digit2', { altKey: true, ctrlKey: true }))).toBeUndefined();
    expect(commandForKey(press('Digit1', { altKey: true, ctrlKey: true }))).toBeUndefined();
    expect(commandForKey(press('Numpad1', { altKey: true }))).toBeUndefined();
  });
});
