// Teststelle 2: Scrollbalken der Monaco-Editoren wie in IntelliJ (Ticket 28, Variante B) in der echten App, mit einer
// langen Datei in einem Temp-Repository: Kapsel mit den freigegebenen Massen und Farben (senkrecht und waagrecht),
// Ziehen, Ausblenden, eigener Streifen mit den Markierungen (Git-Änderung, Suchtreffer) und dieselben Scrollbalken in
// der Vergleichsansicht. Die Vorschau im Peek prüft typescript.test.ts, die der Projektsuche search.test.ts und den
// Zelleditor databaseTables.test.ts.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { EDITOR_SCROLLBAR, EDITOR_SCROLLBAR_WIDTH } from '../../src/renderer/editor/theme';
import { createRepoWithRemote } from '../support/git';
import { launchCodium, prepareAppState, type LaunchedApp } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

const LINES = 300;
const CHANGED_LINE = 200;
const NEEDLE_LINES = [40, 150, 260];
/** Eine lange Zeile oben, damit es einen waagrechten Balken gibt. */
const LONG_LINE = 5;

function committedText(): string {
  return Array.from({ length: LINES }, (_, i) => {
    const n = i + 1;
    if (n === LONG_LINE) return `line ${n}: ${'a very long description of the shelf, '.repeat(12)}end`;
    return NEEDLE_LINES.includes(n) ? `line ${n}: needle in the stock list` : `line ${n}: shelf ${n % 7}, pallet ${n % 11}`;
  }).join('\n');
}

function workingText(): string {
  const lines = committedText().split('\n');
  lines[CHANGED_LINE - 1] = `line ${CHANGED_LINE}: changed after the commit`;
  return lines.join('\n');
}

function treeItem(page: Page, name: string): Locator {
  return page.getByRole('tree', { name: 'Project Files' }).getByRole('treeitem', { name, exact: true });
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ThumbState {
  /** Gezeichnete Kapsel (`::before` am Schieber). */
  width: number;
  height: number;
  radius: number;
  color: [number, number, number, number];
  opacity: number;
  active: boolean;
  bar: Box;
  slider: Box;
  stripe: Box | null;
  scrolling: boolean;
}

/** Zustand des senkrechten (bzw. waagrechten) Scrollbalkens im ersten Editor unter `host`. */
async function thumb(page: Page, host: string, axis: 'vertical' | 'horizontal' = 'vertical'): Promise<ThumbState> {
  const state = await page.evaluate(
    ({ selector, axis }) => {
      const box = (el: Element): Box => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      const editor = document.querySelector(`${selector} .monaco-editor`);
      const bar = editor?.querySelector(`.editor-scrollable > .scrollbar.${axis}`);
      const slider = bar?.querySelector(':scope > .slider');
      if (!editor || !bar || !slider) return null;
      const before = getComputedStyle(slider, '::before');
      const color = (/rgba?\(([^)]+)\)/.exec(before.backgroundColor)?.[1] ?? '').split(',').map((v) => parseFloat(v));
      const stripe = editor.querySelector('canvas.decorationsOverviewRuler');
      return {
        width: parseFloat(before.width),
        height: parseFloat(before.height),
        radius: parseFloat(before.borderTopLeftRadius),
        color: [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, color[3] ?? 1] as [number, number, number, number],
        opacity: parseFloat(before.opacity),
        active: slider.classList.contains('active'),
        bar: box(bar),
        slider: box(slider),
        stripe: stripe ? box(stripe) : null,
        scrolling: editor.hasAttribute('data-codium-scrolling'),
      };
    },
    { selector: host, axis },
  );
  if (!state) throw new Error(`Kein Scrollbalken (${axis}) unter ${host}`);
  return state;
}

/** Erwartete Farbe als [r, g, b, Deckkraft] aus `#rrggbbaa`. */
function expected(color: string): [number, number, number, number] {
  const hex = (i: number) => parseInt(color.slice(i, i + 2), 16);
  return [hex(1), hex(3), hex(5), hex(7) / 255];
}

function sameColor(actual: [number, number, number, number], color: string): boolean {
  const want = expected(color);
  return actual.slice(0, 3).every((v, i) => v === want[i]) && Math.abs(actual[3] - want[3]) < 0.01;
}

/** Sichtbarer Text des Code-Bereichs, ohne die geschützten Leerzeichen von Monaco. */
async function editorText(page: Page): Promise<string> {
  return (await page.locator('.editor-host .view-lines').innerText()).replace(/\u00a0/g, ' ');
}

/** Kleinste sichtbare Zeilennummer im Code-Bereich. */
async function firstVisibleLine(page: Page): Promise<number> {
  return page.evaluate(() => {
    const top = document.querySelector('.editor-host')!.getBoundingClientRect().top;
    const numbers = [...document.querySelectorAll<HTMLElement>('.editor-host .line-numbers')]
      .filter((el) => el.getBoundingClientRect().top >= top - 1)
      .map((el) => Number(el.textContent));
    return Math.min(...numbers);
  });
}

