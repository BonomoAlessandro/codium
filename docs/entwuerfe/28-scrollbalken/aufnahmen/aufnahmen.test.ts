// Aufnahmen für die Entwürfe von Ticket 28 (Scrollbalken im Code-Bereich). Zeigt den heutigen Stand und Varianten,
// jeweils in Ruhe, beim Darüberfahren und beim Ziehen, aus dem verborgenen Testfenster (launchCodium, Testmodus).
// Die Varianten werden nur für die Aufnahme eingespielt: CSS über ein Style-Element und `updateOptions` an den
// Editoren.
//
// Achtung, seit dem Einbau von Variante B: Ohne Schalter gibt das Skript „heute“, A, B und C nicht mehr richtig
// wieder. Die eingebauten Regeln in app.css sind spezifischer als die eingespielten und gewinnen (Kapsel, Ausblenden,
// Streifen), und Monaco bekommt die eingebauten Optionen. Die Bilder dieser Fassungen entstanden vor dem Einbau und
// bleiben als Beleg liegen; nicht neu aufnehmen. Den heutigen Stand zeigt nur AUFNAHME_EINGEBAUT=1: Dann nimmt das
// Skript den eingebauten Stand auf (Bilder „eingebaut-…“), ohne etwas einzuspielen.
//
// Aufruf siehe vitest.config.mts in diesem Ordner. Die Bilder landen in ../bilder.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CDPSession, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { createRepoWithRemote } from '../../../../test/support/git';
import { launchCodium, prepareAppState } from '../../../../test/support/launchApp';
import { useTempDirs } from '../../../../test/support/tempDir';

const OUT = path.resolve(__dirname, '..', 'bilder');
const PROJECT = 'Inventory';

// ---------- Beispieldatei (erfunden) ----------

const TOPICS = [
  'Shelf', 'Pallet', 'Order', 'Supplier', 'Customer', 'Invoice', 'Shipment', 'Return', 'Batch', 'Zone', 'Label', 'Coupon',
  'Carrier', 'Parcel', 'Bundle', 'Voucher', 'Region', 'Store', 'Bin', 'Crate', 'Tote', 'Rack', 'Aisle', 'Dock', 'Lane',
  'Route', 'Driver', 'Truck', 'Depot', 'Hub', 'Kiosk', 'Outlet', 'Counter', 'Booth', 'Stand', 'Cart',
];

/** Die Datei, wie sie im letzten Commit steht: gut 380 Zeilen, zwei Typfehler, eine lange Zeile. */
function committedSource(): string {
  const lines = [
    '// Inventory: stock levels, prices and labels for a small warehouse.',
    '',
    'export interface Item {',
    '  sku: string;',
    '  name: string;',
    '  price: number;',
    '  quantity: number;',
    '}',
    '',
    'export const CURRENCY = "CHF";',
    '',
  ];
  TOPICS.forEach((topic, i) => {
    if (i % 4 === 1) lines.push(`// Keep a minimum stock of ${(i + 2) * 3} items per ${topic.toLowerCase()}.`);
    if (i === 13) {
      lines.push(
        `// Parcels are priced by weight class; the table below follows the carrier contract of the current season and is reviewed every quarter together with the purchasing team, so please keep the order of the entries stable.`,
      );
    }
    const wrong = i === 13 || i === 27;
    lines.push(
      `export function priceFor${topic}(item: Item, discount: number): number {`,
      '  const base = item.price * item.quantity;',
      wrong ? '  const reduced: string = base - base * discount;' : '  const reduced = base - base * discount;',
      '  return Math.round(reduced * 100) / 100;',
      '}',
      '',
      `export function describe${topic}(item: Item): string {`,
      '  return `${item.name} (${item.sku}): ${item.quantity} in stock`;',
      '}',
      '',
    );
  });
  return lines.join('\n');
}

