// Nur lesende Abfragen an Fenster der eigenen Testinstanz über Win32 (PowerShell). Aktiviert, verschiebt oder
// verändert nie ein Fenster (Spielregel „Der Desktop des Nutzers ist tabu“).

import { execFileSync } from 'node:child_process';

/** Erweiterter Fensterstil: Windows aktiviert das Fenster nicht, auch nicht beim Schliessen des Vordergrundfensters. */
export const WS_EX_NOACTIVATE = 0x08000000;

/** Der erweiterte Fensterstil (GWL_EXSTYLE) eines Fensters, gelesen mit GetWindowLongPtr. */
export function extendedWindowStyle(hwnd: bigint): number {
  if (process.platform !== 'win32') throw new Error('Fensterstile gibt es nur unter Windows.');
  const script =
    `Add-Type -Namespace CodiumTest -Name Win -MemberDefinition '[DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);'; ` +
    `[CodiumTest.Win]::GetWindowLongPtr([IntPtr]::new([Int64]${BigInt(hwnd)}), -20).ToInt64()`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
  return Number(out.trim());
}
