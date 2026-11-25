// Teststelle 2: Branch-Anzeige und Branch-Dropdown nach Ticket 31 in der echten App: Präfixe als Ordner, Tastatur,
// Suchen, „Recent“ und die Breite in der Kopfzeile. Temp-Repository mit Bare-Remote im Temp-Ordner, abgeschirmte
// Git-Konfiguration, kein echter Server; Klicks und Tasten gehen nur über die Entwicklerwerkzeuge der App.

import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { createRepoWithRemote, type RepoWithRemote } from '../support/git';
import { launchCodium, prepareAppState, type LaunchedApp } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

/** Wartezeit für Abfragen an die App; die Grundeinstellung von expect.poll (1 s) reicht unter Last nicht. */
const APP = { timeout: 10_000 };

function branchButton(page: Page, name: string): Locator {
  return page.getByRole('button', { name: `Branch ${name}`, exact: true });
}

function dropdown(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Git Branches' });
}

/** Ein Bereich des Dropdowns: „Recent“, „Local“ oder „Remote“. */
function section(page: Page, name: 'Recent' | 'Local' | 'Remote'): Locator {
  return dropdown(page).getByRole('group', { name, exact: true });
}

/** Die Namen der Zeilen eines Bereichs (Ordner mit ihrem Namen, Branches mit dem vollen Namen), von oben nach unten. */
function labels(locator: Locator): Promise<Array<string | null>> {
  return locator.getByRole('option').evaluateAll((elements) => elements.map((e) => e.getAttribute('aria-label')));
}

function selectedLabel(page: Page): Promise<string | null> {
  return dropdown(page).locator('[role="option"][aria-selected="true"]').getAttribute('aria-label');
}

function focusedLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const result = await locator.boundingBox();
  if (!result) throw new Error('Element ist nicht sichtbar.');
  return result;
}

/** Breite und volle Breite des Texts (ungekürzt sind beide gleich). */
function textWidth(locator: Locator): Promise<{ client: number; scroll: number }> {
  return locator.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
}

/** Öffnet das Dropdown und wartet, bis die Branches geladen sind. */
async function openDropdown(page: Page, current: string): Promise<Locator> {
  await branchButton(page, current).click();
  await section(page, 'Local').waitFor();
  return dropdown(page);
}

async function closeDropdown(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect.poll(() => dropdown(page).count(), APP).toBe(0);
}

/** Wählt per Pfeil runter die Zeile mit diesem Namen. */
async function selectByKeyboard(page: Page, name: string): Promise<void> {
  for (let i = 0; i < 12 && (await selectedLabel(page)) !== name; i++) await page.keyboard.press('ArrowDown');
  expect(await selectedLabel(page)).toBe(name);
}

