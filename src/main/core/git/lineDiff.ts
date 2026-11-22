// Änderungsblöcke zwischen zwei Texten (Ticket 17), zeilenweise, ohne Rücksicht auf das Zeilenende: der Algorithmus
// von Myers auf den Zeilen zwischen gemeinsamem Anfang und Ende. Reine Logik, lädt nie Electron.

import type { ChangeBlock } from '../../../shared/types';

/**
 * Ab so vielen Unterschieden gilt der mittlere Teil als ein einziger geänderter Block. Der Kern läuft im Hauptprozess und
 * wird beim Tippen alle 250 ms gefragt: Zeit O((n + m) · D) und Speicher O(D²) bleiben so klein (Review von Ticket 17).
 */
const MAX_EDIT_DISTANCE = 1000;

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r\n|\n|\r/);
  // Ein Zeilenumbruch am Ende ergibt keine weitere Zeile.
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Die Blöcke, die `newText` gegenüber `oldText` geändert, eingefügt oder gelöscht hat. */
export function changeBlocks(oldText: string, newText: string): ChangeBlock[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  return hunks(a, b).map(([aStart, aEnd, bStart, bEnd]): ChangeBlock => {
    const oldLines = a.slice(aStart, aEnd);
    if (aEnd === aStart) return { kind: 'added', line: bStart + 1, count: bEnd - bStart, oldLines };
    if (bEnd === bStart) return { kind: 'deleted', line: bStart + 1, count: 0, oldLines };
    return { kind: 'modified', line: bStart + 1, count: bEnd - bStart, oldLines };
  });
}

/** Unterschiedliche Bereiche als [aStart, aEnd, bStart, bEnd), in Reihenfolge. */
export function hunks(a: readonly string[], b: readonly string[]): Array<[number, number, number, number]> {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  if (start === endA && start === endB) return [];
  const ops = myers(a.slice(start, endA), b.slice(start, endB));
  if (ops === null) return [[start, endA, start, endB]];
  const result: Array<[number, number, number, number]> = [];
  let x = start;
  let y = start;
  let i = 0;
  while (i < ops.length) {
    if (ops[i] === 0) {
      x++;
      y++;
      i++;
      continue;
    }
    const hunk: [number, number, number, number] = [x, x, y, y];
    while (i < ops.length && ops[i] !== 0) {
      if (ops[i] < 0) x++;
      else y++;
      i++;
    }
    hunk[1] = x;
    hunk[3] = y;
    result.push(hunk);
  }
  return result;
}

/** Bearbeitungsfolge: 0 gleich, -1 gelöscht (aus a), 1 eingefügt (aus b); `null`, wenn es zu viele Unterschiede gibt. */
function myers(a: readonly string[], b: readonly string[]): number[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // Je Runde nur der Ausschnitt k = -d-1 … d+1, den der Rückweg braucht.
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], n: number, m: number): number[] {
  const ops: number[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const at = (k: number) => v[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push(0);
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) ops.push(1);
      else ops.push(-1);
      x = prevX;
      y = prevY;
    }
  }
  return ops.reverse();
}
