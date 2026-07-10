const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isClockTime(value: string): boolean {
  return CLOCK_PATTERN.test(value);
}

export function localClock(date: Date, timezone: string): { time: string; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const weekdays: Readonly<Record<string, number>> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 0,
  };
  return { time: `${value('hour')}:${value('minute')}`, weekday: weekdays[value('weekday')] ?? 0 };
}

export function shouldNightModeBeClosed(current: string, close: string, open: string): boolean {
  if (!isClockTime(current) || !isClockTime(close) || !isClockTime(open) || close === open)
    return false;
  if (close < open) return current >= close && current < open;
  return current >= close || current < open;
}
