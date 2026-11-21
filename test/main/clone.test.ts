// Teststelle 1: „Clone Repository“ am Vertrag, mit dem echten Git und einem lokalen Bare-Repository als Quelle; die
// Git-Konfiguration des Rechners ist abgeschirmt.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloneFraction } from '../../src/main/core/clone';
import { gitMessage } from '../../src/main/core/gitProcess';
import { NodeSystem } from '../../src/main/system/nodeSystem';
import { folderNameFromUrl } from '../../src/shared/cloneUrl';
import { ErrorCode, type CommandArgs, type CommandName, type CommandResult, type ProgressEvent } from '../../src/shared/types';
import { createTestCore, restart, type TestCore } from '../support/core';
import { createRepoWithRemote } from '../support/git';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
/** Das echte Git des Rechners (für die Tests im Ticket vorausgesetzt). */
const realGit = new NodeSystem(process.env).findProgram('git');

describe('Repository klonen', () => {
  const tempDir = useTempDirs();

  async function setup() {
    const base = tempDir();
    const source = createRepoWithRemote(base);
    const test = createTestCore(path.join(base, 'data'), {
      system: { programs: { git: realGit! }, home: path.join(base, 'home') },
      processEnv: source.env,
    });
    await test.core.start();
    return { base, source, test, welcome: test.ports.windows.windowTitled(WELCOME) };
  }

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  it('legt den Ordner an, öffnet das Projekt und merkt sich den Elternordner', async () => {
    const { base, source, test, welcome } = await setup();
    expect(await call(test, welcome, 'app.prerequisites')).toEqual({ git: true });
    expect(await call(test, welcome, 'app.cloneDefaults')).toEqual({ parent: path.join(base, 'home') });

    const target = path.join(base, 'projects', 'nested', 'remote');
    const project = await call(test, welcome, 'app.clone', { url: source.remote, directory: target });
    expect(project).toEqual({ path: target, name: 'remote' });
    expect(fs.existsSync(path.join(target, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, '.git'))).toBe(true);
    // Das Projekt ist offen, das Willkommensfenster zu, und es steht unter den zuletzt geöffneten.
    expect(test.ports.windows.openTitles).toEqual(['remote – Codium']);
    expect(test.core.state.recentProjects).toEqual([target]);
    // Fortschritt in der Statusleiste des klonenden Fensters, mit Anfang und Ende.
    const progress = test.events.forWindow(welcome).filter((e) => e.name === 'app.progress').map((e) => (e.payload as ProgressEvent).kind);
    expect(progress[0]).toBe('begin');
    expect(progress.at(-1)).toBe('end');

    // Der nächste Vorschlag nimmt den gewählten Elternordner, auch nach einem Neustart.
    const next = await restart(test, { system: { programs: { git: realGit! } } });
    await next.core.start();
    const windowId = next.ports.windows.windowTitled('remote – Codium');
    expect(await call(next, windowId, 'app.cloneDefaults')).toEqual({ parent: path.join(base, 'projects', 'nested') });
  });

  it('lehnt einen nicht leeren Zielordner ab; ein leerer geht', async () => {
    const { base, source, test, welcome } = await setup();
    const full = path.join(base, 'full');
    fs.mkdirSync(full);
    fs.writeFileSync(path.join(full, 'keep.txt'), 'keep');
    await expect(call(test, welcome, 'app.clone', { url: source.remote, directory: full })).rejects.toMatchObject({
      code: ErrorCode.fileExists,
    });
    expect(fs.readdirSync(full)).toEqual(['keep.txt']);

    const empty = path.join(base, 'empty');
    fs.mkdirSync(empty);
    await call(test, welcome, 'app.clone', { url: source.remote, directory: empty });
    expect(fs.existsSync(path.join(empty, 'README.md'))).toBe(true);
  });

  it('meldet bei einer fehlenden Quelle die Meldung von Git und hinterlässt keinen Ordner', async () => {
    const { base, test, welcome } = await setup();
    const target = path.join(base, 'never');
    const failure = await call(test, welcome, 'app.clone', { url: path.join(base, 'does-not-exist.git'), directory: target }).catch((e: unknown) => e);
    expect(failure).toMatchObject({ code: ErrorCode.gitFailed });
    expect((failure as Error).message).toMatch(/does not exist|not found|not appear to be a git repository/i);
    expect(fs.existsSync(target)).toBe(false);
    // Ein leerer Ordner, der vorher da war, bleibt (leer) stehen.
    const empty = path.join(base, 'empty-before');
    fs.mkdirSync(empty);
    await expect(call(test, welcome, 'app.clone', { url: path.join(base, 'missing.git'), directory: empty })).rejects.toMatchObject({
      code: ErrorCode.gitFailed,
    });
    expect(fs.readdirSync(empty)).toEqual([]);
    expect(test.ports.windows.openTitles).toEqual([WELCOME]);
  });

  it('ist ohne Git aus', async () => {
    const base = tempDir();
    const test = createTestCore(path.join(base, 'data'), { system: { programs: {} } });
    await test.core.start();
    const welcome = test.ports.windows.windowTitled(WELCOME);
    expect(await call(test, welcome, 'app.prerequisites')).toEqual({ git: false });
    await expect(call(test, welcome, 'app.clone', { url: 'https://example.invalid/a.git', directory: path.join(base, 'a') })).rejects.toMatchObject({
      code: ErrorCode.gitNotFound,
    });
  });
});

describe('Ordnername aus der Adresse', () => {
  it('nimmt den letzten Teil ohne .git und ohne Schrägstrich am Ende', () => {
    expect(folderNameFromUrl('https://github.com/BonomoAlessandro/codium.git')).toBe('codium');
    expect(folderNameFromUrl('https://github.com/BonomoAlessandro/codium')).toBe('codium');
    expect(folderNameFromUrl('https://bitbucket.example.com/scm/team/my-service.git/')).toBe('my-service');
    expect(folderNameFromUrl('https://example.com/repo/')).toBe('repo');
    expect(folderNameFromUrl('git@github.com:BonomoAlessandro/THub.git')).toBe('THub');
    expect(folderNameFromUrl('git@host:name.git')).toBe('name');
    expect(folderNameFromUrl('ssh://git@host:7999/team/app.git')).toBe('app');
    expect(folderNameFromUrl('C:\\repos\\local.git')).toBe('local');
    expect(folderNameFromUrl('  https://example.com/x.GIT  ')).toBe('x');
  });
});

describe('Hilfen für Git', () => {
  it('liest den Fortschritt und die Meldung von git clone', () => {
    expect(cloneFraction('Receiving objects:  50% (5/10)')).toBeCloseTo(0.45);
    expect(cloneFraction('Resolving deltas: 100% (3/3), done.')).toBeCloseTo(1);
    expect(cloneFraction('Cloning into ...')).toBeNull();
    expect(gitMessage("Cloning into 'x'...\nfatal: repository 'y' does not exist\n")).toBe("fatal: repository 'y' does not exist");
  });
});
