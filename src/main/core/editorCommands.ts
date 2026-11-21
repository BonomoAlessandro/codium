// Befehle für die Datei-Tabs eines Projekts: offene Tabs, aktiver Tab und Cursor je Datei im Projekt-Zustand. Die
// Tabs gehören zur Oberfläche; der Kern sichert sie nur und prüft beim Wiederherstellen, welche Dateien es noch gibt.
// Lädt nie Electron.
//
// Gespeichert wird relativ zum Projektordner mit „/“, wie bei den aufgeklappten Ordnern, damit der Zustand nicht an
// der Schreibweise des Projektpfads hängt. Cursor folgen Umbenennungen in Codium und entfallen beim Löschen.

import * as path from 'node:path';
import {
  ErrorCode,
  type CommandName,
  type CommandParams,
  type CommandResult,
  type CursorState,
  type EditorTabs,
  type FileOperation,
} from '../../shared/types';
import type { ProjectCore } from './projectCore';
import { CommandError, type CallContext } from './router';
import { MAX_CURSORS, MAX_TABS, parseCursor, type ProjectState } from './schema';

type RegisterProjectCommand = <K extends CommandName>(
  name: K,
  handler: (project: ProjectCore, params: CommandParams<K>, ctx: CallContext) => CommandResult<K> | Promise<CommandResult<K>>,
) => void;

/** Meldet die Befehle für Tabs und Cursor an; alle brauchen ein offenes Projekt. */
export function registerEditorCommands(register: RegisterProjectCommand): void {
  register('project.tabs', (project) => savedTabs(project));
  register('project.setTabs', (project, params) => setTabs(project, params));
  register('project.cursor', (project, params) => cursorOf(project, params));
  register('project.setCursor', (project, params) => setCursor(project, params));
}

/** Der Schlüssel eines relativen Pfads für Vergleiche und für `cursors`: unter Windows klein geschrieben. */
function relativeKey(relative: string): string {
  return process.platform === 'win32' ? relative.toLowerCase() : relative;
}

/** Ein geprüfter absoluter Pfad relativ zum Projektordner, mit „/“. */
function relativeOf(project: ProjectCore, absolute: string): string {
  return path.relative(project.path, absolute).split(path.sep).join('/');
}

function absoluteOf(project: ProjectCore, relative: string): string {
  return path.join(project.path, ...relative.split('/'));
}

/** Ein Dateipfad aus einem Befehl: absolut, im Projekt und nicht der Projektordner selbst (ohne Dateizugriff). */
function requireFilePath(project: ProjectCore, value: unknown): string {
  const absolute = project.files.lexicalPath(value);
  if (relativeOf(project, absolute) === '') throw invalidParams('The project folder is not a file.');
  return absolute;
}

/**
 * Die gespeicherten Tabs als absolute Pfade, ohne Dateien, die es nicht mehr gibt. War der aktive darunter, wird der
 * nächste verbliebene Tab aktiv, sonst der vorherige.
 */
async function savedTabs(project: ProjectCore): Promise<EditorTabs> {
  const { tabs = [], activeTab } = project.state;
  const absolute = tabs.map((relative) => absoluteOf(project, relative));
  const exists = await project.files.existingFiles(absolute);
  const kept = absolute.filter((_, i) => exists[i]);
  if (kept.length === 0) return { tabs: [], active: null };
  const activeIndex = activeTab === undefined ? -1 : tabs.indexOf(activeTab);
  if (activeIndex < 0) return { tabs: kept, active: kept[0] };
  const next = absolute.findIndex((_, i) => i >= activeIndex && exists[i]);
  const previous = absolute.findLastIndex((_, i) => i < activeIndex && exists[i]);
  return { tabs: kept, active: absolute[next >= 0 ? next : previous] };
}

