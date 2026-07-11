import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_MARKER_TTL_SECONDS,
  activityMarkerKey,
  readActivityMarker,
  recordActivityMarker,
} from '../src/services/activity-marker.js';
import type { RedisClient } from '../src/services/redis.js';

describe('Redis-Aktivitätsmarker', () => {
  it('speichert den neuesten Telegram-Zeitpunkt atomar mit Sicherheits-TTL', async () => {
    const evalCommand = vi.fn().mockResolvedValue(1);
    const redis = { eval: evalCommand } as unknown as RedisClient;
    const occurredAt = new Date('2026-07-12T01:02:03.000Z');

    await recordActivityMarker(redis, 'group-1', 42n, occurredAt);

    expect(evalCommand).toHaveBeenCalledWith(
      expect.stringContaining('tonumber'),
      1,
      'inactivity-activity:group-1:42',
      occurredAt.getTime().toString(),
      ACTIVITY_MARKER_TTL_SECONDS.toString(),
    );
    expect(activityMarkerKey('group-1', 42n)).toBe('inactivity-activity:group-1:42');
  });

  it('liest gültige Zeitpunkte und verwirft beschädigte Werte', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce('1783818123000')
      .mockResolvedValueOnce('kaputt')
      .mockResolvedValueOnce(null);
    const redis = { get } as unknown as RedisClient;

    await expect(readActivityMarker(redis, 'group-1', 42n)).resolves.toEqual(
      new Date(1_783_818_123_000),
    );
    await expect(readActivityMarker(redis, 'group-1', 42n)).resolves.toBeNull();
    await expect(readActivityMarker(redis, 'group-1', 42n)).resolves.toBeNull();
  });
});