/**
 * Zeilen (in CSS-Pixeln der Seite) des Streifens mit einer Markierung dieser Art. Die Übersichtsleiste ist eine
 * Leinwand; gelesen wird ihre Mitte.
 * - `modified`: geänderte Zeilen (Ticket 17), deckend blau `#375fad`.
 * - `find`: Suchtreffer, Monacos halb durchsichtiges Orange (`editorOverviewRuler.findMatchForeground`). Es liegt
 *   über anderen Markierungen derselben Zeile (etwa dem Grau der hervorgehobenen Vorkommen), deshalb nur nach dem
 *   Farbton: deutlich mehr Rot als Grün, deutlich mehr Grün als Blau (Rot für Fehler hat gleich viel Grün und Blau).
 */
async function stripeMarks(page: Page, host: string, kind: 'modified' | 'find'): Promise<number[]> {
  return page.evaluate(
    ({ selector, kind }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(`${selector} .monaco-editor canvas.decorationsOverviewRuler`);
      const context = canvas?.getContext('2d');
      if (!canvas || !context || canvas.width === 0) return [];
      const x = Math.floor(canvas.width / 2);
      const data = context.getImageData(x, 0, 1, canvas.height).data;
      const rect = canvas.getBoundingClientRect();
      const matches = (r: number, g: number, b: number) =>
        kind === 'modified' ? Math.abs(r - 0x37) <= 4 && Math.abs(g - 0x5f) <= 4 && Math.abs(b - 0xad) <= 4 : r - b > 60 && g - b > 40 && r > g;
      const rows: number[] = [];
      for (let y = 0; y < canvas.height; y++) {
        const [r, g, b, a] = [data[y * 4]!, data[y * 4 + 1]!, data[y * 4 + 2]!, data[y * 4 + 3]!];
        if (a > 0 && matches(r, g, b)) rows.push(rect.top + ((y + 0.5) / canvas.height) * rect.height);
      }
      return rows;
    },
    { selector: host, kind },
  );
}

