// Welche Zugriffe die Seiten machen dürfen (Review von Ticket 23): nur die eigenen Dateien der Oberfläche.

import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isAllowedPageRequest } from '../../src/main/pageRequests';

const RENDERER = 'C:\\Program Files\\Codium\\resources\\app.asar\\dist\\renderer';

describe('Zugriffe der Seiten', () => {
  it('erlaubt die eigenen Dateien und data:-Adressen', () => {
    expect(isAllowedPageRequest(pathToFileURL(`${RENDERER}\\index.html`).href, RENDERER)).toBe(true);
    expect(isAllowedPageRequest(pathToFileURL(`${RENDERER}\\assets\\font.woff2`).href, RENDERER)).toBe(true);
    expect(isAllowedPageRequest('data:image/png;base64,AAAA', RENDERER)).toBe(true);
  });

  it('weist alles andere ab: andere Dateien, UNC-Pfade, das Netz', () => {
    for (const url of [
      'file:///C:/Users/a/secret.png',
      pathToFileURL(`${RENDERER}\\..\\main\\main.js`).href,
      'file:///C:/Program%20Files/Codium/resources/app.asar/dist/renderer-evil/x.png',
      'file://server/share/x.png',
      'https://example.com/x.png',
      'http://localhost:3000/',
      'blob:null/123',
      'file:///C:/Program%20Files/Codium/resources/app.asar/dist/renderer/%2e%2e/main/main.js',
    ]) {
      expect(isAllowedPageRequest(url, RENDERER), url).toBe(false);
    }
  });
});
