// Projektfenster nach dem neuen IntelliJ: Kopfzeile, links und rechts die Symbolleisten, dazwischen die
// Werkzeugfenster um den Code-Bereich (das untere über die ganze Breite zwischen den Symbolleisten), unten die
// Statusleiste. Welches Werkzeugfenster je Seite aktiv und offen ist und wie gross es ist, speichert der Kern im
// Projekt-Zustand. Die Regeln dazu stehen ohne DOM in toolWindowLayout.ts.
//
// Ein Werkzeugfenster bleibt nach dem ersten Öffnen eingehängt und wird beim Schliessen nur verborgen, wie in
// IntelliJ: Dateibaum, Terminal und Log behalten so ihren Zustand.
//
// Im Code-Bereich liegen die Datei-Tabs mit Monaco (editor/EditorArea.tsx). „Datei öffnen“ aus dem Dateibaum öffnet
// dort einen Tab; der aktive Tab geht an den Dateibaum („Select Opened File“) und an die Statusleiste.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { CodiumError, ErrorCode } from '../../shared/types';
import { BranchPopup, type BranchActions } from '../git/BranchPopup';
import { GitToolWindow } from '../git/GitToolWindow';
import { CommitToolWindow, changeKind } from '../git/CommitToolWindow';
import { GIT_NOT_FOUND_TEXT, useGitState } from '../git/gitState';
import { useGitAvailable } from '../CloneDialog';
import { EditorArea, type EditorAreaHandle, type EditorStatus } from '../editor/EditorArea';
import { FindInFilesPopup, type SearchOutcome } from '../search/FindInFilesPopup';
import { GotoFilePopup, RecentFilesPopup, SymbolPopup } from '../search/FilePopups';
import { FindToolWindow, type FindTab } from '../search/FindToolWindow';
import { errorText } from '../errors';
import { useSettings } from '../settings';
import { SettingsDialog } from '../SettingsDialog';
import { flushSync } from 'react-dom';
import {
  TOOL_WINDOW_SIDE,
  type CodiumApi,
  type GitFileStatus,
  type ProjectInfo,
  type SearchMatch,
  type SearchOptions,
  type ToolWindowId,
  type ToolWindowLayout,
  type ToolWindowSide,
} from '../../shared/types';
import { TOOL_WINDOW_ICONS } from '../icons';
import { bindingForKey, commandForKey, shortcutLabel, type KeyCommand, type ToolWindowCommand } from '../keymap';
import type { Notify } from '../Notices';
import { isDialogOpen, useAsk, useAskText } from '../popup/Dialogs';
import { closeOpenMenus } from '../popup/Menu';
import type { RunningWork } from '../progress';
import type { ProjectActions } from '../RecentProjects';
import { relativeLabel } from './filePaths';
import { Header } from './Header';
import { ProjectView } from './ProjectView';
import { TerminalToolWindow, type TerminalToolWindowHandle } from '../terminal/TerminalToolWindow';
import { StatusBar } from './StatusBar';
import { ToolWindowHeader } from './ToolWindowHeader';
import {
  STRIPES,
  TOOL_WINDOWS,
  beginResize,
  hideSide,
  isShown,
  panelSizes,
  resizeTo,
  shortcutAction,
  showToolWindow,
  toggleToolWindow,
  toolWindowsOn,
  visibleLayout,
  type Availability,
  type LayoutArea,
  type WidthPriority,
} from './toolWindowLayout';

interface ProjectWindowProps {
  api: CodiumApi;
  project: ProjectInfo;
  actions: ProjectActions;
  work: readonly RunningWork[];
  notify: Notify;
}

/** Setzt den Fokus in ein Werkzeugfenster: auf sein Hauptelement (etwa den Dateibaum), sonst auf das Fenster selbst. */
function focusToolWindow(section: HTMLElement | undefined): void {
  (section?.querySelector<HTMLElement>('[data-autofocus]') ?? section)?.focus({ preventScroll: true });
}

/** Ereignis am Fenster: „Open README“ einer Meldung; das Projektfenster öffnet das README in einem Tab. */
export const OPEN_README_EVENT = 'codium:open-readme';

/** Die Überschrift im README, an der „Open README“ steht. */
const PREREQUISITES_HEADING = /^##\s+Voraussetzungen\s*$/;

/** Optionen der Projektsuche beim ersten Öffnen. */
const INITIAL_SEARCH: SearchOptions = {
  query: '',
  matchCase: false,
  wholeWord: false,
  regex: false,
  fileMask: '',
  includeIgnored: false,
};

/** Welches Suchfenster über dem Editor offen ist. */
type SearchPopup = 'gotoFile' | 'recentFiles' | 'findInFiles' | 'gotoClass' | 'gotoSymbol' | null;

