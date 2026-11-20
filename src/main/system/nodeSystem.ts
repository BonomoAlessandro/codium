// Echter Port „System“ ohne Electron: läuft im Hauptprozess und in den langsamen Tests gleich.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SystemPort } from '../core/ports';

export interface NodeSystemOptions {
  /** Testmodus `CODIUM_TEST_NO_GIT=1`: Git gilt als nicht gefunden. */
  noGit?: boolean;
}

export class NodeSystem implements SystemPort {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly options: NodeSystemOptions = {},
  ) {}

  getEnv(name: string): string | undefined {
    // process.env ist unter Windows schon unempfindlich, eine Kopie davon nicht.
    const direct = this.env[name];
    if (direct !== undefined) return direct;
    const wanted = name.toLowerCase();
    const key = Object.keys(this.env).find((k) => k.toLowerCase() === wanted);
    return key === undefined ? undefined : this.env[key];
  }

  findProgram(name: string): string | null {
    if (this.options.noGit && path.parse(name).name.toLowerCase() === 'git') return null;
    const dirs = (this.getEnv('PATH') ?? '').split(path.delimiter).filter(Boolean);
    const hasExtension = path.extname(name) !== '';
    const extensions =
      process.platform === 'win32' && !hasExtension
        ? (this.getEnv('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
        : [''];
    for (const dir of dirs) {
      for (const ext of extensions) {
        const candidate = path.join(dir.replace(/^"|"$/g, ''), name + ext);
        if (isFile(candidate)) return candidate;
      }
    }
    return null;
  }

  homeDir(): string {
    return os.homedir();
  }

  listDirectories(dir: string): string[] {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  exists(targetPath: string): boolean {
    return fs.existsSync(targetPath);
  }

  readTextFile(file: string): string | null {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  }
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}
