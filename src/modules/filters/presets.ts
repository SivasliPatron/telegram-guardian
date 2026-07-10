import { FilterActionType, FilterMatchType } from '../../generated/prisma/enums.js';
import type { Database } from '../../database/client.js';

const WORD_START = String.raw`(?:^|[^\p{L}\p{N}_])`;
const WORD_END = String.raw`(?=$|[^\p{L}\p{N}_])`;

function words(...expressions: string[]): string {
  return `${WORD_START}(?:${expressions.join('|')})${WORD_END}`;
}

export interface PresetFilterDefinition {
  key: string;
  label: string;
  pattern: string;
}

export const PRESET_FILTERS: readonly PresetFilterDefinition[] = [
  {
    key: 'profanity-de',
    label: 'Beleidigungen – Deutsch',
    pattern: words(
      'arschloch',
      'arschlöcher',
      'hurensohn',
      'hurensöhne',
      'wichser',
      'fotze',
      'missgeburt',
      'drecksau',
      'schlampe',
      'bastard',
      'nutte',
    ),
  },
  {
    key: 'profanity-tr-words',
    label: 'Beleidigungen – Türkisch',
    pattern: words(
      'orospu',
      'oruspu',
      'pezevenk',
      'şerefsiz',
      'serefsiz',
      'piç',
      'pic',
      'puşt',
      'pust',
      'kahpe',
      'yavşak',
      'yavsak',
      'sikik',
      'siktir',
      'amk',
    ),
  },
  {
    key: 'profanity-tr-phrases',
    label: 'Schwere Beleidigungen – Türkisch',
    pattern: words(
      String.raw`orospu\s+(?:çocuğu|cocugu|evladı|evladi)`,
      String.raw`amına\s+koyayım`,
      String.raw`amina\s+koyayim`,
      String.raw`ananı\s+sikeyim`,
      String.raw`anani\s+sikeyim`,
    ),
  },
  {
    key: 'profanity-ku',
    label: 'Beleidigungen – Kurmancî',
    pattern: words(
      'qehpe',
      'qehpê',
      String.raw`kurê\s+qehpê`,
      String.raw`kure\s+qehpe`,
      'bêşeref',
      'beseref',
      'haramzade',
    ),
  },
  {
    key: 'religious-abuse-modifiers',
    label: 'Verunglimpfung islamischer Heiligtümer',
    pattern: words(
      String.raw`(?:scheiß|scheiss|drecks|pis|lanet)\s*(?:islam|allah|koran|kuran|quran|mohammed|muhammed|peygamber|moschee|muslime?|moslems?)`,
    ),
  },
  {
    key: 'religious-abuse-de-phrases',
    label: 'Vulgäre Angriffe auf Religion – Deutsch',
    pattern: words(
      String.raw`(?:islam|allah|koran|kuran|quran|mohammed|muhammed)\s+(?:scheiße|scheisse|dreck)`,
      String.raw`(?:muslim|moslem)(?:schwein(?:e)?|pack)`,
    ),
  },
  {
    key: 'religious-abuse-de-statements',
    label: 'Vulgäre Religionsaussagen – Deutsch',
    pattern: words(
      String.raw`(?:islam|allah|koran|kuran|quran|mohammed|muhammed)\s+ist\s+(?:scheiße|scheisse|dreck)`,
    ),
  },
  {
    key: 'religious-abuse-phrases',
    label: 'Vulgäre Angriffe auf Religion – Türkisch',
    pattern: words(
      String.raw`(?:allahını|allahini|dinini|kitabını|kitabini|peygamberini|islamı|islami|kuranı|kurani|quranı|qurani)\s+sik(?:eyim|iyim|tim)`,
    ),
  },
] as const;

export async function setPresetFilters(
  database: Database,
  groupId: string,
  actorTelegramId: bigint,
  enabled: boolean,
): Promise<void> {
  if (!enabled) {
    await database.filter.updateMany({
      where: { groupId, presetKey: { in: PRESET_FILTERS.map(({ key }) => key) } },
      data: { enabled: false },
    });
    return;
  }

  await database.$transaction(
    PRESET_FILTERS.map((preset) =>
      database.filter.upsert({
        where: { groupId_presetKey: { groupId, presetKey: preset.key } },
        create: {
          groupId,
          presetKey: preset.key,
          pattern: preset.pattern,
          matchType: FilterMatchType.REGEX,
          action: FilterActionType.WARN,
          ignoreCase: true,
          createdByTelegramId: actorTelegramId,
        },
        update: {
          pattern: preset.pattern,
          matchType: FilterMatchType.REGEX,
          action: FilterActionType.WARN,
          ignoreCase: true,
          enabled: true,
          deletedAt: null,
        },
      }),
    ),
  );
}

export async function countEnabledPresetFilters(
  database: Database,
  groupId: string,
): Promise<number> {
  return database.filter.count({
    where: {
      groupId,
      presetKey: { in: PRESET_FILTERS.map(({ key }) => key) },
      enabled: true,
      deletedAt: null,
    },
  });
}