/** Die Arbeitskopie: geänderte und neue Zeilen an mehreren Stellen, damit Änderungsbalken erscheinen. */
function workingSource(committed: string): string {
  const lines = committed.split('\n');
  const at = (text: string) => {
    const index = lines.indexOf(text);
    if (index < 0) throw new Error(`Zeile fehlt: ${text}`);
    return index;
  };
  // Geändert: Rundung bei „Batch“, Beschreibung bei „Bundle“ (im sichtbaren Bereich) und „Hub“.
  lines[at('export function priceForBatch(item: Item, discount: number): number {') + 3] = '  return Math.floor(reduced * 100) / 100;';
  lines[at('export function describeBundle(item: Item): string {') + 1] = '  return `${item.name} [${item.sku}]: ${item.quantity} left`;';
  lines[at('export function describeHub(item: Item): string {') + 1] = '  return `${item.name}: ${item.quantity} at the hub`;';
  // Neu: drei Zeilen nach „Tote“.
  lines.splice(at('export function describeTote(item: Item): string {'), 0, 'export function isEmptyTote(item: Item): boolean {', '  return item.quantity === 0;', '}', '');
  return lines.join('\n');
}

// ---------- Varianten ----------

interface Colors {
  rest: string;
  hover: string;
  active: string;
}

interface Variant {
  id: string;
  /** Optionen für alle Editoren; `null` lässt Monaco wie heute. */
  options: Record<string, unknown> | null;
  css: string;
}

interface CapsuleSpec {
  /** Greiffläche des senkrechten Schiebers (px), links im Balken. */
  area: number;
  /** Eigener Streifen für die Markierungen rechts (px); 0 heisst: Markierungen unter dem Schieber wie heute. */
  stripe: number;
  gap: number;
  rest: number;
  hover: number;
  /** Höhe des waagrechten Balkens (Greiffläche). */
  horizontalArea: number;
  colors: Colors;
  /** Schieber ausblenden, solange nicht gescrollt, darübergefahren oder gezogen wird. */
  hide: boolean;
  lanes: 1 | 2 | 3;
}

const SCROLLABLE = '.monaco-editor .monaco-scrollable-element';

function capsuleCss(s: CapsuleSpec): string {
  const css = [
    `${SCROLLABLE} > .scrollbar { background: transparent !important; }`,
    `${SCROLLABLE} > .scrollbar > .slider { background: transparent !important; }`,
    `${SCROLLABLE} > .scrollbar > .slider::before {
      content: ''; position: absolute; border-radius: 999px; background: ${s.colors.rest};
      transition: background-color 150ms linear, width 120ms ease-out, height 120ms ease-out, left 120ms ease-out, top 120ms ease-out, opacity 250ms linear;
    }`,
    // Senkrecht: Die Greiffläche bleibt so breit wie `area`, gezeichnet wird nur die Kapsel in der Mitte.
    `${SCROLLABLE} > .scrollbar.vertical > .slider { left: 0 !important; width: ${s.area}px !important; }`,
    `${SCROLLABLE} > .scrollbar.vertical > .slider::before { top: 2px; bottom: 2px; width: ${s.rest}px; left: ${(s.area - s.rest) / 2}px; }`,
    `${SCROLLABLE} > .scrollbar.vertical:hover > .slider::before, ${SCROLLABLE} > .scrollbar.vertical > .slider.active::before {
      width: ${s.hover}px; left: ${(s.area - s.hover) / 2}px;
    }`,
    // Waagrecht entsprechend.
    `${SCROLLABLE} > .scrollbar.horizontal > .slider::before { left: 2px; right: 2px; height: ${s.rest}px; top: ${(s.horizontalArea - s.rest) / 2}px; }`,
    `${SCROLLABLE} > .scrollbar.horizontal:hover > .slider::before, ${SCROLLABLE} > .scrollbar.horizontal > .slider.active::before {
      height: ${s.hover}px; top: ${(s.horizontalArea - s.hover) / 2}px;
    }`,
    `${SCROLLABLE} > .scrollbar:hover > .slider::before { background: ${s.colors.hover}; }`,
    `${SCROLLABLE} > .scrollbar > .slider.active::before { background: ${s.colors.active}; }`,
    // Vergleich: Der eckige Kasten in Monacos Vergleichsübersicht entfällt; die Lage zeigt die Kapsel des rechten Editors.
    `.monaco-diff-editor .diffViewport { background: transparent !important; }`,
  ];
  if (s.stripe > 0) {
    // Eigener Streifen: Monacos Übersichtsleiste nur ganz rechts (für die Aufnahme gestaucht gezeichnet).
    css.push(`.monaco-editor .decorationsOverviewRuler { width: ${s.stripe}px !important; }`);
  }
  if (s.hide) {
    css.push(
      `${SCROLLABLE} > .scrollbar > .slider::before { opacity: 0; }`,
      `${SCROLLABLE} > .scrollbar:hover > .slider::before, ${SCROLLABLE} > .scrollbar > .slider.active::before { opacity: 1; transition-duration: 150ms, 120ms, 120ms, 120ms, 120ms, 100ms; }`,
    );
  }
  return css.join('\n');
}

