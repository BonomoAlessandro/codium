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

/** Klickt, bis der erwartete Tab aktiv ist (jdtls importiert beim ersten Mal noch). */
async function jumpTo(page: Page, from: string, word: string, line: RegExp, tab: string): Promise<void> {
  await expect
    .poll(
      async () => {
        if ((await activeTab(page)) === from) await ctrlClick(page, word, line).catch(() => {});
        await page.waitForTimeout(1000);
        return activeTab(page);
      },
      { timeout: 240_000, interval: 1000 },
    )
    .toBe(tab);
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

      await jumpTo(page, 'Main.java', 'String', /String\[\] args/, 'String.class');
      await expect.poll(() => page.locator('.editor-host .view-lines').innerText().then((t) => t.replace(/ /g, ' '))).toContain('public final class String');
      // Schreibgeschützt: Tippen ändert nichts.
      const before = await page.locator('.editor-host .view-lines').innerText();
      await page.locator('.editor-host .view-lines').click();
      await page.keyboard.type('xyz');
      expect(await page.locator('.editor-host .view-lines').innerText()).toBe(before);

      // Auch in der Klassendatei: Ctrl + Linksklick auf ein anderes JDK-Interface.
      await jumpTo(page, 'String.class', 'CharSequence', /implements .*CharSequence/, 'CharSequence.class');
    } finally {
      await codium.close();
    }
  });
});
