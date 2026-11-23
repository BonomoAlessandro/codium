// Zweimal Shift (Ticket 26): Wie in IntelliJ öffnet zweimal kurz Shift allein „Go to File“. Kleiner Zustandsautomat
// ohne DOM, damit er sich in Node prüfen lässt: Das Projektfenster gibt ihm Tastendrücke mit Zeitstempel, Maustasten
// und Fokusverlust, er sagt, wann es auslöst.
//
// - Es zählen zwei kurze Tipper auf Shift allein, links oder rechts, auch gemischt: vom ersten bis zum zweiten Drücken
//   weniger als DOUBLE_SHIFT_INTERVAL_MS, und das zweite Loslassen ebenso kurz nach dem zweiten Drücken.
// - Ausgelöst wird beim zweiten Loslassen, wie in IntelliJ. So bricht ein Grossbuchstabe oder ein Klick mit Shift auch
//   nach dem zweiten Drücken noch ab.
// - Jede andere gedrückte Taste, ein mitgedrückter Modifikator (Ctrl, Alt, Windows; Alt + Shift wechselt die
//   Tastatursprache), eine Maustaste, das Mausrad (Shift + Mausrad scrollt quer), Tastenwiederholung, eine laufende
//   Eingabe über einen IME und Fokusverlust brechen ab. Das Loslassen einer anderen Taste stört nicht: Beim schnellen
//   Tippen kommt es oft erst nach dem nächsten Drücken.
// - Nach dem Auslösen beginnt die Zählung neu; dreimal Shift löst nur einmal aus.

/** Höchster Abstand zwischen den beiden Tastendrücken (Richtwert im Ticket: 300–400 ms). */
export const DOUBLE_SHIFT_INTERVAL_MS = 400;

/** Der Teil eines Tastaturereignisses, den die Erkennung braucht; `KeyboardEvent` passt darauf. */
export interface KeyEventLike {
  type: string;
  key: string;
  code: string;
  repeat: boolean;
  /** Teil einer laufenden Eingabe über einen IME (etwa Japanisch); dann meldet die Taste oft `key === 'Process'`. */
  isComposing: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** Zeitpunkt in Millisekunden, auf einer gleichmässig laufenden Uhr. */
  timeStamp: number;
}

/** Was die Erkennung sieht: Tasten (gedrückt oder losgelassen), Maustasten, Mausrad und Fokusverlust des Fensters. */
export type DoubleShiftInput = KeyEventLike | { type: 'mousedown' | 'wheel' | 'blur' };

type State =
  | { phase: 'idle' }
  /** Shift zum ersten Mal unten. */
  | { phase: 'firstDown'; firstAt: number }
  /** Shift einmal getippt, wartet auf das zweite Drücken. */
  | { phase: 'firstUp'; firstAt: number }
  /** Shift zum zweiten Mal unten; das Loslassen löst aus. */
  | { phase: 'secondDown'; secondAt: number };

const IDLE: State = { phase: 'idle' };

function isShift(event: KeyEventLike): boolean {
  return event.key === 'Shift' || event.code === 'ShiftLeft' || event.code === 'ShiftRight';
}

export class DoubleShiftDetector {
  private state: State = IDLE;

  /** Nimmt ein Ereignis auf; `true`, wenn damit zweimal Shift vollständig ist. */
  handle(input: DoubleShiftInput): boolean {
    const { state, fire } = step(this.state, input);
    this.state = state;
    return fire;
  }
}

function step(state: State, input: DoubleShiftInput): { state: State; fire: boolean } {
  // Maustaste, Mausrad oder Fokusverlust: neu beginnen.
  if (!('key' in input)) return { state: IDLE, fire: false };
  const event = input;
  // Eingabe über einen IME: Die Tasten gehören dem IME.
  if (event.isComposing || event.key === 'Process') return { state: IDLE, fire: false };
  const time = event.timeStamp;
  const clean = !event.ctrlKey && !event.altKey && !event.metaKey;
  if (event.type === 'keydown') {
    // Gehaltenes Shift (Tastenwiederholung), eine andere Taste, ein Modifikator dazu: neu beginnen.
    if (!isShift(event) || event.repeat || !clean) return { state: IDLE, fire: false };
    switch (state.phase) {
      case 'idle':
        return { state: { phase: 'firstDown', firstAt: time }, fire: false };
      case 'firstUp':
        // Zu langsam: Dieses Drücken ist das erste eines neuen Versuchs.
        if (time - state.firstAt >= DOUBLE_SHIFT_INTERVAL_MS) return { state: { phase: 'firstDown', firstAt: time }, fire: false };
        return { state: { phase: 'secondDown', secondAt: time }, fire: false };
      default:
        // Die zweite Shift-Taste, während die erste noch unten ist: kein Doppeltipper.
        return { state: IDLE, fire: false };
    }
  }
  // Losgelassen; andere Tasten stören dabei nicht.
  if (event.type !== 'keyup' || !isShift(event)) return { state, fire: false };
  if (!clean) return { state: IDLE, fire: false };
  switch (state.phase) {
    case 'firstDown':
      return { state: { phase: 'firstUp', firstAt: state.firstAt }, fire: false };
    case 'secondDown':
      return { state: IDLE, fire: time - state.secondAt < DOUBLE_SHIFT_INTERVAL_MS };
    default:
      // Ein Shift, dessen Drücken nicht mitgezählt hat (etwa gehalten oder mit Ctrl): neu beginnen.
      return { state: IDLE, fire: false };
  }
}
