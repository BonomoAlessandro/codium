import { describe, expect, it } from 'vitest';
import type { ToolWindowLayout } from '../../src/shared/types';
import {
  BOTTOM_MIN_SIZE,
  CODE_MIN_HEIGHT,
  CODE_MIN_WIDTH,
  SIDE_MIN_SIZE,
  STRIPES,
  TOOL_WINDOWS,
  beginResize,
  dragSize,
  resizeTo,
  hideSide,
  isShown,
  panelSizes,
  shortcutAction,
  sizeLimits,
  toggleToolWindow,
  visibleLayout,
  withShownSizes,
  type Availability,
} from '../../src/renderer/project/toolWindowLayout';

const LAYOUT: ToolWindowLayout = {
  left: { active: 'project', open: true, size: 300 },
  bottom: { active: 'terminal', open: false, size: 250 },
  right: { active: 'database', open: false, size: 320 },
};
const all: Availability = () => true;
const withoutFind: Availability = (id) => id !== 'find';
const AREA = { width: 1200, height: 700 };

describe('Werkzeugfenster: Öffnen, Schliessen, Wechseln', () => {
  it('ein Klick auf ein anderes Symbol derselben Seite wechselt, auf das sichtbare schliesst', () => {
    const commit = toggleToolWindow(LAYOUT, 'commit');
    expect(commit.left).toEqual({ active: 'commit', open: true, size: 300 });
    expect(isShown(commit, 'project')).toBe(false);

    const closed = toggleToolWindow(commit, 'commit');
    expect(closed.left).toEqual({ active: 'commit', open: false, size: 300 });
    // Wieder öffnen zeigt das zuletzt aktive.
    expect(toggleToolWindow(closed, 'commit').left.open).toBe(true);
  });

  it('die Seiten sind unabhängig voneinander', () => {
    const layout = toggleToolWindow(toggleToolWindow(LAYOUT, 'terminal'), 'database');
    expect([isShown(layout, 'project'), isShown(layout, 'terminal'), isShown(layout, 'database')]).toEqual([true, true, true]);
    expect(hideSide(layout, 'bottom')).toEqual({ ...layout, bottom: { ...layout.bottom, open: false } });
  });

  it('Kürzel: zeigen, dann Fokus hinein, mit Fokus darin schliessen; nicht verfügbare bleiben unberührt', () => {
    expect(shortcutAction(LAYOUT, 'commit', false, all)).toBe('show');
    expect(shortcutAction(LAYOUT, 'project', false, all)).toBe('focus');
    expect(shortcutAction(LAYOUT, 'project', true, all)).toBe('hide');
    expect(shortcutAction(LAYOUT, 'find', false, withoutFind)).toBe('none');
  });

  it('ein nicht verfügbares aktives Werkzeugfenster zeigt sich als geschlossene Seite', () => {
    const findOpen: ToolWindowLayout = { ...LAYOUT, bottom: { active: 'find', open: true, size: 250 } };
    expect(visibleLayout(findOpen, withoutFind).bottom).toEqual({ active: 'terminal', open: false, size: 250 });
    expect(visibleLayout(findOpen, all)).toEqual(findOpen);
  });

  it('die Symbolleisten tragen jedes Werkzeugfenster genau einmal, mit den Kürzeln nach IntelliJ', () => {
    const onStripes = [...STRIPES.left.top, ...STRIPES.left.bottom, ...STRIPES.right.top].sort();
    expect(onStripes).toEqual(Object.keys(TOOL_WINDOWS).sort());
    expect(Object.fromEntries(Object.values(TOOL_WINDOWS).map((d) => [d.id, d.shortcut]))).toEqual({
      project: 'Alt+1',
      commit: 'Alt+0',
      terminal: 'Alt+F12',
      git: 'Alt+9',
      find: 'Alt+3',
      database: undefined,
    });
  });
});