function capsuleOptions(s: CapsuleSpec): Record<string, unknown> {
  const width = s.stripe > 0 ? s.area + s.gap + s.stripe : s.area;
  return {
    overviewRulerLanes: s.lanes,
    scrollbar: {
      // Mit „visible“ bleibt die Fläche immer bedienbar (auch der Streifen); das Ausblenden macht das CSS.
      vertical: 'visible',
      horizontal: 'auto',
      useShadows: false,
      verticalScrollbarSize: width,
      verticalSliderSize: s.area,
      horizontalScrollbarSize: s.horizontalArea,
      horizontalSliderSize: s.horizontalArea,
    },
  };
}

/** Grau 10 des neuen IntelliJ-Designs „Dark“ (#b4b8bf), halb durchsichtig; auf der Editorfläche ergibt das etwa Grau 4, 6 und 7. */
const INTELLIJ: Colors = { rest: '#b4b8bf40', hover: '#b4b8bf66', active: '#b4b8bf8c' };
/** Etwas kräftiger: ergibt etwa Grau 5, dazwischen und Grau 8. */
const BRIGHTER: Colors = { rest: '#b4b8bf59', hover: '#b4b8bf80', active: '#b4b8bfa6' };

const SPECS: Record<string, CapsuleSpec> = {
  a: { area: 14, stripe: 0, gap: 0, rest: 6, hover: 8, horizontalArea: 12, colors: INTELLIJ, hide: false, lanes: 3 },
  b: { area: 10, stripe: 5, gap: 1, rest: 6, hover: 9, horizontalArea: 12, colors: INTELLIJ, hide: true, lanes: 1 },
  c: { area: 10, stripe: 7, gap: 1, rest: 8, hover: 10, horizontalArea: 12, colors: BRIGHTER, hide: false, lanes: 2 },
};

const TODAY_OPTIONS = {
  overviewRulerLanes: 3,
  scrollbar: { vertical: 'auto', horizontal: 'auto', useShadows: true, verticalScrollbarSize: 14, verticalSliderSize: 14, horizontalScrollbarSize: 12, horizontalSliderSize: 12 },
};

/** Nur den eingebauten Stand aufnehmen (nach Ticket 28). */
const BUILT = process.env.AUFNAHME_EINGEBAUT === '1';

const VARIANTS: Variant[] = BUILT
  ? [{ id: 'eingebaut', options: null, css: '' }]
  : [
      { id: 'heute', options: TODAY_OPTIONS, css: '' },
      ...Object.entries(SPECS).map(([id, spec]) => ({ id, options: capsuleOptions(spec), css: capsuleCss(spec) })),
    ];

// ---------- Hilfen in der Seite ----------

