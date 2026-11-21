// Teststelle 2: Markdown-Vorschau in der echten App, gesteuert mit Playwright im Testmodus.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import type { TestEvent } from '../../src/main/testMode';
import { launchCodium, prepareAppState, type LaunchedApp } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

const ALPHA = 'Alpha – Codium';
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const DOC = [
  '# Codium Notes',
  '',
  '| Name | Value |',
  '|------|-------|',
  '| a    | 1     |',
  '',
  '- [ ] open task',
  '- [x] done task',
  '',
  '![Screenshot](img/shot.png)',
  '![Outside](../../secret.png)',
  '',
  '[Website](https://example.com/docs)',
  '',
  '<script>window.__pwned = true</script>',
  '<img src="x" onerror="window.__pwned2 = true">',
  '',
  '```mermaid',
  'graph LR',
  '  A --> B',
  '```',
  '',
  '```mermaid',
  'this is not a diagram ((',
  '```',
  '',
  'After the diagrams.',
  '',
].join('\n');

function item(page: Page, name: string): Locator {
  return page.getByRole('tree', { name: 'Project Files' }).getByRole('treeitem', { name, exact: true });
}

function preview(page: Page): Locator {
  return page.getByRole('document', { name: 'Markdown Preview' });
}

function viewButton(page: Page, name: 'Editor' | 'Split' | 'Preview'): Locator {
  return page.getByRole('group', { name: 'Markdown View' }).getByRole('button', { name, exact: true });
}

async function webRequests(codium: LaunchedApp): Promise<string[]> {
  return (await codium.recorded()).filter((e) => e.kind === 'web-request').map((e) => (e.detail as { url: string }).url);
}

