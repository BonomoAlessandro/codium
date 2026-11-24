// Teststelle 2: Java in der echten App (Ticket 14): Ctrl + Linksklick auf eine JDK-Klasse öffnet sie schreibgeschützt
// mit Quelltext, und auch darin geht Ctrl + Linksklick weiter. Übersprungen ohne JDK 25, ohne jdtls oder ohne Netz.
// jdtls läuft im Testmodus nur mit CODIUM_TEST_JAVA=1 und eigenen Maven-Einstellungen.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { detectJdks } from '../../src/main/core/jdks';
import { javaTools } from '../../src/main/javaToolsPaths';
import { NodeSystem } from '../../src/main/system/nodeSystem';
import { launchCodium, prepareAppState } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

const REPO = path.resolve(__dirname, '..', '..');
const CACHE = path.join(REPO, '.test-cache', 'java');
const MAVEN_SETTINGS = path.join(CACHE, 'maven-settings.xml');
const online = spawnSync(process.execPath, ['-e', "fetch('https://repo1.maven.org/maven2/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"], { timeout: 20_000 }).status === 0;
const ready = javaTools(REPO, false) !== null && detectJdks(new NodeSystem(process.env)).some((j) => j.major >= 25) && online;

const MAIN = 'package demo;\n\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println(args.length);\n  }\n}\n';

function item(page: Page, name: string): Locator {
  return page.getByRole('tree', { name: 'Project Files' }).getByRole('treeitem', { name, exact: true });
}

async function activeTab(page: Page): Promise<string | null> {
  return page.locator('.editor-tab.active .editor-tab-name').first().textContent();
}

