// Zweimal Shift (Ticket 26): die Erkennung ohne DOM, mit Tastendrücken und Zeitstempeln.

import { describe, expect, it } from 'vitest';
import { DOUBLE_SHIFT_INTERVAL_MS, DoubleShiftDetector, type DoubleShiftInput, type KeyEventLike } from '../../src/renderer/doubleShift';

type Mods = Partial<Pick<KeyEventLike, 'ctrlKey' | 'altKey' | 'metaKey' | 'repeat'>>;

/** Ein Tastaturereignis wie im Browser; Shift links, wenn nichts anderes angegeben ist. */
function key(type: 'keydown' | 'keyup', at: number, code = 'ShiftLeft', mods: Mods = {}): KeyEventLike {
  const key = /^Shift/.test(code) ? 'Shift' : /^Control/.test(code) ? 'Control' : /^Alt/.test(code) ? 'Alt' : /^Meta/.test(code) ? 'Meta' : code.replace(/^Key/, '');
  return { type, key, code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, timeStamp: at, ...mods };
}

const down = (at: number, code?: string, mods?: Mods) => key('keydown', at, code, mods);
const up = (at: number, code?: string, mods?: Mods) => key('keyup', at, code, mods);
/** Ein kurzer Tipper auf eine Taste: drücken, nach 60 ms loslassen. */
const tap = (at: number, code?: string, mods?: Mods) => [down(at, code, mods), up(at + 60, code, mods)];

/** Spielt die Ereignisse ab und liefert die Stellen, an denen die Erkennung auslöst. */
function firings(events: DoubleShiftInput[]): number[] {
  const detector = new DoubleShiftDetector();
  return events.flatMap((event, index) => (detector.handle(event) ? [index] : []));
}

