import safeRegex from 'safe-regex2';

const LEETSPEAK_REPLACEMENTS: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '!': 'i',
  '@': 'a',
  $: 's',
};

export type MatchType = 'EXACT' | 'CONTAINS' | 'REGEX';

export function canonicalizeLearnedFilterText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase();
}

export function validateFilterPattern(pattern: string, matchType: MatchType): boolean {
  if (pattern.length < 1 || pattern.length > 200) return false;
  if (matchType !== 'REGEX') return true;
  try {
    return safeRegex(pattern) && new RegExp(pattern, 'u') instanceof RegExp;
  } catch {
    return false;
  }
}

export function filterMatches(
  text: string,
  pattern: string,
  matchType: MatchType,
  ignoreCase: boolean,
): boolean {
  const candidate = ignoreCase ? text.toLocaleLowerCase() : text;
  const expected = ignoreCase ? pattern.toLocaleLowerCase() : pattern;
  if (matchType === 'EXACT') return candidate === expected;
  if (matchType === 'CONTAINS') return candidate.includes(expected);
  if (!validateFilterPattern(pattern, 'REGEX')) return false;
  return new RegExp(pattern, ignoreCase ? 'iu' : 'u').test(text);
}

export function moderationTextVariants(text: string): string[] {
  const normalized = text.normalize('NFKC').replace(/\p{Cf}/gu, '');
  const leetspeak = normalized.replace(
    /[0134578!@$]/gu,
    (character) => LEETSPEAK_REPLACEMENTS[character] ?? character,
  );
  const withoutInnerSeparators = leetspeak.replace(
    /(?<=[\p{L}\p{N}])[._*•·~-]+(?=[\p{L}\p{N}])/gu,
    '',
  );
  const joinedSingleLetters = withoutInnerSeparators.replace(
    /(^|[^\p{L}\p{N}])((?:[\p{L}\p{N}]\s+){2,}[\p{L}\p{N}])(?=$|[^\p{L}\p{N}])/gu,
    (_match, prefix: string, sequence: string) => `${prefix}${sequence.replace(/\s+/gu, '')}`,
  );
  const collapsedRepetitions = joinedSingleLetters.replace(/([\p{L}\p{N}])\1{2,}/giu, '$1');
  return [
    ...new Set([
      text,
      normalized,
      leetspeak,
      withoutInnerSeparators,
      joinedSingleLetters,
      collapsedRepetitions,
    ]),
  ];
}

export function presetFilterMatches(text: string, pattern: string, ignoreCase: boolean): boolean {
  return moderationTextVariants(text).some((variant) =>
    filterMatches(variant, pattern, 'REGEX', ignoreCase),
  );
}

export function configuredFilterMatches(
  text: string,
  filter: {
    presetKey?: string | null;
    learnedKey?: string | null;
    pattern: string;
    matchType: MatchType;
    ignoreCase: boolean;
  },
): boolean {
  if (filter.learnedKey && filter.matchType === 'EXACT') {
    return canonicalizeLearnedFilterText(text) === canonicalizeLearnedFilterText(filter.pattern);
  }
  return filter.presetKey && filter.matchType === 'REGEX'
    ? presetFilterMatches(text, filter.pattern, filter.ignoreCase)
    : filterMatches(text, filter.pattern, filter.matchType, filter.ignoreCase);
}
