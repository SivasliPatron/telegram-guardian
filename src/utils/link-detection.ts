export type LinkViolation =
  | 'telegram_link'
  | 'external_link'
  | 'short_link'
  | 'username_ad'
  | 'phone'
  | 'email'
  | 'forwarded_channel';

export interface LinkPolicy {
  telegramLinks: boolean;
  externalLinks: boolean;
  shortLinks: boolean;
  usernameAds: boolean;
  phoneNumbers: boolean;
  emailAddresses: boolean;
  forwardedChannel: boolean;
  allowedDomains: readonly string[];
}

const URL_PATTERN =
  /(?:https?:\/\/|www\.)[^\s<]+|(?<!@)\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<]*)?/giu;
const TELEGRAM_PATTERN = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/[\w+/-]+/iu;
const SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'cutt.ly',
]);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const PHONE_PATTERN = /(?:^|\s)(?:\+?\d[\d\s()./-]{7,}\d)(?:$|\s)/u;
const USERNAME_PATTERN = /(?:^|\s)@[a-zA-Z][a-zA-Z0-9_]{4,}\b/u;

function domainOf(rawUrl: string): string | null {
  try {
    const normalized = /^https?:\/\//iu.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return new URL(normalized).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isAllowed(domain: string, allowedDomains: readonly string[]): boolean {
  return allowedDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

export function detectLinkViolation(
  text: string,
  policy: LinkPolicy,
  hasForwardedChannel = false,
): LinkViolation | null {
  if (policy.forwardedChannel && hasForwardedChannel) return 'forwarded_channel';
  if (policy.emailAddresses && EMAIL_PATTERN.test(text)) return 'email';
  if (policy.phoneNumbers && PHONE_PATTERN.test(text)) return 'phone';
  if (policy.usernameAds && USERNAME_PATTERN.test(text)) return 'username_ad';

  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const domain = domainOf(raw);
    if (!domain || isAllowed(domain, policy.allowedDomains)) continue;
    if (policy.telegramLinks && TELEGRAM_PATTERN.test(raw)) return 'telegram_link';
    if (policy.shortLinks && SHORTENERS.has(domain)) return 'short_link';
    if (policy.externalLinks) return 'external_link';
  }

  if (policy.telegramLinks && TELEGRAM_PATTERN.test(text)) return 'telegram_link';
  return null;
}
