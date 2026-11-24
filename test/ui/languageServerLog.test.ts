// Teststelle 2 (Ticket 30): Nach vier Abstürzen des TypeScript-Servers in drei Minuten gibt Codium ihn auf und zeigt
// eine Meldung mit „Show Log“ und „Restart“. „Show Log“ öffnet das Protokoll der Sprachserver schreibgeschützt und lässt
// die Meldung stehen; „Restart“ startet den Server neu, ohne das Projekt neu zu öffnen, und Ctrl + Linksklick springt
// danach wieder zur Definition. Die Abstürze sind hier Prozesse, die der Test beendet (wie im langsamen Neustart-Test).

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { dataFolder } from '../../src/main/dataFolder';
import { launchCodium, prepareAppState } from '../support/launchApp';
import { listProcessesAsync } from '../support/processes';
import { useTempDirs } from '../support/tempDir';

const SHAPES = 'Shapes – Codium';
const SHAPE = 'export interface Shape {\n  area(): number;\n}\n\n/** Doubles a number. */\nexport function double(x: number): number {\n  return x * 2;\n}\n';
const MAIN = "import { double } from './shape.js';\n\nexport const four = double(2);\n";

function item(page: Page, name: string): Locator {
  return page.getByRole('tree', { name: 'Project Files' }).getByRole('treeitem', { name, exact: true });
}

function tabList(page: Page): Locator {
  return page.getByRole('tablist', { name: 'Editor Tabs' });
}

async function activeTab(page: Page): Promise<string | null> {
  if ((await tabList(page).count()) === 0) return null;
  return tabList(page).getByRole('tab', { selected: true }).getAttribute('aria-label');
}

async function editorText(page: Page): Promise<string> {
  return (await page.locator('.editor-host .view-lines').innerText()).replace(/ /g, ' ');
}

/** Mitte eines Wortes in der ersten Editorzeile, deren Text auf das Muster passt. */
async function wordAt(page: Page, text: string, lineText: RegExp): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ([w, source]) => {
      const pattern = new RegExp(source as string);
      const line = [...document.querySelectorAll<HTMLElement>('.editor-host .view-line')].find((l) => pattern.test(l.innerText.replace(/ /g, ' ')));
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
}

async function ctrlClick(page: Page, text: string, lineText: RegExp): Promise<void> {
  const at = await wordAt(page, text, lineText);
  if (!at) return;
  await page.mouse.move(at.x - 3, at.y);
  await page.keyboard.down('Control');
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await page.waitForTimeout(400);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Control');
}

/** Der native TypeScript-Server dieser Codium-Instanz (Kind ihres Hauptprozesses); `undefined`, wenn keiner läuft. */
async function serverPid(mainPid: number): Promise<number | undefined> {
  const table = await listProcessesAsync(['tsc.exe']);
  return table.find((p) => p.ppid === mainPid && /--lsp/.test(p.cmd))?.pid;
}

/** Ctrl + Linksklick auf den Aufruf in main.ts, bis shape.ts aktiv ist. */
async function jumpToDefinition(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        if ((await activeTab(page)) === 'main.ts') await ctrlClick(page, 'double', /four/).catch(() => {});
        await page.waitForTimeout(500);
        return activeTab(page);
      },
      { timeout: 30_000, interval: 500 },
    )
    .toBe('shape.ts');
}

describe('Sprachserver aufgegeben (Ticket 30)', () => {
  const tempDir = useTempDirs();

  it('„Show Log“ öffnet das Protokoll, „Restart“ startet den Server neu, und die Definition geht wieder', async () => {
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
      // Der Hauptprozess von Electron (Playwright startet ihn über einen Zwischenprozess).
      const mainPid = await codium.app.evaluate(() => process.pid);
      await item(page, 'main.ts').dblclick({ timeout: 15_000 });
      await page.locator('.editor-host .view-lines').waitFor();

      // Vier Abstürze in Folge: drei Neustarts, dann gibt Codium auf.
      let pid = await expect.poll(() => serverPid(mainPid), { timeout: 30_000 }).toBeDefined().then(() => serverPid(mainPid));
      for (let crash = 1; crash <= 4; crash++) {
        process.kill(pid!);
        if (crash === 4) break;
        const before = pid;
        await expect.poll(async () => (pid = await serverPid(mainPid)), { timeout: 30_000 }).not.toBe(before);
        expect(pid).toBeDefined();
      }
      const notice = page.getByRole('alert').filter({ hasText: 'The TypeScript language server stopped 4 times within three minutes' });
      await notice.waitFor({ timeout: 30_000 });
      expect(await notice.innerText()).toContain('and was not restarted. Click Restart to start it again.');
      expect(await serverPid(mainPid)).toBeUndefined();

      // „Show Log“: das Protokoll schreibgeschützt, der Cursor am letzten Eintrag; die Meldung bleibt stehen.
      await notice.getByRole('button', { name: 'Show Log' }).click();
      await expect.poll(() => activeTab(page)).toBe('language-servers.log');
      expect(await tabList(page).getByRole('tab', { name: 'language-servers.log' }).getAttribute('title')).toBe('language-servers.log – language server log (read-only)');
      await expect.poll(() => editorText(page)).toContain('TypeScript language server stopped unexpectedly');
      expect(await editorText(page)).toContain('Not restarted: it stopped 4 times within three minutes.');
      const log = fs.readFileSync(path.join(dataFolder(dataRoot, false), 'logs', 'language-servers.log'), 'utf8');
      expect(log.match(/stopped unexpectedly/g)).toHaveLength(4);
      const lastHeader = log.split('\n').reduce((last, line, i) => (line.startsWith('=== ') ? i : last), -1) + 1;
      expect(await page.getByLabel('Line and column', { exact: true }).innerText()).toBe(`${lastHeader}:1`);
      await page.keyboard.type('xyz');
      expect(await editorText(page)).not.toContain('xyz');
      expect(await notice.count()).toBe(1);

      // „Restart“: Die Meldung geht zu, der Server läuft wieder, und Ctrl + Linksklick springt zur Definition.
      await notice.getByRole('button', { name: 'Restart' }).click();
      await expect.poll(() => notice.count()).toBe(0);
      await expect.poll(() => serverPid(mainPid), { timeout: 30_000 }).toBeDefined();
      await tabList(page).getByRole('tab', { name: 'main.ts' }).click();
      await expect.poll(() => activeTab(page)).toBe('main.ts');
      await jumpToDefinition(page);
    } finally {
      await codium.close();
    }
  });
});
