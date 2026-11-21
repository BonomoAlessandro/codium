import { describe, expect, it } from 'vitest';
import { NOTICE_TIMEOUT_MS, noticeTimeout } from '../../src/renderer/noticeRules';
import { applyProgress, summarizeProgress, type RunningWork } from '../../src/renderer/progress';
import type { ProgressEvent } from '../../src/shared/types';

const run = (events: ProgressEvent[]): RunningWork[] => events.reduce<RunningWork[]>(applyProgress, []);

describe('Fortschritt in der Statusleiste', () => {
  it('verrechnet Beginn, Stand und Ende', () => {
    expect(
      run([
        { kind: 'begin', id: 'a', title: 'Pushing…' },
        { kind: 'report', id: 'a', fraction: 0.3 },
        { kind: 'begin', id: 'b', title: 'Importing…', fraction: 0.1 },
        { kind: 'report', id: 'b', title: 'Importing modules…' },
      ]),
    ).toEqual([
      { id: 'a', title: 'Pushing…', fraction: 0.3 },
      // Ein Stand ohne Zahl heisst „unbekannt“.
      { id: 'b', title: 'Importing modules…' },
    ]);
    expect(run([{ kind: 'begin', id: 'a', title: 'Pushing…' }, { kind: 'end', id: 'a' }])).toEqual([]);
    // Zu einer unbekannten Arbeit bewirken Stand und Ende nichts.
    expect(run([{ kind: 'report', id: 'x', fraction: 0.5 }, { kind: 'end', id: 'y' }])).toEqual([]);
  });

  it('zeigt eine Arbeit mit Titel und Stand, mehrere zusammengefasst', () => {
    expect(summarizeProgress([])).toBeNull();
    expect(summarizeProgress([{ id: 'a', title: 'Pushing…', fraction: 0.5 }])).toEqual({
      text: 'Pushing…',
      fraction: 0.5,
      titles: ['Pushing…'],
    });
    expect(
      summarizeProgress([
        { id: 'a', title: 'Pushing…', fraction: 0.2 },
        { id: 'b', title: 'Fetching…', fraction: 0.6 },
      ]),
    ).toEqual({ text: '2 processes running', fraction: 0.4, titles: ['Pushing…', 'Fetching…'] });
    // Ist ein Stand unbekannt, ist es der gemeinsame auch.
    expect(summarizeProgress([{ id: 'a', title: 'Pushing…', fraction: 0.2 }, { id: 'b', title: 'Importing…' }])).toEqual({
      text: '2 processes running',
      titles: ['Pushing…', 'Importing…'],
    });
  });
});

describe('Meldungen', () => {
  it('Erfolg und Information verschwinden nach etwa fünf Sekunden, Fehler bleiben', () => {
    expect(NOTICE_TIMEOUT_MS).toBe(5000);
    expect(noticeTimeout('info')).toBe(NOTICE_TIMEOUT_MS);
    expect(noticeTimeout('success')).toBe(NOTICE_TIMEOUT_MS);
    expect(noticeTimeout('error')).toBeNull();
  });
});