/** Layout, falls der Kern keines liefert (das Fenster schliesst sich gerade): alle Seiten zu. */
const CLOSED_LAYOUT: ToolWindowLayout = {
  left: { active: 'project', open: false, size: 280 },
  bottom: { active: 'terminal', open: false, size: 260 },
  right: { active: 'database', open: false, size: 320 },
};

const RESIZE_CLASSES = ['resizing-rows', 'resizing-columns'];

/** Ein laufendes Ziehen an einer Trennlinie. */
interface ActiveDrag {
  side: ToolWindowSide;
  /** Meldet die Ereignisse am Fenster wieder ab und gibt den Zeiger frei. */
  release: () => void;
}

export function ProjectWindow({ api, project, actions, work, notify }: ProjectWindowProps) {
  const { layout, layoutRef, change } = useToolWindowLayout(api);
  const settings = useSettings(api);
  const editorRef = useRef<EditorAreaHandle>(null);
  const terminalRef = useRef<TerminalToolWindowHandle>(null);

  // ---------- Git (Ticket 15) ----------

  const gitState = useGitState(api);
  const gitStateRef = useRef(gitState);
  gitStateRef.current = gitState;
  // Ohne Git ein Hinweis auf das fehlende Git statt „Not a Git repository“ (Review von Ticket 15).
  const gitAvailable = useGitAvailable(api);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const ask = useAsk();
  const askText = useAskText();
  /** Zeigt das Werkzeugfenster „Commit“ mit dem Fokus in der Nachricht. */
  const openCommitRef = useRef(() => {});
  const branchActions = useMemo((): BranchActions => {
    /** Vor jeder schreibenden Git-Aktion: alle Tabs speichern (Ticket 07); Fehler von Git im Wortlaut. */
    const act = async (work: () => Promise<unknown>): Promise<string | null> => {
      await (editorRef.current?.saveAll() ?? Promise.resolve());
      try {
        await work();
        return null;
      } catch (err) {
        return errorText(err);
      }
    };
    const checkoutWith = async (work: () => Promise<unknown>) => {
      await (editorRef.current?.saveAll() ?? Promise.resolve());
      try {
        await work();
      } catch (err) {
        if (err instanceof CodiumError && err.code === ErrorCode.gitCheckoutBlocked) {
          const files = ((err.data as { files?: string[] } | undefined)?.files ?? []).map((f) => relativeLabel(project.path, f));
          await ask({
            title: 'Checkout Failed',
            // Die Meldung von Git im Wortlaut (Spezifikation; Review von Ticket 15), die Dateien als Liste.
            message: err.message,
            items: files,
            buttons: [{ id: 'ok', label: 'OK', primary: true }],
          });
          return;
        }
        notify({ level: 'error', text: errorText(err) });
      }
    };
    return {
      commit: () => openCommitRef.current(),
      pull: () => void gitRemoteRef.current.pull(),
      push: () => void gitRemoteRef.current.push(),
      fetch: () => void gitRemoteRef.current.fetch(),
      newBranch: (from) => {
        let checkout = true;
        void askText({
          title: 'Create New Branch',
          message: from ? `New branch from '${from}'` : 'New branch name',
          value: '',
          okLabel: 'Create',
          validate: (v) => (v.trim() === '' ? 'Enter a branch name.' : null),
          checkbox: { label: 'Checkout branch', checked: true, onChange: (v) => (checkout = v) },
          submit: (name) => act(() => api.request('git.createBranch', { name: name.trim(), ...(from ? { from } : {}), checkout })),
        });
      },
      checkout: (name) => void checkoutWith(() => api.request('git.checkout', { name })),
      checkoutRemote: (name) => void checkoutWith(() => api.request('git.checkoutRemote', { name })),
      rename: (name) => {
        void askText({
          title: 'Rename Branch',
          message: `New name for '${name}'`,
          value: name,
          okLabel: 'Rename',
          validate: (v) => (v.trim() === '' ? 'Enter a branch name.' : null),
          submit: (newName) => act(() => api.request('git.renameBranch', { name, newName: newName.trim() })),
        });
      },
      remove: (name) => {
        void (async () => {
          try {
            await api.request('git.deleteBranch', { name });
          } catch (err) {
            if (err instanceof CodiumError && err.code === ErrorCode.gitNotMerged) {
              const choice = await ask({
                title: 'Delete Branch',
                message: `The branch '${name}' is not fully merged. Delete it anyway?`,
                buttons: [
                  { id: 'delete', label: 'Delete' },
                  { id: 'cancel', label: 'Cancel', primary: true },
                ],
              });
              if (choice === 'delete') {
                await api.request('git.deleteBranch', { name, force: true }).catch((e: unknown) => notify({ level: 'error', text: errorText(e) }));
              }
              return;
            }
            notify({ level: 'error', text: errorText(err) });
          }
        })();
      },
    };
  }, [api, ask, askText, notify, project.path]);
  // ---------- Fetch, Pull, Push (Ticket 18) ----------

  // Fortschritt zeigt die Statusleiste (vom Kern); hier Erfolg, Fehler und das Öffnen der Änderungsansicht bei Konflikten.
  const gitRemote = {
    fetch: async () => {
      try {
        await api.request('git.fetch');
        notify({ level: 'success', text: 'Fetched from all remotes.' });
      } catch (err) {
        notify({ level: 'error', text: errorText(err) });
      }
    },
    pull: async () => {
      try {
        // Vorher speichern: Der Pull ändert Dateien, ungespeicherte Eingaben gingen sonst in Konflikte mit der Platte.
        await (editorRef.current?.saveAll() ?? Promise.resolve());
        const result = await api.request('git.pull');
        if (result.conflicts) {
          notify({ level: 'info', text: 'Pull stopped with conflicts. Resolve them and commit in the Commit tool window.' });
          openCommitRef.current();
        } else notify({ level: 'success', text: 'Pulled.' });
      } catch (err) {
        notify({ level: 'error', text: errorText(err) });
      }
    },
    push: async () => {
      try {
        const result = await api.request('git.push');
        notify({
          level: 'success',
          text: `Pushed ${result.branch} to ${result.remote}/${result.branch}${result.upstreamSet ? ' and set it as upstream' : ''}.`,
        });
      } catch (err) {
        if (err instanceof CodiumError && err.code === ErrorCode.gitPushRejected) {
          notify({
            level: 'error',
            text: `Push rejected: the remote has changes you do not have yet. Pull them first.\n${err.message}`,
            actions: [{ label: 'Pull', run: () => void gitRemoteRef.current.pull() }],
          });
          return;
        }
        notify({ level: 'error', text: errorText(err) });
      }
    },
  };
  const gitRemoteRef = useRef(gitRemote);
  gitRemoteRef.current = gitRemote;

  const pendingTerminalCwd = useRef<string | undefined>(undefined);
  const takePendingTerminalCwd = useCallback(() => {
    const cwd = pendingTerminalCwd.current;
    pendingTerminalCwd.current = undefined;
    return cwd;
  }, []);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [status, setStatus] = useState<EditorStatus | null>(null);
  // Schliesst sich das Fenster oder endet Codium, speichert der Code-Bereich zuerst alle Tabs; der Kern wartet darauf.
  useEffect(
    () =>
      api.on('editor.flushRequest', ({ requestId }) => {
        const done = () => void api.request('editor.flushed', { requestId }).catch(() => {});
        (editorRef.current?.saveAll() ?? Promise.resolve()).then(done, done);
      }),
    [api],
  );

  /** „Datei öffnen“ aus dem Dateibaum (Doppelklick, Enter, neue Datei): ein Tab mit dem Fokus im Editor. */
  const openFile = useCallback((path: string) => editorRef.current?.open(path, { focus: true }), []);

  // Vergleich letzter Commit gegen Arbeitsordner (Ticket 17): neue Dateien gegen leer, gelöschte gegen leer rechts,
  // Umbenennungen alter gegen neuen Pfad.
  const showDiff = useCallback(
    (file: GitFileStatus) => {
      const kind = changeKind(file);
      const name = relativeLabel(project.path, file.path);
      editorRef.current?.openDiff({
        id: file.path,
        title: `${name.split(/[\\/]/).pop()} (Diff)`,
        filePath: file.path,
        base: kind === 'unversioned' || kind === 'added' ? null : { path: file.origPath ?? file.path },
        modified: kind === 'deleted' ? { kind: 'text', text: '' } : { kind: 'file' },
      });
    },
    [project.path],
  );

  // ---------- Suchen (Ticket 08) ----------

  const [settingsOpen, setSettingsOpen] = useState(false);

  // „Open README“ (Meldungen zu fehlenden Voraussetzungen): das mitgelieferte README schreibgeschützt, am Abschnitt
  // „Voraussetzungen“.
  useEffect(() => {
    const onOpenReadme = () => {
      api.request('app.readme').then(
        ({ text }) => {
          const line = text.split(/\r?\n/).findIndex((l) => PREREQUISITES_HEADING.test(l));
          editorRef.current?.openDocument({ title: 'README.md', text, language: 'markdown', line: line >= 0 ? line + 1 : 1 });
        },
        (err: unknown) => notify({ level: 'error', text: errorText(err) }),
      );
    };
    window.addEventListener(OPEN_README_EVENT, onOpenReadme);
    return () => window.removeEventListener(OPEN_README_EVENT, onOpenReadme);
  }, [api, notify]);

  const [popup, setPopup] = useState<SearchPopup>(null);
  const popupRef = useRef(popup);
  popupRef.current = popup;
  /** Die Optionen der letzten Projektsuche; sie bleiben über das Schliessen des Suchfensters hinweg. */
  const [searchOptions, setSearchOptions] = useState<SearchOptions>(INITIAL_SEARCH);
  /** Abgelegte Trefferlisten im Werkzeugfenster „Find“; ohne sie gibt es das Werkzeugfenster nicht. */
  const [findTabs, setFindTabs] = useState<FindTab[]>([]);
  const [activeFindTab, setActiveFindTab] = useState<number | null>(null);
  const findTabCounter = useRef(0);
  const findAvailable = useRef(false);
  findAvailable.current = findTabs.length > 0;
  /** Welche Werkzeugfenster verfügbar sind: „Find“ nur, solange es Trefferlisten gibt. */
  const available = useCallback<Availability>((id) => id !== 'find' || findAvailable.current, []);

  /** Öffnet eine Fundstelle in einem Tab, mit Auswahl des Treffers und dem Fokus im Editor. */
  const openMatch = useCallback((match: SearchMatch) => {
    editorRef.current?.open(match.path, {
      focus: true,
      target: { startLineNumber: match.line, startColumn: match.column, endLineNumber: match.line, endColumn: match.column + match.length },
    });
  }, []);
  const areaRef = useRef<HTMLDivElement>(null);
  const area = useElementSize(areaRef);
  const areaValue = useRef<LayoutArea | null>(null);
  areaValue.current = area;
  const codeRef = useRef<HTMLElement>(null);
  /** Die eingehängten Werkzeugfenster und die Flächen der Seiten, für den Fokus. */
  const sections = useRef(new Map<ToolWindowId, HTMLElement>());
  const sides = useRef(new Map<ToolWindowSide, HTMLElement>());
  /** Werkzeugfenster, die schon einmal offen waren; sie bleiben eingehängt. */
  const mounted = useRef(new Set<ToolWindowId>());
  /**
   * Die zuletzt gezogene Seite links oder rechts; bei Platzmangel weicht zuerst die andere (wie in IntelliJ). Sie gilt
   * nur, solange das Fenster offen ist, und wird nicht gespeichert.
   */
  const [priority, setPriority] = useState<WidthPriority>(null);
  const drag = useRef<ActiveDrag | null>(null);

  /** Das Layout, wie es sich gerade zeigt; Grundlage jeder Änderung. */
  const shownLayout = useCallback((): ToolWindowLayout | null => {
    const current = layoutRef.current;
    return current ? visibleLayout(current, available) : null;
  }, [available, layoutRef]);

  /** Beendet ein laufendes Ziehen und speichert, was bis dahin gezogen wurde. */
  const stopDrag = useCallback(() => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    active.release();
    document.body.classList.remove(...RESIZE_CLASSES);
    if (layoutRef.current) change(layoutRef.current, true);
  }, [change, layoutRef]);

  // Verschwindet das Fenster während des Ziehens, nichts zurücklassen.
  useEffect(
    () => () => {
      drag.current?.release();
      drag.current = null;
      document.body.classList.remove(...RESIZE_CLASSES);
    },
    [],
  );

  /** Liegt der Fokus auf einer Seite, die gleich verschwindet, geht er in den Code-Bereich. */
  const moveFocusOutOf = useCallback((side: ToolWindowSide) => {
    if (sides.current.get(side)?.contains(document.activeElement)) codeRef.current?.focus({ preventScroll: true });
  }, []);

  /** Zeigt ein Werkzeugfenster und setzt den Fokus hinein, wie IntelliJ beim Aktivieren eines Werkzeugfensters. */
  const showAndFocus = useCallback(
    (current: ToolWindowLayout, id: ToolWindowId) => {
      // Erst zeichnen, dann den Fokus hinein; so schliesst das nächste Kürzel das Werkzeugfenster wieder.
      flushSync(() => change(showToolWindow(current, id), true));
      focusToolWindow(sections.current.get(id));
    },
    [change],
  );

  openCommitRef.current = () => {
    closeOpenMenus();
    const current = shownLayout();
    if (current && gitState?.repository) showAndFocus(current, 'commit');
  };

  // Git-Farben im Dateibaum (Ticket 16): Zustand je Pfad, ignorierte Ordner färben alles darin grau.
  const gitStatusOf = useMemo(() => {
    const byPath = new Map<string, string>();
    for (const file of gitState?.files ?? []) {
      const known = byPath.get(file.path.toLowerCase());
      if (!known || known === 'unversioned') byPath.set(file.path.toLowerCase(), changeKind(file));
    }
    // Ignorierte: eigene Einträge, und alles unter einem ignorierten Ordner (über die Elternordner nachgeschlagen,
    // statt jede Zeile gegen alle ignorierten Einträge zu prüfen; Review von Ticket 16).
    const ignoredDirs = new Set<string>();
    for (const entry of gitState?.ignored ?? []) {
      byPath.set(entry.path.toLowerCase(), 'ignored');
      if (entry.directory) ignoredDirs.add(entry.path.toLowerCase());
    }
    return (filePath: string): string | undefined => {
      const k = filePath.toLowerCase();
      const own = byPath.get(k);
      if (own) return own;
      if (ignoredDirs.size === 0) return undefined;
      for (let i = k.lastIndexOf('\\'); i > 0; i = k.lastIndexOf('\\', i - 1)) if (ignoredDirs.has(k.slice(0, i))) return 'ignored';
      return undefined;
    };
  }, [gitState]);

  /** „Open in Terminal“ aus dem Dateibaum: ein weiteres Terminal im Ordner, das Werkzeugfenster mit dem Fokus darin. */
  const openInTerminal = useCallback(
    (path: string) => {
      // Erst den Tab anlegen: So startet das Zeigen des leeren Werkzeugfensters kein zweites Terminal.
      // Ist das Werkzeugfenster noch nicht eingehängt, übernimmt es den Ordner beim ersten Zeigen (Review von Ticket 11).
      if (terminalRef.current) flushSync(() => terminalRef.current?.open(path));
      else pendingTerminalCwd.current = path;
      const current = shownLayout();
      if (current) showAndFocus(current, 'terminal');
    },
    [showAndFocus, shownLayout],
  );

  /** „Open in Find Window“: legt die Trefferliste als Reiter ab und zeigt das Werkzeugfenster „Find“. */
  const openInFindWindow = useCallback(
    (outcome: SearchOutcome) => {
      const id = ++findTabCounter.current;
      const tab: FindTab = { id, title: outcome.options.query, matches: outcome.matches, limitReached: outcome.limitReached };
      flushSync(() => {
        setFindTabs((tabs) => [...tabs, tab]);
        setActiveFindTab(id);
      });
      findAvailable.current = true;
      const current = shownLayout();
      if (current) showAndFocus(current, 'find');
    },
    [showAndFocus, shownLayout],
  );

  /** Alt + F7 (Ticket 12): die Verwendungen als Reiter im Werkzeugfenster „Find“. */
  const showUsages = useCallback(
    (title: string, matches: SearchMatch[]) => {
      openInFindWindow({
        options: { query: title, matchCase: true, wholeWord: false, regex: false, fileMask: '', includeIgnored: true },
        matches,
        limitReached: false,
      });
    },
    [openInFindWindow],
  );

  /** Schliesst einen Reiter im Werkzeugfenster „Find“; mit dem letzten verschwindet das Werkzeugfenster. */
  const closeFindTab = useCallback(
    (id: number) => {
      const remaining = findTabs.filter((t) => t.id !== id);
      if (remaining.length === 0) moveFocusOutOf('bottom');
      setFindTabs(remaining);
      if (activeFindTab === id) setActiveFindTab(remaining.at(-1)?.id ?? null);
    },
    [activeFindTab, findTabs, moveFocusOutOf],
  );

  /** Klick auf ein Symbol der Symbolleiste: schliesst das sichtbare Werkzeugfenster, sonst zeigt es dieses. */
  const toggle = useCallback(
    (id: ToolWindowId) => {
      stopDrag();
      const current = shownLayout();
      if (!current) return;
      if (!isShown(current, id)) {
        showAndFocus(current, id);
        return;
      }
      moveFocusOutOf(TOOL_WINDOW_SIDE[id]);
      change(toggleToolWindow(current, id), true);
    },
    [change, moveFocusOutOf, showAndFocus, shownLayout, stopDrag],
  );

  const hide = useCallback(
    (side: ToolWindowSide) => {
      stopDrag();
      const current = shownLayout();
      if (!current) return;
      moveFocusOutOf(side);
      change(hideSide(current, side), true);
    },
    [change, moveFocusOutOf, shownLayout, stopDrag],
  );

  // Die zentrale Tastenbelegung (keymap.ts), in der Capture-Phase vor allen anderen Belegungen (Monaco, später das
  // Terminal). Während einer Rückfrage ruhen die Kürzel. Werkzeugfenster regelt das Fenster selbst, alles andere der
  // Code-Bereich; was er nicht nimmt, geht unverändert weiter. Ein offenes Menü schliesst ein Werkzeugfenster-Kürzel
  // zuerst, sonst nähme es weiter Tasten an.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const command = commandForKey(e);
      if (!command || isDialogOpen()) return;
      // Im Terminal gehören alle Tasten der Shell, ausser den Kürzeln für Werkzeugfenster und Einstellungen (Ticket 11).
      if (!bindingForKey(e)?.global && e.target instanceof Element && e.target.closest('.terminal-view')) return;
      // Bei offenem Suchfenster gehören Werkzeugfenster- und Tab-Kürzel nicht dem Fenster darunter (Review von
      // Ticket 08); Bearbeitungs-Kürzel gehen an das Eingabefeld (etwa Ctrl + Z).
      if (popupRef.current !== null && (command.startsWith('toolWindow.') || command.startsWith('tab.') || command === 'file.saveAll')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (command === 'settings.open') {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        closeOpenMenus();
        stopDrag();
        setPopup(null);
        setSettingsOpen(true);
        return;
      }
      // Ctrl + K (Ticket 16): die Änderungsansicht mit dem Fokus in der Commit-Nachricht, auch aus dem Editor.
      if (command === 'vcs.commit') {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        openCommitRef.current();
        return;
      }
      // Ctrl + T und Ctrl + Shift + K (Ticket 18): Pull und Push, auch mit Fokus im Editor.
      if (command === 'vcs.pull' || command === 'vcs.push') {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat || !gitStateRef.current?.repository) return;
        if (command === 'vcs.pull') void gitRemoteRef.current.pull();
        else void gitRemoteRef.current.push();
        return;
      }
      if (command === 'symbol.gotoClass' || command === 'symbol.gotoSymbol') {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        closeOpenMenus();
        stopDrag();
        setPopup(command === 'symbol.gotoClass' ? 'gotoClass' : 'gotoSymbol');
        return;
      }
      if (command === 'file.gotoFile' || command === 'file.recent' || command === 'find.inFiles') {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        closeOpenMenus();
        stopDrag();
        setPopup(command === 'file.gotoFile' ? 'gotoFile' : command === 'file.recent' ? 'recentFiles' : 'findInFiles');
        return;
      }
      if (!command.startsWith('toolWindow.')) {
        if (editorRef.current?.handleCommand(command as Exclude<KeyCommand, ToolWindowCommand>, e.repeat)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      closeOpenMenus();
      stopDrag();
      const id = command.slice('toolWindow.'.length) as ToolWindowId;
      const current = shownLayout();
      if (!current) return;
      const side = TOOL_WINDOW_SIDE[id];
      const section = sections.current.get(id);
      const action = shortcutAction(current, id, section?.contains(document.activeElement) ?? false, available);
      if (action === 'show') {
        showAndFocus(current, id);
      } else if (action === 'focus') {
        focusToolWindow(section);
      } else if (action === 'hide') {
        moveFocusOutOf(side);
        change(hideSide(current, side), true);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [change, moveFocusOutOf, showAndFocus, shownLayout, stopDrag]);

  // Ziehen an einer Trennlinie: begrenzt auf Mindest- und Höchstgrösse, gespeichert beim Loslassen. Bewegung und
  // Loslassen kommen über das Fenster, damit das Ziehen auch endet, wenn die Trennlinie dabei verschwindet.
  const startDrag = (side: ToolWindowSide, e: ReactPointerEvent<HTMLElement>) => {
    const current = shownLayout();
    const currentArea = areaValue.current;
    if (e.button !== 0 || !current || !currentArea || drag.current) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const pointerId = e.pointerId;
    handle.setPointerCapture(pointerId);
    // Gezogen wird von der angezeigten Grösse aus; ab jetzt hat die gezogene Seite Vorrang, wenn der Platz nicht reicht.
    const resize = beginResize(current, side, currentArea, priority);
    if (side !== 'bottom') setPriority(side);
    const start = side === 'bottom' ? e.clientY : e.clientX;
    const onMove = (ev: PointerEvent) => {
      const latestArea = areaValue.current;
      if (ev.pointerId !== pointerId || !latestArea) return;
      const delta = (side === 'bottom' ? ev.clientY : ev.clientX) - start;
      // Links wächst nach rechts, rechts nach links, unten nach oben.
      const requested = side === 'left' ? resize.startSize + delta : resize.startSize - delta;
      change(resizeTo(resize, requested, latestArea), false);
    };
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) stopDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    drag.current = {
      side,
      release: () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        if (handle.isConnected && handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      },
    };
    document.body.classList.add(side === 'bottom' ? 'resizing-rows' : 'resizing-columns');
  };

  const shown = layout ? visibleLayout(layout, available) : null;
  const sizes = shown && area ? panelSizes(shown, area, priority) : null;
  if (shown && sizes) for (const s of ['left', 'bottom', 'right'] as const) if (shown[s].open) mounted.current.add(shown[s].active);

  const side = (s: ToolWindowSide) => {
    const ids = toolWindowsOn(s).filter((id) => mounted.current.has(id));
    if (!shown || !sizes || ids.length === 0) return null;
    const { open, active } = shown[s];
    const title = TOOL_WINDOWS[active].title;
    return (
      <div
        ref={(el) => {
          if (el) sides.current.set(s, el);
          else sides.current.delete(s);
        }}
        className={`tool-window-side tool-window-${s}`}
        style={s === 'bottom' ? { height: sizes.bottom } : { width: sizes[s] }}
        hidden={!open}
      >
        {ids.map((id) => (
          <section
            key={id}
            ref={(el) => {
              if (el) sections.current.set(id, el);
              else sections.current.delete(id);
            }}
            className="tool-window"
            aria-label={TOOL_WINDOWS[id].title}
            tabIndex={-1}
            hidden={!open || active !== id}
          >
            {id === 'project' ? (
              <ProjectView
                api={api}
                project={project}
                notify={notify}
                onHide={() => hide(s)}
                onOpenFile={openFile}
                openedFile={activeFile}
                onOpenInTerminal={openInTerminal}
                gitStatusOf={gitStatusOf}
              />
            ) : id === 'git' ? (
              <GitToolWindow api={api} state={gitState} gitAvailable={gitAvailable} onHide={() => hide(s)} />
            ) : id === 'commit' && gitAvailable !== false && gitState?.repository ? (
              <CommitToolWindow
                api={api}
                project={project}
                state={gitState}
                notify={notify}
                onHide={() => hide(s)}
                onOpenFile={openFile}
                onShowDiff={showDiff}
                onPush={() => gitRemoteRef.current.push()}
                saveAll={() => editorRef.current?.saveAll() ?? Promise.resolve()}
              />
            ) : id === 'commit' && (gitAvailable === false || (gitState && !gitState.repository)) ? (
              <>
                <ToolWindowHeader title={TOOL_WINDOWS[id].title} onHide={() => hide(s)} />
                <div className="tool-window-body">
                  <p className="tool-window-placeholder">{gitAvailable === false ? GIT_NOT_FOUND_TEXT : 'Not a Git repository'}</p>
                </div>
              </>
            ) : id === 'terminal' ? (
              <TerminalToolWindow
                ref={terminalRef}
                api={api}
                visible={open && active === id}
                fontSize={settings.fontSize}
                onHide={() => hide(s)}
                notify={notify}
                takePendingCwd={takePendingTerminalCwd}
              />
            ) : id === 'find' ? (
              <FindToolWindow
                project={project}
                tabs={findTabs}
                activeId={activeFindTab}
                onSelect={setActiveFindTab}
                onCloseTab={closeFindTab}
                onOpenMatch={openMatch}
                onHide={() => hide(s)}
              />
            ) : (
              <>
                <ToolWindowHeader title={TOOL_WINDOWS[id].title} onHide={() => hide(s)} />
                <div className="tool-window-body">
                  <p className="tool-window-placeholder">{TOOL_WINDOWS[id].placeholder}</p>
                </div>
              </>
            )}
          </section>
        ))}
        {open && (
          <div
            className={`splitter splitter-${s}`}
            role="separator"
            aria-orientation={s === 'bottom' ? 'horizontal' : 'vertical'}
            aria-label={`Resize ${title}`}
            onPointerDown={(e) => startDrag(s, e)}
          />
        )}
      </div>
    );
  };

  return (
    <div className="project-window">
      <Header
        project={project}
        actions={actions}
        onExit={() => void api.request('app.exit')}
        onSettings={() => setSettingsOpen(true)}
        api={api}
        git={gitState}
        onBranches={() => {
          closeOpenMenus();
          setBranchesOpen(true);
        }}
      />
      {branchesOpen && gitState?.repository && (
        <BranchPopup api={api} state={gitState} actions={branchActions} onClose={() => setBranchesOpen(false)} />
      )}
      <div className="workbench">
        <Stripe side="left" groups={[STRIPES.left.top, STRIPES.left.bottom]} layout={shown} available={available} onToggle={toggle} />
        <div className="tool-area" ref={areaRef}>
          <div className="tool-area-row">
            {side('left')}
            <main ref={codeRef} className="code-area" tabIndex={-1} aria-label="Editor">
              <EditorArea
                ref={editorRef}
                api={api}
                project={project}
                notify={notify}
                fontSize={settings.fontSize}
                onActiveFileChange={setActiveFile}
                onStatusChange={setStatus}
            onShowUsages={showUsages}
                empty={<CodeHints />}
              />
            </main>
            {side('right')}
          </div>
          {side('bottom')}
        </div>
        <Stripe side="right" groups={[STRIPES.right.top, []]} layout={shown} available={available} onToggle={toggle} />
      </div>
      <StatusBar work={work} editor={status} />
      {settingsOpen && <SettingsDialog api={api} settings={settings} onClose={() => setSettingsOpen(false)} />}
      {(popup === 'gotoClass' || popup === 'gotoSymbol') && (
        <SymbolPopup
          api={api}
          project={project}
          kinds={popup === 'gotoClass' ? 'types' : 'all'}
          onOpen={(symbol) =>
            editorRef.current?.open(symbol.path, {
              focus: true,
              target: { lineNumber: symbol.range.start.line + 1, column: symbol.range.start.character + 1 },
            })
          }
          onClose={() => setPopup(null)}
        />
      )}
      {popup === 'gotoFile' && <GotoFilePopup api={api} project={project} onOpen={openFile} onClose={() => setPopup(null)} />}
      {popup === 'recentFiles' && <RecentFilesPopup api={api} project={project} onOpen={openFile} onClose={() => setPopup(null)} />}
      {popup === 'findInFiles' && (
        <FindInFilesPopup
          api={api}
          project={project}
          initial={searchOptions}
          fontSize={settings.fontSize}
          onOptions={setSearchOptions}
          onOpenMatch={openMatch}
          onOpenInFindWindow={openInFindWindow}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}

/** Das Layout der Werkzeugfenster: vom Kern geladen, bei jeder Änderung angezeigt und auf Wunsch gespeichert. */
function useToolWindowLayout(api: CodiumApi) {
  const [layout, setLayout] = useState<ToolWindowLayout | null>(null);
  const layoutRef = useRef<ToolWindowLayout | null>(null);

  useEffect(() => {
    let active = true;
    const apply = (loaded: ToolWindowLayout) => {
      if (!active || layoutRef.current !== null) return;
      layoutRef.current = loaded;
      setLayout(loaded);
    };
    api.request('project.layout').then(apply, (err: unknown) => {
      console.error('Layout der Werkzeugfenster nicht geladen:', err);
      apply(CLOSED_LAYOUT);
    });
    return () => {
      active = false;
    };
  }, [api]);

  /**
   * Zeigt ein neues Layout und speichert es mit `persist` gleich im Kern; die Anfrage geht noch im selben Ereignis
   * weg, damit ein unmittelbar folgendes „Exit“ sie nicht überholt.
   */
  const change = useCallback(
    (next: ToolWindowLayout, persist: boolean) => {
      layoutRef.current = next;
      setLayout(next);
      if (persist) api.request('project.setLayout', next).catch((err: unknown) => console.error('Layout nicht gespeichert:', err));
    },
    [api],
  );

  return { layout, layoutRef, change };
}

/** Grösse eines Elements, gemessen vor dem ersten Zeichnen und bei jeder Änderung. */
function useElementSize(ref: RefObject<HTMLElement | null>): LayoutArea | null {
  const [size, setSize] = useState<LayoutArea | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setSize((old) => (old && old.width === width && old.height === height ? old : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

interface StripeProps {
  /** Welche Werkzeugfenster es gerade gibt („Find“ nur mit Trefferlisten). */
  available: Availability;
  side: 'left' | 'right';
  /** Obere und untere Gruppe der Symbolleiste. */
  groups: [ToolWindowId[], ToolWindowId[]];
  layout: ToolWindowLayout | null;
  onToggle: (id: ToolWindowId) => void;
}

function Stripe({ side, groups, layout, available, onToggle }: StripeProps) {
  return (
    <nav className={`stripe stripe-${side}`} aria-label={side === 'left' ? 'Left Tool Windows' : 'Right Tool Windows'}>
      {groups.map((ids, i) => (
        <div key={i} className="stripe-group">
          {ids.filter(available).map((id) => {
            const def = TOOL_WINDOWS[id];
            const Icon = TOOL_WINDOW_ICONS[id];
            const shown = layout !== null && isShown(layout, id);
            return (
              <button
                key={id}
                type="button"
                className={shown ? 'stripe-button active' : 'stripe-button'}
                aria-label={def.title}
                aria-pressed={shown}
                title={def.shortcut ? `${def.title} (${def.shortcut})` : def.title}
                disabled={layout === null}
                onClick={() => onToggle(id)}
              >
                <Icon />
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Kürzel, die der leere Code-Bereich als Hinweis zeigt, wie IntelliJ. */
const CODE_HINTS = [
  { label: 'Project View', command: 'toolWindow.project' },
  { label: 'Commit', command: 'toolWindow.commit' },
  { label: 'Terminal', command: 'toolWindow.terminal' },
  { label: 'Git', command: 'toolWindow.git' },
] as const;

/** Inhalt des Code-Bereichs ohne offene Tabs. */
function CodeHints() {
  return (
    <div className="code-empty">
      <p className="code-empty-title">No files are open</p>
      <dl className="code-empty-hints">
        {CODE_HINTS.map((hint) => (
          <div key={hint.command} className="code-empty-hint">
            <dt>{hint.label}</dt>
            <dd>
              <kbd>{shortcutLabel(hint.command)}</kbd>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