/**
 * Sucht die Monaco-Editoren der Seite über die internen Felder von React (Refs in den Hooks) und legt sie unter
 * `window.__aufnahmeEditors` ab. Nur für diese Aufnahmen; die App selbst bietet keinen Zugang.
 */
async function collectEditors(page: Page): Promise<number> {
  return page.evaluate(() => {
    const container = document.getElementById('root') as unknown as Record<string, unknown>;
    const key = Object.keys(container).find((k) => k.startsWith('__reactContainer$'));
    if (!key) throw new Error('Kein React-Root');
    type Fiber = { child: Fiber | null; sibling: Fiber | null; memoizedState: unknown; type: unknown; stateNode: { current: Fiber } };
    const start = (container[key] as Fiber).stateNode.current;
    const editors = new Set<{ updateOptions(o: object): void }>();
    const stack: Fiber[] = [start];
    while (stack.length > 0) {
      const fiber = stack.pop()!;
      if (typeof fiber.type === 'function' || (typeof fiber.type === 'object' && fiber.type !== null)) {
        let hook = fiber.memoizedState as { memoizedState: unknown; next: unknown } | null;
        while (hook && typeof hook === 'object' && 'next' in hook) {
          const state = hook.memoizedState as { current?: { updateOptions?: unknown } } | null;
          if (state && typeof state === 'object' && 'current' in state && state.current && typeof state.current.updateOptions === 'function') {
            editors.add(state.current as { updateOptions(o: object): void });
          }
          hook = hook.next as typeof hook;
        }
      }
      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    (window as unknown as { __aufnahmeEditors: unknown[] }).__aufnahmeEditors = [...editors];
    return editors.size;
  });
}

async function applyVariant(page: Page, variant: Variant): Promise<void> {
  await collectEditors(page);
  await page.evaluate(
    ({ css, options }) => {
      document.getElementById('aufnahme-variante')?.remove();
      if (css) {
        const style = document.createElement('style');
        style.id = 'aufnahme-variante';
        style.textContent = css;
        document.head.append(style);
      }
      const editors = (window as unknown as { __aufnahmeEditors: Array<{ updateOptions(o: object): void }> }).__aufnahmeEditors;
      for (const editor of editors) {
        if (options) editor.updateOptions(options);
        // Nur für die Aufnahmen: keine Hover-Fenster des Sprachservers, wenn die Maus auf dem Text ruht.
        editor.updateOptions({ hover: { enabled: false } });
      }
    },
    { css: variant.css, options: variant.options },
  );
  await page.waitForTimeout(400);
}

/** Der Vergleich: Scrollstand der rechten Seite setzen. */
async function diffScrollTo(page: Page, top: number): Promise<void> {
  await page.evaluate((scrollTop) => {
    const editors = (window as unknown as { __aufnahmeEditors: Array<Record<string, (...a: unknown[]) => unknown>> }).__aufnahmeEditors;
    const diff = editors.find((e) => typeof e.getModifiedEditor === 'function');
    if (!diff) throw new Error('Kein Vergleich');
    (diff.getModifiedEditor() as { setScrollTop(n: number): void }).setScrollTop(scrollTop);
  }, top);
}

/** Aufbau des Vergleichs am rechten Rand (für die Entwürfe: welche Teile es dort gibt). */
async function diffStructure(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector('.diff-host')!;
    const out: string[] = [];
    const left = host.getBoundingClientRect().x;
    for (const sb of host.querySelectorAll('.scrollbar.vertical')) {
      const editor = sb.closest('.editor')?.className ?? '?';
      const r = sb.getBoundingClientRect();
      const s = sb.querySelector('.slider')?.getBoundingClientRect();
      out.push(`Vergleich: senkrechter Balken in „${editor}“ bei x ${Math.round(r.x - left)}, ${r.width} px breit, Klasse „${sb.className}“, Schieber ${s?.width} px`);
    }
    for (const c of host.querySelectorAll('canvas.decorationsOverviewRuler')) {
      const r = c.getBoundingClientRect();
      out.push(`Vergleich: Übersichtsleiste in „${c.closest('.editor')?.className}“ bei x ${Math.round(r.x - left)}, ${r.width} px breit`);
    }
    const overview = host.querySelector('.diffOverview');
    if (overview) {
      const r = overview.getBoundingClientRect();
      const parts = [...overview.querySelectorAll('*')].map((c) => `${c.tagName.toLowerCase()}.${c.getAttribute('class')} ${Math.round(c.getBoundingClientRect().width)} px`);
      out.push(`Vergleich: eigene Übersicht (.diffOverview) bei x ${Math.round(r.x - left)}, ${r.width} px breit: ${parts.join('; ')}`);
    }
    out.push(`Vergleich: Breite gesamt ${host.getBoundingClientRect().width} px`);
    return out.join('\n');
  });
}

