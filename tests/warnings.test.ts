import { describe, expect, it } from 'vitest';
import { shouldApplyWarningBan } from '../src/services/warning-escalation.js';

describe('automatische Verwarnungsstrafe', () => {
  it('wird exakt ab dem konfigurierten Grenzwert ausgelöst', () => {
    expect(shouldApplyWarningBan(2, 3)).toBe(false);
    expect(shouldApplyWarningBan(3, 3)).toBe(true);
    expect(shouldApplyWarningBan(4, 3)).toBe(true);
  });

  it('akzeptiert keinen ungültigen Grenzwert', () => {
    expect(shouldApplyWarningBan(1, 0)).toBe(false);
  });
});
