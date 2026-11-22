// Graph-Spuren des Git-Logs (Ticket 19): pro Zeile die Spalte des Commit-Punkts und die Linien zur nächsten Zeile.
// Die Berechnung setzt Zeile für Zeile fort (seitenweise, ohne frühere Zeilen neu zu berechnen); die Oberfläche
// zeichnet nur. Reine Logik, lädt nie Electron.
//
// - Jede Spalte („Spur“) erwartet einen Commit; jeder erwartete Commit steht in höchstens einer Spur. Zeigen zwei
//   Kinder auf denselben Elterncommit, läuft die Linie des zweiten in die bestehende Spur.
// - Ein Commit, den keine Spur erwartet (eine Branch-Spitze), bekommt die erste freie Spalte.
// - Die Spur des aktuellen Branches ist von Anfang an für HEAD reserviert und bleibt so in Spalte 0, wo möglich.
// - Der erste Elterncommit erbt Spalte und Farbe; weitere Elterncommits bekommen neue Spuren mit neuen Farben.

import type { GitGraphRow } from '../../../shared/types';

export class LogGraph {
  /** Erwarteter Commit je Spalte; `null` ist eine freie Spalte. */
  private lanes: Array<string | null> = [];
  private colors: number[] = [];
  private nextColor = 0;
  /** Für HEAD reserviert, aber noch nicht erreicht: Diese Spur zeichnet noch keine Linie. */
  private waitingHead: string | null = null;

  /** `head`: der Commit von HEAD, dessen Spur in Spalte 0 beginnt (wenn er im Log vorkommt). */
  constructor(head?: string) {
    if (head) {
      this.lanes.push(head);
      this.colors.push(this.nextColor++);
      this.waitingHead = head;
    }
  }

  /** Die Spuren der nächsten Zeile; Commits müssen in der Reihenfolge des Logs kommen (Kinder vor Eltern). */
  next(hash: string, parents: readonly string[]): GitGraphRow {
    if (hash === this.waitingHead) this.waitingHead = null;
    let column = this.lanes.indexOf(hash);
    if (column < 0) {
      column = this.freeColumn();
      this.lanes[column] = hash;
      this.colors[column] = this.nextColor++;
    }
    const color = this.colors[column];
    const before = [...this.lanes];
    const waiting = this.waitingHead;
    const lines: GitGraphRow['lines'] = [];

    // Spuren, die in dieser Zeile die Spalte wechseln (statt gerade weiterzulaufen).
    const moved = new Map<number, number>();

    // Die Spur des Commits geht an den ersten Elterncommit (oder endet); weitere Elterncommits zweigen ab.
    this.lanes[column] = null;
    parents.forEach((parent, i) => {
      const existing = this.lanes.indexOf(parent);
      if (existing > column && i === 0 && parent !== this.waitingHead) {
        // Den ersten Elterncommit erwartet schon eine Spur weiter rechts: Er rückt in diese Spalte, die andere Spur
        // biegt hierher. So bleibt der aktuelle Branch links, auch wenn ein Seitenzweig früher abzweigte.
        this.lanes[existing] = null;
        this.lanes[column] = parent;
        moved.set(existing, column);
        lines.push({ from: column, to: column, color });
        return;
      }
      if (existing >= 0) {
        // Eine Linie in die reservierte Spur von HEAD: Ab hier wird sie gezeichnet.
        if (parent === this.waitingHead) this.waitingHead = null;
        lines.push({ from: column, to: existing, color: this.colors[existing] });
        return;
      }
      if (i === 0) {
        this.lanes[column] = parent;
        lines.push({ from: column, to: column, color });
        return;
      }
      const target = this.freeColumn();
      this.lanes[target] = parent;
      this.colors[target] = this.nextColor++;
      lines.push({ from: column, to: target, color: this.colors[target] });
    });

    // Die anderen Spuren laufen gerade weiter.
    before.forEach((expected, j) => {
      if (j === column || expected === null || expected === waiting) return;
      lines.push({ from: j, to: moved.get(j) ?? j, color: this.colors[j] });
    });

    while (this.lanes.length > 0 && this.lanes[this.lanes.length - 1] === null) {
      this.lanes.pop();
      this.colors.pop();
    }
    return { column, color, lines: lines.sort((a, b) => a.from - b.from || a.to - b.to) };
  }

  private freeColumn(): number {
    const free = this.lanes.indexOf(null);
    if (free >= 0) return free;
    this.lanes.push(null);
    this.colors.push(0);
    return this.lanes.length - 1;
  }
}
