// Reine Hilfen des Sprach-Dienstes (Ticket 13): Umrechnung semantischer Token auf die gemeinsame Legende und das
// Filtern der Vorschläge nach dem getippten Wortanfang.

import { describe, expect, it } from 'vitest';
import { matchesPrefix, remapTokens } from '../../src/main/core/language/languageService';
import { SEMANTIC_TOKEN_MODIFIERS, SEMANTIC_TOKEN_TYPES } from '../../src/shared/types';

const type = (name: string) => (SEMANTIC_TOKEN_TYPES as readonly string[]).indexOf(name);
const bit = (name: string) => 1 << (SEMANTIC_TOKEN_MODIFIERS as readonly string[]).indexOf(name);

describe('Semantische Token', () => {
  it('rechnet Arten und Modifikatoren um, „member“ von typescript-language-server als Methode', () => {
    const legend = { types: ['member', 'variable', 'unknownKind', 'property'], modifiers: ['static', 'declaration', 'weird'] };
    // Zeile 0: member (static+declaration) bei 2, unknownKind bei 10; Zeile 1: variable bei 4; Zeile 3: property bei 0.
    const data = [0, 2, 3, 0, 0b011, 0, 8, 2, 2, 0, 1, 4, 5, 1, 0b100, 2, 0, 6, 3, 0];
    expect(remapTokens(data, legend)).toEqual([
      0, 2, 3, type('method'), bit('static') | bit('declaration'),
      // Das unbekannte Token fällt weg; die nächste Zeile beginnt wieder absolut.
      1, 4, 5, type('variable'), 0,
      2, 0, 6, type('property'), 0,
    ]);
  });

  it('rechnet die Spalte nach einem weggelassenen Token in derselben Zeile richtig', () => {
    const legend = { types: ['variable', 'nope'], modifiers: [] };
    // Drei Token in Zeile 0 bei 1, 5 und 9; das mittlere fällt weg.
    expect(remapTokens([0, 1, 2, 0, 0, 0, 4, 2, 1, 0, 0, 4, 2, 0, 0], legend)).toEqual([0, 1, 2, type('variable'), 0, 0, 8, 2, type('variable'), 0]);
  });
});

describe('Filtern der Vorschläge', () => {
  it('lässt Vorschläge durch, deren Buchstaben in dieser Reihenfolge vorkommen', () => {
    expect(matchesPrefix('helperFunction', '')).toBe(true);
    expect(matchesPrefix('helperFunction', 'helperFun')).toBe(true);
    expect(matchesPrefix('helperFunction', 'hFun')).toBe(true);
    expect(matchesPrefix('HelperFunction', 'helper')).toBe(true);
    expect(matchesPrefix('helperFunction', 'funhelp')).toBe(false);
    expect(matchesPrefix('Array', 'helperFun')).toBe(false);
  });
});
