// Wahl des TypeScript-Sprachservers nach der TypeScript-Version des Projekts (Spezifikation, „Sprachverständnis“):
// - ab TypeScript 7 der native Server des Projekts (`tsc --lsp --stdio`),
// - bis TypeScript 6 typescript-language-server (mitgeliefert, mit der Node-Laufzeit von Electron) mit dem tsserver des
//   Projekts,
// - ohne eigenes TypeScript der native Server des mitgelieferten TypeScript 7.
// Lädt nie Electron.

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Mitgelieferte Sprachserver und die Node-Laufzeit, mit der typescript-language-server läuft. */
export interface BundledTypeScript {
  /** Native Programmdatei des mitgelieferten TypeScript 7 (`tsc.exe`). */
  nativeTsc: string;
  /** `cli.mjs` von typescript-language-server. */
  languageServerCli: string;
  /** Node-Laufzeit: Electron als Node (`ELECTRON_RUN_AS_NODE`) bzw. im Test Node selbst. */
  node: { execPath: string; env: Record<string, string> };
}

export interface TypeScriptLaunch {
  /** Woher der Server kommt, für Meldungen und Tests. */
  kind: 'project-native' | 'project-tsserver' | 'bundled-native';
  /** TypeScript-Version des Projekts; `null` ohne eigenes. */
  version: string | null;
  command: string;
  args: string[];
  /** Zusätze zur Umgebung. */
  env: Record<string, string>;
  initializationOptions?: unknown;
}

const PLATFORM_PACKAGE = `@typescript/typescript-${process.platform}-${process.arch}`;

/** Der Server für ein Projekt. */
export function typescriptLaunch(projectPath: string, bundled: BundledTypeScript): TypeScriptLaunch {
  const own = projectTypeScript(projectPath);
  if (own && major(own.version) >= 7) {
    const tsc = nativeTscOf(own.dir);
    if (tsc) return { kind: 'project-native', version: own.version, command: tsc, args: ['--lsp', '--stdio'], env: {} };
  }
  if (own && major(own.version) <= 6) {
    const tsserver = path.join(own.dir, 'lib', 'tsserver.js');
    if (fs.existsSync(tsserver)) {
      return {
        kind: 'project-tsserver',
        version: own.version,
        command: bundled.node.execPath,
        args: [bundled.languageServerCli, '--stdio'],
        env: bundled.node.env,
        initializationOptions: { tsserver: { path: tsserver }, preferences: { includeCompletionsForModuleExports: true } },
      };
    }
  }
  return { kind: 'bundled-native', version: own?.version ?? null, command: bundled.nativeTsc, args: ['--lsp', '--stdio'], env: {} };
}

/** Das TypeScript im Projekt (`node_modules/typescript` im Projektordner), mit Version. */
function projectTypeScript(projectPath: string): { dir: string; version: string } | null {
  const dir = path.join(projectPath, 'node_modules', 'typescript');
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? { dir: fs.realpathSync(dir), version: pkg.version } : null;
  } catch {
    return null;
  }
}

/** Die native Programmdatei zu einem TypeScript ab 7: im Plattformpaket neben bzw. unter dem Paket `typescript`. */
function nativeTscOf(typescriptDir: string): string | null {
  const exe = process.platform === 'win32' ? 'tsc.exe' : 'tsc';
  for (let dir = typescriptDir; ; dir = path.dirname(dir)) {
    const candidates = [path.join(dir, 'node_modules', PLATFORM_PACKAGE, 'lib', exe)];
    if (path.basename(dir) === 'node_modules') candidates.push(path.join(dir, PLATFORM_PACKAGE, 'lib', exe));
    const found = candidates.find((c) => fs.existsSync(c));
    if (found) return found;
    if (path.dirname(dir) === dir) return null;
  }
}

function major(version: string): number {
  return Number.parseInt(version, 10) || 0;
}

/** Sprach-Kennung von LSP für eine Datei; `null`, wenn TypeScript sie nicht versteht. */
export function typescriptLanguageId(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') return 'typescript';
  if (ext === '.tsx') return 'typescriptreact';
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'javascript';
  if (ext === '.jsx') return 'javascriptreact';
  return null;
}

/** Kennzeichen eines TypeScript/JavaScript-Projekts im Projektordner. */
export const TYPESCRIPT_MARKERS = ['tsconfig.json', 'jsconfig.json', 'package.json'];
