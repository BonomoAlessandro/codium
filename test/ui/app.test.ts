// Teststelle 2: die echte App in Electron, gesteuert mit Playwright im Testmodus.

import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchCodium } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

describe('App im Testmodus', () => {
  const tempDir = useTempDirs();

  it('startet unsichtbar, zeigt die Oberfläche über den Vertrag, zeichnet auf und beendet sich wieder', async () => {
    const codium = await launchCodium({ dataRoot: tempDir() });
    try {
      const page = await codium.app.firstWindow();
      await expect.poll(() => page.locator('h1').textContent(), { timeout: 15_000 }).toBe('Codium');
      // Die Version kommt über den Vertrag aus dem Kern.
      await expect.poll(() => page.locator('p').textContent(), { timeout: 15_000 }).toMatch(/^Version \d+\.\d+\.\d+/);

      // Die Schutzversprechen des Testmodus: auf keinem Bildschirm sichtbar, ohne Fokus. Windows setzt die Lage
      // nicht genau auf die verlangten -32000, deshalb wird gegen alle Bildschirme geprüft.
      const windows = await codium.app.evaluate(({ BrowserWindow, screen }) => {
        const displays = screen.getAllDisplays().map((d) => d.bounds);
        return BrowserWindow.getAllWindows().map((w) => {
          const b = w.getBounds();
          const onSomeDisplay = displays.some(
            (d) => b.x < d.x + d.width && b.x + b.width > d.x && b.y < d.y + d.height && b.y + b.height > d.y,
          );
          return { bounds: b, onSomeDisplay, focused: w.isFocused() };
        });
      });
      expect(windows).toHaveLength(1);
      expect(windows[0].onSomeDisplay, JSON.stringify(windows[0].bounds)).toBe(false);
      expect(windows[0].focused).toBe(false);

      const recorded = await codium.recorded();
      expect(recorded.map((e) => e.kind)).toContain('window-opened');
    } finally {
      await codium.close();
    }
  });

  it('verweigert den Start ohne Testmodus oder mit einem Datenordner ausserhalb des Temp-Ordners', async () => {
    await expect(launchCodium({ dataRoot: tempDir(), env: { CODIUM_TEST_HIDDEN: '' } })).rejects.toThrow(/Testmodus/);
    await expect(launchCodium({ dataRoot: tempDir(), env: { CODIUM_TEST_DATA_DIR: '' } })).rejects.toThrow(/Testmodus/);
    const outside = path.join(os.homedir(), 'codium-test-nicht-hier');
    await expect(launchCodium({ dataRoot: tempDir(), env: { CODIUM_TEST_DATA_DIR: outside } })).rejects.toThrow(/Temp-Ordner/);
  });
});
