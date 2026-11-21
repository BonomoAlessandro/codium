// Teststelle 1: was die Markdown-Vorschau vom Kern braucht: Bilder als Daten, Web-Adressen öffnen, Ansicht je Datei.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ErrorCode, MAX_PREVIEW_IMAGE_BYTES, type CommandArgs, type CommandName, type CommandResult } from '../../src/shared/types';
import { createTestCore, restart, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Kern für die Markdown-Vorschau', () => {
  const tempDir = useTempDirs();

  async function openAlpha(files: Record<string, string | Buffer> = {}) {
    const root = tempDir();
    const project = path.join(root, 'Alpha');
    fs.mkdirSync(project);
    for (const [relative, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(project, relative)), { recursive: true });
      fs.writeFileSync(path.join(project, relative), content);
    }
    const test = createTestCore(path.join(root, 'data'));
    await test.core.start();
    await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
    return { root, test, windowId: test.ports.windows.windowTitled('Alpha – Codium'), at: (...p: string[]) => path.join(project, ...p) };
  }

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  it('liefert ein Bild im Projekt als Daten und lehnt eines ausserhalb, eines über 10 MB und Nicht-Bilder ab', async () => {
    const { root, test, windowId, at } = await openAlpha({
      'docs/img/shot.png': PNG_1X1,
      'docs/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'notes.txt': 'kein Bild',
    });
    fs.writeFileSync(path.join(root, 'outside.png'), PNG_1X1);
    fs.writeFileSync(at('huge.png'), '');
    fs.truncateSync(at('huge.png'), MAX_PREVIEW_IMAGE_BYTES + 1);

    expect(await call(test, windowId, 'files.readImage', { path: at('docs', 'img', 'shot.png') })).toEqual({
      dataUrl: `data:image/png;base64,${PNG_1X1.toString('base64')}`,
      size: PNG_1X1.length,
    });
    expect(await call(test, windowId, 'files.readImage', { path: at('docs', 'logo.svg') })).toMatchObject({
      dataUrl: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
    });
    await expect(call(test, windowId, 'files.readImage', { path: at('..', 'outside.png') })).rejects.toMatchObject({
      code: ErrorCode.pathOutsideProject,
    });
    await expect(call(test, windowId, 'files.readImage', { path: at('huge.png') })).rejects.toMatchObject({ code: ErrorCode.fileTooLarge });
    await expect(call(test, windowId, 'files.readImage', { path: at('notes.txt') })).rejects.toMatchObject({ code: ErrorCode.invalidParams });
  });

  it('öffnet Web-Adressen über den Port „Shell-Aktionen“, andere nicht', async () => {
    const { test, windowId } = await openAlpha();
    await call(test, windowId, 'app.openExternal', { url: 'https://example.com/a?b=1' });
    await call(test, windowId, 'app.openExternal', { url: 'mailto:someone@example.com' });
    for (const url of ['file:///C:/Windows/notepad.exe', 'javascript:alert(1)', 'C:\\x.exe', 'http:evil']) {
      await expect(call(test, windowId, 'app.openExternal', { url }), url).rejects.toMatchObject({ code: ErrorCode.invalidParams });
    }
    expect(test.ports.shell.opened).toEqual(['https://example.com/a?b=1', 'mailto:someone@example.com']);
  });

  it('merkt sich die Ansicht je Markdown-Datei über einen Neustart und beim Umbenennen', async () => {
    const { test: first, windowId: firstWindow, at } = await openAlpha({ 'README.md': '# A', 'docs/guide.md': '# B' });
    expect(await call(first, firstWindow, 'project.markdownView', { path: at('README.md') })).toBeNull();
    await call(first, firstWindow, 'project.setMarkdownView', { path: at('README.md'), view: 'preview' });
    await call(first, firstWindow, 'project.setMarkdownView', { path: at('docs', 'guide.md'), view: 'editor' });
    await expect(call(first, firstWindow, 'project.setMarkdownView', { path: at('README.md'), view: 'both' as never })).rejects.toMatchObject({
      code: ErrorCode.invalidParams,
    });
    const test = await restart(first);
    await test.core.start();
    const windowId = test.ports.windows.windowTitled('Alpha – Codium');
    expect(await call(test, windowId, 'project.markdownView', { path: at('readme.MD') })).toBe('preview');
    await call(test, windowId, 'files.rename', { path: at('docs'), newName: 'manual' });
    expect(await call(test, windowId, 'project.markdownView', { path: at('manual', 'guide.md') })).toBe('editor');
    await call(test, windowId, 'files.delete', { paths: [at('README.md')] });
    expect(await call(test, windowId, 'project.markdownView', { path: at('README.md') })).toBeNull();
  });
});
