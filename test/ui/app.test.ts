// Teststelle 2: die echte App in Electron, gesteuert mit Playwright im Testmodus.

import { describe, expect, it } from 'vitest';
import { launchCodium } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

describe('App im Testmodus', () => {
  const tempDir = useTempDirs();

  it('startet, zeigt die Oberfläche über den Vertrag, zeichnet auf und beendet sich wieder', async () => {
    const codium = await launchCodium({ dataRoot: tempDir() });
    try {
      const page = await codium.app.firstWindow();
      await expect.poll(() => page.locator('h1').textContent()).toBe('Codium');
      // Die Version kommt über den Vertrag aus dem Kern.
      await expect.poll(() => page.locator('p').textContent()).toMatch(/^Version \d+\.\d+\.\d+/);

      const recorded = await codium.recorded();
      expect(recorded.map((e) => e.kind)).toContain('window-opened');
    } finally {
      await codium.close();
    }
  });

  it('verweigert den Start ohne Testmodus', async () => {
    await expect(launchCodium({ dataRoot: tempDir(), env: { CODIUM_TEST_HIDDEN: '' } })).rejects.toThrow(/Testmodus/);
    await expect(launchCodium({ dataRoot: tempDir(), env: { CODIUM_TEST_DATA_DIR: '' } })).rejects.toThrow(/Testmodus/);
  });
});
