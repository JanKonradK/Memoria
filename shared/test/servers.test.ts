import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { GAME_SERVERS, gameServer, PRESETS, serversFor } from '../src';

const utcOffset = (tz: string) => DateTime.fromISO('2026-01-15T12:00:00Z', { zone: tz }).offset / 60;

describe('game servers', () => {
  it('lists servers for every preset, each on a real clock', () => {
    for (const preset of PRESETS) {
      const servers = serversFor(preset.key);
      expect(servers.length, preset.key).toBeGreaterThan(0);
      expect(new Set(servers.map((server) => server.id)).size, preset.key).toBe(servers.length);
      for (const server of servers) expect(DateTime.now().setZone(server.tz).isValid, server.tz).toBe(true);
    }
    // Etc zones invert the sign; a slip here moves every reset by hours.
    expect(utcOffset(GAME_SERVERS.genshin.find((s) => s.id === 'na')!.tz)).toBe(-5);
    expect(utcOffset(GAME_SERVERS.genshin.find((s) => s.id === 'eu')!.tz)).toBe(1);
    expect(utcOffset(GAME_SERVERS.genshin.find((s) => s.id === 'tw')!.tz)).toBe(8);
  });

  it('names a server only when it knows which one', () => {
    expect(gameServer({ presetKey: 'genshin', server: 'tw', tz: 'Etc/GMT-8' })?.id).toBe('tw');
    expect(gameServer({ presetKey: 'genshin', tz: 'Etc/GMT-1' })?.id).toBe('eu');
    // Asia, TW/HK/MO and China share UTC+8: an old account without a server stays unnamed.
    expect(gameServer({ presetKey: 'genshin', tz: 'Etc/GMT-8' })).toBeUndefined();
    // A server id that no longer matches the clock is not trusted.
    expect(gameServer({ presetKey: 'genshin', server: 'eu', tz: 'Asia/Tokyo' })).toBeUndefined();
    expect(gameServer({ tz: 'Etc/GMT-1' })).toBeUndefined();
  });
});
