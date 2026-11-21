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

  it('beim Ziehen darf eine offene Gegenseite bis auf ihre Mindestbreite verdrängt werden', () => {
    const both = toggleToolWindow(LAYOUT, 'database');
    expect(sizeLimits('left', both, AREA).max).toBe(AREA.width - CODE_MIN_WIDTH - SIDE_MIN_SIZE);
    expect(sizeLimits('right', both, AREA).max).toBe(AREA.width - CODE_MIN_WIDTH - SIDE_MIN_SIZE);
    // Ohne Gegenseite bleibt nur der Code-Bereich.
    expect(sizeLimits('left', LAYOUT, AREA).max).toBe(AREA.width - CODE_MIN_WIDTH);
  });

  it('in einem zu kleinen Fenster schrumpfen beide Seiten anteilig, solange keine zuletzt gezogen wurde', () => {
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
    expect(panelSizes(wide, { width: 400, height: 150 }, 'left')).toEqual(tiny);
  });

  it('bei Platzmangel weicht zuerst die Seite, die nicht zuletzt gezogen wurde, bis zu ihrer Mindestbreite', () => {
    const both: ToolWindowLayout = { ...LAYOUT, left: { ...LAYOUT.left, size: 280 }, right: { ...LAYOUT.right, open: true, size: 320 } };
    const small = { width: 720, height: 335 };
    const room = small.width - CODE_MIN_WIDTH;
    expect(room).toBeLessThan(280 + 320);
    expect(panelSizes(both, small, 'left')).toEqual({ left: 280, right: room - 280, bottom: 0 });
    expect(panelSizes(both, small, 'right')).toEqual({ left: room - 320, right: 320, bottom: 0 });
    // Reicht es nicht einmal dafür, weicht danach auch die bevorzugte Seite, nie unter die Mindestbreite.
    const huge = { ...both, left: { ...both.left, size: 900 } };
    expect(panelSizes(huge, small, 'left')).toEqual({ left: room - SIDE_MIN_SIZE, right: SIDE_MIN_SIZE, bottom: 0 });
  });

  it('Ziehen in einem kleinen Fenster: Die gezogene Breite bleibt stehen, die Gegenseite behält ihre gespeicherte', () => {
    // Der Fall aus dem Review: links 280 und rechts 320 gespeichert, zu eng für beide.
    const both: ToolWindowLayout = { ...LAYOUT, left: { ...LAYOUT.left, size: 280 }, right: { ...LAYOUT.right, open: true, size: 320 } };
    const small = { width: 640, height: 335 };
    const before = panelSizes(both, small);
    expect(before.left).toBeLessThan(280);

    // Ein Pixel breiter: Die Seite wird breiter, nicht schmaler, auch nach dem Loslassen.
    const resize = beginResize(both, 'left', small, null);
    expect(resize.startSize).toBe(before.left);
    const step = resizeTo(resize, resize.startSize + 1, small);
    expect(step.left.size).toBe(before.left + 1);
    expect(step.right.size).toBe(320);
    const afterStep = panelSizes(step, small, 'left');
    expect(afterStep.left).toBe(before.left + 1);
    expect(afterStep.right).toBe(small.width - CODE_MIN_WIDTH - afterStep.left);

    // Weit nach rechts: bis die Gegenseite auf ihre Mindestbreite verdrängt ist.
    const far = resizeTo(resize, resize.startSize + 300, small);
    expect(far.left.size).toBe(small.width - CODE_MIN_WIDTH - SIDE_MIN_SIZE);
    expect(far.right.size).toBe(320);
    expect(panelSizes(far, small, 'left')).toEqual({ left: far.left.size, right: SIDE_MIN_SIZE, bottom: 0 });

    // Ein neues Ziehen beginnt bei der gezogenen Breite.
    expect(beginResize(far, 'left', small, 'left').startSize).toBe(far.left.size);
    // Im grossen Fenster: links die gezogene Breite, rechts wieder die gespeicherten 320.
    expect(panelSizes(far, AREA, 'left')).toEqual({ left: far.left.size, right: 320, bottom: 0 });
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