function setTabs(project: ProjectCore, params: unknown): void {
  const record = (params ?? {}) as Partial<Record<keyof EditorTabs, unknown>>;
  if (!Array.isArray(record.tabs) || record.tabs.length > MAX_TABS) {
    throw invalidParams(`A list of at most ${MAX_TABS} tabs is expected.`);
  }
  const tabs: string[] = [];
  const keys = new Set<string>();
  for (const value of record.tabs) {
    const relative = relativeOf(project, requireFilePath(project, value));
    const key = relativeKey(relative);
    if (keys.has(key)) throw invalidParams('A file can only have one tab.');
    keys.add(key);
    tabs.push(relative);
  }
  let activeTab: string | undefined;
  if (record.active !== null) {
    const key = relativeKey(relativeOf(project, requireFilePath(project, record.active)));
    activeTab = tabs.find((t) => relativeKey(t) === key);
    if (activeTab === undefined) throw invalidParams('The active tab must be one of the tabs.');
  }
  project.updateState((state) => {
    state.tabs = tabs;
    if (activeTab === undefined) delete state.activeTab;
    else state.activeTab = activeTab;
  });
}

function cursorOf(project: ProjectCore, params: unknown): CursorState | null {
  const relative = relativeOf(project, requireFilePath(project, field(params, 'path')));
  return project.state.cursors?.[relativeKey(relative)] ?? null;
}

function setCursor(project: ProjectCore, params: unknown): void {
  const relative = relativeOf(project, requireFilePath(project, field(params, 'path')));
  const cursor = parseCursor(field(params, 'cursor'));
  if (!cursor) throw invalidParams('A cursor with line and column from 1 and a scroll position is expected.');
  const key = relativeKey(relative);
  project.updateState((state) => {
    // Neu einsortieren: Der zuletzt gesetzte steht am Ende, die ältesten fallen über der Grenze heraus.
    const others = Object.entries(state.cursors ?? {}).filter(([k]) => k !== key);
    state.cursors = Object.fromEntries([...others, [key, cursor] as const].slice(-MAX_CURSORS));
  });
}

/**
 * Passt Tabs und Cursor einer Dateioperation von Codium an: Umbenennen verschiebt die Einträge der Datei bzw. aller
 * Dateien im Ordner, Löschen entfernt sie. Die Oberfläche speichert ihre Tabs danach ohnehin neu; so stimmt der
 * Zustand aber auch, wenn sie das nicht mehr schafft (etwa weil das Fenster gerade zugeht).
 */
export function followFileOperation(projectPath: string, state: ProjectState, op: FileOperation): void {
  const relative = (absolute: string) => path.relative(projectPath, absolute).split(path.sep).join('/');
  const inside = (key: string, prefix: string) => key === prefix || key.startsWith(`${prefix}/`);
  let move: (relativePath: string) => string | null;
  if (op.kind === 'renamed') {
    const from = relative(op.from);
    const to = relative(op.to);
    const fromKey = relativeKey(from);
    move = (p) => (inside(relativeKey(p), fromKey) ? to + p.slice(from.length) : p);
  } else if (op.kind === 'deleted') {
    const goneKey = relativeKey(relative(op.path));
    move = (p) => (inside(relativeKey(p), goneKey) ? null : p);
  } else {
    return;
  }
  if (state.tabs) {
    const active = state.activeTab;
    const moved = state.tabs.map((t) => ({ before: t, after: move(t) }));
    state.tabs = moved.flatMap((m) => (m.after === null ? [] : [m.after]));
    const activeAfter = moved.find((m) => m.before === active)?.after;
    if (activeAfter) state.activeTab = activeAfter;
    else delete state.activeTab;
  }
  if (state.cursors) {
    const entries = Object.entries(state.cursors).flatMap(([key, cursor]): Array<[string, CursorState]> => {
      const after = move(key);
      return after === null ? [] : [[relativeKey(after), cursor]];
    });
    state.cursors = Object.fromEntries(entries);
  }
}

function field(params: unknown, name: string): unknown {
  return typeof params === 'object' && params !== null ? (params as Record<string, unknown>)[name] : undefined;
}

function invalidParams(message: string): CommandError {
  return new CommandError(message, ErrorCode.invalidParams);
}
