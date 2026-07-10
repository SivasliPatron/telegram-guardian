export function isFlooding(
  messageTimestamps: readonly number[],
  now: number,
  windowSeconds: number,
  maximumMessages: number,
): boolean {
  const cutoff = now - windowSeconds * 1_000;
  return (
    messageTimestamps.filter((timestamp) => timestamp > cutoff && timestamp <= now).length >
    maximumMessages
  );
}
