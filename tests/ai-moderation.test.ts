import { describe, expect, it } from 'vitest';
import {
  applyMessagePolicyOverrides,
  decideAiModeration,
  decideDisplayNameModeration,
  isExplicitlyAllowedGeographicStatement,
  limitModerationReason,
} from '../src/services/ai-moderation.js';

describe('KI-Moderation', () => {
  it('lässt neutrale oder unsichere Bewertungen durch', () => {
    expect(
      decideAiModeration(
        { violation: false, category: 'none', confidence: 0.99, reason: 'Neutral' },
        0.72,
        0.92,
      ),
    ).toBe('allow');
    expect(
      decideAiModeration(
        { violation: true, category: 'insult', confidence: 0.71, reason: 'Unsicher' },
        0.72,
        0.92,
      ),
    ).toBe('allow');
  });

  it('protokolliert Grenzfälle, ohne sie automatisch zu löschen', () => {
    expect(
      decideAiModeration(
        { violation: true, category: 'harassment', confidence: 0.8, reason: 'Grenzfall' },
        0.72,
        0.92,
      ),
    ).toBe('log');
  });

  it('verwarnt nur bei hoher Sicherheit', () => {
    expect(
      decideAiModeration(
        { violation: true, category: 'religious_abuse', confidence: 0.95, reason: 'Klar' },
        0.72,
        0.92,
      ),
    ).toBe('warn');
  });

  it('unterstützt eine getrennte, etwas niedrigere Audioschwelle', () => {
    const result = {
      violation: true,
      category: 'insult' as const,
      confidence: 0.86,
      reason: 'Klar gesprochene Beleidigung',
    };
    expect(decideAiModeration(result, 0.72, 0.92)).toBe('log');
    expect(decideAiModeration(result, 0.5, 0.75)).toBe('warn');
  });

  it('kickt eindeutige politische oder beleidigende sichtbare Namen', () => {
    expect(
      decideDisplayNameModeration(
        {
          violation: true,
          category: 'insult',
          confidence: 0.9,
          reason: 'Beleidigender sichtbarer Name',
        },
        0.5,
        0.75,
      ),
    ).toBe('warn');
  });

  it.each([
    'Kurdistan',
    'Türkei',
    'Free Kurdistan',
    'Free Türkei',
    'Ich besuche morgen Kurdistan',
    'Ich will morgen Kurdistan besuchen',
    'Ich komme aus der Türkei',
    'Ich will morgen Kurdistsn besuchen',
  ])('erkennt eine ausdrücklich erlaubte geografische Aussage: %s', (message) => {
    expect(isExplicitlyAllowedGeographicStatement(message)).toBe(true);
  });

  it.each(['Free Kurdistan PKK', 'Biji Apo', 'Kurdistan gehört der PKK', 'Free Türkei Erdoğan'])(
    'erlaubt problematische Zusätze nicht automatisch: %s',
    (message) => {
      expect(isExplicitlyAllowedGeographicStatement(message)).toBe(false);
    },
  );

  it('überschreibt eine politische KI-Fehlbewertung für einen neutralen Reisesatz', () => {
    expect(
      applyMessagePolicyOverrides('Ich besuche morgen Kurdistan', {
        violation: true,
        category: 'political',
        confidence: 1,
        reason: 'Falsch als politisch eingestuft',
      }),
    ).toEqual({
      violation: false,
      category: 'none',
      confidence: 1,
      reason: 'Neutrale geografische oder allgemeine Aussage ohne verbotenen politischen Bezug.',
    });
  });

  it('überschreibt keine Beleidigung trotz geografischem Begriff', () => {
    const result = {
      violation: true,
      category: 'insult' as const,
      confidence: 0.99,
      reason: 'Beleidigung',
    };
    expect(applyMessagePolicyOverrides('Kurdistan', result)).toEqual(result);
  });

  it('kürzt lange Gemini-Begründungen, statt die gesamte Moderation zu verwerfen', () => {
    const reason = limitModerationReason(`Sehr lange Begründung ${'x'.repeat(300)}`);
    expect(reason).toHaveLength(180);
    expect(reason.endsWith('…')).toBe(true);
  });
});
