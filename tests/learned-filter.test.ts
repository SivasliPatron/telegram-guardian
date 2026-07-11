import { describe, expect, it } from 'vitest';
import { learnedReviewFilterKey } from '../src/services/learned-filter.js';
import { configuredFilterMatches } from '../src/utils/filter.js';

describe('aus Admin-Entscheidungen gelernte Wortfilter', () => {
  it('verwendet für denselben Satz unabhängig von Großschreibung denselben eindeutigen Schlüssel', () => {
    const first = learnedReviewFilterKey('  H S Menschen in Afrika haben kein Wasser  ');
    const second = learnedReviewFilterKey('h s menschen in afrika haben kein wasser');
    expect(first).toBe(second);
    expect(first).toMatch(/^learned-review:[a-f0-9]{64}$/u);
    expect(learnedReviewFilterKey('Ein anderer Satz')).not.toBe(first);
  });

  it('trifft den bestätigten Satz exakt und ohne Beachtung der Großschreibung', () => {
    const filter = {
      presetKey: null,
      learnedKey: learnedReviewFilterKey('h s Menschen in Afrika haben kein Wasser'),
      pattern: 'h s Menschen in Afrika haben kein Wasser',
      matchType: 'EXACT' as const,
      ignoreCase: true,
    };
    expect(configuredFilterMatches('H S MENSCHEN IN AFRIKA HABEN KEIN WASSER', filter)).toBe(true);
    expect(configuredFilterMatches('Heute: h s Menschen in Afrika haben kein Wasser', filter)).toBe(
      false,
    );
    expect(configuredFilterMatches('h s Menschen in Afrika haben kein Wasser!', filter)).toBe(
      false,
    );
  });

  it('behält für verwaltete Regex-Presets die Verschleierungserkennung bei', () => {
    expect(
      configuredFilterMatches('f.1.c.k', {
        presetKey: 'profanity-example',
        pattern: 'fick',
        matchType: 'REGEX',
        ignoreCase: true,
      }),
    ).toBe(true);
  });
});
