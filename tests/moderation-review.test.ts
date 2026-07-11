import { describe, expect, it } from 'vitest';
import {
  formatModerationReviewMessage,
  moderationReviewCallbackData,
  moderationReviewKeyboard,
  parseModerationReviewCallback,
} from '../src/modules/moderation-review/index.js';

describe('Admin-Prüfung für KI-Grenzfälle', () => {
  it('erzeugt kurze, eindeutig auswertbare Callback-Daten', () => {
    const reviewId = 'cm1234567890abcdef';
    const approve = moderationReviewCallbackData('approve', reviewId);
    const dismiss = moderationReviewCallbackData('dismiss', reviewId);
    expect(approve.length).toBeLessThanOrEqual(64);
    expect(dismiss.length).toBeLessThanOrEqual(64);
    expect(parseModerationReviewCallback(approve)).toEqual({
      decision: 'approve',
      reviewId,
    });
    expect(parseModerationReviewCallback(dismiss)).toEqual({
      decision: 'dismiss',
      reviewId,
    });
    expect(parseModerationReviewCallback('mr:y:../fremd')).toBeNull();
  });

  it('zeigt genau die beiden gewünschten Entscheidungsbuttons', () => {
    const keyboard = moderationReviewKeyboard('cm123');
    expect(keyboard.inline_keyboard).toEqual([
      [
        { text: '⚠️ Verwarnung: Ja', callback_data: 'mr:y:cm123' },
        { text: '✅ Verwarnung: Nein', callback_data: 'mr:n:cm123' },
      ],
    ]);
  });

  it('zeigt den echten Nachrichtentext und escaped Telegram-HTML', () => {
    const message = formatModerationReviewMessage({
      user: '<Admin-Test>',
      messageText: 'h s Menschen in Afrika haben <kein> Wasser',
      category: 'insult',
      confidence: 0.6,
      reason: 'Möglicherweise verschleierte Abkürzung',
    });
    expect(message).toContain('&lt;Admin-Test&gt;');
    expect(message).toContain('h s Menschen in Afrika haben &lt;kein&gt; Wasser');
    expect(message).toContain('60 %');
    expect(message).toContain('noch keine Verwarnung');
    expect(message).toContain('als automatischer Wortfilter gespeichert');
    expect(message).not.toContain('<kein>');
  });
});
