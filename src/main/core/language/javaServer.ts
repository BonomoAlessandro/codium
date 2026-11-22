// Start des Java-Sprachservers jdtls (Ticket 14), nach der Spezifikation („Sprachverständnis“): mit dem JDK aus der
// JDK-Erkennung (ab Java 25), mit Lombok als Java-Agent, Arbeitsdaten und einer beschreibbaren Kopie des
// Konfigurationsordners pro Projekt im Datenordner. Die erkannten JDKs gehen als Laufzeiten an jdtls, der Gradle-Daemon
// bekommt ein JDK passend zur Gradle-Version des Wrappers. Lädt nie Electron.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { JdkInfo } from '../../../shared/types';

/** Mitgeliefertes jdtls und Lombok. */
export interface BundledJava {
  /** Ordner von jdtls (mit `plugins` und `config_win`). */
  jdtls: string;
  lombok: string;
}

export interface JavaLaunchOptions {
  bundled: BundledJava;
  /** Das JDK für jdtls (ab 25). */
  jdk: JdkInfo;
  /** Alle erkannten JDKs, als Laufzeiten für jdtls. */
  jdks: readonly JdkInfo[];
  /** Ordner für Arbeitsdaten und Konfiguration dieses Projekts. */
  dataDir: string;
  /** Eigene Maven-Einstellungen (Tests: Maven Central, lokales Repository im Test-Zwischenspeicher). */
  mavenUserSettings?: string;
}

/** Kennzeichen eines Java-Projekts im Projektordner. */
export const JAVA_MARKERS = ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'];

export function isJavaFile(filePath: string): boolean {
  return /\.java$/i.test(filePath);
}

