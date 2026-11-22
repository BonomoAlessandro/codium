// Teststelle 2: Zurück und Vor, Symbolsuche und Vervollständigung in der echten App (Ticket 13), mit dem
// mitgelieferten nativen Server von TypeScript 7.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { launchCodium, prepareAppState, type LaunchedApp } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

const TITLE = 'Counters – Codium';
const COUNTER = 'export class Counter {\n  count = 0;\n  increment(step: number): number {\n    this.count += step;\n    return this.count;\n  }\n}\n';
const MAIN = "import { Counter } from './counter.js';\n\nconst c = new Counter();\nc.increment(2);\nexport const value = c.count;\n";

function item(page: Page, name: string): Locator {
  return page.getByRole('tree', { name: 'Project Files' }).getByRole('treeitem', { name, exact: true });
}

async function activeTab(page: Page): Promise<string | null> {
  return page.locator('.editor-tab.active .editor-tab-name').first().textContent();
}

function position(page: Page): Promise<string> {
  return page.getByLabel('Line and column').innerText();
}

/** Mitte eines Wortes in der ersten Editorzeile, deren Text auf das Muster passt. */
async function wordAt(page: Page, text: string, lineText: RegExp): Promise<{ x: number; y: number }> {
  const box = await page.evaluate(
    ([w, source]) => {
      const pattern = new RegExp(source as string);
      const line = [...document.querySelectorAll<HTMLElement>('.editor-host .view-line')].find((l) => pattern.test(l.innerText.replace(/ /g, ' ')));
      if (!line) return null;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const index = (node.textContent ?? '').indexOf(w as string);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + (w as string).length);
        const r = range.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      return null;
    },
    [text, lineText.source] as const,
  );
  if (!box) throw new Error(`Wort nicht gefunden: ${text}`);
  return box;
}

async function ctrlClick(page: Page, text: string, lineText: RegExp): Promise<void> {
  const { x, y } = await wordAt(page, text, lineText);
  await page.mouse.move(x - 3, y);
  await page.keyboard.down('Control');
  await page.mouse.move(x, y, { steps: 3 });
  await page.waitForTimeout(400);
  await page.mouse.click(x, y);
  await page.keyboard.up('Control');
}

describe('TypeScript: Zurück und Vor, Symbolsuche, Vervollständigung', () => {
  const tempDir = useTempDirs();

  async function launch(): Promise<{ codium: LaunchedApp; page: Page }> {
    const project = path.join(tempDir(), 'Counters');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'es2022', module: 'nodenext' } }));
    fs.writeFileSync(path.join(project, 'counter.ts'), COUNTER);
    fs.writeFileSync(path.join(project, 'main.ts'), MAIN);
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [project], recentProjects: [project] });
    const codium = await launchCodium({ dataRoot });
    const page = await codium.page(TITLE);
    await item(page, 'main.ts').dblclick({ timeout: 15_000 });
    await page.locator('.editor-host .view-lines').waitFor();
    return { codium, page };
  }

  it('springt mit Ctrl + Linksklick in eine andere Datei und mit Ctrl + Alt + Links sowie der Maustaste „zurück“ zurück', async () => {
    const { codium, page } = await launch();
    try {
      // Cursor auf „increment“ in Zeile 4 setzen, dann zur Definition.
      const start = await wordAt(page, 'increment', /c\.increment/);
      await page.mouse.click(start.x, start.y);
      const origin = await position(page);
      expect(origin).toMatch(/^4:/);
      await expect
        .poll(
          async () => {
            if ((await activeTab(page)) === 'main.ts') await ctrlClick(page, 'increment', /c\.increment/).catch(() => {});
            await page.waitForTimeout(500);
            return activeTab(page);
          },
          { timeout: 30_000, interval: 500 },
        )
        .toBe('counter.ts');
      await expect.poll(() => position(page)).toBe('3:3');

      // Ctrl + Alt + Links: zurück an die Ausgangsstelle; Ctrl + Alt + Rechts wieder vor.
      await page.keyboard.press('Control+Alt+ArrowLeft');
      await expect.poll(() => activeTab(page)).toBe('main.ts');
      await expect.poll(() => position(page)).toBe(origin);
      await page.keyboard.press('Control+Alt+ArrowRight');
      await expect.poll(() => activeTab(page)).toBe('counter.ts');

      // Die Seitentaste „zurück“ der Maus (über das DevTools-Protokoll) wirkt gleich.
      const cdp = await page.context().newCDPSession(page);
      const box = (await page.locator('.editor-host').boundingBox())!;
      for (const type of ['mousePressed', 'mouseReleased'] as const) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: box.x + 50, y: box.y + 50, button: 'back', buttons: type === 'mousePressed' ? 8 : 0, clickCount: 1 });
      }
      await expect.poll(() => activeTab(page)).toBe('main.ts');
      await expect.poll(() => position(page)).toBe(origin);
    } finally {
      await codium.close();
    }
  });

  it('öffnet mit Ctrl + N eine Klasse und zeigt mit Ctrl + Leertaste Vorschläge', async () => {
    const { codium, page } = await launch();
    try {
      // Ctrl + N, Klassenname tippen, Enter: counter.ts an der Klasse.
      await expect
        .poll(
          async () => {
            await page.keyboard.press('Control+n');
            const popup = page.getByRole('dialog', { name: 'Go to Class' });
            await popup.waitFor();
            await page.keyboard.type('Counter');
            const found = await popup
              .getByRole('option', { name: 'Counter' })
              .waitFor({ timeout: 3000 })
              .then(() => true, () => false);
            if (found) await page.keyboard.press('Enter');
            else await page.keyboard.press('Escape');
            return found;
          },
          { timeout: 30_000, interval: 500 },
        )
        .toBe(true);
      await expect.poll(() => activeTab(page)).toBe('counter.ts');
      await expect.poll(() => position(page)).toBe('1:14');

      // Ctrl + Leertaste in main.ts nach „c.“: die Members von Counter.
      await page.locator('.editor-tab', { hasText: 'main.ts' }).click();
      await expect.poll(() => activeTab(page)).toBe('main.ts');
      await expect.poll(() => wordAt(page, 'value', /export const value/).then(() => true, () => false)).toBe(true);
      const end = await wordAt(page, 'value', /export const value/);
      await page.mouse.click(end.x, end.y);
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('c.');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+Space');
      const suggest = page.locator('.editor-host .suggest-widget.visible');
      await suggest.waitFor({ timeout: 15_000 });
      await expect.poll(() => suggest.innerText()).toContain('increment');
    } finally {
      await codium.close();
    }
  });
});