describe('Zweimal Shift', () => {
  it('löst bei zwei kurzen Tippern im Zeitfenster aus, beim zweiten Loslassen', () => {
    expect(firings([...tap(0), ...tap(200)])).toEqual([3]);
    // Knapp im Zeitfenster (gemessen von Drücken zu Drücken) zählt es noch, an der Grenze nicht mehr.
    expect(firings([...tap(0), ...tap(DOUBLE_SHIFT_INTERVAL_MS - 1)])).toEqual([3]);
    expect(firings([...tap(0), ...tap(DOUBLE_SHIFT_INTERVAL_MS)])).toEqual([]);
  });

  it('hat ein Zeitfenster zwischen 300 und 400 ms', () => {
    expect(DOUBLE_SHIFT_INTERVAL_MS).toBeGreaterThanOrEqual(300);
    expect(DOUBLE_SHIFT_INTERVAL_MS).toBeLessThanOrEqual(400);
  });

  it('löst zu langsam nicht aus; der zu späte Tipper zählt als erster eines neuen Versuchs', () => {
    expect(firings([...tap(0), ...tap(800)])).toEqual([]);
    expect(firings([...tap(0), ...tap(800), ...tap(1000)])).toEqual([5]);
  });

  it('zählt linke und rechte Shift-Taste gleich, auch gemischt', () => {
    expect(firings([...tap(0, 'ShiftLeft'), ...tap(150, 'ShiftRight')])).toEqual([3]);
    expect(firings([...tap(0, 'ShiftRight'), ...tap(150, 'ShiftLeft')])).toEqual([3]);
    expect(firings([...tap(0, 'ShiftRight'), ...tap(150, 'ShiftRight')])).toEqual([3]);
  });

  it('löst nicht aus, wenn dazwischen eine andere Taste gedrückt wird (Grossbuchstaben)', () => {
    // Shift + A, Shift + B, schnell hintereinander.
    expect(
      firings([down(0), down(30, 'KeyA'), up(60, 'KeyA'), up(80), down(150), down(180, 'KeyB'), up(210, 'KeyB'), up(230)]),
    ).toEqual([]);
    // Eine Taste zwischen den beiden Tippern.
    expect(firings([...tap(0), ...tap(100, 'KeyX'), ...tap(200)])).toEqual([]);
    // Eine Taste nach dem zweiten Drücken, noch vor dem Loslassen (Shift + A als zweites).
    expect(firings([...tap(0), down(150), down(180, 'KeyA'), up(200, 'KeyA'), up(220)])).toEqual([]);
    // Ein Grossbuchstabe, danach zwei saubere Tipper: Die zählen.
    expect(firings([down(0), down(30, 'KeyA'), up(60, 'KeyA'), up(80), ...tap(150), ...tap(300)])).toEqual([7]);
  });

  it('lässt sich vom späten Loslassen einer anderen Taste nicht stören (schnelles Tippen)', () => {
    expect(firings([down(0, 'KeyX'), down(40), up(70, 'KeyX'), up(100), ...tap(200)])).toEqual([5]);
  });

  it('löst nicht aus, wenn Ctrl, Alt oder die Windows-Taste mitgedrückt ist', () => {
    expect(firings([...tap(0, 'ShiftLeft', { ctrlKey: true }), ...tap(150, 'ShiftLeft', { ctrlKey: true })])).toEqual([]);
    // Alt + Shift wechselt unter Windows die Tastatursprache.
    expect(firings([...tap(0, 'ShiftLeft', { altKey: true }), ...tap(150, 'ShiftLeft', { altKey: true })])).toEqual([]);
    expect(firings([...tap(0, 'ShiftLeft', { metaKey: true }), ...tap(150, 'ShiftLeft', { metaKey: true })])).toEqual([]);
    // Nur beim zweiten Tipper mit Ctrl.
    expect(firings([...tap(0), ...tap(150, 'ShiftLeft', { ctrlKey: true })])).toEqual([]);
    // Ctrl kurz zwischen den Tippern gedrückt.
    expect(firings([...tap(0), down(80, 'ControlLeft', { ctrlKey: true }), up(100, 'ControlLeft'), ...tap(150)])).toEqual([]);
    // Ctrl während des zweiten Drückens dazu (Ctrl + Shift), losgelassen vor Shift.
    expect(firings([...tap(0), down(150), down(170, 'ControlLeft', { ctrlKey: true }), up(190, 'ControlLeft'), up(210)])).toEqual([]);
  });

  it('löst nicht aus, wenn dazwischen eine Maustaste gedrückt wird (Shift + Klick)', () => {
    expect(firings([...tap(0), { type: 'mousedown' }, ...tap(150)])).toEqual([]);
    expect(firings([...tap(0), down(150), { type: 'mousedown' }, up(220)])).toEqual([]);
  });

  it('löst nicht aus, wenn Shift nur gehalten wird (Tastenwiederholung)', () => {
    // Gehalten mit Wiederholung, losgelassen, dann ein Tipper: Erst der zählt als erster.
    const held = [down(0), down(250, 'ShiftLeft', { repeat: true }), down(280, 'ShiftLeft', { repeat: true }), up(300)];
    expect(firings([...held, ...tap(380)])).toEqual([]);
    expect(firings([...held, ...tap(380), ...tap(500)])).toEqual([7]);
    // Das zweite Shift gehalten, mit oder ohne Wiederholung.
    expect(firings([...tap(0), down(150), down(400, 'ShiftLeft', { repeat: true }), up(450)])).toEqual([]);
    expect(firings([...tap(0), down(150), up(150 + DOUBLE_SHIFT_INTERVAL_MS)])).toEqual([]);
  });

  it('löst nicht aus, wenn das Fenster dazwischen den Fokus verliert', () => {
    expect(firings([...tap(0), { type: 'blur' }, ...tap(150)])).toEqual([]);
    expect(firings([...tap(0), down(150), { type: 'blur' }, up(220)])).toEqual([]);
  });

  it('löst bei beiden Shift-Tasten zugleich nicht aus', () => {
    expect(firings([down(0, 'ShiftLeft'), down(50, 'ShiftRight'), up(100, 'ShiftRight'), up(150, 'ShiftLeft')])).toEqual([]);
  });

  it('löst bei dreimal Shift nur einmal aus, bei viermal zweimal', () => {
    expect(firings([...tap(0), ...tap(150), ...tap(300)])).toEqual([3]);
    expect(firings([...tap(0), ...tap(150), ...tap(300), ...tap(450)])).toEqual([3, 7]);
  });
});
