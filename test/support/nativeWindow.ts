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
