const DURATION_PATTERN = /^(\d+)([mhdw])$/i;
const UNIT_SECONDS: Readonly<Record<string, number>> = {
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
};

export function parseDuration(value: string): number | null {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match?.[1] || !match[2]) return null;
  const amount = Number.parseInt(match[1], 10);
  const multiplier = UNIT_SECONDS[match[2].toLowerCase()];
  if (!multiplier || amount < 1) return null;
  const seconds = amount * multiplier;
  return Number.isSafeInteger(seconds) && seconds <= 366 * 24 * 60 * 60 ? seconds : null;
}

export function formatDuration(seconds: number): string {
  if (seconds % 604_800 === 0) return `${seconds / 604_800}w`;
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  return `${Math.ceil(seconds / 60)}m`;
}