/** Der Editor im Code-Bereich (nicht der Vergleich). */
async function mainEditorCall<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ({ method, args }) => {
      const editors = (window as unknown as { __aufnahmeEditors: Array<Record<string, (...a: unknown[]) => unknown>> }).__aufnahmeEditors;
      const editor = editors.find((e) => typeof e.getDomNode === 'function' && (e.getDomNode() as HTMLElement | null)?.closest('.editor-host'));
      if (!editor) throw new Error('Kein Editor im Code-Bereich');
      return editor[method](...args) as T;
    },
    { method, args },
  );
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxes(page: Page, host: string): Promise<{ host: Box; slider: Box | null }> {
  return page.evaluate((selector) => {
    const plain = (r: DOMRect): Box => ({ x: r.x, y: r.y, width: r.width, height: r.height });
    const hostEl = document.querySelector(selector);
    if (!hostEl) throw new Error(`Fehlt: ${selector}`);
    const slider = hostEl.querySelector('.editor.modified .scrollbar.vertical > .slider') ?? hostEl.querySelector('.scrollbar.vertical > .slider');
    return { host: plain(hostEl.getBoundingClientRect()), slider: slider ? plain(slider.getBoundingClientRect()) : null };
  }, host);
}

/**
 * Bild eines Ausschnitts über die Entwicklerwerkzeuge der App (nur die eigene Seite). `scale` 1 nimmt die echte
 * Pixeldichte des Fensters, 2 das Doppelte davon (für die vergrösserten Ausschnitte).
 */
async function shot(cdp: CDPSession, name: string, clip: Box, scale = 1): Promise<void> {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale }, captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
}

/** Ein ganzer Bereich (Code-Bereich, Vergleich), höchstens `maxHeight` hoch. */
function whole(host: Box, maxHeight = Infinity): Box {
  return { x: Math.round(host.x), y: Math.round(host.y), width: Math.round(host.width), height: Math.round(Math.min(host.height, maxHeight)) };
}

/** Ausschnitt am rechten Rand um den Schieber (wird mit doppelter Pixeldichte aufgenommen, also 2×). */
function edgeZoom(host: Box, slider: Box | null): Box {
  const width = 104;
  const height = 300;
  const center = slider ? slider.y + slider.height / 2 : host.y + host.height / 2;
  const top = Math.max(host.y, Math.min(center - height / 2, host.y + host.height - height));
  return { x: Math.round(host.x + host.width - width), y: Math.round(top), width, height };
}

// ---------- Ablauf ----------

