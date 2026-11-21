import { describe, expect, it } from 'vitest';
import { commandForKey, shortcutLabel, shortcutOf, type KeyLike } from '../../src/renderer/keymap';

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

  it('reagiert nicht auf andere Modifikatoren, AltGr (Ctrl + Alt) oder den Ziffernblock', () => {
    expect(commandForKey(press('Digit1'))).toBeUndefined();
    expect(commandForKey(press('Digit1', { altKey: true, shiftKey: true }))).toBeUndefined();
    // AltGr + 2 ist auf der Schweizer Tastatur „@“.
    expect(commandForKey(press('Digit2', { altKey: true, ctrlKey: true }))).toBeUndefined();
    expect(commandForKey(press('Digit1', { altKey: true, ctrlKey: true }))).toBeUndefined();
    expect(commandForKey(press('Numpad1', { altKey: true }))).toBeUndefined();
  });
});
