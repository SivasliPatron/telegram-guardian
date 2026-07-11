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
    key: 'sexual-explicit-general',
    label: 'Explizite Sexualbegriffe – allgemein',
    pattern: words(
      'penis',
      'vagina',
      'vajina',
      'vulva',
      'klitoris',
      'clitoris',
      'pimmel',
      'schwanz',
      'dildo',
      'sperma',
      'orgasmus',
      'masturbation',
      'masturbieren',
    ),
  },
  {
    key: 'sexual-explicit-media',
    label: 'Pornografische und sexuelle Begriffe',
    pattern: words(
      'porno',
      'porn',
      'pornografie',
      'pornographie',
      'sex',
      'seks',
      'anal',
      'oral',
      'blowjob',
      'handjob',
      'deepthroat',
      'kîr',
    ),
  },
  {
    key: 'politics-kurdish-organizations',
    label: 'Politische Organisationen – kurdischer Kontext',
    pattern: words(
      'pkk',
      'kck',
      'ypg',
      'ypj',
      'hpg',
      'pjak',
      String.raw`partiya\s+karker[eê]n\s+kurdistan[eê]?`,
      String.raw`kurdistan\s+işçi\s+partisi`,
      String.raw`kurdistan\s+isci\s+partisi`,
    ),
  },
  {
    key: 'politics-kurdish-slogans',
    label: 'Politische Parolen – kurdischer Kontext',
    pattern: words(
      String.raw`biji\s+(?:apo|pkk|serok\s+apo|berxwedan)`,
      String.raw`serok\s+apo`,
      String.raw`(?:yaşasın|yasasin)\s+(?:apo|pkk)`,
      String.raw`biji\s+berxwedana\s+kurdistan[eê]?`,
    ),
  },
  {
    key: 'politics-turkish-nationalist',
    label: 'Politische Symbole und Parolen – türkischer Kontext',
    pattern: words(
      'bozkurt',
      'bozkurtlar',
      'ülkücü',
      'ulkucu',
      'ülkücüler',
      'ulkuculer',
      String.raw`ülkü\s+ocakları`,
      String.raw`ulku\s+ocaklari`,
      String.raw`graue\s+wölfe`,
      String.raw`graue\s+wolfe`,
      String.raw`grey\s+wolves`,
    ),
  },
  {
    key: 'politics-parties-turkey',
    label: 'Politische Parteien – Türkei',
    pattern: words(
      'akp',
      'mhp',
      'chp',
      'hdp',
      String.raw`dem\s+parti(?:si)?`,
      String.raw`iyi\s+parti(?:si)?`,
      String.raw`zafer\s+parti(?:si)?`,
      String.raw`h[üu]da\s*par`,
    ),
  },
  {
    key: 'politics-turkish-slogans',
    label: 'Politische Parolen – Türkisch',
    pattern: words(String.raw`(?:yaşasın|yasasin)\s+bozkurt`, String.raw`biji\s+bozkurt`),
  },
  {
    key: 'politics-turkish-state-slogans',
    label: 'Nationalistische politische Parolen – Türkisch',
    pattern: words(
      String.raw`ne\s+mutlu\s+türküm\s+diyene`,
      String.raw`ne\s+mutlu\s+turkum\s+diyene`,
      String.raw`şehitler\s+ölmez\s+vatan\s+bölünmez`,
      String.raw`sehitler\s+olmez\s+vatan\s+bolunmez`,
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
