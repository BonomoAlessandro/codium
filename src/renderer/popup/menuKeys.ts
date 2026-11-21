// Bedienung eines offenen Menüs mit der Tastatur. Reine Zuordnung von Taste zu Wirkung, ohne DOM, damit sie sich in
// Node prüfen lässt (nach dem Vorbild THub).

export type MenuKeyAction =
  /** Diesen Eintrag hervorheben. */
  | { type: 'highlight'; index: number }
  /** Diesen Eintrag ausführen; das Menü schliesst sich dabei. */
  | { type: 'choose'; index: number }
  | { type: 'close' };

/**
 * Was eine Taste im offenen Menü bewirkt. `highlighted` ist der hervorgehobene Eintrag (-1: keiner), `count` die Zahl
 * der wählbaren Einträge (ohne Trennlinien). Pfeil hoch/runter laufen im Kreis, Pos1/Ende springen an die Enden, Enter
 * und Leertaste wählen, Escape und Tab schliessen. `null` für Tasten, die das Menü nicht betreffen.
 */
export function menuKey(key: string, highlighted: number, count: number): MenuKeyAction | null {
  switch (key) {
    case 'ArrowDown':
      return count > 0 ? { type: 'highlight', index: (highlighted + 1) % count } : null;
    case 'ArrowUp':
      return count > 0 ? { type: 'highlight', index: highlighted <= 0 ? count - 1 : highlighted - 1 } : null;
    case 'Home':
      return count > 0 ? { type: 'highlight', index: 0 } : null;
    case 'End':
      return count > 0 ? { type: 'highlight', index: count - 1 } : null;
    case 'Enter':
    case ' ':
      return highlighted >= 0 && highlighted < count ? { type: 'choose', index: highlighted } : null;
    case 'Escape':
    case 'Tab':
      return { type: 'close' };
    default:
      return null;
  }
}
