// Teststelle 2: Sprachfunktionen für TypeScript in der echten App (Ticket 12), mit dem mitgelieferten nativen Server
// von TypeScript 7 (das Beispielprojekt hat kein eigenes TypeScript).

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { launchCodium, prepareAppState } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

const SHAPES = 'Shapes – Codium';
const SHAPE = 'export interface Shape {\n  area(): number;\n}\n\n/** Doubles a number. */\nexport function double(x: number): number {\n  return x * 2;\n}\n';
const MAIN = "import { double } from './shape.js';\n\nexport const four = double(2);\nexport const six = double(3);\n";

function item(page: Page, name: string): Locator {
  return page.getByRole('tree', { name: 'Project Files' }).getByRole('treeitem', { name, exact: true });
}

async function activeTab(page: Page): Promise<string | null> {
  return page.locator('.editor-tab.active .editor-tab-name').first().textContent();
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
  // Wie von Hand: Ctrl halten, über das Wort fahren (Monaco unterstreicht es, sobald es ein Ziel gibt), klicken.
  await page.mouse.move(x - 3, y);
  await page.keyboard.down('Control');
  await page.mouse.move(x, y, { steps: 3 });
  await page.waitForTimeout(400);
  await page.mouse.click(x, y);
  await page.keyboard.up('Control');
}

describe('TypeScript im Editor', () => {
  const tempDir = useTempDirs();

  it('springt mit Ctrl + Linksklick zur Definition, zeigt auf der Deklaration die Verwendungen, Alt + F7 füllt „Find“', async () => {
    const project = path.join(tempDir(), 'Shapes');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'es2022', module: 'nodenext' } }));
    fs.writeFileSync(path.join(project, 'shape.ts'), SHAPE);
    fs.writeFileSync(path.join(project, 'main.ts'), MAIN);
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [project], recentProjects: [project] });
    const codium = await launchCodium({ dataRoot });
    try {
      const page = await codium.page(SHAPES);
      await item(page, 'main.ts').dblclick({ timeout: 15_000 });
      await page.locator('.editor-host .view-lines').waitFor();

      // Ctrl + Linksklick auf den Aufruf: shape.ts öffnet an der Definition. Der Server braucht beim ersten Mal etwas.
      await expect
        .poll(
          async () => {
            // Klickt nur, solange noch main.ts aktiv ist; der Sprung selbst kann einen Augenblick dauern.
            if ((await activeTab(page)) === 'main.ts') await ctrlClick(page, 'double', /four/).catch(() => {});
            await page.waitForTimeout(500);
            return activeTab(page);
          },
          { timeout: 30_000, interval: 500 },
        )
        .toBe('shape.ts');
      // Der Cursor steht auf dem Namen der Funktion (Zeile 6, Spalte 17).
      await expect.poll(() => page.getByLabel('Line and column').innerText()).toBe('6:17');

      // Ctrl + Linksklick auf die Deklaration selbst: die Verwendungen als Auswahl.
      const peek = page.locator('.editor-host .zone-widget .ref-tree');
      // Unter Last kann der erste Klick vor der Antwort des Servers kommen: wiederholen, bis die Auswahl da ist.
      await expect
        .poll(
          async () => {
            if ((await peek.count()) === 0) {
              await ctrlClick(page, 'double', /export function/).catch(() => {});
              // Nicht sofort wieder klicken: Ein zweiter Klick schlösse eine Auswahl, die gerade aufgeht.
              await peek.waitFor({ timeout: 3000 }).catch(() => {});
            }
            return peek.count();
          },
          { timeout: 30_000, interval: 500 },
        )
        .toBeGreaterThan(0);
      await expect.poll(() => peek.innerText()).toContain('main.ts');
      await page.keyboard.press('Escape');

      // Alt + F7 auf der Deklaration: ein Reiter im Werkzeugfenster „Find“ mit den Verwendungen.
      const decl = await wordAt(page, 'double', /export function/);
      await page.mouse.click(decl.x, decl.y);
      await page.keyboard.press('Alt+F7');
      const find = page.getByRole('tablist', { name: 'Find Results' }).getByRole('tab', { name: 'Usages of double' });
      await find.waitFor({ timeout: 15_000 });
      const results = page.locator('section[aria-label="Find"]');
      await expect.poll(() => results.innerText()).toContain('main.ts');
      await expect.poll(() => results.innerText()).toContain('export const six = double(3);');
    } finally {
      await codium.close();
    }
  });
});
