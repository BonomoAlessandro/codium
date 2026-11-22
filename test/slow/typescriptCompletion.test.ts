// Langsamer Lauf: Vervollständigung, semantische Token und Symbolsuche (Ticket 13) mit echten TypeScript-Sprachservern,
// an denselben drei Arten von Beispielprojekten wie in Ticket 12.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundledTypeScript } from '../../src/main/typescriptPaths';
import { SEMANTIC_TOKEN_MODIFIERS, SEMANTIC_TOKEN_TYPES, type CommandArgs, type CommandName, type CommandResult } from '../../src/shared/types';
import { createTestCore, type TestCore } from '../support/core';
import { useTempDirs } from '../support/tempDir';

const WELCOME = 'Welcome to Codium';
const REPO = path.resolve(__dirname, '..', '..');
const BUNDLED = bundledTypeScript(REPO, false, { execPath: process.execPath, env: {} });

const SOURCE = [
  'export class Counter {',
  '  static instances = 0;',
  '  count = 0;',
  '  /** Adds a step to the count. */',
  '  increment(step: number): number {',
  '    const next = this.count + step;',
  '    this.count = next;',
  '    return Counter.instances + next;',
  '  }',
  '}',
  '',
  'export function makeCounter(): Counter {',
  '  return new Counter();',
  '}',
  '',
].join('\n');

const VARIANTS = [
  { name: 'TypeScript 7 im Projekt', typescript: 'typescript' },
  { name: 'TypeScript 6 im Projekt', typescript: 'typescript6' },
  { name: 'ohne eigenes TypeScript', typescript: null },
] as const;

/** Die Token einer Zeile als „Text:Art.Modifikator…“. */
function decode(data: number[], lines: string[]): string[] {
  const out: string[] = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    line += data[i];
    char = data[i] === 0 ? char + data[i + 1] : data[i + 1];
    const modifiers = SEMANTIC_TOKEN_MODIFIERS.filter((_, bit) => (data[i + 4] & (1 << bit)) !== 0);
    out.push(`${line}:${lines[line].slice(char, char + data[i + 2])}:${[SEMANTIC_TOKEN_TYPES[data[i + 3]], ...modifiers].join('.')}`);
  }
  return out;
}

async function until<T>(get: () => T | Promise<T>, ok: (v: T) => boolean, what: string, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await get();
    if (ok(value)) return value;
    if (Date.now() > end) throw new Error(`Zeitüberschreitung: ${what} (zuletzt ${JSON.stringify(value)?.slice(0, 400)})`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('TypeScript: Vervollständigung, semantische Token, Symbolsuche', () => {
  const tempDir = useTempDirs();

  function call<K extends CommandName>(test: TestCore, windowId: number, name: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
    return test.core.router.call({ windowId }, name, ...args);
  }

  for (const variant of VARIANTS) {
    it(variant.name, async () => {
      const root = tempDir();
      const project = path.join(root, 'Counters');
      fs.mkdirSync(path.join(project, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'counters', type: 'module' }));
      fs.writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'es2022', module: 'nodenext', noEmit: true } }));
      fs.writeFileSync(path.join(project, 'counter.ts'), SOURCE);
      if (variant.typescript) fs.symlinkSync(path.join(REPO, 'node_modules', variant.typescript), path.join(project, 'node_modules', 'typescript'), 'junction');
      const test = createTestCore(path.join(root, 'data'), { typescript: BUNDLED, cleanupTimeoutMs: 10_000 });
      await test.core.start();
      await call(test, test.ports.windows.windowTitled(WELCOME), 'app.openProject', { path: project });
      const windowId = test.ports.windows.windowTitled('Counters – Codium');
      const file = path.join(project, 'counter.ts');

      // Vervollständigung eines Members nach „c.“, mit nachgeladener Dokumentation.
      const text = `${SOURCE}const c = makeCounter();\nc.\n`;
      await call(test, windowId, 'language.didOpen', { path: file, text, version: 1 });
      const lines = text.split('\n');
      const completion = await until(
        () => call(test, windowId, 'language.completion', { path: file, line: 16, character: 2, triggerCharacter: '.' }),
        (r) => r.items.some((i) => i.label === 'increment'),
        'Vorschläge',
      );
      const increment = completion.items.find((i) => i.label === 'increment')!;
      expect(completion.items.map((i) => i.label)).toEqual(expect.arrayContaining(['count', 'increment']));
      const details = await until(
        () => call(test, windowId, 'language.resolveCompletion', { id: increment.id }),
        (d) => `${d.detail ?? ''} ${d.documentation ?? ''}`.includes('Adds a step'),
        'Details',
      );
      expect(`${details.detail ?? ''} ${details.documentation ?? ''}`).toContain('Adds a step to the count.');

      // Semantische Token: Parameter, lokale Variable, Eigenschaft und statisches Member unterscheiden sich.
      const tokens = await until(() => call(test, windowId, 'language.semanticTokens', { path: file }), (r) => (r?.data.length ?? 0) > 0, 'Token');
      const decoded = decode(tokens!.data, lines);
      const kind = (line: number, word: string) => decoded.find((t) => t.startsWith(`${line}:${word}:`))?.split(':')[2];
      const parameter = kind(5, 'step');
      const local = kind(5, 'next');
      const property = kind(5, 'count');
      const staticMember = kind(7, 'instances');
      expect(parameter).toMatch(/^parameter/);
      expect(local).toMatch(/^variable/);
      expect(property).toMatch(/^property/);
      expect(staticMember).toMatch(/^property.*\.static/);
      expect(new Set([parameter, local, property, staticMember]).size).toBe(4);

      // Symbolsuche: die Klasse über „types“, die Funktion nur über „all“.
      const types = await until(() => call(test, windowId, 'language.symbols', { query: 'Count', kinds: 'types' }), (r) => r.length > 0, 'Klassen');
      expect(types).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Counter', path: file, range: expect.objectContaining({ start: expect.objectContaining({ line: 0 }) }) })]));
      expect(types.some((s) => s.name === 'makeCounter')).toBe(false);
      const all = await until(() => call(test, windowId, 'language.symbols', { query: 'makeCount', kinds: 'all' }), (r) => r.length > 0, 'alle Symbole');
      expect(all.some((s) => s.name === 'makeCounter' && s.path === file)).toBe(true);
    });
  }
});
