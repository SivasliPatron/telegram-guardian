import { describe, expect, it } from 'vitest';
import {
  AI_MODERATION_SYSTEM_INSTRUCTION,
  applyMessagePolicyOverrides,
  decideAiModeration,
  decideDisplayNameModeration,
  hasSpacedCodedInsult,
  isExplicitlyAllowedGeographicStatement,
  limitModerationReason,
  spacedCodedInsultReview,
} from '../src/services/ai-moderation.js';

describe('KI-Moderation', () => {
  it('bewertet Mutter- und Mehrdeutigkeitskontext als ganzen Satz', () => {
    expect(AI_MODERATION_SYSTEM_INSTRUCTION).toContain('vollständige wörtliche Gesamtbedeutung');
    expect(AI_MODERATION_SYSTEM_INSTRUCTION).toContain('kein Geld für Eier');
    expect(AI_MODERATION_SYSTEM_INSTRUCTION).toContain('Fick deine Mutter');
    expect(AI_MODERATION_SYSTEM_INSTRUCTION).toContain('plausiblen harmlosen Lesart');
  });

  it('lässt neutrale oder unsichere Bewertungen durch', () => {
    expect(
      decideAiModeration(
        {
          violation: false,
          reviewRecommended: false,
          category: 'none',
          confidence: 0.99,
          reason: 'Neutral',
        },
        0.72,
        0.92,
      ),
    ).toBe('allow');
    expect(
      decideAiModeration(
        {
          violation: true,
          reviewRecommended: false,
          category: 'insult',
          confidence: 0.71,
          reason: 'Unsicher',
        },
        0.72,
        0.92,
      ),
    ).toBe('allow');
  });

  it('protokolliert Grenzfälle, ohne sie automatisch zu löschen', () => {
    expect(
      decideAiModeration(
        {
          violation: true,
          reviewRecommended: false,
          category: 'harassment',
          confidence: 0.8,
          reason: 'Grenzfall',
        },
        0.72,
        0.92,
      ),
    ).toBe('log');
  });

  it('gibt einer empfohlenen Admin-Prüfung auch bei hoher Sicherheit Vorrang', () => {
    expect(
      decideAiModeration(
        {
          violation: true,
          reviewRecommended: true,
          category: 'hate_or_discrimination',
          confidence: 0.99,
          reason: 'Menschliche Prüfung erforderlich',
        },
        0.45,
        0.72,
      ),
    ).toBe('log');
  });

  it('verwarnt nur bei hoher Sicherheit', () => {
    expect(
      decideAiModeration(
        {
          violation: true,
          reviewRecommended: false,
          category: 'religious_abuse',
          confidence: 0.95,
          reason: 'Klar',
        },
        0.72,
        0.92,
      ),
    ).toBe('warn');
  });

  it('unterstützt eine getrennte, etwas niedrigere Audioschwelle', () => {
    const result = {
      violation: true,
      reviewRecommended: false,
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
        reviewRecommended: false,
        category: 'political',
        confidence: 1,
        reason: 'Falsch als politisch eingestuft',
      }),
    ).toEqual({
      violation: false,
      reviewRecommended: false,
      category: 'none',
      confidence: 1,
      reason: 'Neutrale geografische oder allgemeine Aussage ohne verbotenen politischen Bezug.',
    });
  });

  it('überschreibt keine Beleidigung trotz geografischem Begriff', () => {
    const result = {
      violation: true,
      reviewRecommended: false,
      category: 'insult' as const,
      confidence: 0.99,
      reason: 'Beleidigung',
    };
    expect(applyMessagePolicyOverrides('Kurdistan', result)).toEqual(result);
  });

  it('schickt eine getrennte HS-Abkürzung sicher zur Admin-Prüfung', () => {
    const message = 'h s Menschen in Afrika haben kein Wasser usw';
    expect(hasSpacedCodedInsult(message)).toBe(true);
    const result = applyMessagePolicyOverrides(message, {
      violation: true,
      reviewRecommended: false,
      category: 'insult',
      confidence: 0.99,
      reason: 'Zu streng bewertet',
    });
    expect(result.reviewRecommended).toBe(true);
    expect(decideAiModeration(result, 0.45, 0.72)).toBe('log');
    expect(
      applyMessagePolicyOverrides(message, {
        violation: true,
        reviewRecommended: false,
        category: 'hate_or_discrimination',
        confidence: 0.99,
        reason: 'Zu streng als Diskriminierung bewertet',
      }).reviewRecommended,
    ).toBe(true);
    expect(spacedCodedInsultReview(message)?.reviewRecommended).toBe(true);
  });

  it('lässt den sachlichen Afrika-Wassersatz ohne Abkürzung unverändert', () => {
    const result = {
      violation: false,
      reviewRecommended: false,
      category: 'none' as const,
      confidence: 1,
      reason: 'Sachliche Aussage',
    };
    expect(
      applyMessagePolicyOverrides(
        'Menschen in Afrika haben in manchen Regionen keinen sicheren Wasserzugang.',
        result,
      ),
    ).toEqual(result);
  });

  it('kürzt lange Gemini-Begründungen, statt die gesamte Moderation zu verwerfen', () => {
    const reason = limitModerationReason(`Sehr lange Begründung ${'x'.repeat(300)}`);
    expect(reason).toHaveLength(180);
    expect(reason.endsWith('…')).toBe(true);
  });
});
