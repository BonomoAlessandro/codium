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

/** Meldet die Befehle des Datei-, Such- und Terminal-Dienstes an; alle brauchen ein offenes Projekt. */
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
  register('files.readImage', (project, params) => project.files.readImage(params));
  register('files.write', (project, params) => project.files.write(params));
  register('files.findByName', (project, params) => project.search.findByName(params));
  register('search.start', (project, params) => project.search.startSearch(params));
  register('search.cancel', (project, params) => project.search.cancelSearch(params));
  register('terminal.start', (project, params) => project.terminals.start(params));
  register('terminal.write', (project, params) => project.terminals.write(params));
  register('terminal.resize', (project, params) => project.terminals.resize(params));
  register('terminal.close', (project, params) => project.terminals.close(params));
  register('language.didOpen', (project, params) => project.language.didOpen(params));
  register('language.didChange', (project, params) => project.language.didChange(params));
  register('language.didClose', (project, params) => project.language.didClose(params));
  register('language.definition', (project, params) => project.language.definition(params));
  register('language.references', (project, params) => project.language.references(params));
  register('language.implementations', (project, params) => project.language.implementations(params));
  register('language.hover', (project, params) => project.language.hover(params));
  register('language.readTarget', (project, params) => project.language.readTarget(params));
  register('language.completion', (project, params) => project.language.completion(params));
  register('language.resolveCompletion', (project, params) => project.language.resolveCompletion(params));
  register('language.semanticTokens', (project, params) => project.language.semanticTokens(params));
  register('language.symbols', (project, params) => project.language.symbols(params));
  register('git.state', (project) => project.git.current());
  register('git.refresh', (project) => project.git.refresh());
  register('git.branches', (project) => project.git.branches());
  register('git.createBranch', (project, params) => project.git.createBranch(params));
  register('git.checkout', (project, params) => project.git.checkout(params));
  register('git.checkoutRemote', (project, params) => project.git.checkoutRemote(params));
  register('git.renameBranch', (project, params) => project.git.renameBranch(params));
  register('git.deleteBranch', (project, params) => project.git.deleteBranch(params));
  register('git.console', (project) => project.git.console());
  register('git.commit', (project, params) => project.git.commit(params));
  register('git.fileAtCommit', (project, params) => project.git.fileAtCommit(params));
  register('git.changes', (project, params) => project.git.changes(params));
  register('git.fetch', (project) => project.git.fetch());
  register('git.pull', (project) => project.git.pull());
  register('git.push', (project) => project.git.push());
  register('git.abort', (project) => project.git.abort());
  register('git.continueRebase', (project) => project.git.continueRebase());
  register('git.mergeMessage', (project) => project.git.mergeMessage());
  register('git.conflictMarkers', (project) => project.git.conflictMarkers());
  register('git.lastMessage', (project) => project.git.lastMessage());
  register('git.rollback', (project, params) => project.git.rollback(params));
  register('git.addToGitignore', (project, params) => project.git.addToGitignore(params));
  register('project.commitView', (project) => ({ groupByDirectory: project.state.commitGroupByDirectory === true }));
  register('project.setCommitView', (project, params) => {
    const value = (params as { groupByDirectory?: unknown } | undefined)?.groupByDirectory;
    if (typeof value !== 'boolean') throw new CommandError('A boolean is expected.', ErrorCode.invalidParams);
    project.updateState((state) => {
      state.commitGroupByDirectory = value;
    });
  });
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
