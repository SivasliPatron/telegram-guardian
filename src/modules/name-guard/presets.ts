import type { User as TelegramUser } from 'grammy/types';
import {
  matchesForbiddenName,
  normalizeName,
  normalizedProfileName,
  type ForbiddenNameMatch,
} from '../../services/name-guard.js';

export const DISPLAY_NAME_PRESETS = ['pkk', 'bozkurt'] as const;

export function findDisplayNamePresetMatch(user: TelegramUser): ForbiddenNameMatch | null {
  const profileName = normalizedProfileName(user);
  for (const pattern of DISPLAY_NAME_PRESETS) {
    const normalized = normalizeName(pattern);
    if (
      matchesForbiddenName(profileName, {
        normalizedPattern: normalized.normalized,
        compactPattern: normalized.compact,
      })
    ) {
      return { id: `candidate:${normalized.normalized}`, pattern };
    }
  }
  return null;
}