describe('Markdown-Vorschau', () => {
  const tempDir = useTempDirs();

  function setup(files: Record<string, string | Buffer>) {
    const alpha = path.join(tempDir(), 'Alpha');
    fs.mkdirSync(alpha, { recursive: true });
    for (const [relative, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(alpha, relative)), { recursive: true });
      fs.writeFileSync(path.join(alpha, relative), content);
    }
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [alpha], recentProjects: [alpha] });
    return { alpha, dataRoot };
  }

  async function launchAlpha(dataRoot: string): Promise<{ codium: LaunchedApp; page: Page }> {
    const codium = await launchCodium({ dataRoot });
    const page = await codium.page(ALPHA);
    await item(page, 'Alpha').waitFor({ timeout: 15_000 });
    return { codium, page };
  }

  async function withApp(codium: LaunchedApp, body: () => Promise<void>): Promise<void> {
    try {
      await body();
    } finally {
      await codium.close();
    }
  }

  it('zeigt Überschrift, Tabelle, Aufgabenliste, Bild und Mermaid; Skripte laufen nicht; Web-Links gehen an den Browser', async () => {
    // Wege, über die eine fremde Datei Dateien von ausserhalb laden oder das Fenster überdecken wollte (Review von
    // Ticket 23): CSS-url(), ein SVG-Bild, Bilder und Ereignis-Attribute in Mermaid-Beschriftungen, position: fixed.
    const root = tempDir();
    const secret = path.join(root, 'secret.png');
    fs.writeFileSync(secret, PNG_1X1);
    const secretUrl = pathToFileURL(secret).href;
    const fromRenderer = path.relative(path.join(PROJECT_ROOT, 'dist', 'renderer'), secret).replaceAll('\\', '/');
    const attacks = [
      `<div style="background-image:url('${secretUrl}')">styled</div>`,
      '<div style="position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999">FAKE</div>',
      `<svg width="10" height="10"><image href="${secretUrl}" width="10" height="10"/></svg>`,
      '',
      '```mermaid',
      'graph LR',
      `  A["<img src='${fromRenderer}'>"] --> B`,
      `  C["<img src='nope.png' onerror='window.__m = 1'>"] --> D`,
      '```',
      '',
    ].join('\n');
    const { alpha, dataRoot } = setup({ 'docs/guide.md': `${DOC}\n${attacks}`, 'docs/img/shot.png': PNG_1X1, 'plain.md': '# Plain\n' });
    fs.writeFileSync(path.join(alpha, '..', 'secret.png'), PNG_1X1);
    const { codium, page } = await launchAlpha(dataRoot);
    await withApp(codium, async () => {
      // Eine Datei ohne Diagramm lädt Mermaid nicht.
      await item(page, 'plain.md').dblclick();
      await preview(page).getByRole('heading', { name: 'Plain' }).waitFor();
      expect(await viewButton(page, 'Split').getAttribute('aria-pressed')).toBe('true');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect((await webRequests(codium)).some((url) => url.endsWith('/mermaid.js'))).toBe(false);

      await item(page, 'docs').dblclick();
      await item(page, 'guide.md').dblclick();
      const doc = preview(page);
      await doc.getByRole('heading', { name: 'Codium Notes' }).waitFor();
      expect(await doc.getByRole('table').locator('td').allInnerTexts()).toEqual(['a', '1']);
      expect(await doc.getByRole('checkbox').evaluateAll((els) => els.map((e) => e.getAttribute('aria-checked')))).toEqual(['false', 'true']);

      // Das Bild aus dem Projekt erscheint, das von ausserhalb nicht (stattdessen der Alternativtext).
      const shot = doc.getByRole('img', { name: 'Screenshot' });
      await expect.poll(() => shot.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
      // Ebenso das <img src="x" onerror=…> weiter unten: Es gibt das Bild nicht, also der Alternativtext.
      await expect.poll(() => doc.locator('.md-image-alt').allInnerTexts()).toEqual(['Outside', 'x']);

      // Mermaid als SVG; das fehlerhafte Diagramm zeigt seine Meldung, der Rest bleibt.
      await expect.poll(() => doc.locator('.md-mermaid > svg').count(), { timeout: 15_000 }).toBe(2);
      expect(await doc.locator('.md-mermaid svg image, .md-mermaid svg img, .md-mermaid svg foreignObject').count()).toBe(0);
      await expect.poll(() => doc.locator('.md-mermaid-error').count()).toBe(1);
      expect(await doc.getByText('After the diagrams.').count()).toBe(1);

      // Skripte und Ereignis-Attribute laufen nicht.
      expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean; __pwned2?: boolean }).__pwned ?? (window as unknown as { __pwned2?: boolean }).__pwned2 ?? false)).toBe(false);
      expect(await doc.locator('script').count()).toBe(0);
      expect(await page.evaluate(() => (window as unknown as { __m?: number }).__m)).toBeUndefined();
      // Nichts aus der Vorschau überdeckt das Fenster; Mermaid lässt keine Hilfsknoten im Dokument zurück.
      expect(await page.evaluate(() => document.elementFromPoint(5, 5)?.closest('.markdown-preview') ?? null)).toBeNull();
      expect(await doc.getByText('FAKE').isVisible()).toBe(true);
      expect(await page.evaluate(() => [...document.body.children].map((el) => el.id).filter((id) => id.includes('mermaid')))).toEqual([]);

      // Ein Web-Link landet in der Aufzeichnung (statt den Browser zu öffnen).
      await doc.getByRole('link', { name: 'Website' }).click();
      await expect
        .poll(async () => (await codium.recorded()).filter((e: TestEvent) => e.kind === 'open-external').map((e) => (e.detail as { url: string }).url))
        .toEqual(['https://example.com/docs']);

      // Mermaid kam aus den eigenen Dateien; nichts aus dem Netz, keine Verstösse gegen die Sicherheitsrichtlinie.
      const own = pathToFileURL(path.join(PROJECT_ROOT, 'dist')).href.toLowerCase();
      const requests = await webRequests(codium);
      expect(requests.some((url) => url.endsWith('/mermaid.js'))).toBe(true);
      expect(requests.filter((url) => !url.toLowerCase().startsWith(`${own}/`) && !url.startsWith('data:'))).toEqual([]);
      // Jeder Zugriff auf eigene Dateien trifft eine Datei, die es gibt (kein „nope.png“, kein Pfad von draussen).
      for (const url of requests.filter((u) => u.startsWith('file:'))) {
        expect(fs.existsSync(fileURLToPath(url)), url).toBe(true);
      }
      expect(requests.filter((url) => /secret|nope/.test(url))).toEqual([]);
      const violations = (await codium.recorded()).filter(
        (e) => e.kind === 'console-message' && /Content Security Policy|Refused to/i.test((e.detail as { message: string }).message),
      );
      expect(violations.map((v) => (v.detail as { message: string }).message)).toEqual([]);
    });
  });

  it('aktualisiert die Vorschau beim Tippen, folgt dem Scrollen und merkt sich „Preview“ über einen Neustart', async () => {
    const long = Array.from({ length: 120 }, (_, i) => `## Section ${i + 1}\n\nText of section ${i + 1}.\n`).join('\n');
    const { dataRoot } = setup({ 'notes.md': `# Start\n\n${long}` });
    const first = await launchAlpha(dataRoot);
    await withApp(first.codium, async () => {
      const { page } = first;
      await item(page, 'notes.md').dblclick();
      const doc = preview(page);
      await doc.getByRole('heading', { name: 'Start' }).waitFor();

      // Tippen ändert die Vorschau, auch vor dem Speichern.
      await page.locator('.editor-host .view-lines').click();
      await page.keyboard.press('Control+Home');
      await page.keyboard.press('End');
      await page.keyboard.type(' Typed');
      await doc.getByRole('heading', { name: 'Start Typed' }).waitFor();

      // Scrollen im Editor bringt den passenden Abschnitt in der Vorschau nach oben.
      const box = (await page.locator('.editor-host').boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 500);
      /** Der Abschnitt der obersten sichtbaren Editorzeile bzw. der oberste sichtbare Abschnitt der Vorschau. */
      const editorSection = () =>
        page.locator('.editor-host .view-line').evaluateAll((lines) => {
          const sorted = lines
            .map((l) => ({ top: Number.parseFloat((l as HTMLElement).style.top), text: (l as HTMLElement).innerText.replace(/ /g, ' ') }))
            .sort((a, b) => a.top - b.top);
          const heading = sorted.find((l) => /^## Section \d+/.test(l.text));
          return heading ? Number(/\d+/.exec(heading.text)![0]) : 0;
        });
      const previewSection = () =>
        doc.evaluate((el) => {
          const top = el.getBoundingClientRect().top;
          const heading = [...el.querySelectorAll('h2')].find((h) => h.getBoundingClientRect().top >= top - 30);
          return heading ? Number(/\d+/.exec(heading.textContent ?? '')![0]) : 0;
        });
      await expect.poll(editorSection).toBeGreaterThan(5);
      await expect.poll(async () => Math.abs((await previewSection()) - (await editorSection()))).toBeLessThanOrEqual(1);

      // Nur die Vorschau; nach einem Neustart wieder so.
      await viewButton(page, 'Preview').click();
      expect(await page.locator('.editor-host').isVisible()).toBe(false);
      await page.getByRole('button', { name: 'Alpha', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Exit' }).click();
      await first.codium.exited();
    });

    const second = await launchAlpha(dataRoot);
    await withApp(second.codium, async () => {
      await preview(second.page).getByRole('heading', { name: 'Start Typed' }).waitFor();
      expect(await viewButton(second.page, 'Preview').getAttribute('aria-pressed')).toBe('true');
      expect(await second.page.locator('.editor-host').isVisible()).toBe(false);
    });
  });
});