/** Befehl, Argumente und Einstellungen für jdtls. */
export function javaLaunch(projectPath: string, options: JavaLaunchOptions) {
  const plugins = path.join(options.bundled.jdtls, 'plugins');
  const launcher = fs.readdirSync(plugins).find((f) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(f));
  if (!launcher) throw new Error(`Kein Launcher in ${plugins}`);
  const configuration = writableConfiguration(options.bundled.jdtls, options.dataDir);
  const workspace = path.join(options.dataDir, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const java = path.join(options.jdk.path, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const gradleJdk = gradleJdkFor(projectPath, options.jdks);
  return {
    kind: 'jdtls' as const,
    command: java,
    args: [
      '-Declipse.application=org.eclipse.jdt.ls.core.id1',
      '-Dosgi.bundles.defaultStartLevel=4',
      '-Declipse.product=org.eclipse.jdt.ls.core.product',
      '-Dosgi.checkConfiguration=true',
      '-Dlog.level=WARNING',
      '-Xms256m',
      '-Xmx2G',
      `-javaagent:${options.bundled.lombok}`,
      '--add-modules=ALL-SYSTEM',
      '--add-opens',
      'java.base/java.util=ALL-UNNAMED',
      '--add-opens',
      'java.base/java.lang=ALL-UNNAMED',
      '-jar',
      path.join(plugins, launcher),
      '-configuration',
      configuration,
      '-data',
      workspace,
    ],
    env: { JAVA_HOME: options.jdk.path },
    initializationOptions: {
      bundles: [],
      workspaceFolders: [],
      extendedClientCapabilities: { classFileContentsSupport: true, progressReportProvider: false },
      settings: { java: javaSettings(options, gradleJdk) },
    },
    gradleJdk,
  };
}

/** Einstellungen für jdtls: Laufzeiten, Quellen herunterladen, Methoden in der Symbolsuche, Gradle-JDK, Maven. */
export function javaSettings(options: Pick<JavaLaunchOptions, 'jdk' | 'jdks' | 'mavenUserSettings'>, gradleJdk: JdkInfo | null) {
  return {
    home: options.jdk.path,
    configuration: {
      runtimes: javaRuntimes(options.jdks),
      ...(options.mavenUserSettings ? { maven: { userSettings: options.mavenUserSettings } } : {}),
      updateBuildConfiguration: 'automatic',
    },
    import: {
      maven: { enabled: true },
      gradle: { enabled: true, wrapper: { enabled: true }, ...(gradleJdk ? { java: { home: gradleJdk.path } } : {}) },
    },
    maven: { downloadSources: true },
    eclipse: { downloadSources: true },
    symbols: { includeSourceMethodDeclarations: true },
    contentProvider: { preferred: 'fernflower' },
    autobuild: { enabled: true },
    format: { enabled: false },
    signatureHelp: { enabled: true },
  };
}

/** Die erkannten JDKs als Laufzeiten nach Ausführungsumgebung (je Major die neueste), die mit jdtls die Standard. */
export function javaRuntimes(jdks: readonly JdkInfo[]): Array<{ name: string; path: string }> {
  const byName = new Map<string, JdkInfo>();
  for (const jdk of jdks) {
    const name = executionEnvironment(jdk.major);
    if (!name) continue;
    const known = byName.get(name);
    if (!known || compareVersions(jdk.version, known.version) > 0) byName.set(name, jdk);
  }
  return [...byName].map(([name, jdk]) => ({ name, path: jdk.path }));
}

function executionEnvironment(major: number): string | null {
  if (major === 8) return 'JavaSE-1.8';
  if (major >= 9) return `JavaSE-${major}`;
  return null;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+_-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.+_-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Die Gradle-Version des Wrappers (`gradle/wrapper/gradle-wrapper.properties`); `null` ohne Wrapper. */
export function wrapperGradleVersion(projectPath: string): string | null {
  try {
    const text = fs.readFileSync(path.join(projectPath, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'utf8');
    return /distributionUrl=.*gradle-(\d+(?:\.\d+){0,2}(?:-[a-z0-9-]+)?)-(?:bin|all)\.zip/i.exec(text)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Welche Java-Versionen eine Gradle-Version zum Ausführen unterstützt (Verträglichkeitstabelle von Gradle, „Running
 * Gradle“): `[mindestens, höchstens]`.
 */
export function gradleJavaRange(version: string): [number, number] {
  const [major, minor] = version.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const at = (maj: number, min: number) => major > maj || (major === maj && minor >= min);
  if (at(9, 1)) return [17, 25];
  if (at(9, 0)) return [17, 24];
  if (at(8, 14)) return [8, 24];
  if (at(8, 10)) return [8, 23];
  if (at(8, 8)) return [8, 22];
  if (at(8, 5)) return [8, 21];
  if (at(8, 3)) return [8, 20];
  if (at(7, 6)) return [8, 19];
  if (at(7, 5)) return [8, 18];
  if (at(7, 3)) return [8, 17];
  if (at(7, 0)) return [8, 16];
  if (at(6, 7)) return [8, 15];
  return [8, 14];
}

/** Das JDK für den Gradle-Daemon: das neueste erkannte, das die Gradle-Version des Wrappers verträgt. */
export function gradleJdkFor(projectPath: string, jdks: readonly JdkInfo[]): JdkInfo | null {
  const version = wrapperGradleVersion(projectPath);
  if (!version) return null;
  const [min, max] = gradleJavaRange(version);
  return [...jdks].filter((j) => j.major >= min && j.major <= max).sort((a, b) => b.major - a.major || compareVersions(b.version, a.version))[0] ?? null;
}

/**
 * Eine beschreibbare Kopie des Konfigurationsordners von jdtls (der Programmordner der installierten App ist nicht
 * beschreibbar). Neu kopiert, wenn sich jdtls geändert hat.
 */
function writableConfiguration(jdtls: string, dataDir: string): string {
  const source = path.join(jdtls, process.platform === 'win32' ? 'config_win' : process.platform === 'darwin' ? 'config_mac' : 'config_linux');
  const target = path.join(dataDir, 'config');
  const stamp = path.join(target, '.codium-source');
  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== source) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(source, target, { recursive: true });
    fs.writeFileSync(stamp, source);
  }
  return target;
}
