import { describe, expect, it } from 'vitest';
import { DEFAULT_GROUP_RULES } from '../src/services/group-setup.js';

describe('Standard-Gruppenregeln', () => {
  it('schützt Religionen allgemein statt nur eine einzelne Religion', () => {
    expect(DEFAULT_GROUP_RULES).toContain('Alle Religionen');
    expect(DEFAULT_GROUP_RULES).toContain('heiligen Schriften');
    expect(DEFAULT_GROUP_RULES).toContain('religiösen Symbole');
  });

  it('verbietet gefährliche politische Inhalte, aber keine neutralen Ortsangaben', () => {
    expect(DEFAULT_GROUP_RULES).toContain('Politische Grenzen');
    expect(DEFAULT_GROUP_RULES).toContain('politische Propaganda');
    expect(DEFAULT_GROUP_RULES).toContain('„Free Kurdistan“');
    expect(DEFAULT_GROUP_RULES).toContain('„Free Türkei“');
    expect(DEFAULT_GROUP_RULES).not.toContain('Politische Inhalte jeder Art sind verboten');
  });

  it('verlangt eine vorherige DM-Erlaubnis im Gruppenchat', () => {
    expect(DEFAULT_GROUP_RULES).toContain('ausdrücklich im Gruppenchat ihre Erlaubnis');
    expect(DEFAULT_GROUP_RULES).toContain('ohne vorherige Verwarnung sofort');
  });

  it('kündigt ab der dritten aktiven Verwarnung einen dauerhaften Ban an', () => {
    expect(DEFAULT_GROUP_RULES).toContain('Ab der dritten aktiven Verwarnung');
    expect(DEFAULT_GROUP_RULES).toContain('dauerhafter Ban');
    expect(DEFAULT_GROUP_RULES).not.toContain('zeitlich begrenzte Stummschaltung');
  });
});