describe('Werkzeugfenster: Grössen', () => {
  it('zeigt die gespeicherten Grössen, solange sie passen', () => {
    const layout = toggleToolWindow(toggleToolWindow(LAYOUT, 'terminal'), 'database');
    expect(panelSizes(layout, AREA)).toEqual({ left: 300, right: 320, bottom: 250 });
    expect(panelSizes(LAYOUT, AREA)).toEqual({ left: 300, right: 0, bottom: 0 });
  });

  it('ziehen geht nicht unter die Mindest- und nicht über die Höchstgrösse; der Code-Bereich bleibt', () => {
    expect(dragSize('left', 20, LAYOUT, AREA)).toBe(SIDE_MIN_SIZE);
    expect(dragSize('left', 5000, LAYOUT, AREA)).toBe(AREA.width - CODE_MIN_WIDTH);
    expect(dragSize('left', 450.4, LAYOUT, AREA)).toBe(450);
    expect(dragSize('bottom', 10, LAYOUT, AREA)).toBe(BOTTOM_MIN_SIZE);
    expect(dragSize('bottom', 5000, LAYOUT, AREA)).toBe(AREA.height - CODE_MIN_HEIGHT);
  });

  it('links und rechts zusammen lassen dem Code-Bereich seine Mindestbreite', () => {
    const both = toggleToolWindow(LAYOUT, 'database');
    expect(sizeLimits('left', both, AREA).max).toBe(AREA.width - CODE_MIN_WIDTH - 320);
    expect(sizeLimits('right', both, AREA).max).toBe(AREA.width - CODE_MIN_WIDTH - 300);
  });

  it('in einem zu kleinen Fenster schrumpfen beide Seiten anteilig, nie unter die Mindestgrösse', () => {
    const wide: ToolWindowLayout = {
      left: { active: 'project', open: true, size: 650 },
      bottom: { active: 'terminal', open: true, size: 900 },
      right: { active: 'database', open: true, size: 350 },
    };
    const sizes = panelSizes(wide, { width: 840, height: 400 });
    expect(sizes.left + sizes.right).toBeLessThanOrEqual(840 - CODE_MIN_WIDTH);
    expect(sizes.left).toBeGreaterThan(sizes.right);
    expect(sizes.bottom).toBe(400 - CODE_MIN_HEIGHT);

    const tiny = panelSizes(wide, { width: 400, height: 150 });
    expect(tiny).toEqual({ left: SIDE_MIN_SIZE, right: SIDE_MIN_SIZE, bottom: BOTTOM_MIN_SIZE });
    // Die gespeicherten Grössen bleiben; nur zum Ziehen werden die angezeigten übernommen.
    expect(withShownSizes(wide, { width: 840, height: 400 }).left.size).toBe(sizes.left);
    expect(wide.left.size).toBe(650);
  });

  it('Ziehen in einem kleinen Fenster speichert nur die gezogene Seite; die Gegenseite behält ihre Grösse', () => {
    const both: ToolWindowLayout = { ...LAYOUT, left: { ...LAYOUT.left, size: 280 }, right: { ...LAYOUT.right, open: true, size: 320 } };
    const small = { width: 640, height: 335 };
    const before = panelSizes(both, small);
    // Zu eng für beide: Sie zeigen sich schmaler als gespeichert.
    expect(before.right).toBeLessThan(320);

    const resize = beginResize(both, 'left', small);
    expect(resize.startSize).toBe(before.left);
    const step = resizeTo(resize, resize.startSize + 1, small);
    expect(step.stored.left.size).toBe(before.left + 1);
    expect(step.stored.right.size).toBe(320);
    // Zu sehen bleibt die Gegenseite, wie sie war.
    expect(panelSizes(step.shown, small)).toEqual({ left: before.left + 1, right: before.right, bottom: 0 });

    // Die Höchstgrösse rechnet mit der angezeigten Breite der Gegenseite, der Code-Bereich bleibt.
    const far = resizeTo(resize, 5000, small);
    expect(far.stored.left.size).toBe(small.width - CODE_MIN_WIDTH - before.right);
    expect(far.stored.right.size).toBe(320);
    // Im grossen Fenster ist die Gegenseite wieder so breit wie gespeichert.
    expect(panelSizes(far.stored, AREA).right).toBe(320);
  });

  it('eine zu kleine gespeicherte Grösse zeigt sich in der Mindestgrösse', () => {
    const small: ToolWindowLayout = { ...LAYOUT, bottom: { active: 'git', open: true, size: 20 } };
    expect(panelSizes({ ...small, left: { ...small.left, size: 40 } }, AREA)).toEqual({
      left: SIDE_MIN_SIZE,
      right: 0,
      bottom: BOTTOM_MIN_SIZE,
    });
  });
});
