// Art von Java-Dateien in der Oberfläche (Ticket 32): der Zwischenspeicher des Projektfensters ohne DOM, der Name im
// Baum, die Symbole und ihre Farben.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CodiumApi, Events, JavaKind, JavaKindEntry } from '../../src/shared/types';
import { JavaKindIcon } from '../../src/renderer/icons';
import { isJavaFileName, JAVA_KINDS_CHUNK, JavaKindStore, treeName } from '../../src/renderer/project/javaKinds';

const P = 'C:\\shop\\src';

/** Ein Zwischenspeicher mit nachgemachtem Kern: Anfragen bleiben offen, bis der Test sie beantwortet. */
function storeWithFakeCore() {
  const requests: Array<{ paths: string[]; answer(kinds: Record<string, JavaKind>): Promise<void>; fail(): Promise<void> }> = [];
  const errors: unknown[] = [];
  const store = new JavaKindStore(
    (paths) =>
      new Promise<JavaKindEntry[]>((resolve, reject) => {
        requests.push({
          paths,
          answer: async (kinds) => {
            resolve(paths.map((p) => ({ path: p, kind: kinds[path.win32.basename(p)] ?? 'class' })));
            await Promise.resolve();
          },
          fail: async () => {
            reject(new Error('Kern weg'));
            await Promise.resolve();
          },
        });
      }),
    (err) => errors.push(err),
  );
  let notified = 0;
  store.subscribe(() => notified++);
  return { store, requests, errors, notified: () => notified };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('Art von Java-Dateien in der Oberfläche', () => {
  it('fragt nur Java-Dateien an, jede einmal', async () => {
    const { store, requests, notified } = storeWithFakeCore();
    store.ensure([`${P}\\A.java`, `${P}\\notes.txt`, `${P}\\B.JAVA`, `${P}\\a.java`, `${P}\\pkg`]);
    expect(requests.map((r) => r.paths)).toEqual([[`${P}\\A.java`, `${P}\\B.JAVA`]]);
    expect(store.kindOf(`${P}\\A.java`)).toBeUndefined();

    // Unterwegs: nicht noch einmal.
    store.ensure([`${P}\\A.java`]);
    expect(requests).toHaveLength(1);

    await requests[0].answer({ 'A.java': 'interface', 'B.JAVA': 'enum' });
    await flush();
    expect(store.kindOf(`${P}\\a.JAVA`)).toBe('interface');
    expect(store.kindOf(`${P}\\B.JAVA`)).toBe('enum');
    expect(notified()).toBe(1);

    // Bekannt: nicht wieder, auch nicht nach dem Zu- und Wiederaufklappen; Änderungen meldet der Kern.
    store.ensure([`${P}\\A.java`, `${P}\\C.java`]);
    expect(requests.map((r) => r.paths)).toEqual([[`${P}\\A.java`, `${P}\\B.JAVA`], [`${P}\\C.java`]]);
  });

  it('teilt einen grossen Ordner in Anfragen zu höchstens JAVA_KINDS_CHUNK Pfaden, nacheinander von oben', async () => {
    const { store, requests } = storeWithFakeCore();
    const paths = Array.from({ length: JAVA_KINDS_CHUNK * 2 + 3 }, (_, i) => `${P}\\C${i}.java`);
    store.ensure(paths);
    // Der nächste Teil geht erst nach der Antwort auf den vorigen; die obersten zuerst.
    expect(requests.map((r) => r.paths.length)).toEqual([JAVA_KINDS_CHUNK]);
    expect(store.kindOf(paths[0])).toBeUndefined();
    await requests[0].answer({});
    await flush();
    expect(store.kindOf(paths[0])).toBe('class');
    expect(requests.map((r) => r.paths.length)).toEqual([JAVA_KINDS_CHUNK, JAVA_KINDS_CHUNK]);
    // Was inzwischen gelöscht ist, wird nicht mehr angefragt.
    store.forget(paths[paths.length - 1]);
    await requests[1].answer({});
    await flush();
    expect(requests.map((r) => r.paths.length)).toEqual([JAVA_KINDS_CHUNK, JAVA_KINDS_CHUNK, 2]);
    expect(requests.flatMap((r) => r.paths)).toEqual(paths.slice(0, -1));
    // Ein anderer Aufruf wartet nicht auf die Teile des ersten.
    store.ensure([`${P}\\Tab.java`]);
    expect(requests.at(-1)!.paths).toEqual([`${P}\\Tab.java`]);
  });

  it('meldet nur Änderungen und zählt die Version hoch', () => {
    const { store, notified } = storeWithFakeCore();
    store.apply([{ path: `${P}\\A.java`, kind: 'class' }]);
    store.apply([{ path: `${P}\\A.java`, kind: 'class' }]);
    expect(notified()).toBe(1);
    store.apply([{ path: `${P}\\A.java`, kind: 'interface' }]);
    expect(notified()).toBe(2);
    expect(store.version).toBe(2);
  });

  it('vergisst Gelöschtes samt Inhalt; eine Antwort für einen vergessenen Pfad zählt nicht', async () => {
    const { store, requests } = storeWithFakeCore();
    store.apply([
      { path: `${P}\\pkg\\A.java`, kind: 'class' },
      { path: `${P}\\pkg\\sub\\B.java`, kind: 'enum' },
      { path: `${P}\\pkgX\\C.java`, kind: 'record' },
    ]);
    store.ensure([`${P}\\pkg\\D.java`]);
    store.forget(`${P}\\PKG`);
    await requests[0].answer({ 'D.java': 'interface' });
    await flush();
    expect(store.kindOf(`${P}\\pkg\\A.java`)).toBeUndefined();
    expect(store.kindOf(`${P}\\pkg\\sub\\B.java`)).toBeUndefined();
    expect(store.kindOf(`${P}\\pkg\\D.java`)).toBeUndefined();
    expect(store.kindOf(`${P}\\pkgX\\C.java`)).toBe('record');
    // Danach wird der Pfad wieder angefragt.
    store.ensure([`${P}\\pkg\\D.java`]);
    expect(requests).toHaveLength(2);
  });

  it('nach dem Umbenennen: unter einem Ordner wandert die Art mit, eine Datei wird neu angefragt', () => {
    const { store, requests } = storeWithFakeCore();
    store.apply([
      { path: `${P}\\old\\A.java`, kind: 'class' },
      { path: `${P}\\B.java`, kind: 'enum' },
    ]);
    store.moved(`${P}\\old`, `${P}\\new`, true);
    expect(store.kindOf(`${P}\\new\\A.java`)).toBe('class');
    expect(store.kindOf(`${P}\\old\\A.java`)).toBeUndefined();
    store.moved(`${P}\\B.java`, `${P}\\C.java`, false);
    expect(store.kindOf(`${P}\\B.java`)).toBeUndefined();
    store.ensure([`${P}\\new\\A.java`, `${P}\\C.java`]);
    expect(requests.map((r) => r.paths)).toEqual([[`${P}\\C.java`]]);
  });

  it('zeigt nach einem Fehler des Kerns das allgemeine Symbol und fragt nicht dauernd neu', async () => {
    const { store, requests, errors } = storeWithFakeCore();
    store.ensure([`${P}\\A.java`]);
    await requests[0].fail();
    await flush();
    expect(errors).toHaveLength(1);
    expect(store.kindOf(`${P}\\A.java`)).toBe('java');
    store.ensure([`${P}\\A.java`]);
    expect(requests).toHaveLength(1);
  });

  it('folgt den Ereignissen des Kerns: geänderte Arten, Löschen und Umbenennen', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const api = {
      on: (name: string, listener: (payload: unknown) => void) => {
        listeners.set(name, listener);
        return () => listeners.delete(name);
      },
    } as unknown as CodiumApi;
    const { store } = storeWithFakeCore();
    const off = store.connect(api);
    const emit = <K extends keyof Events>(name: K, payload: Events[K]) => listeners.get(name)!(payload);
    emit('files.javaKindsChanged', { kinds: [{ path: `${P}\\A.java`, kind: 'interface' }, { path: `${P}\\d\\B.java`, kind: 'enum' }] });
    expect(store.kindOf(`${P}\\A.java`)).toBe('interface');
    emit('files.operation', { kind: 'renamed', from: `${P}\\d`, to: `${P}\\e`, isDirectory: true });
    expect(store.kindOf(`${P}\\e\\B.java`)).toBe('enum');
    emit('files.changed', { changes: [{ path: `${P}\\A.java`, kind: 'deleted' }] });
    expect(store.kindOf(`${P}\\A.java`)).toBeUndefined();
    emit('files.operation', { kind: 'deleted', path: `${P}\\e`, isDirectory: true });
    expect(store.kindOf(`${P}\\e\\B.java`)).toBeUndefined();
    off();
    expect(listeners.size).toBe(0);
  });

  it('der Name im Baum: ohne .java nur bei eindeutiger Art', () => {
    expect(treeName('OrderService.java', 'class')).toBe('OrderService');
    expect(treeName('Repo.JAVA', 'interface')).toBe('Repo');
    expect(treeName('Shipping.java', 'java')).toBe('Shipping.java');
    expect(treeName('OrderService.java', undefined)).toBe('OrderService.java');
    expect(treeName('notes.txt', 'class')).toBe('notes.txt');
    expect(isJavaFileName('a.java')).toBe(true);
    expect(isJavaFileName('a.javax')).toBe(false);
  });
});

