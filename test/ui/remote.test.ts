// Teststelle 2: Push, Pull und Konflikte in der Oberfläche (Ticket 18), mit einem Temp-Repository, einem Bare-Remote
// im Temp-Ordner und einem zweiten Klon; abgeschirmte Git-Konfiguration, kein echter Server.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { createRepoWithRemote, git } from '../support/git';
import { launchCodium, prepareAppState } from '../support/launchApp';
import { useTempDirs } from '../support/tempDir';

function treeItem(page: Page, name: string): Locator {
  return page.getByRole('tree', { name: 'Project Files' }).getByRole('treeitem', { name, exact: true });
}

describe('Fetch, Pull und Push', () => {
  const tempDir = useTempDirs();

  async function launch(prepare: (repo: ReturnType<typeof createRepoWithRemote>, other: (...a: string[]) => string, otherDir: string) => void) {
    const base = tempDir();
    const repo = createRepoWithRemote(base);
    repo.run('config', 'pull.rebase', 'false');
    fs.writeFileSync(path.join(repo.repo, 'a.txt'), 'eins\nzwei\ndrei\n');
    repo.run('add', 'a.txt');
    repo.run('commit', '-m', 'a');
    repo.run('push');
    const otherDir = path.join(base, 'other');
    git(base, repo.env, 'clone', repo.remote, otherDir);
    const other = (...a: string[]) => git(otherDir, repo.env, ...a);
    prepare(repo, other, otherDir);
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [repo.repo], recentProjects: [repo.repo] });
    const codium = await launchCodium({ dataRoot });
    const page = await codium.page('repo – Codium');
    await treeItem(page, 'repo').waitFor({ timeout: 15_000 });
    return { ...repo, codium, page };
  }

  /** Ein Commit im zweiten Klon, auf den Remote geschoben. */
  function remoteCommit(other: (...a: string[]) => string, otherDir: string, file: string, text: string) {
    fs.writeFileSync(path.join(otherDir, file), text);
    other('add', file);
    other('commit', '-m', `remote ${file}`);
    other('push');
  }

  it('schiebt mit Ctrl + Shift + K bei Fokus im Editor einen neuen Branch und setzt den Upstream', async () => {
    const { codium, page, run, remote } = await launch((repo) => {
      repo.run('switch', '-c', 'feature');
      fs.writeFileSync(path.join(repo.repo, 'f.txt'), 'f\n');
      repo.run('add', 'f.txt');
      repo.run('commit', '-m', 'f');
    });
    try {
      await treeItem(page, 'a.txt').dblclick();
      await page.locator('.editor-host .view-lines').click();
      await page.keyboard.press('Control+Shift+K');
      await expect.poll(() => page.getByRole('status').filter({ hasText: 'Pushed feature to origin/feature' }).count(), { timeout: 30_000 }).toBe(1);
      expect(git(path.dirname(remote), {}, '--git-dir', remote, 'rev-parse', 'feature')).toBe(run('rev-parse', 'HEAD'));
      expect(run('rev-parse', '--abbrev-ref', 'feature@{upstream}')).toBe('origin/feature');
    } finally {
      await codium.close();
    }
  });

  it('zeigt nach einem Pull mit Konflikt „Merge in progress“ und die rote Datei; Auflösen und „Commit“ schliesst ab', async () => {
    const { codium, page, run, repo } = await launch((r, other, otherDir) => {
      remoteCommit(other, otherDir, 'a.txt', 'eins\nREMOTE\ndrei\n');
      fs.writeFileSync(path.join(r.repo, 'a.txt'), 'eins\nLOKAL\ndrei\n');
      r.run('commit', '-am', 'lokal');
    });
    try {
      await page.keyboard.press('Control+t');
      const banner = page.getByRole('status').filter({ hasText: 'Merge in progress' });
      await banner.waitFor({ timeout: 30_000 });
      const conflict = page.getByRole('group', { name: 'Merge Conflicts' }).getByRole('treeitem', { name: 'a.txt' });
      await conflict.waitFor();
      expect(await conflict.getAttribute('class')).toContain('git-conflict');
      // Die von Git vorbereitete Nachricht steht schon im Feld.
      const message = page.getByRole('textbox', { name: 'Commit Message' });
      await expect.poll(() => message.inputValue()).toMatch(/^Merge branch 'main' of /);

      // Im Editor auflösen.
      await page.keyboard.press('Alt+1');
      await treeItem(page, 'a.txt').dblclick();
      await expect.poll(() => page.locator('.editor-host .view-lines').innerText(), { timeout: 15_000 }).toContain('<<<<<<<');
      await page.locator('.editor-host .view-lines').click();
      await page.keyboard.press('Control+a');
      await page.keyboard.insertText('eins\nBEIDE\ndrei\n');
      await expect.poll(() => fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), { timeout: 15_000 }).toBe('eins\nBEIDE\ndrei\n');

      await page.keyboard.press('Alt+0');
      await page.locator('section[aria-label="Commit"]').getByRole('button', { name: 'Commit', exact: true }).click();
      await expect.poll(() => banner.count(), { timeout: 15_000 }).toBe(0);
      expect(run('log', '-1', '--format=%P').split(' ')).toHaveLength(2);
      expect(run('show', 'HEAD:a.txt')).toBe('eins\nBEIDE\ndrei');
    } finally {
      await codium.close();
    }
  });

  it('zeigt bei einem abgelehnten Push den Hinweis mit „Pull“; der Knopf holt die Änderungen', async () => {
    const { codium, page, repo } = await launch((r, other, otherDir) => {
      remoteCommit(other, otherDir, 'b.txt', 'b\n');
      fs.writeFileSync(path.join(r.repo, 'c.txt'), 'c\n');
      r.run('add', 'c.txt');
      r.run('commit', '-m', 'c');
    });
    try {
      await page.keyboard.press('Control+Shift+K');
      const alert = page.getByRole('alert').filter({ hasText: 'Push rejected' });
      await alert.waitFor({ timeout: 30_000 });
      await alert.getByRole('button', { name: 'Pull' }).click();
      await expect.poll(() => fs.existsSync(path.join(repo, 'b.txt')), { timeout: 30_000 }).toBe(true);
    } finally {
      await codium.close();
    }
  });
});
