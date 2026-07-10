import { describe, expect, it } from 'vitest';
import { decideAiModeration } from '../src/services/ai-moderation.js';

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
});
