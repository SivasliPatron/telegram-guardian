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
    key: 'profanity-de-extended',
    label: 'Beleidigungen – Deutsch erweitert',
    pattern: words(
      'hure',
      'hurentochter',
      'arschgeige',
      'arschficker',
      'arschkriecher',
      'dreckschwein',
      'scheißkerl',
      'scheisskerl',
      'wichskopf',
      'ficker',
      'ficksau',
      'pissnelke',
      'vollidiot',
      'idiot',
    ),
  },
  {
    key: 'profanity-de-phrases',
    label: 'Beleidigende Phrasen – Deutsch',
    pattern: words(
      'fick',
      String.raw`fick\s+dich`,
      String.raw`fick\s+deine\s+mutter`,
      String.raw`verpiss\s+dich`,
      String.raw`leck\s+mich\s+am\s+arsch`,
      String.raw`sohn\s+einer\s+hure`,
      'schwanzlutscher',
      'nuttenkind',
    ),
  },
  {
    key: 'profanity-reported-obfuscations',
    label: 'Gemeldete verschleierte Beleidigungen',
    pattern: words('geschmichte', 'fikdikgöt', 'fikdikgot'),
  },
  {
    key: 'profanity-de-context',
    label: 'Beleidigende Sätze – Deutsch',
    pattern: words(
      String.raw`du\s+(?:hund|schwein|esel|affe|ratte|opfer|versager)`,
      String.raw`halt\s+die\s+fresse`,
      String.raw`geh\s+sterben`,
      'verreck',
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
    key: 'profanity-tr-body',
    label: 'Vulgäre Begriffe – Türkisch',
    pattern: words(
      'amcık',
      'amcik',
      'amcuk',
      'göt',
      'götveren',
      'götlek',
      'götoş',
      'gotos',
      'yarak',
      'yarrak',
      'taşak',
      'tasak',
      'sikici',
      'sikilmis',
      'sikilmiş',
    ),
  },
  {
    key: 'profanity-tr-insults',
    label: 'Beleidigungen – Türkisch erweitert',
    pattern: words(
      'ibne',
      'gavat',
      'kavat',
      'kaltak',
      'kaşar',
      'kasar',
      'namussuz',
      'dangalak',
      'gerizekalı',
      'gerizekali',
      'salak',
      'ahmak',
      'aptal',
      'öküz',
      'okuz',
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
    key: 'profanity-tr-phrases-extended',
    label: 'Schwere Beleidigungen – Türkisch erweitert',
    pattern: words(
      String.raw`avradını\s+sikeyim`,
      String.raw`avradini\s+sikeyim`,
      String.raw`bacını\s+sikeyim`,
      String.raw`bacini\s+sikeyim`,
      String.raw`sülaleni\s+sikeyim`,
      String.raw`sulaleni\s+sikeyim`,
      String.raw`siktir\s+git`,
      String.raw`amına\s+kodumun`,
      String.raw`amina\s+kodumun`,
    ),
  },
  {
    key: 'profanity-tr-concatenated',
    label: 'Zusammengezogene Beleidigungen – Türkisch',
    pattern: words(
      'amınakoy',
      'aminakoy',
      'amınakoyayım',
      'aminakoyayim',
      'amınakoyarım',
      'aminakoyarim',
      'amınakoyim',
      'aminakoyim',
      'amınoğlu',
      'aminoglu',
      'orospuçocuğu',
      'orospucocugu',
      'siktirgit',
    ),
  },
  {
    key: 'profanity-tr-context',
    label: 'Beleidigende Sätze – Türkisch',
    pattern: words(
      String.raw`sen\s+(?:köpek|kopek|eşek|esek|şerefsiz|serefsiz|salak|aptal)`,
      String.raw`it\s+oğlu`,
      String.raw`it\s+oglu`,
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
    key: 'profanity-ku-extended',
    label: 'Beleidigungen – Kurmancî erweitert',
    pattern: words(
      'ehmeq',
      'bêaqil',
      'beaqil',
      'qehbik',
      String.raw`tu\s+kûçik`,
      String.raw`tu\s+kucik`,
      String.raw`kurê\s+kûçikê`,
      String.raw`kure\s+kucike`,
      String.raw`kurê\s+kerê`,
      String.raw`kure\s+kere`,
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
      String.raw`dinini\s+du\s+hund`,
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
