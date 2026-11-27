import { describe, expect, it } from 'vitest';
import { holdHeaderNoDrag, POPUP_OPEN_CLASS, type PopupRoot } from '../../src/renderer/popup/dismiss';

/** Ersatz für das Wurzelelement: merkt sich die Klassen. */
function fakeRoot(): PopupRoot & { classes: Set<string> } {
  const classes = new Set<string>();
  return {
    classes,
    classList: {
      toggle(name: string, force?: boolean) {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    },
  };
}

describe('Kopfzeile ohne Zieh-Fläche, solange ein Popup offen ist (Ticket 33)', () => {
  it('setzt die Klasse mit dem ersten Popup und entfernt sie erst mit dem letzten', () => {
    const root = fakeRoot();
    const dropdown = holdHeaderNoDrag(root);
    expect(root.classes.has(POPUP_OPEN_CLASS)).toBe(true);
    // Das Untermenü im Dropdown liegt darüber und geht zuerst zu.
    const submenu = holdHeaderNoDrag(root);
    submenu();
    expect(root.classes.has(POPUP_OPEN_CLASS)).toBe(true);
    dropdown();
    expect(root.classes.has(POPUP_OPEN_CLASS)).toBe(false);
  });

  it('zählt eine zweite Freigabe derselben Sperre nicht mit', () => {
    const root = fakeRoot();
    const menu = holdHeaderNoDrag(root);
    const dropdown = holdHeaderNoDrag(root);
    menu();
    menu();
    expect(root.classes.has(POPUP_OPEN_CLASS)).toBe(true);
    dropdown();
    expect(root.classes.has(POPUP_OPEN_CLASS)).toBe(false);
    // Danach beginnt es von vorn.
    const next = holdHeaderNoDrag(root);
    expect(root.classes.has(POPUP_OPEN_CLASS)).toBe(true);
    next();
    expect(root.classes.has(POPUP_OPEN_CLASS)).toBe(false);
  });

  it('zählt je Fenster für sich', () => {
    const first = fakeRoot();
    const second = fakeRoot();
    const release = holdHeaderNoDrag(first);
    expect(second.classes.has(POPUP_OPEN_CLASS)).toBe(false);
    holdHeaderNoDrag(second)();
    expect(first.classes.has(POPUP_OPEN_CLASS)).toBe(true);
    release();
    expect(first.classes.has(POPUP_OPEN_CLASS)).toBe(false);
  });
});
