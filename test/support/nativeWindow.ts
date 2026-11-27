// Nur lesende Abfragen an Fenster der eigenen Testinstanz über Win32 (PowerShell). Aktiviert, verschiebt oder
// verändert nie ein Fenster (Spielregel „Der Desktop des Nutzers ist tabu“).

import { execFileSync } from 'node:child_process';

/** Erweiterter Fensterstil: Windows aktiviert das Fenster nicht, auch nicht beim Schliessen des Vordergrundfensters. */
export const WS_EX_NOACTIVATE = 0x08000000;

function powershell(script: string): string {
  if (process.platform !== 'win32') throw new Error('Fenster lassen sich nur unter Windows abfragen.');
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
}

/** Der erweiterte Fensterstil (GWL_EXSTYLE) eines Fensters, gelesen mit GetWindowLongPtr. */
export function extendedWindowStyle(hwnd: bigint): number {
  const script =
    `Add-Type -Namespace CodiumTest -Name Win -MemberDefinition '[DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);'; ` +
    `[CodiumTest.Win]::GetWindowLongPtr([IntPtr]::new([Int64]${BigInt(hwnd)}), -20).ToInt64()`;
  return Number(powershell(script).trim());
}

export interface NativeWindow {
  hwnd: string;
  /** Erweiterter Fensterstil (GWL_EXSTYLE). */
  exStyle: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Ob es das Vordergrundfenster von Windows ist. */
  foreground: boolean;
}

/** Ob ein Fenster mit dem umschliessenden Rechteck aller Bildschirme überlappt (vorsichtig: auch Lücken zählen). */
export function onSomeScreen(w: NativeWindow, screen: { left: number; top: number; right: number; bottom: number }): boolean {
  return w.left < screen.right && w.right > screen.left && w.top < screen.bottom && w.bottom > screen.top;
}

const LIST_WINDOWS = `
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class CodiumWindows {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  public static string List(uint wanted) {
    var lines = new List<string>();
    var fg = GetForegroundWindow();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != wanted || !IsWindowVisible(h)) return true;
      RECT r; GetWindowRect(h, out r);
      lines.Add(string.Join("|", h.ToInt64(), GetWindowLongPtr(h, -20).ToInt64(), r.L, r.T, r.R, r.B, h == fg ? 1 : 0));
      return true;
    }, IntPtr.Zero);
    int x = GetSystemMetrics(76), y = GetSystemMetrics(77);
    lines.Add(string.Join("|", "screen", x, y, x + GetSystemMetrics(78), y + GetSystemMetrics(79)));
    return string.Join("\\n", lines);
  }
}`;

/**
 * Die sichtbaren Fenster eines Prozesses (Lage, Stil, Vordergrund) und das umschliessende Rechteck aller Bildschirme,
 * nur gelesen (EnumWindows, GetWindowRect, GetWindowLongPtr, GetForegroundWindow, GetSystemMetrics).
 */
export function windowsOfProcess(pid: number): { windows: NativeWindow[]; screen: { left: number; top: number; right: number; bottom: number } } {
  const script = `Add-Type -TypeDefinition @'${LIST_WINDOWS}\n'@; [CodiumWindows]::List(${Math.trunc(pid)})`;
  const rows = powershell(script)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => l.split('|'));
  const screenRow = rows.find((r) => r[0] === 'screen');
  if (!screenRow) throw new Error('Keine Bildschirme gemeldet.');
  const [, sl, st, sr, sb] = screenRow.map(Number);
  const windows = rows
    .filter((r) => r[0] !== 'screen')
    .map(([hwnd, exStyle, left, top, right, bottom, fg]) => ({
      hwnd,
      exStyle: Number(exStyle),
      left: Number(left),
      top: Number(top),
      right: Number(right),
      bottom: Number(bottom),
      foreground: fg === '1',
    }));
  return { windows, screen: { left: sl, top: st, right: sr, bottom: sb } };
}

/** Antworten auf WM_NCHITTEST: Fläche der Seite bzw. Titelleiste (also Zieh-Fläche). */
export const HTCLIENT = 1;
export const HTCAPTION = 2;

const HIT_TEST = `
using System;
using System.Runtime.InteropServices;
public static class CodiumHit {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeoutW(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  public static string Test(long hwnd, double cssWidth, double[] xy) {
    // Bildpunkte ohne Umrechnung durch Windows, egal wie die PowerShell skaliert (-4: per Monitor, Version 2).
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    var h = new IntPtr(hwnd);
    RECT c; GetClientRect(h, out c);
    var o = new POINT(); ClientToScreen(h, ref o);
    double scale = (c.R - c.L) / cssWidth;
    var results = new System.Collections.Generic.List<string>();
    for (int i = 0; i + 1 < xy.Length; i += 2) {
      int x = o.X + (int)Math.Round(xy[i] * scale), y = o.Y + (int)Math.Round(xy[i + 1] * scale);
      // WM_NCHITTEST trägt jede Koordinate in 16 Bit mit Vorzeichen; ausserhalb träfe die Abfrage still daneben.
      if (x < short.MinValue || x > short.MaxValue || y < short.MinValue || y > short.MaxValue)
        throw new Exception("Punkt " + x + ", " + y + " liegt ausserhalb des Wertebereichs von WM_NCHITTEST (16 Bit); das Fenster liegt zu weit ausserhalb des Bildschirms.");
      long l = ((long)unchecked((ushort)y) << 16) | unchecked((ushort)x);
      IntPtr r;
      if (SendMessageTimeoutW(h, 0x84, IntPtr.Zero, new IntPtr(l), 2, 5000, out r) == IntPtr.Zero) throw new Exception("WM_NCHITTEST ohne Antwort");
      results.Add(r.ToInt64().ToString());
    }
    return string.Join(",", results);
  }
}`;

/**
 * Was ein Fenster der eigenen Testinstanz an Punkten seiner Seite meldet, wenn Windows fragt, was dort liegt
 * (WM_NCHITTEST über SendMessageTimeout). Damit entscheidet Windows, ob ein Klick die Seite erreicht (HTCLIENT) oder
 * als Klick auf die Titelleiste gilt (HTCAPTION). Die Punkte sind CSS-Pixel der Seite; umgerechnet wird über die Breite
 * der Client-Fläche (`cssWidth` ist `innerWidth`), damit es bei jeder Skalierung stimmt. Liegt ein Punkt ausserhalb von
 * 16 Bit (die Nachricht trägt nicht mehr), bricht die Abfrage mit einer Meldung ab. Nur eine Abfrage: keine
 * Eingabe, keine Aktivierung, keine Bewegung; die Seite bekommt davon nichts mit (Ticket 33).
 */
export function hitTest(hwnd: bigint | string, cssWidth: number, points: ReadonlyArray<{ x: number; y: number }>): number[] {
  const xy = points.flatMap(({ x, y }) => [x, y]).map((v) => v.toFixed(2));
  const script = `Add-Type -TypeDefinition @'${HIT_TEST}\n'@; [CodiumHit]::Test(${BigInt(hwnd)}, ${cssWidth}, [double[]]@(${xy.join(',')}))`;
  return powershell(script).trim().split(',').map(Number);
}
