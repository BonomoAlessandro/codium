// Logo im Willkommensfenster (Ticket 24): die echte App im Testmodus, gesteuert mit Playwright.

import { describe, expect, it } from 'vitest';
import { launchCodium } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

describe('Logo', () => {
  const tempDir = useTempDirs();

  it('das Willkommensfenster zeigt das Logo gross über dem Titel, geladen aus den eigenen Dateien und nicht leer', async () => {
    const codium = await launchCodium({ dataRoot: tempDir() });
    try {
      const page = await codium.page('Welcome to Codium');
      const logo = page.locator('.welcome-header .welcome-logo');
      await expect
        .poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { timeout: 15_000 })
        .toBe(true);

      const shown = await logo.evaluate((img: HTMLImageElement) => {
        const box = img.getBoundingClientRect();
        const title = document.querySelector('.welcome-header h1')!.getBoundingClientRect();
        // Nicht leer: das Bild auf eine Leinwand zeichnen und die deckenden Pixel zählen.
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const context = canvas.getContext('2d')!;
        context.drawImage(img, 0, 0, 64, 64);
        const alpha = context.getImageData(0, 0, 64, 64).data.filter((_, i) => i % 4 === 3);
        return {
          src: img.getAttribute('src'),
          width: box.width,
          height: box.height,
          aboveTitle: box.bottom <= title.top,
          opaqueShare: alpha.filter((a) => a > 128).length / alpha.length,
        };
      });
      expect(shown.src).toMatch(/^\.\/assets\/codium-[\w-]+\.svg$/);
      expect([shown.width, shown.height]).toEqual([64, 64]);
      expect(shown.aboveTitle).toBe(true);
      // Der Ring mit dem Punkt deckt gut ein Fünftel der Fläche; ein leeres oder kaputtes Bild deckte nichts.
      expect(shown.opaqueShare).toBeGreaterThan(0.15);

      // Die Datei kam aus dem Ordner der Oberfläche und wurde nicht abgewiesen.
      const requests = (await codium.recorded())
        .filter((e) => e.kind === 'web-request')
        .map((e) => e.detail as { url: string; blocked?: boolean })
        .filter((r) => /\/dist\/renderer\/assets\/codium-[\w-]+\.svg$/.test(r.url));
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every((r) => r.blocked !== true)).toBe(true);
    } finally {
      await codium.close();
    }
  });
});
