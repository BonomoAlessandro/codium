import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { StateFile } from '../../src/main/core/stateFile';
import { useTempDirs } from '../support/tempDir';

interface Sample {
  schemaVersion: 1;
  items: string[];
  extra?: string;
}

const empty = (): Sample => ({ schemaVersion: 1, items: [] });

describe('Zustandsdatei', () => {
  const tempDir = useTempDirs();

  function setup() {
    const dir = tempDir();
    const file = path.join(dir, 'sub', 'state.json');
    const corrupt: string[] = [];
    const errors: string[] = [];
    const store = new StateFile(file, 1, empty, {
      debounceMs: 5,
      retryDelayMs: 1,
      onCorrupt: (_backup, reason) => corrupt.push(reason),
      onError: (message) => errors.push(message),
    });
    return { dir, file, store, corrupt, errors };
  }

  function writeRaw(file: string, content: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }

  it('liefert ohne Datei den leeren Zustand', () => {
    const { store, errors } = setup();
    expect(store.load()).toEqual(empty());
    expect(errors).toEqual([]);
  });

  it('schreibt entprellt und übersteht das Neuladen', async () => {
    const { file, store } = setup();
    store.save({ schemaVersion: 1, items: ['a'] });
    store.save({ schemaVersion: 1, items: ['a', 'b'] });
    expect(fs.existsSync(file)).toBe(false);
    await vi.waitFor(() => expect(fs.existsSync(file)).toBe(true));
    expect(new StateFile(file, 1, empty).load()).toEqual({ schemaVersion: 1, items: ['a', 'b'] });
  });

  it('schreibt bei flush sofort und hinterlässt keine Temp-Datei', () => {
    const { file, store } = setup();
    store.save({ schemaVersion: 1, items: ['x'] });
    store.flush();
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ schemaVersion: 1, items: ['x'] });
    expect(fs.readdirSync(path.dirname(file))).toEqual(['state.json']);
  });

  it('ergänzt fehlende Felder aus dem leeren Zustand und verträgt ein BOM', () => {
    const { file, store } = setup();
    writeRaw(file, '﻿{"schemaVersion":1,"extra":"da"}');
    expect(store.load()).toEqual({ schemaVersion: 1, items: [], extra: 'da' });
  });

  it('prüft die Felder mit der Normalisierung des Schemas', () => {
    const { file } = setup();
    writeRaw(file, '{"schemaVersion":1,"items":"kein Array"}');
    const store = new StateFile<Sample>(file, 1, empty, {
      normalize: (raw) => ({ schemaVersion: 1, items: Array.isArray(raw.items) ? raw.items : [] }),
    });
    expect(store.load()).toEqual({ schemaVersion: 1, items: [] });
  });

  it.each([
    ['kein JSON', '{ kaputt'],
    ['kein Objekt', '[1, 2]'],
    ['ohne Schemaversion', '{"items":["a"]}'],
    ['mit älterer Schemaversion', '{"schemaVersion":0,"items":["a"]}'],
  ])('legt eine Datei %s beiseite statt sie zu überschreiben', (_name, content) => {
    const { file, store, corrupt } = setup();
    writeRaw(file, content);

    expect(store.load()).toEqual(empty());
    const backups = fs.readdirSync(path.dirname(file)).filter((name) => name.startsWith('state.json.corrupt-'));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(path.dirname(file), backups[0]), 'utf8')).toBe(content);
    expect(corrupt).toHaveLength(1);
  });

  it('überschreibt eine Datei einer neueren Version nicht', () => {
    const { file, store, errors } = setup();
    const newer = '{"schemaVersion":2,"items":["von morgen"]}';
    writeRaw(file, newer);

    expect(store.load()).toEqual(empty());
    store.save({ schemaVersion: 1, items: ['heute'] });
    store.flush();
    expect(fs.readFileSync(file, 'utf8')).toBe(newer);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['state.json']);
    expect(errors.join('\n')).toMatch(/neueren Version/);
  });

  it('überschreibt eine unlesbare Datei nicht', () => {
    const { file, store, errors } = setup();
    // Ein Ordner an Stelle der Datei: Lesen scheitert mit einem anderen Fehler als „fehlt“.
    fs.mkdirSync(file, { recursive: true });

    expect(store.load()).toEqual(empty());
    store.save({ schemaVersion: 1, items: ['x'] });
    store.flush();
    expect(fs.statSync(file).isDirectory()).toBe(true);
    expect(errors.join('\n')).toMatch(/nicht lesbar/);
  });

  it('meldet einen Schreibfehler, ohne zu werfen, und behält den Stand für den nächsten Versuch', () => {
    const { file, store, errors } = setup();
    expect(store.load()).toEqual(empty());
    // Erst nach dem Laden blockiert ein Ordner die Zieldatei: Umbenennen scheitert.
    fs.mkdirSync(file, { recursive: true });

    store.save({ schemaVersion: 1, items: ['wichtig'] });
    expect(() => store.flush()).not.toThrow();
    expect(errors.join('\n')).toMatch(/nicht geschrieben/);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['state.json']);

    fs.rmSync(file, { recursive: true });
    store.flush();
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).items).toEqual(['wichtig']);
  });
});
