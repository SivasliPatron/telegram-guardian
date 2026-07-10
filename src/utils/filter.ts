import safeRegex from 'safe-regex2';

export type MatchType = 'EXACT' | 'CONTAINS' | 'REGEX';

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
