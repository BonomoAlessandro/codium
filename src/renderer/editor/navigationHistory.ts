// Navigationsverlauf eines Projektfensters für Zurück und Vor (Ticket 13), wie in IntelliJ: Einträge entstehen bei
// Sprüngen (Definition, Verwendungen, Implementierungen, Datei- und Projektsuche, Symbolsuche, Zu Zeile, Wechsel der
// Datei) und bei grösseren Cursorbewegungen. Reine Logik ohne DOM.

/** Eine Stelle: Datei, Zeile und Spalte ab 1. */
export interface NavLocation {
  path: string;
  line: number;
  column: number;
}

/** Ab so vielen Zeilen gilt eine Cursorbewegung in derselben Datei als Sprung. */
export const JUMP_LINES = 10;
/** So viele Einträge hält der Verlauf je Richtung höchstens. */
const LIMIT = 100;

const samePlace = (a: NavLocation, b: NavLocation) => a.path.toLowerCase() === b.path.toLowerCase() && a.line === b.line;

export class NavigationHistory {
  private readonly back: NavLocation[] = [];
  private readonly forward: NavLocation[] = [];

  /**
   * Der Cursor ist von `from` nach `to` gegangen. Ein Wechsel der Datei oder eine Bewegung über mehr als
   * `JUMP_LINES` Zeilen merkt `from` als Eintrag; ein neuer Sprung verwirft die Vor-Einträge. Liefert, ob ein Eintrag
   * entstand.
   */
  moved(from: NavLocation, to: NavLocation): boolean {
    const jump = from.path.toLowerCase() !== to.path.toLowerCase() || Math.abs(from.line - to.line) > JUMP_LINES;
    if (!jump) return false;
    this.push(from);
    this.forward.length = 0;
    return true;
  }

  /** Ein Sprung, den Codium selbst auslöst (etwa „Zu Zeile“ über wenige Zeilen): merkt `from` immer. */
  jumped(from: NavLocation): void {
    this.push(from);
    this.forward.length = 0;
  }

  get canGoBack(): boolean {
    return this.back.length > 0;
  }

  get canGoForward(): boolean {
    return this.forward.length > 0;
  }

  /** Zurück: das Ziel, `current` kommt in die Vor-Einträge; `null`, wenn es keinen Eintrag gibt. */
  goBack(current: NavLocation): NavLocation | null {
    const target = this.back.pop();
    if (!target) return null;
    this.forward.push(current);
    return target;
  }

  /** Vor: das Ziel, `current` kommt in die Zurück-Einträge; `null`, wenn es keinen gibt. */
  goForward(current: NavLocation): NavLocation | null {
    const target = this.forward.pop();
    if (!target) return null;
    this.back.push(current);
    return target;
  }

  /** Einträge einer Datei, die es nicht mehr gibt, fallen weg; umbenannte folgen. */
  rename(from: string, to: string | null): void {
    for (const list of [this.back, this.forward]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const entry = list[i];
        const k = entry.path.toLowerCase();
        const f = from.toLowerCase();
        if (k !== f && !k.startsWith(`${f}\\`) && !k.startsWith(`${f}/`)) continue;
        if (to === null) list.splice(i, 1);
        else list[i] = { ...entry, path: to + entry.path.slice(from.length) };
      }
    }
  }

  private push(location: NavLocation): void {
    const last = this.back.at(-1);
    if (last && samePlace(last, location)) return;
    this.back.push(location);
    if (this.back.length > LIMIT) this.back.shift();
  }
}