describe('Aufnahmen Ticket 28', () => {
  const tempDir = useTempDirs();

  it('nimmt den heutigen Stand und die Varianten auf', async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const base = tempDir();
    const repo = createRepoWithRemote(base, PROJECT);
    const committed = committedSource();
    const file = path.join(repo.repo, 'inventory.ts');
    fs.writeFileSync(file, committed);
    fs.writeFileSync(path.join(repo.repo, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'es2022', module: 'nodenext' } }, null, 2));
    // Viele kleine Dateien, damit der Dateibaum einen eigenen Scrollbalken zeigt (Vergleich ausserhalb von Monaco).
    fs.mkdirSync(path.join(repo.repo, 'fixtures'));
    for (let i = 1; i <= 60; i++) fs.writeFileSync(path.join(repo.repo, 'fixtures', `sample-${String(i).padStart(2, '0')}.json`), `{ "id": ${i} }\n`);
    repo.run('add', '.');
    repo.run('commit', '-m', 'Inventory');
    fs.writeFileSync(file, workingSource(committed));

    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [repo.repo], recentProjects: [repo.repo] });
    const codium = await launchCodium({ dataRoot });
    const log: string[] = [];
    try {
      const page = await codium.page(`${PROJECT} – Codium`);
      const tree = page.getByRole('tree', { name: 'Project Files' });
      await tree.getByRole('treeitem', { name: 'inventory.ts', exact: true }).dblclick({ timeout: 20_000 });
      await page.locator('.editor-host .view-lines').waitFor();
      log.push(`devicePixelRatio des Fensters: ${await page.evaluate(() => window.devicePixelRatio)}`);
      const cdp = await page.context().newCDPSession(page);

      expect(await collectEditors(page)).toBeGreaterThan(0);
      // Gegend mit Fehler, Änderung und langer Zeile in die Mitte holen.
      const lineHeight = await mainEditorCall<number>(page, 'getOption', 75 /* EditorOption.lineHeight */);
      const parcelLine = workingSource(committed).split('\n').findIndex((l) => l.startsWith('export function priceForParcel')) + 1;
      await mainEditorCall(page, 'setScrollTop', (parcelLine - 12) * lineHeight);
      await page.waitForTimeout(300);
      // Der Sprachserver meldet den Typfehler.
      await expect.poll(() => page.locator('.editor-host .squiggly-error').count(), { timeout: 90_000 }).toBeGreaterThan(0);
      await page.locator('.editor-host .change-bar.modified').first().waitFor({ timeout: 30_000 });
      // Cursor auf eine leere Zeile (Markierung der Cursorzeile, ohne hervorgehobene Wörter), dann Monacos Suche mit
      // Ctrl + F für die Suchtreffer.
      await mainEditorCall(page, 'focus');
      await mainEditorCall(page, 'setPosition', { lineNumber: parcelLine + 5, column: 1 });
      await page.keyboard.press('Control+F');
      await page.keyboard.type('minimum');
      await page.waitForTimeout(800);
      // Die Suche springt zum nächsten Treffer; danach wieder die Gegend um „Parcel“ zeigen (Treffer, Fehler, Änderung).
      const scrollTop = (parcelLine - 4) * lineHeight;

      for (const variant of VARIANTS) {
        await applyVariant(page, variant);
        await mainEditorCall(page, 'setScrollTop', scrollTop);
        await page.waitForTimeout(300);

        // In Ruhe: Maus über dem Text.
        let b = await boxes(page, '.editor-host');
        await page.mouse.move(b.host.x + 220, b.host.y + b.host.height * 0.6, { steps: 4 });
        await page.waitForTimeout(1500);
        b = await boxes(page, '.editor-host');
        await shot(cdp, `${variant.id}-ruhe`, whole(b.host));
        await shot(cdp, `${variant.id}-ruhe-rand`, edgeZoom(b.host, b.slider), 2);

        // Darüberfahren: Maus auf den Schieber.
        if (!b.slider) throw new Error(`Kein Schieber (${variant.id})`);
        const grip = { x: b.slider.x + Math.min(b.slider.width, 10) / 2, y: b.slider.y + b.slider.height / 2 };
        await page.mouse.move(grip.x, grip.y, { steps: 6 });
        await page.waitForTimeout(700);
        b = await boxes(page, '.editor-host');
        await shot(cdp, `${variant.id}-darueber`, whole(b.host));
        await shot(cdp, `${variant.id}-darueber-rand`, edgeZoom(b.host, b.slider), 2);

        // Ziehen: Maustaste halten und 90 px nach unten.
        const before = await mainEditorCall<number>(page, 'getScrollTop');
        await page.mouse.down();
        await page.mouse.move(grip.x, grip.y + 90, { steps: 10 });
        await page.waitForTimeout(500);
        b = await boxes(page, '.editor-host');
        await shot(cdp, `${variant.id}-ziehen`, whole(b.host));
        await shot(cdp, `${variant.id}-ziehen-rand`, edgeZoom(b.host, b.slider), 2);
        const after = await mainEditorCall<number>(page, 'getScrollTop');
        await page.mouse.up();
        log.push(`${variant.id}: Ziehen scrollt von ${before} auf ${after} px; Schieber ${JSON.stringify(b.slider)}`);
        expect(after).toBeGreaterThan(before);
      }

      // Vergleichsansicht: heute und je Variante in Ruhe.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Alt+0');
      const changes = page.getByRole('tree', { name: 'Changes' }).getByRole('treeitem', { name: 'inventory.ts', exact: true });
      await changes.waitFor({ timeout: 20_000 });
      await changes.dblclick();
      await page.locator('.diff-host .editor.modified .view-lines').waitFor({ timeout: 20_000 });
      await page.keyboard.press('Alt+0');
      await page.waitForTimeout(800);
      await collectEditors(page);
      for (const variant of VARIANTS) {
        await applyVariant(page, variant);
        await diffScrollTo(page, (parcelLine - 4) * lineHeight);
        log.push(`${variant.id}:\n${await diffStructure(page)}`);
        const b = await boxes(page, '.diff-host');
        await page.mouse.move(b.host.x + b.host.width * 0.8, b.host.y + 60, { steps: 4 });
        await page.waitForTimeout(1500);
        await shot(cdp, `${variant.id}-vergleich`, whole(b.host, 420));
        await shot(cdp, `${variant.id}-vergleich-rand`, { x: Math.round(b.host.x + b.host.width - 140), y: Math.round(b.host.y + 60), width: 140, height: 220 }, 2);
        if (BUILT && b.slider) {
          // Eingebaut ist die Kapsel in Ruhe ausgeblendet; zusätzlich beim Darüberfahren über den rechten Editor.
          await page.mouse.move(b.slider.x + 5, b.slider.y + b.slider.height / 2, { steps: 4 });
          await page.waitForTimeout(800);
          const edge = { x: Math.round(b.host.x + b.host.width - 140), y: Math.round(Math.max(b.host.y, b.slider.y - 80)), width: 140, height: 220 };
          await shot(cdp, `${variant.id}-vergleich-darueber`, whole(b.host, 420));
          await shot(cdp, `${variant.id}-vergleich-darueber-rand`, edge, 2);
          // Und beim Darüberfahren über Monacos Vergleichsübersicht ganz rechts: Die Kapsel des rechten Editors zeigt die
          // Lage.
          const overview = (await page.locator('.diff-host .diffOverview').boundingBox())!;
          await page.mouse.move(b.host.x + b.host.width * 0.8, b.host.y + 60, { steps: 4 });
          await page.waitForTimeout(800);
          await page.mouse.move(overview.x + overview.width / 2, b.slider.y + b.slider.height / 2, { steps: 4 });
          await page.waitForTimeout(800);
          await shot(cdp, `${variant.id}-vergleich-uebersicht-rand`, edge, 2);
        }
      }
      await applyVariant(page, VARIANTS[0]!);
      // Vom eingebauten Stand nur Code-Bereich und Vergleich.
      if (BUILT) return;

      // Ausserhalb von Monaco: Dateibaum mit vielen Dateien (ohne die Zeile des Projekts, die den Temp-Pfad zeigt).
      await page.keyboard.press('Alt+1');
      await tree.getByRole('treeitem', { name: 'fixtures', exact: true }).dblclick();
      await tree.getByRole('treeitem', { name: 'sample-01.json', exact: true }).waitFor({ timeout: 10_000 });
      const treeBox = await page.evaluate(() => {
        const t = document.querySelector('[role="tree"][aria-label="Project Files"]')!.getBoundingClientRect();
        const second = document.querySelectorAll('[role="tree"][aria-label="Project Files"] [role="treeitem"]')[1]!.getBoundingClientRect();
        return { x: t.x, y: second.y, width: t.width, height: Math.min(t.bottom - second.y, 360) };
      });
      const treeClip = { x: Math.round(treeBox.x), y: Math.round(treeBox.y), width: Math.round(treeBox.width), height: Math.round(treeBox.height) };
      await page.mouse.move(treeBox.x + 60, treeBox.y + 100);
      await page.waitForTimeout(1200);
      await shot(cdp, 'aussen-baum-ruhe', treeClip);
      await page.mouse.move(treeBox.x + treeBox.width - 4, treeBox.y + 60, { steps: 4 });
      await page.waitForTimeout(1200);
      await shot(cdp, 'aussen-baum-darueber', treeClip);

      // Terminal (xterm.js hat einen eigenen Scrollbalken). Die Eingabeaufforderung ohne Pfad, damit kein Temp-Pfad
      // im Bild steht.
      await page.keyboard.press('Alt+F12');
      const rows = page.locator('.terminal-view:not([hidden]) .xterm-rows');
      await expect.poll(async () => (await rows.innerText()).replace(/\u00a0/g, ' '), { timeout: 30_000 }).toMatch(/>\s*$/m);
      await page.keyboard.type('prompt $G');
      await page.keyboard.press('Enter');
      await page.keyboard.type('cls');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.keyboard.type('for /L %i in (1,1,150) do @echo line %i');
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await rows.innerText()).replace(/\u00a0/g, ' '), { timeout: 30_000 }).toContain('line 150');
      const termBox = await page.evaluate(() => {
        const el = document.querySelector('.terminal-view:not([hidden])')!.getBoundingClientRect();
        return { x: el.x, y: el.y, width: el.width, height: el.height };
      });
      const termClip = { x: Math.round(termBox.x + termBox.width - 220), y: Math.round(termBox.y), width: 220, height: Math.round(termBox.height) };
      await page.mouse.move(termBox.x + 100, termBox.y + termBox.height / 2, { steps: 4 });
      await page.waitForTimeout(1200);
      await shot(cdp, 'aussen-terminal-ruhe', termClip, 2);
      await page.mouse.move(termBox.x + termBox.width - 6, termBox.y + termBox.height - 20, { steps: 4 });
      await page.waitForTimeout(1200);
      await shot(cdp, 'aussen-terminal-darueber', termClip, 2);

      // Was die Scrollbalken ausserhalb von Monaco heute tragen (für den Bericht).
      log.push(
        await page.evaluate(() => {
          const tree = document.querySelector('[role="tree"][aria-label="Project Files"]') as HTMLElement;
          const scroller = (el: HTMLElement | null): HTMLElement | null => {
            for (let e = el; e; e = e.parentElement) if (/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight) return e;
            return null;
          };
          const s = scroller(tree);
          const cs = s ? getComputedStyle(s) : null;
          return `Baum: Scroll-Element ${s?.className ?? '?'}, scrollbar-width ${cs?.scrollbarWidth}, scrollbar-color ${cs?.scrollbarColor}, Breite ${s ? s.offsetWidth - s.clientWidth : '?'} px`;
        }),
      );
    } finally {
      fs.writeFileSync(path.join(OUT, BUILT ? 'aufnahmen-eingebaut.txt' : 'aufnahmen.txt'), `${log.join('\n')}\n`);
      await codium.close();
    }
  });
});