describe('Branch-Dropdown: Ordner, „Recent“ und Breite (Ticket 31)', () => {
  const tempDir = useTempDirs();

  /**
   * Ein Repository mit `main`, `feature/a`, `feature/b` und `bugfix/c`, alle auch auf dem Remote `origin`. `prepare`
   * läuft vor dem Start der App (etwa Wechsel für „Recent“).
   */
  async function launch(options: { projectName?: string; prepare?: (repo: RepoWithRemote) => void } = {}) {
    const name = options.projectName ?? 'repo';
    const repo = createRepoWithRemote(tempDir(), name);
    for (const branch of ['feature/a', 'feature/b', 'bugfix/c']) repo.run('branch', branch);
    repo.run('push', 'origin', 'feature/a', 'feature/b', 'bugfix/c');
    options.prepare?.(repo);
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [repo.repo], recentProjects: [repo.repo] });
    const codium = await launchCodium({ dataRoot });
    const page = await codium.page(`${name} – Codium`);
    await page.getByRole('button', { name: /^Branch / }).waitFor({ timeout: 15_000 });
    return { ...repo, codium, page };
  }

  /** Ändert die Fenstergrösse (bleibt im Testmodus ausserhalb des Bildschirms). */
  async function resize(codium: LaunchedApp, width: number, height: number): Promise<void> {
    await codium.app.evaluate(
      ({ BrowserWindow }, size) => {
        for (const w of BrowserWindow.getAllWindows()) w.setSize(size.width, size.height);
      },
      { width, height },
    );
  }

  it('zeigt Präfixe als Ordner; ein Klick klappt auf, der Checkout über die Zeile im Ordner gelingt', async () => {
    const { codium, page, run } = await launch();
    try {
      await openDropdown(page, 'main');
      const local = section(page, 'Local');
      // Ordner vor Branches, zu; ein Remote bildet die erste Ebene unter „Remote“.
      expect(await labels(local)).toEqual(['bugfix', 'feature', 'main']);
      expect(await labels(section(page, 'Remote'))).toEqual(['origin']);
      const feature = local.getByRole('option', { name: 'feature', exact: true });
      expect(await feature.getAttribute('aria-expanded')).toBe('false');
      expect(await feature.locator('.icon-folder').count()).toBe(1);
      expect(await local.getByRole('option', { name: 'bugfix', exact: true }).getAttribute('aria-expanded')).toBe('false');

      // Ein Klick klappt auf: darunter „a“ und „b“ ohne Präfix, eingerückt; der Tooltip nennt den vollen Namen.
      await feature.click();
      await expect.poll(() => labels(local), APP).toEqual(['bugfix', 'feature', 'feature/a', 'feature/b', 'main']);
      expect(await feature.getAttribute('aria-expanded')).toBe('true');
      const a = local.getByRole('option', { name: 'feature/a', exact: true });
      expect(await a.locator('.branch-row-name').innerText()).toBe('a');
      expect(await a.locator('.branch-row-name').getAttribute('title')).toBe('feature/a');
      expect((await box(a.locator('.branch-row-icon'))).x).toBeGreaterThan((await box(feature.locator('.branch-row-icon'))).x + 8);

      // Checkout über das Untermenü der Zeile im Ordner: Die Kopfzeile zeigt danach feature/a.
      await a.click();
      const submenu = page.getByRole('menu', { name: 'feature/a', exact: true });
      await submenu.getByRole('menuitem', { name: 'Checkout', exact: true }).click();
      await branchButton(page, 'feature/a').waitFor();
      expect(run('rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature/a');

      // Beim nächsten Öffnen ist der Ordner des aktuellen Branches offen, der Branch trägt sein Etikett.
      await openDropdown(page, 'feature/a');
      const current = local.getByRole('option', { name: 'feature/a', exact: true });
      expect(await current.locator('.icon-head').count()).toBe(1);
      expect(await current.getAttribute('class')).toContain('current');

      // Das Projektfenster merkt sich aufgeklappte Ordner für die Sitzung: „bugfix“ bleibt nach dem Schliessen offen.
      await local.getByRole('option', { name: 'bugfix', exact: true }).click();
      await local.getByRole('option', { name: 'bugfix/c', exact: true }).waitFor();
      await closeDropdown(page);
      await openDropdown(page, 'feature/a');
      expect(await labels(local)).toEqual(['bugfix', 'bugfix/c', 'feature', 'feature/a', 'feature/b', 'main']);

      // „feature“ zuklappen: Als Ordner des aktuellen Branches ist er beim nächsten Öffnen trotzdem offen, gemerkt wird er
      // aber nicht. Nach dem Wechsel auf main (über „Recent“) ist er zu, „bugfix“ offen (Review).
      await local.getByRole('option', { name: 'feature', exact: true }).click();
      await expect.poll(() => labels(local), APP).toEqual(['bugfix', 'bugfix/c', 'feature', 'main']);
      await closeDropdown(page);
      await openDropdown(page, 'feature/a');
      expect(await labels(local)).toEqual(['bugfix', 'bugfix/c', 'feature', 'feature/a', 'feature/b', 'main']);
      await section(page, 'Recent').getByRole('option', { name: 'main', exact: true }).click();
      await page.getByRole('menu', { name: 'main', exact: true }).getByRole('menuitem', { name: 'Checkout', exact: true }).click();
      await branchButton(page, 'main').waitFor();
      await openDropdown(page, 'main');
      expect(await labels(local)).toEqual(['bugfix', 'bugfix/c', 'feature', 'main']);
    } finally {
      await codium.close();
    }
  });

  it('bedient Ordner mit Pfeilen und Enter; Pfeil links springt zum Ordner, Pfeil rechts öffnet das Untermenü', async () => {
    const { codium, page } = await launch();
    try {
      await openDropdown(page, 'main');
      const local = section(page, 'Local');
      const bugfix = local.getByRole('option', { name: 'bugfix', exact: true });
      // Pfeil runter läuft von den Aktionen auf den ersten Ordner.
      await selectByKeyboard(page, 'bugfix');

      // Enter klappt auf und wieder zu.
      await page.keyboard.press('Enter');
      await expect.poll(() => bugfix.getAttribute('aria-expanded'), APP).toBe('true');
      await page.keyboard.press('Enter');
      await expect.poll(() => bugfix.getAttribute('aria-expanded'), APP).toBe('false');

      // Pfeil rechts klappt auf, ein zweites Mal geht es zum ersten Eintrag darin.
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => bugfix.getAttribute('aria-expanded'), APP).toBe('true');
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => selectedLabel(page), APP).toBe('bugfix/c');

      // Pfeil links auf dem Branch springt zum Ordner, ein zweites Mal klappt er zu.
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => selectedLabel(page), APP).toBe('bugfix');
      expect(await bugfix.getAttribute('aria-expanded')).toBe('true');
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => bugfix.getAttribute('aria-expanded'), APP).toBe('false');
      expect(await labels(local)).toEqual(['bugfix', 'feature', 'main']);

      // Pfeil runter läuft über Ordner- und Branchzeilen.
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => selectedLabel(page), APP).toBe('feature');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => selectedLabel(page), APP).toBe('feature/a');
      expect(await focusedLabel(page)).toBe('Search branches');

      // Pfeil rechts auf einer Branchzeile öffnet ihr Untermenü, mit dem vollen Namen.
      await page.keyboard.press('ArrowRight');
      const submenu = page.getByRole('menu', { name: 'feature/a', exact: true });
      await submenu.waitFor();
      expect(await submenu.getByRole('menuitem', { name: "New Branch from 'feature/a'…", exact: true }).count()).toBe(1);
      // Pfeil links schliesst es wieder; dann springt er zum Ordner.
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => submenu.count(), APP).toBe(0);
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => selectedLabel(page), APP).toBe('feature');
    } finally {
      await codium.close();
    }
  });

  it('zeigt beim Suchen nur die Treffer in offenen Ordnern; nach dem Leeren gilt wieder der gemerkte Zustand', async () => {
    const { codium, page } = await launch();
    try {
      const popup = await openDropdown(page, 'main');
      const local = section(page, 'Local');
      // Vorher „bugfix“ aufklappen: Das ist der gemerkte Zustand.
      await local.getByRole('option', { name: 'bugfix', exact: true }).click();
      await expect.poll(() => labels(local), APP).toEqual(['bugfix', 'bugfix/c', 'feature', 'main']);
      const search = popup.getByRole('textbox', { name: 'Search branches' });
      await search.fill('feat');
      await expect.poll(() => labels(local), APP).toEqual(['feature', 'feature/a', 'feature/b']);
      expect(await local.getByRole('option', { name: 'feature', exact: true }).getAttribute('aria-expanded')).toBe('true');
      // Der Treffer im Ordnernamen ist hervorgehoben; „bugfix“ und „main“ fehlen, ebenso die Aktionen.
      expect(await local.getByRole('option', { name: 'feature', exact: true }).locator('mark').innerText()).toBe('feat');
      expect(await popup.getByRole('option', { name: 'bugfix', exact: true }).count()).toBe(0);
      expect(await popup.getByRole('option', { name: 'Pull', exact: true }).count()).toBe(0);
      expect(await labels(section(page, 'Remote'))).toEqual(['origin', 'feature', 'origin/feature/a', 'origin/feature/b']);
      expect(await selectedLabel(page)).toBe('feature');

      // Mit Shift oder Ctrl gehören Pfeil links und rechts dem Suchfeld (markieren, wortweise springen); der Ordner
      // bleibt offen und gewählt (Review).
      const caret = () => search.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]);
      await search.evaluate((el: HTMLInputElement) => el.setSelectionRange(4, 4));
      await page.keyboard.press('Shift+ArrowLeft');
      expect(await caret()).toEqual([3, 4]);
      await page.keyboard.press('Control+ArrowLeft');
      expect(await caret()).toEqual([0, 0]);
      expect(await local.getByRole('option', { name: 'feature', exact: true }).getAttribute('aria-expanded')).toBe('true');
      expect(await selectedLabel(page)).toBe('feature');
      // Ohne sie klappt Pfeil links den Ordner zu, Pfeil rechts wieder auf; beim Filtern gilt das nur für diesen Suchtext.
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => labels(local), APP).toEqual(['feature']);
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => labels(local), APP).toEqual(['feature', 'feature/a', 'feature/b']);

      // Pfeil runter läuft auch hier über Ordner und Branches; Shift + Pfeil rechts auf einem Branch markiert im Suchfeld,
      // statt das Untermenü zu öffnen.
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => selectedLabel(page), APP).toBe('feature/a');
      await page.keyboard.press('Shift+ArrowRight');
      expect(await caret()).toEqual([0, 1]);
      expect(await page.getByRole('menu').count()).toBe(0);

      // Nach dem Leeren gilt wieder der gemerkte Zustand: „bugfix“ offen, „feature“ zu.
      await search.fill('');
      await expect.poll(() => labels(local), APP).toEqual(['bugfix', 'bugfix/c', 'feature', 'main']);
      expect(await local.getByRole('option', { name: 'feature', exact: true }).getAttribute('aria-expanded')).toBe('false');
      expect(await popup.getByRole('option', { name: 'Pull', exact: true }).count()).toBe(1);
    } finally {
      await codium.close();
    }
  });

  it('zeigt unter „Recent“ die zuletzt ausgecheckten Branches; gelöschte fallen weg, der Checkout von dort gelingt', async () => {
    const { codium, page, run } = await launch({
      prepare: (repo) => {
        // main → feature/a → bugfix/c → main, wie im Terminal
        repo.run('switch', 'feature/a');
        repo.run('switch', 'bugfix/c');
        repo.run('switch', 'main');
      },
    });
    try {
      const popup = await openDropdown(page, 'main');
      const recent = section(page, 'Recent');
      // Zwischen den Aktionen und „Local“, der neueste zuerst, mit vollem Namen, ohne den aktuellen Branch.
      expect(await popup.getByRole('group').evaluateAll((groups) => groups.map((g) => g.getAttribute('aria-label')))).toEqual(['Recent', 'Local', 'Remote']);
      expect(await labels(recent)).toEqual(['bugfix/c', 'feature/a']);
      expect(await recent.getByRole('option', { name: 'bugfix/c', exact: true }).locator('.branch-row-name').innerText()).toBe('bugfix/c');
      // Das Suchfeld filtert auch hier; ohne Treffer fehlt der Bereich.
      const search = popup.getByRole('textbox', { name: 'Search branches' });
      await search.fill('bug');
      await expect.poll(() => labels(recent), APP).toEqual(['bugfix/c']);
      await search.fill('mai');
      await expect.poll(() => recent.count(), APP).toBe(0);
      await closeDropdown(page);

      // Ein gelöschter Branch erscheint dort nicht mehr.
      run('branch', '-D', 'feature/a');
      await openDropdown(page, 'main');
      expect(await labels(recent)).toEqual(['bugfix/c']);

      // Checkout über die Zeile in „Recent“; danach steht main dort.
      await recent.getByRole('option', { name: 'bugfix/c', exact: true }).click();
      await page.getByRole('menu', { name: 'bugfix/c', exact: true }).getByRole('menuitem', { name: 'Checkout', exact: true }).click();
      await branchButton(page, 'bugfix/c').waitFor();
      expect(run('rev-parse', '--abbrev-ref', 'HEAD')).toBe('bugfix/c');
      await openDropdown(page, 'bugfix/c');
      expect(await labels(recent)).toEqual(['main']);
    } finally {
      await codium.close();
    }
  });

  it('zeigt den Branchnamen bis 560 px ungekürzt, kürzt längere und den Projektnamen ab 280 px', async () => {
    // Grossbuchstaben machen die Namen breit, ohne dass die Pfade unter .git/refs die Grenze von Windows erreichen.
    const medium = 'feature/ABC-1234-a-rather-long-description-of-the-change';
    const long = `${medium}-AND-SOME-MORE-WORDS-IN-CAPITALS`;
    const projectName = 'CODIUM-PROJECT-WITH-A-LONG-FOLDER-NAME';
    const { codium, page, run } = await launch({ projectName, prepare: (repo) => repo.run('switch', '-c', medium) });
    try {
      await resize(codium, 1400, 800);
      const label = branchButton(page, medium).locator('.header-widget-label');
      await expect.poll(async () => (await textWidth(label)).client, APP).toBeGreaterThan(280);
      const shown = await textWidth(label);
      expect(shown.scroll, 'Der Testname muss breiter als 280 px und schmaler als 560 px sein.').toBeLessThan(560);
      expect(shown.client).toBe(shown.scroll);
      expect(await branchButton(page, medium).getAttribute('title')).toBe(medium);

      // Der Projektname bleibt bei höchstens 280 px und wird gekürzt.
      const project = await textWidth(page.locator('.project-widget .header-widget-label'));
      expect(project.client).toBeLessThanOrEqual(280);
      expect(project.scroll).toBeGreaterThan(project.client);

      // Das Dropdown wird breiter, damit der lange Name auch dort ganz steht, und bleibt unter seiner Obergrenze.
      const popup = await openDropdown(page, medium);
      const width = (await box(popup)).width;
      expect(width).toBeGreaterThan(380);
      expect(width).toBeLessThanOrEqual(680);
      await section(page, 'Local').getByRole('option', { name: 'feature', exact: true }).waitFor();
      await closeDropdown(page);

      // Ein noch längerer Name wird bei 560 px gekürzt; der Tooltip nennt ihn ganz.
      run('switch', '-c', long);
      const longLabel = branchButton(page, long).locator('.header-widget-label');
      await longLabel.waitFor({ timeout: 15_000 });
      const cut = await textWidth(longLabel);
      expect(cut.scroll).toBeGreaterThan(560);
      expect(cut.client).toBeGreaterThan(550);
      expect(cut.client).toBeLessThanOrEqual(560);
      expect(await branchButton(page, long).getAttribute('title')).toBe(long);

      // Im schmalen Fenster wird er weiter gekürzt; rechts bleibt Zieh-Fläche frei, nichts reicht unter die Fensterknöpfe.
      await resize(codium, 720, 600);
      await expect.poll(async () => (await textWidth(longLabel)).client, APP).toBeLessThan(400);
      const layout = await page.evaluate(() => {
        const content = document.querySelector('.header-content')!.getBoundingClientRect();
        const widget = document.querySelector('.branch-widget')!.getBoundingClientRect();
        return { contentRight: content.right, widgetRight: widget.right, windowWidth: window.innerWidth };
      });
      expect(layout.widgetRight).toBeLessThanOrEqual(layout.contentRight - 48 + 0.5);
      expect(layout.contentRight).toBeLessThanOrEqual(layout.windowWidth);
    } finally {
      await codium.close();
    }
  });
});
