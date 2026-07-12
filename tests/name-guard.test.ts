import { describe, expect, it } from 'vitest';
import {
  isValidForbiddenName,
  matchesForbiddenName,
  normalizeName,
  normalizedProfileName,
} from '../src/services/name-guard.js';
import { DISPLAY_NAME_PRESETS } from '../src/modules/name-guard/presets.js';
import { findDisplayNamePresetMatch } from '../src/modules/name-guard/presets.js';
import { translate } from '../src/locales/index.js';

describe('Namensschutz', () => {
  it('normalisiert Großschreibung, unsichtbare Zeichen und Trennzeichen', () => {
    expect(normalizeName('  B\u200bad.-Name  ')).toEqual({
      normalized: 'bad.-name',
      compact: 'badname',
    });
  });

  it('prüft nur Vor- und Nachname und ignoriert den @Benutzernamen', () => {
    const profile = normalizedProfileName({
      id: 1,
      is_bot: false,
      first_name: 'Guter',
      last_name: 'Name',
      username: 'ForbiddenTag',
    });
    const forbidden = normalizeName('forbidden tag');
    expect(
      matchesForbiddenName(profile, {
        normalizedPattern: forbidden.normalized,
        compactPattern: forbidden.compact,
      }),
    ).toBe(false);
    expect(
      matchesForbiddenName(normalizeName('Forbidden Tag'), {
        normalizedPattern: forbidden.normalized,
        compactPattern: forbidden.compact,
      }),
    ).toBe(true);
  });

  it('erkennt getrennt geschriebene verbotene Namen über die kompakte Form', () => {
    const profile = normalizeName('B.a-d N_a_m_e');
    const forbidden = normalizeName('badname');
    expect(
      matchesForbiddenName(profile, {
        normalizedPattern: forbidden.normalized,
        compactPattern: forbidden.compact,
      }),
    ).toBe(true);
  });

  it('erkennt längere Beleidigungen auch mit angehängten Präfixen', () => {
    const forbidden = normalizeName('hurensohn');
    expect(
      matchesForbiddenName(normalizeName('Duhurensohn'), {
        normalizedPattern: forbidden.normalized,
        compactPattern: forbidden.compact,
      }),
    ).toBe(true);
  });

  it('lehnt zu kurze und überlange Einträge ab', () => {
    expect(isValidForbiddenName('ab')).toBe(false);
    expect(isValidForbiddenName('abc')).toBe(true);
    expect(isValidForbiddenName('x'.repeat(65))).toBe(false);
  });

  it('erkennt politische Kürzel getrennt, aber nicht als Teil echter Namen', () => {
    const forbidden = normalizeName('afd');
    expect(
      matchesForbiddenName(normalizeName('Max A.F.D'), {
        normalizedPattern: forbidden.normalized,
        compactPattern: forbidden.compact,
      }),
    ).toBe(true);
    expect(
      matchesForbiddenName(normalizeName('Kraftdienst'), {
        normalizedPattern: forbidden.normalized,
        compactPattern: forbidden.compact,
      }),
    ).toBe(false);
  });

  it('startet nur mit den zwei gewünschten Prüfkandidaten', () => {
    expect(DISPLAY_NAME_PRESETS).toEqual(['pkk', 'bozkurt']);
    for (const pattern of DISPLAY_NAME_PRESETS) expect(isValidForbiddenName(pattern)).toBe(true);
  });

  it('verwendet Standardbegriffe nur als Prüfkandidaten', () => {
    expect(
      findDisplayNamePresetMatch({
        id: 1,
        is_bot: false,
        first_name: 'Max P.K.K',
      }),
    ).toMatchObject({ pattern: 'pkk' });
    expect(
      findDisplayNamePresetMatch({
        id: 2,
        is_bot: false,
        first_name: 'Bozkurt Test',
      }),
    ).toMatchObject({ pattern: 'bozkurt' });
    expect(
      findDisplayNamePresetMatch({
        id: 3,
        is_bot: false,
        first_name: 'Max A.F.D',
      }),
    ).toBeNull();
  });

  it('erklärt dem entfernten Nutzer den sichtbaren Namen und ignorierten @Namen', () => {
    const notice = translate('de', 'name_guard_private_notice', {
      message: 'Ändere deinen Namen.',
    });
    expect(notice).toContain('sichtbarer Vor- und Nachname');
    expect(notice).toContain('@Benutzername');
    expect(notice).toContain('erneut beitreten');
  });
});
