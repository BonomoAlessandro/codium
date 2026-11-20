import { describe, expect, it } from 'vitest';
import { EventHub } from '../../src/shared/eventHub';

describe('Verteilung der Ereignisse in der Oberfläche', () => {
  it('stellt allen Abonnenten zu und lässt Abgemeldete aus', () => {
    const hub = new EventHub();
    const a: unknown[] = [];
    const b: unknown[] = [];
    const unsubscribeA = hub.subscribe('app.notice', (p) => a.push(p));
    hub.subscribe('app.notice', (p) => b.push(p));

    hub.deliver('app.notice', 1);
    unsubscribeA();
    hub.deliver('app.notice', 2);
    expect(a).toEqual([1]);
    expect(b).toEqual([1, 2]);
  });

  it('hält Ereignisse ohne Abonnenten zurück und stellt sie dem ersten zu', () => {
    const hub = new EventHub();
    hub.deliver('app.notice', 'früh');
    hub.deliver('anderes', 'nicht für mich');
    const got: unknown[] = [];
    hub.subscribe('app.notice', (p) => got.push(p));
    hub.deliver('app.notice', 'später');
    expect(got).toEqual(['früh', 'später']);

    const second: unknown[] = [];
    hub.subscribe('app.notice', (p) => second.push(p));
    expect(second).toEqual([]);
  });

  it('hält höchstens die neuesten Ereignisse zurück', () => {
    const hub = new EventHub(2);
    for (const n of [1, 2, 3]) hub.deliver('x', n);
    const got: unknown[] = [];
    hub.subscribe('x', (p) => got.push(p));
    expect(got).toEqual([2, 3]);
  });
});