async function wordAt(page: Page, text: string, lineText: RegExp): Promise<{ x: number; y: number }> {
  const box = await page.evaluate(
    ([w, source]) => {
      const pattern = new RegExp(source as string);
      const line = [...document.querySelectorAll<HTMLElement>('.editor-host .view-line')].find((l) => pattern.test(l.innerText.replace(/ /g, ' ')));
      if (!line) return null;
      // Monaco teilt lange Abschnitte gleicher Farbe nach 50 Zeichen in mehrere Textknoten, etwa „…, CharSeq“ und
      // „uence,“, solange die Färbung des Sprachservers fehlt. Gesucht wird deshalb im Text der ganzen Zeile.
      const nodes: Text[] = [];
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
      const full = nodes.map((n) => n.data).join('');
      const index = full.indexOf(w as string);
      if (index < 0) return null;
      const at = (offset: number): [Text, number] => {
        let rest = offset;
        for (const node of nodes) {
          if (rest <= node.data.length) return [node, rest];
          rest -= node.data.length;
        }
        return [nodes[nodes.length - 1], nodes[nodes.length - 1].data.length];
      };
      const range = document.createRange();
      range.setStart(...at(index));
      range.setEnd(...at(index + (w as string).length));
      const r = range.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
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

/** Ob jdtls noch importiert („Importing Java project…“ unter den laufenden Arbeiten der Statusleiste). */
async function importing(page: Page): Promise<boolean> {
  return ((await page.locator('.status-progress').getAttribute('title')) ?? '').includes('Importing Java project');
}

/**
 * Ein Ctrl + Linksklick, dann warten, bis der erwartete Tab aktiv ist; ein weiterer Klick erst nach einer Minute ohne
 * Sprung. Früher klickte der Test jede Sekunde neu: Kam ein Sprung gerade während eines solchen Klicks an, traf der Klick
 * ein Wort in der eben geöffneten Datei, und der Cursor stand danach mitten im Javadoc (Ticket 27).
 */
async function jumpTo(page: Page, word: string, line: RegExp, tab: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    await ctrlClick(page, word, line);
    try {
      await expect.poll(() => activeTab(page), { timeout: 60_000, interval: 500 }).toBe(tab);
      return;
    } catch (err) {
      if (attempt === 3) throw err;
    }
  }
}

/** Die Zeile mit dem Cursor (nach der Statusleiste) und ihr Text ab dem Cursor. */
async function atCursor(page: Page): Promise<{ line: string; rest: string } | null> {
  const [lineNumber, column] = (await page.getByLabel('Line and column', { exact: true }).innerText()).split(':').map(Number);
  return page.evaluate(
    ([wanted, col]) => {
      // Zeilennummer und Zeile stehen in Monaco auf derselben Höhe.
      const number = [...document.querySelectorAll<HTMLElement>('.editor-host .line-numbers')].find((n) => n.textContent?.trim() === String(wanted));
      const top = number?.parentElement?.style.top;
      const view = [...document.querySelectorAll<HTMLElement>('.editor-host .view-line')].find((l) => top !== undefined && l.style.top === top);
      if (!view) return null;
      const text = view.innerText.replace(/ /g, ' ');
      return { line: text, rest: text.slice(col - 1) };
    },
    [lineNumber, column] as const,
  );
}

describe.skipIf(!ready)('Java im Editor', () => {
  const tempDir = useTempDirs();

  it('öffnet eine JDK-Klasse schreibgeschützt mit Quelltext; Ctrl + Linksklick geht darin weiter', { timeout: 400_000 }, async () => {
    const project = path.join(tempDir(), 'Hello');
    fs.mkdirSync(path.join(project, 'src', 'main', 'java', 'demo'), { recursive: true });
    fs.writeFileSync(
      path.join(project, 'pom.xml'),
      '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>ch.codium</groupId><artifactId>hello</artifactId><version>1.0</version><properties><maven.compiler.release>21</maven.compiler.release></properties></project>\n',
    );
    fs.writeFileSync(path.join(project, 'src', 'main', 'java', 'demo', 'Main.java'), MAIN);
    fs.mkdirSync(CACHE, { recursive: true });
    if (!fs.existsSync(MAVEN_SETTINGS)) {
      fs.writeFileSync(
        MAVEN_SETTINGS,
        `<settings><localRepository>${path.join(CACHE, 'maven-repository')}</localRepository><mirrors><mirror><id>central</id><mirrorOf>*</mirrorOf><url>https://repo1.maven.org/maven2</url></mirror></mirrors></settings>\n`,
      );
    }
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [project], recentProjects: [project] });
    const codium = await launchCodium({ dataRoot, env: { CODIUM_TEST_JAVA: '1', CODIUM_TEST_MAVEN_SETTINGS: MAVEN_SETTINGS } });
    try {
      const page = await codium.page('Hello – Codium');
      await item(page, 'src').dblclick({ timeout: 15_000 });
      await item(page, 'main').dblclick();
      await item(page, 'java').dblclick();
      await item(page, 'demo').dblclick();
      await item(page, 'Main.java').dblclick();
      await page.locator('.editor-host .view-lines').waitFor();

      // Klicks während des Imports beantwortet jdtls erst danach; so lange wartet der Test.
      await expect.poll(() => importing(page), { timeout: 240_000, interval: 1000 }).toBe(false);

      await jumpTo(page, 'String', /String\[\] args/, 'String.class');
      // Der Cursor steht auf dem Namen in der Deklaration, nicht auf Zeile 1 (Ticket 27): Kurz nach dem Import liefert
      // jdtls die ganze Datei als Ziel; der Sprach-Dienst fragt dann neu, bis er den Namen bekommt.
      await expect
        .poll(() => atCursor(page), { timeout: 15_000 })
        .toMatchObject({ line: expect.stringContaining('public final class String'), rest: expect.stringMatching(/^String\b/) });
      // Schreibgeschützt: Tippen ändert nichts.
      const before = await page.locator('.editor-host .view-lines').innerText();
      await page.locator('.editor-host .view-lines').click();
      await page.keyboard.type('xyz');
      expect(await page.locator('.editor-host .view-lines').innerText()).toBe(before);

      // Auch in der Klassendatei: Ctrl + Linksklick auf ein anderes JDK-Interface.
      await jumpTo(page, 'CharSequence', /implements .*CharSequence/, 'CharSequence.class');
      await expect
        .poll(() => atCursor(page), { timeout: 15_000 })
        .toMatchObject({ line: expect.stringContaining('interface CharSequence'), rest: expect.stringMatching(/^CharSequence\b/) });
    } finally {
      await codium.close();
    }
  });
});
