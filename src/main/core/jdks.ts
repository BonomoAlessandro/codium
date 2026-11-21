// JDK-Erkennung für den Java-Sprachserver (jdtls braucht Java 25 oder neuer). Über den Port „System“, damit Tests
// vorgegebene Ordner verwenden. Lädt nie Electron.
//
// Gesucht wird in JAVA_HOME, in den üblichen Installationsordnern (Oracle, Eclipse Adoptium, Microsoft, Amazon
// Corretto, Azul Zulu, BellSoft) unter „Program Files“ und unter `%LOCALAPPDATA%\Programs`, und in den von IntelliJ
// heruntergeladenen JDKs (`~\.jdks`). Ein JDK erkennt Codium an `bin\java.exe` und der Datei `release` mit
// `JAVA_VERSION`.

import * as path from 'node:path';
import type { JdkInfo } from '../../shared/types';
import type { SystemPort } from './ports';

/** Mindestversion von Java für jdtls. */
export const JDTLS_MIN_JAVA = 25;

/** Ordner der Hersteller unter „Program Files“ bzw. `%LOCALAPPDATA%\Programs`, in denen JDKs liegen. */
const VENDOR_FOLDERS = ['Java', 'Eclipse Adoptium', 'Temurin', 'Microsoft', 'Amazon Corretto', 'Zulu', 'BellSoft', 'OpenJDK'];

/** Liest Version und Hersteller eines JDK-Ordners; `null`, wenn es keines ist. */
export function readJdk(system: SystemPort, dir: string): JdkInfo | null {
  if (!system.exists(path.join(dir, 'bin', 'java.exe')) && !system.exists(path.join(dir, 'bin', 'java'))) return null;
  const release = system.readTextFile(path.join(dir, 'release'));
  if (release === null) return null;
  const version = /^JAVA_VERSION="?([^"\r\n]+)"?/m.exec(release)?.[1];
  if (!version) return null;
  const vendor = /^IMPLEMENTOR="?([^"\r\n]+)"?/m.exec(release)?.[1];
  const major = majorVersion(version);
  if (major === null) return null;
  return { path: dir, version, major, ...(vendor ? { vendor } : {}) };
}

/** Die Hauptversion: „1.8.0_392“ → 8, „21.0.13“ → 21, „25“ → 25. */
export function majorVersion(version: string): number | null {
  const parts = version.split(/[.+_-]/).map((p) => Number.parseInt(p, 10));
  if (!Number.isFinite(parts[0])) return null;
  return parts[0] === 1 && Number.isFinite(parts[1]) ? parts[1] : parts[0];
}

/** Vergleicht Versionen numerisch Teil für Teil („25.0.10“ nach „25.0.9“). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+_-]/).map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(/[.+_-]/).map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Alle erkannten JDKs, neueste zuerst, ohne Doppelte (JAVA_HOME zeigt oft auf eines der anderen). */
export function detectJdks(system: SystemPort): JdkInfo[] {
  const candidates: string[] = [];
  const javaHome = system.getEnv('JAVA_HOME');
  if (javaHome) candidates.push(javaHome.replace(/[\\/]+$/, ''));
  const roots: string[] = [];
  for (const variable of ['ProgramFiles', 'ProgramW6432', 'ProgramFiles(x86)']) {
    const dir = system.getEnv(variable);
    if (dir) roots.push(...VENDOR_FOLDERS.map((vendor) => path.join(dir, vendor)));
  }
  const localAppData = system.getEnv('LOCALAPPDATA');
  if (localAppData) roots.push(...VENDOR_FOLDERS.map((vendor) => path.join(localAppData, 'Programs', vendor)));
  roots.push(path.join(system.homeDir(), '.jdks'));
  for (const root of roots) for (const name of system.listDirectories(root)) candidates.push(path.join(root, name));

  const seen = new Set<string>();
  const jdks: JdkInfo[] = [];
  for (const dir of candidates) {
    const key = path.resolve(dir).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const jdk = readJdk(system, dir);
    if (jdk) jdks.push(jdk);
  }
  return jdks.sort((a, b) => compareVersions(b.version, a.version) || a.path.localeCompare(b.path));
}

/**
 * Das JDK für jdtls: das eingestellte, wenn es noch erkannt wird und Java 25 oder neuer ist; sonst („Newest detected“)
 * das neueste erkannte ab 25. `null`, wenn es keines gibt.
 */
export function jdkForLanguageServer(jdks: readonly JdkInfo[], configured: string | null): JdkInfo | null {
  const usable = jdks.filter((j) => j.major >= JDTLS_MIN_JAVA);
  if (configured !== null) {
    const chosen = usable.find((j) => path.resolve(j.path).toLowerCase() === path.resolve(configured).toLowerCase());
    if (chosen) return chosen;
  }
  return usable[0] ?? null;
}

/** Ob ein Projekt Java-Kennzeichen hat: eine Maven- oder Gradle-Baudatei im Projektordner. */
export function hasJavaMarkers(system: SystemPort, projectPath: string): boolean {
  return ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].some((name) =>
    system.exists(path.join(projectPath, name)),
  );
}