describe('Scrollbalken der Editoren (Ticket 28)', () => {
  const tempDir = useTempDirs();

  async function launch(): Promise<{ codium: LaunchedApp; page: Page; repo: ReturnType<typeof createRepoWithRemote> }> {
    const repo = createRepoWithRemote(tempDir(), 'Stock');
    const file = path.join(repo.repo, 'stock.txt');
    fs.writeFileSync(file, committedText());
    repo.run('add', 'stock.txt');
    repo.run('commit', '-m', 'Liste');
    fs.writeFileSync(file, workingText());
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [repo.repo], recentProjects: [repo.repo] });
    const codium = await launchCodium({ dataRoot });
    const page = await codium.page('Stock – Codium');
    await treeItem(page, 'stock.txt').dblclick({ timeout: 15_000 });
    await page.locator('.editor-host .view-lines').waitFor();
    await expect.poll(() => editorText(page), { timeout: 15_000 }).toContain('line 1:');
    return { codium, page, repo };
  }

  it('Kapsel wie freigegeben: 6 px und rund, auch waagrecht, Farben in Ruhe und beim Darüberfahren, ausgeblendet ohne Scrollen, Ziehen scrollt', async () => {
    const { codium, page } = await launch();
    try {
      // Rand: 16 px, der Schieber in der Greiffläche links, der Streifen ganz rechts.
      let state = await thumb(page, '.editor-host');
      expect(state.bar.width).toBeCloseTo(EDITOR_SCROLLBAR_WIDTH, 1);
      expect(state.slider.x).toBeCloseTo(state.bar.x, 1);
      expect(state.slider.width).toBeCloseTo(EDITOR_SCROLLBAR.grip, 1);
      expect(state.stripe).not.toBeNull();
      expect(state.stripe!.width).toBeCloseTo(EDITOR_SCROLLBAR.stripe, 1);
      expect(state.stripe!.x + state.stripe!.width).toBeCloseTo(state.bar.x + state.bar.width, 1);

      // In Ruhe (Maus über dem Text, nicht gescrollt): Kapsel 6 px, ganz gerundet, Farbe wie IntelliJ, ausgeblendet.
      const host = (await page.locator('.editor-host').boundingBox())!;
      await page.mouse.move(host.x + 200, host.y + 200);
      await expect.poll(async () => (await thumb(page, '.editor-host')).opacity, { timeout: 10_000 }).toBe(0);
      state = await thumb(page, '.editor-host');
      expect(state.width).toBe(EDITOR_SCROLLBAR.thumb);
      expect(state.radius).toBeGreaterThanOrEqual(state.width / 2);
      expect(sameColor(state.color, EDITOR_SCROLLBAR.color), `Farbe in Ruhe ${state.color}`).toBe(true);

      // Der waagrechte Balken (lange Zeile oben) entsprechend: 12 px hoch, Kapsel 6 px, beim Darüberfahren 9 px und heller.
      let across = await thumb(page, '.editor-host', 'horizontal');
      expect(across.bar.height).toBeCloseTo(EDITOR_SCROLLBAR.horizontal, 1);
      expect(across.height).toBe(EDITOR_SCROLLBAR.thumb);
      expect(across.radius).toBeGreaterThanOrEqual(across.height / 2);
      expect(across.opacity).toBe(0);
      expect(sameColor(across.color, EDITOR_SCROLLBAR.color)).toBe(true);
      await page.mouse.move(across.slider.x + across.slider.width / 2, across.slider.y + across.slider.height / 2, { steps: 4 });
      await expect.poll(async () => (await thumb(page, '.editor-host', 'horizontal')).height, { timeout: 10_000 }).toBe(EDITOR_SCROLLBAR.thumbHover);
      await expect.poll(async () => sameColor((await thumb(page, '.editor-host', 'horizontal')).color, EDITOR_SCROLLBAR.hoverColor), { timeout: 10_000 }).toBe(true);
      across = await thumb(page, '.editor-host', 'horizontal');
      expect(across.opacity).toBe(1);
      expect(across.radius).toBeGreaterThanOrEqual(EDITOR_SCROLLBAR.thumbHover / 2);

      // Darüberfahren: sichtbar, 9 px, heller.
      const grip = { x: state.slider.x + state.slider.width / 2, y: state.slider.y + state.slider.height / 2 };
      await page.mouse.move(grip.x, grip.y, { steps: 4 });
      await expect.poll(async () => (await thumb(page, '.editor-host')).opacity, { timeout: 10_000 }).toBe(1);
      await expect.poll(async () => (await thumb(page, '.editor-host')).width, { timeout: 10_000 }).toBe(EDITOR_SCROLLBAR.thumbHover);
      await expect.poll(async () => sameColor((await thumb(page, '.editor-host')).color, EDITOR_SCROLLBAR.hoverColor), { timeout: 10_000 }).toBe(true);
      expect((await thumb(page, '.editor-host')).radius).toBeGreaterThanOrEqual(EDITOR_SCROLLBAR.thumbHover / 2);

      // Ziehen: Der Editor scrollt mit, die Kapsel ist noch heller.
      const before = await firstVisibleLine(page);
      expect(before).toBe(1);
      await page.mouse.down();
      await page.mouse.move(grip.x, grip.y + 120, { steps: 8 });
      await expect.poll(async () => (await thumb(page, '.editor-host')).active).toBe(true);
      await expect.poll(async () => sameColor((await thumb(page, '.editor-host')).color, EDITOR_SCROLLBAR.activeColor), { timeout: 10_000 }).toBe(true);
      expect((await thumb(page, '.editor-host')).opacity).toBe(1);
      await expect.poll(() => firstVisibleLine(page), { timeout: 10_000 }).toBeGreaterThan(before + 20);
      await page.mouse.up();

      // Zurück über den Text: Die Kapsel blendet aus; beim Scrollen mit dem Mausrad erscheint sie und geht danach wieder.
      await page.mouse.move(host.x + 200, host.y + 200, { steps: 4 });
      await expect.poll(async () => (await thumb(page, '.editor-host')).opacity, { timeout: 10_000 }).toBe(0);
      await page.mouse.wheel(0, 400);
      await expect.poll(async () => (await thumb(page, '.editor-host')).scrolling, { timeout: 5_000 }).toBe(true);
      await expect.poll(async () => (await thumb(page, '.editor-host')).opacity, { timeout: 5_000 }).toBe(1);
      // Sichtbar beim Scrollen, ohne dass die Maus auf dem Rand ist: die Farbe in Ruhe, 6 px.
      state = await thumb(page, '.editor-host');
      expect(sameColor(state.color, EDITOR_SCROLLBAR.color), `Farbe beim Scrollen ${state.color}`).toBe(true);
      expect(state.width).toBe(EDITOR_SCROLLBAR.thumb);
      await expect.poll(async () => (await thumb(page, '.editor-host')).scrolling, { timeout: 10_000 }).toBe(false);
      await expect.poll(async () => (await thumb(page, '.editor-host')).opacity, { timeout: 10_000 }).toBe(0);
    } finally {
      await codium.close();
    }
  });

  it('zeigt Git-Änderung und Suchtreffer im eigenen Streifen; ein Klick darauf springt hin', async () => {
    const { codium, page } = await launch();
    try {
      // Git-Änderung (blau, Ticket 17) im Streifen, weit unten in der Datei. Der Cursor steht auf „line“, das in jeder
      // Zeile vorkommt: Monaco hebt alle Vorkommen im Streifen grau hervor; die Änderung liegt darüber (zIndex in
      // changeBars.ts).
      await expect.poll(async () => (await stripeMarks(page, '.editor-host', 'modified')).length, { timeout: 15_000 }).toBeGreaterThan(0);
      const marks = await stripeMarks(page, '.editor-host', 'modified');
      const state = await thumb(page, '.editor-host');
      const markY = marks[Math.floor(marks.length / 2)]!;
      expect(markY).toBeGreaterThan(state.bar.y + state.bar.height / 2);
      expect(await firstVisibleLine(page)).toBe(1);

      // Klick in den Streifen auf die Markierung: Der Editor springt zur geänderten Zeile.
      await page.mouse.click(state.stripe!.x + state.stripe!.width / 2, markY);
      await expect.poll(() => editorText(page), { timeout: 10_000 }).toContain('changed after the commit');
      expect(await firstVisibleLine(page)).toBeGreaterThan(CHANGED_LINE - 40);

      // Suchtreffer (Monacos Suche, Ctrl + F) erscheinen im Streifen, einer je Fundstelle.
      const host = (await page.locator('.editor-host').boundingBox())!;
      await page.mouse.click(host.x + 200, host.y + 200);
      await page.keyboard.press('Control+F');
      await page.keyboard.type('needle');
      await expect.poll(async () => (await stripeMarks(page, '.editor-host', 'find')).length, { timeout: 10_000 }).toBeGreaterThan(0);
      const hits = await stripeMarks(page, '.editor-host', 'find');
      // Je Fundstelle eine Gruppe von Zeilen; die Cursorzeile darf eine davon in der Mitte überdecken.
      const groups = hits.filter((y, i) => i === 0 || y - hits[i - 1]! > 8);
      expect(groups.length).toBe(NEEDLE_LINES.length);
    } finally {
      await codium.close();
    }
  });

  it('die Vergleichsansicht hat dieselben Scrollbalken, ohne den eckigen Kasten der Vergleichsübersicht', async () => {
    const { codium, page } = await launch();
    try {
      await page.keyboard.press('Alt+0');
      const changes = page.getByRole('tree', { name: 'Changes' }).getByRole('treeitem', { name: 'stock.txt', exact: true });
      await changes.waitFor({ timeout: 15_000 });
      await changes.dblclick();
      const modified = '.diff-host .editor.modified';
      await page.locator(`${modified} .view-lines`).waitFor({ timeout: 15_000 });

      let state = await thumb(page, '.diff-host .editor.modified');
      expect(state.bar.width).toBeCloseTo(EDITOR_SCROLLBAR_WIDTH, 1);
      expect(state.slider.width).toBeCloseTo(EDITOR_SCROLLBAR.grip, 1);
      expect(state.stripe!.width).toBeCloseTo(EDITOR_SCROLLBAR.stripe, 1);
      expect(state.width).toBe(EDITOR_SCROLLBAR.thumb);
      expect(state.radius).toBeGreaterThanOrEqual(state.width / 2);
      expect(sameColor(state.color, EDITOR_SCROLLBAR.color)).toBe(true);

      await page.mouse.move(state.slider.x + state.slider.width / 2, state.slider.y + state.slider.height / 2, { steps: 4 });
      await expect.poll(async () => (await thumb(page, '.diff-host .editor.modified')).width, { timeout: 10_000 }).toBe(EDITOR_SCROLLBAR.thumbHover);
      state = await thumb(page, '.diff-host .editor.modified');
      expect(state.opacity).toBe(1);

      // Über dem Text blendet die Kapsel aus; beim Darüberfahren über die Vergleichsübersicht ganz rechts zeigt sie die
      // Lage.
      const text = (await page.locator(`${modified} .view-lines`).boundingBox())!;
      await page.mouse.move(text.x + 100, text.y + 100, { steps: 4 });
      await expect.poll(async () => (await thumb(page, modified)).opacity, { timeout: 10_000 }).toBe(0);
      const overview = (await page.locator('.diff-host .diffOverview').boundingBox())!;
      await page.mouse.move(overview.x + overview.width / 2, overview.y + overview.height / 2, { steps: 4 });
      await expect.poll(async () => (await thumb(page, modified)).opacity, { timeout: 10_000 }).toBe(1);

      // Monacos Vergleichsübersicht bleibt (rot und grün), aber ohne den Kasten für den sichtbaren Bereich.
      const viewport = await page.evaluate(() => {
        const el = document.querySelector('.diff-host .diffOverview .diffViewport');
        return el ? getComputedStyle(el).backgroundColor : null;
      });
      expect(viewport).toBe('rgba(0, 0, 0, 0)');
    } finally {
      await codium.close();
    }
  });
});
