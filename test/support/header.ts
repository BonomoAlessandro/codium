// Hilfen für die Kopfzeile in UI-Tests (Ticket 33): die Zieh-Fläche laut Stil und ein Klick auf ihre leere Fläche,
// beides über die Entwicklerwerkzeuge der Seite. Ob Windows einen echten Klick an die Seite gäbe, fragt dagegen
// `hitTest` in nativeWindow.ts beim Fenster selbst.

import type { Page } from 'playwright-core';

/** Die Zieh-Fläche der Kopfzeile laut Stil: `drag` oder `no-drag`. */
export function headerRegion(page: Page): Promise<string> {
  return page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('header.header')!);
    return style.getPropertyValue('-webkit-app-region') || style.getPropertyValue('app-region');
  });
}

/** Ein Punkt auf der leeren Fläche der Kopfzeile, im freien Rand rechts vor den Fensterknöpfen (CSS-Pixel). */
export function emptyHeaderPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const content = document.querySelector('.header-content')!.getBoundingClientRect();
    const header = document.querySelector('header.header')!.getBoundingClientRect();
    return { x: content.right - 24, y: header.top + header.height / 2 };
  });
}

/**
 * Klickt über die Entwicklerwerkzeuge auf die leere Fläche der Kopfzeile. Der Klick erreicht die Seite auch dort, wo
 * Windows einen echten Klick als Klick auf die Titelleiste behandelte.
 */
export async function clickEmptyHeader(page: Page): Promise<void> {
  const at = await emptyHeaderPoint(page);
  await page.mouse.click(at.x, at.y);
}
