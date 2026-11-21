// Befehle des Datei-Dienstes und die aufgeklappten Ordner des Dateibaums im Projekt-Zustand. Lädt nie Electron.

import * as path from 'node:path';
import { ErrorCode, type CommandName, type CommandParams, type CommandResult } from '../../shared/types';
import type { ProjectCore } from './projectCore';
import { CommandError, type CallContext } from './router';
import { MAX_EXPANDED_FOLDERS } from './schema';

type RegisterProjectCommand = <K extends CommandName>(
  name: K,
  handler: (project: ProjectCore, params: CommandParams<K>, ctx: CallContext) => CommandResult<K> | Promise<CommandResult<K>>,
) => void;

/** Meldet die Befehle des Datei-Dienstes an; alle brauchen ein offenes Projekt. */
export function registerFileCommands(register: RegisterProjectCommand): void {
  register('files.list', (project, params) => project.files.list(params));
  register('files.createFile', (project, params) => project.files.createFile(params));
  register('files.createDirectory', (project, params) => project.files.createDirectory(params));
  register('files.rename', (project, params) => project.files.rename(params));
  register('files.delete', (project, params) => project.files.delete(params));
  register('files.copy', (project, params) => project.files.copy(params));
  register('files.suggestCopyName', (project, params) => project.files.suggestCopyName(params));
  register('files.copyPaths', (project, params) => project.files.copyPaths(params));
  register('files.showInExplorer', (project, params) => project.files.showInExplorer(params));
  register('files.read', (project, params) => project.files.read(params));
  register('project.expandedFolders', (project) => expandedFolders(project));
  register('project.setExpandedFolders', (project, params) => setExpandedFolders(project, params));
}

/**
 * Die aufgeklappten Ordner als absolute Pfade. Gespeichert sind sie relativ zum Projekt (mit „/“, der Projektordner
 * selbst als leerer Pfad), damit sie nicht von der Schreibweise des Projektpfads abhängen. Ohne gespeicherte ist der
 * Projektordner aufgeklappt.
 */
function expandedFolders(project: ProjectCore): string[] {
  return expandedFolderPaths(project.path, project.state.expandedFolders);
}

/** Die gespeicherten aufgeklappten Ordner (relativ, siehe `ProjectState.expandedFolders`) als absolute Pfade. */
export function expandedFolderPaths(projectPath: string, saved: readonly string[] | undefined): string[] {
  if (saved === undefined) return [projectPath];
  return saved.map((relative) => (relative === '' ? projectPath : path.join(projectPath, ...relative.split('/'))));
}

/**
 * Speichert die aufgeklappten Ordner. Geprüft wird ohne Dateizugriff, denn der Befehl berührt die Festplatte nicht:
 * Jeder Pfad muss absolut sein und im Projekt liegen. Ob es die Ordner noch gibt, zeigt sich beim Lesen.
 */
function setExpandedFolders(project: ProjectCore, params: unknown): void {
  const paths = (params as { paths?: unknown } | undefined)?.paths;
  if (!Array.isArray(paths) || paths.length > MAX_EXPANDED_FOLDERS) {
    throw new CommandError(`A list of at most ${MAX_EXPANDED_FOLDERS} paths is expected.`, ErrorCode.invalidParams);
  }
  const relative = new Map<string, string>();
  const absolutes: string[] = [];
  for (const value of paths) {
    const absolute = project.files.lexicalPath(value);
    const rel = path.relative(project.path, absolute).split(path.sep).join('/');
    const key = process.platform === 'win32' ? rel.toLowerCase() : rel;
    if (relative.has(key)) continue;
    relative.set(key, rel);
    absolutes.push(absolute);
  }
  project.updateState((state) => {
    state.expandedFolders = [...relative.values()];
  });
  project.files.setExpandedFolders(absolutes);
}
