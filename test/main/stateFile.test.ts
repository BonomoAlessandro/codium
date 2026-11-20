import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
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

  function setup(onCorrupt?: (backup: string, reason: string) => void) {
    const dir = tempDir();
    const file = path.join(dir, 'sub', 'state.json');
    return { dir, file, store: new StateFile(file, 1, empty, { debounceMs: 5, onCorrupt }) };
  }

  it('liefert ohne Datei den leeren Zustand', () => {
    expect(setup().store.load()).toEqual(empty());
  });

  it('schreibt entprellt und übersteht das Neuladen', async () => {
    const { file, store } = setup();
    store.save({ schemaVersion: 1, items: ['a'] });
    store.save({ schemaVersion: 1, items: ['a', 'b'] });
    expect(fs.existsSync(file)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
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
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '﻿{"schemaVersion":1,"extra":"da"}', 'utf8');
    expect(store.load()).toEqual({ schemaVersion: 1, items: [], extra: 'da' });
  });

  it.each([
    ['kein JSON', '{ kaputt'],
    ['kein Objekt', '[1, 2]'],
    ['ohne Schemaversion', '{"items":["a"]}'],
    ['mit unbekannter Schemaversion', '{"schemaVersion":99,"items":["a"]}'],
  ])('legt eine Datei %s beiseite statt sie zu überschreiben', (_name, content) => {
    const reasons: string[] = [];
    const { file, store } = setup((_backup, reason) => reasons.push(reason));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');

    expect(store.load()).toEqual(empty());
    const backups = fs.readdirSync(path.dirname(file)).filter((name) => name.startsWith('state.json.corrupt-'));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(path.dirname(file), backups[0]), 'utf8')).toBe(content);
    expect(reasons).toHaveLength(1);
  });
});
