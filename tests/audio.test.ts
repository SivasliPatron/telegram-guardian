import { describe, expect, it } from 'vitest';
import { audioWithinModerationLimits } from '../src/services/audio.js';

const limits = { maxDurationSeconds: 120, maxBytes: 10_000_000 };

describe('Audio-Moderationsgrenzen', () => {
  it('akzeptiert kurze Audiodateien innerhalb des Größenlimits', () => {
    expect(audioWithinModerationLimits({ durationSeconds: 30, fileSize: 500_000 }, limits)).toBe(
      true,
    );
  });

  it('überspringt zu lange oder zu große Audiodateien', () => {
    expect(audioWithinModerationLimits({ durationSeconds: 121, fileSize: 500_000 }, limits)).toBe(
      false,
    );
    expect(audioWithinModerationLimits({ durationSeconds: 30, fileSize: 10_000_001 }, limits)).toBe(
      false,
    );
  });

  it('akzeptiert fehlende Telegram-Größenangaben für die spätere Downloadprüfung', () => {
    expect(audioWithinModerationLimits({ durationSeconds: 60 }, limits)).toBe(true);
  });
});
