import { createHash } from 'node:crypto';
import { canonicalizeLearnedFilterText } from '../utils/filter.js';

export const LEARNED_REVIEW_FILTER_PREFIX = 'learned-review:';

export function learnedReviewFilterKey(messageText: string): string {
  const canonicalText = canonicalizeLearnedFilterText(messageText);
  const digest = createHash('sha256').update(canonicalText).digest('hex');
  return `${LEARNED_REVIEW_FILTER_PREFIX}${digest}`;
}

export function isLearnedReviewFilterKey(value: string | null | undefined): boolean {
  return value?.startsWith(LEARNED_REVIEW_FILTER_PREFIX) ?? false;
}
