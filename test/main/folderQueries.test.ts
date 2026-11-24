// Abfragen auf Projektordnern: echter Pfad, fehlende und nicht erreichbare Ordner, und dass hängende Abfragen den
// Threadpool nicht füllen.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FolderQueries } from '../../src/main/core/folderQueries';
import { lexicalProjectKey, normalizeProjectPath } from '../../src/main/core/projectPath';
import { useTempDirs } from '../support/tempDir';
import { tempPrefix } from '../support/testRun';
import { neverAnsweringPipe, unusedDriveLetter, type NeverAnsweringPipe } from '../support/unreachable';

describe('Abfragen auf Projektordnern', () => {
  const tempDir = useTempDirs();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Abfragen auf Pfade, für die `hangs` zutrifft, lesen stattdessen von einer Pipe, die nie antwortet, und belegen
   * so einen Thread. `answerWith` ersetzt die übrigen Abfragen auf diese Pfade (etwa nach einer späten Antwort).
   */
  function hangWhere(pipe: NeverAnsweringPipe, hangs: (target: string) => boolean, answerWith?: () => string): void {
    const stat = fs.promises.stat.bind(fs.promises);
    const realpath = fs.promises.realpath.bind(fs.promises);
    vi.spyOn(fs.promises, 'stat').mockImplementation(((target: fs.PathLike, ...rest: []) =>
      hangs(String(target)) ? pipe.hang() : stat(answerWith?.() ?? target, ...rest)) as unknown as typeof fs.promises.stat);
    vi.spyOn(fs.promises, 'realpath').mockImplementation(((target: fs.PathLike, ...rest: []) =>
      hangs(String(target)) ? pipe.hang() : realpath(target, ...rest)) as unknown as typeof fs.promises.realpath);
  }

  const onDriveZ = (target: string) => target.toUpperCase().startsWith('Z:');
  /** Wartet, bis alle anstehenden Promise-Reaktionen gelaufen sind (etwa auf eine späte Antwort). */
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  function hangOnDriveZ(pipe: NeverAnsweringPipe): void {
    hangWhere(pipe, onDriveZ);
  }

  it('vergleicht vorhandene Ordner über ihren echten Pfad, zeigt aber die angegebene Schreibweise', async () => {
    // os.tmpdir() liefert unter Windows oft einen Kurznamen wie C:\Users\ALESSA~1\...; mkdtemp übernimmt ihn.
    const raw = fs.mkdtempSync(path.join(os.tmpdir(), tempPrefix('pfad')));
    try {
      const real = fs.realpathSync.native(raw);
      const project = path.join(real, 'Projekt');
      const junction = path.join(real, 'Verknuepfung');
      fs.mkdirSync(project);
      fs.symlinkSync(project, junction, 'junction');
      const queries = new FolderQueries();

      // Angezeigt und als Arbeitsordner benutzt wird die angegebene Schreibweise (etwa ein Netzlaufwerk bleibt
      // ein Laufwerksbuchstabe), verglichen wird über den echten Pfad.
      expect(normalizeProjectPath(path.join(raw, 'projekt'))).toBe(path.join(raw, 'projekt'));
      const key = await queries.resolveKey(project);
      expect(key).toEqual({ key: lexicalProjectKey(project), resolved: true });
      expect(await queries.resolveKey(path.join(raw, 'projekt'))).toEqual(key);
      expect(await queries.resolveKey(junction)).toEqual(key);
      expect(await queries.folderStatus(junction)).toBe('exists');
    } finally {
      fs.rmSync(raw, { recursive: true, force: true });
    }
  });

  it('unterscheidet einen fehlenden Ordner von einem fehlenden Laufwerk', async () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, 'datei.txt'), '');
    const queries = new FolderQueries();
    const drive = unusedDriveLetter();

    expect(await queries.folderStatus(root)).toBe('exists');
    expect(await queries.folderStatus(path.join(root, 'fehlt'))).toBe('missing');
    expect(await queries.folderStatus(path.join(root, 'datei.txt'))).toBe('missing');
    // Ein Laufwerk, das es nicht gibt, ist wie ein Netzlaufwerk, das noch nicht verbunden ist: nicht erreichbar.
    expect(await queries.folderStatus(`${drive}:\\Projekt`)).toBe('unreachable');
    expect(await queries.resolveKey(`${drive}:\\Projekt`)).toEqual({
      key: lexicalProjectKey(`${drive}:\\Projekt`),
      resolved: false,
    });
  });

  it('lässt hängende Abfragen den Threadpool nicht füllen: höchstens eine pro Laufwerk, lokale Ordner bleiben erreichbar', async () => {
    const local = tempDir();
    const pipe = await neverAnsweringPipe();
    try {
      hangOnDriveZ(pipe);
      let now = 0;
      const queries = new FolderQueries({ timeoutMs: 100, unreachableForMs: 1000, now: () => now });

      // Viele Abfragen gleichzeitig auf das hängende Laufwerk, dazu immer wieder lokale: Die lokalen kommen durch.
      // Vom hängenden Laufwerk lesen nur zwei: die erste Abfrage und die Rückfrage an seine Wurzel, die ebenfalls
      // hängt; danach ist das ganze Laufwerk gesperrt.
      const onZ = Array.from({ length: 40 }, (_, i) => `Z:\\Netz\\Projekt${i}`);
      const results = await Promise.all([
        ...onZ.map((p) => queries.folderStatus(p)),
        ...onZ.map((p) => queries.resolveKey(p).then((r) => (r.resolved ? 'resolved' : 'unreachable'))),
      ]);
      expect(new Set(results)).toEqual(new Set(['unreachable']));
      for (let i = 0; i < 5; i++) expect(await queries.folderStatus(local)).toBe('exists');
      expect(await queries.resolveKey(local)).toEqual({ key: lexicalProjectKey(local), resolved: true });
      expect(pipe.reads).toBe(2);

      // Auch nach Ablauf der Wartezeit kein weiterer Versuch, solange die hängenden Abfragen nicht zurück sind.
      now = 5000;
      expect(await queries.folderStatus(onZ[0])).toBe('unreachable');
      expect(pipe.reads).toBe(2);
    } finally {
      await pipe.close();
    }
  });

  it('sperrt bei einem hängenden lokalen Pfad nur diesen Pfad, nicht das ganze Laufwerk', async () => {
    const local = tempDir();
    // Etwa ein Link auf eine tote Freigabe: Der Pfad hängt, die Wurzel seines Laufwerks antwortet.
    const dead = path.join(local, 'tot');
    const pipe = await neverAnsweringPipe();
    try {
      hangWhere(pipe, (target) => lexicalProjectKey(target) === lexicalProjectKey(dead));
      const queries = new FolderQueries({ timeoutMs: 100, unreachableForMs: 1000 });

      expect(await queries.folderStatus(dead)).toBe('unreachable');
      expect(await queries.folderStatus(local)).toBe('exists');
      expect(await queries.resolveKey(local)).toEqual({ key: lexicalProjectKey(local), resolved: true });
      // Der gesperrte Pfad bekommt sofort „nicht erreichbar“, ohne neue Abfrage.
      expect(await queries.folderStatus(dead)).toBe('unreachable');
      expect((await queries.resolveKey(dead)).resolved).toBe(false);
      expect(pipe.reads).toBe(1);
    } finally {
      await pipe.close();
    }
  });

  it('hebt die Sperren auf, sobald eine hängende Abfrage doch noch antwortet', async () => {
    const local = tempDir();
    const pipe = await neverAnsweringPipe();
    let zHangs = true;
    try {
      // Solange Z: hängt, lesen die Abfragen von der Pipe; danach antwortet Z: mit einem vorhandenen Ordner.
      hangWhere(pipe, (target) => zHangs && onDriveZ(target), () => local);
      const queries = new FolderQueries({ timeoutMs: 100, unreachableForMs: 60_000 });
      expect(await queries.folderStatus('Z:\\Projekt')).toBe('unreachable');
      expect(await queries.folderStatus('Z:\\Anderes')).toBe('unreachable');
      expect(pipe.reads).toBe(2);

      // Die hängenden Abfragen kommen mit „fehlt“ zurück: Das Laufwerk hat geantwortet, lange vor Ablauf der Sperre.
      zHangs = false;
      await pipe.answer('ENOENT');
      await settle();
      expect(await queries.folderStatus('Z:\\Anderes')).toBe('exists');
      expect(await queries.folderStatus('Z:\\Projekt')).toBe('exists');
      expect(pipe.reads).toBe(2);
    } finally {
      await pipe.close();
    }
  });

  it('versucht ein nicht erreichbares Laufwerk erst wieder, wenn die hängende Abfrage zurück ist und die Wartezeit um', async () => {
    const pipe = await neverAnsweringPipe();
    let now = 0;
    const queries = new FolderQueries({ timeoutMs: 50, unreachableForMs: 1000, now: () => now });
    try {
      hangOnDriveZ(pipe);
      expect(await queries.folderStatus('Z:\\Projekt')).toBe('unreachable');
      expect(pipe.reads).toBe(2);
    } finally {
      // Die Pipe geht zu: Die hängenden Abfragen kehren ohne Antwort zurück (Netzwerkfehler) und geben ihre
      // Threads frei; die Sperre läuft weiter.
      await pipe.close();
      await settle();
      vi.restoreAllMocks();
    }

    expect(await queries.folderStatus('Z:\\Projekt')).toBe('unreachable');
    now = 2000;
    vi.spyOn(fs.promises, 'stat').mockRejectedValue(Object.assign(new Error('weg'), { code: 'ENOENT' }));
    // Jetzt wird wieder gefragt: Ordner und Laufwerk fehlen, also nicht erreichbar.
    expect(await queries.folderStatus('Z:\\Projekt')).toBe('unreachable');
    expect(fs.promises.stat).toHaveBeenCalledTimes(2);
  });

  it('teilt gleichzeitige Abfragen auf denselben Pfad', async () => {
    const local = tempDir();
    const stat = vi.spyOn(fs.promises, 'stat');
    const queries = new FolderQueries();

    await Promise.all([queries.folderStatus(local), queries.folderStatus(`${local}\\`), queries.folderStatus(local.toUpperCase())]);
    expect(stat).toHaveBeenCalledTimes(1);
  });
});