describe('Java-Symbole', () => {
  const ROOT = path.resolve(__dirname, '..', '..');
  const KINDS: JavaKind[] = ['class', 'abstractClass', 'interface', 'enum', 'record', 'annotation', 'exception', 'abstractException', 'java'];

  it('jede Art hat ihr Symbol, nur mit den Design-Variablen gefärbt', () => {
    const palettes: Record<JavaKind, string> = {
      class: 'class',
      abstractClass: 'class',
      record: 'class',
      interface: 'interface',
      annotation: 'interface',
      enum: 'enum',
      exception: 'exception',
      abstractException: 'exception',
      java: 'file',
    };
    const markups = new Set<string>();
    for (const kind of KINDS) {
      const svg = renderToStaticMarkup(createElement(JavaKindIcon, { kind }));
      expect(svg, kind).toContain(`data-java-kind="${kind}"`);
      expect(svg, kind).toContain('width="16"');
      expect(svg, kind).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|currentColor/i);
      const colors = [...svg.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1]);
      expect(new Set(colors), kind).toEqual(new Set([`--java-${palettes[kind]}`, `--java-${palettes[kind]}-fill`]));
      markups.add(svg.replace(/data-java-kind="[^"]+"/, ''));
    }
    // Keine zwei Arten sehen gleich aus.
    expect(markups.size).toBe(KINDS.length);
    // Abstraktes hat den gestrichelten Ring: acht Bögen und einen Kreis ohne Rand; das Übrige einen Kreis mit Rand.
    for (const kind of KINDS.filter((k) => k !== 'java')) {
      const svg = renderToStaticMarkup(createElement(JavaKindIcon, { kind }));
      const dashed = kind === 'abstractClass' || kind === 'abstractException';
      expect(svg.match(/A6\.5 6\.5/g)?.length ?? 0, kind).toBe(dashed ? 8 : 0);
      expect(/<circle [^>]*stroke=/.test(svg), kind).toBe(!dashed);
    }
  });

  it('tokens.css hat die freigegebenen Farben wie IntelliJ „Dark“', () => {
    const tokens = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles', 'tokens.css'), 'utf8');
    const approved: Record<string, string> = {
      '--java-class': '#548af7',
      '--java-class-fill': '#25324d',
      '--java-interface': '#57965c',
      '--java-interface-fill': '#253627',
      '--java-enum': '#a571e6',
      '--java-enum-fill': '#2f2936',
      '--java-exception': '#d6ae58',
      '--java-exception-fill': '#3d3223',
      '--java-file': '#c77d55',
      '--java-file-fill': '#45322b',
    };
    for (const [name, value] of Object.entries(approved)) expect(tokens, name).toMatch(new RegExp(`${name}:\\s*${value};`, 'i'));
  });
});
