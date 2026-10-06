import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({ readFile: vi.fn(), writeFile: vi.fn() }));
vi.mock('node:fs/promises', () => disk);
const committed = JSON.parse(readFileSync(new URL('../../app/public/events.json', import.meta.url), 'utf8'));
const originalArgs = process.argv;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.argv = ['node', 'scripts/export-event-feed.mjs', '--check'];
  disk.readFile.mockResolvedValue(JSON.stringify(committed));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  process.argv = originalArgs;
  vi.restoreAllMocks();
});

describe('public event feed freshness check', () => {
  it('preserves the publication timestamp when unchanged content is exported', async () => {
    process.argv = ['node', 'scripts/export-event-feed.mjs'];
    await import('../../scripts/export-event-feed.mjs');
    expect(JSON.parse(disk.writeFile.mock.calls[0][1]).generatedAt).toBe(committed.generatedAt);
  });

  it.each([0, -1000])(
    'publishes changed content after the previous timestamp despite clock offset %s',
    async (offset) => {
      process.argv = ['node', 'scripts/export-event-feed.mjs'];
      disk.readFile.mockResolvedValue(JSON.stringify({ ...committed, revision: 'previous-content' }));
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse(committed.generatedAt) + offset);
      await import('../../scripts/export-event-feed.mjs');
      expect(Date.parse(JSON.parse(disk.writeFile.mock.calls[0][1]).generatedAt)).toBeGreaterThan(
        Date.parse(committed.generatedAt),
      );
    },
  );

  it('refuses a changed feed whose required timestamp is too far in the future', async () => {
    process.argv = ['node', 'scripts/export-event-feed.mjs'];
    disk.readFile.mockResolvedValue(JSON.stringify({ ...committed, revision: 'previous-content' }));
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(committed.generatedAt) - 300_001);
    await expect(import('../../scripts/export-event-feed.mjs')).rejects.toThrow('future');
    expect(disk.writeFile).not.toHaveBeenCalled();
  });

  it('rejects an explicit timestamp that cannot advance changed content', async () => {
    process.argv = ['node', 'scripts/export-event-feed.mjs', '--generated-at', committed.generatedAt];
    disk.readFile.mockResolvedValue(JSON.stringify({ ...committed, revision: 'previous-content' }));
    await expect(import('../../scripts/export-event-feed.mjs')).rejects.toThrow('later publication');
    expect(disk.writeFile).not.toHaveBeenCalled();
  });

  it('accepts an earlier valid publication timestamp without writing the feed', async () => {
    disk.readFile.mockResolvedValue(JSON.stringify({ ...committed, generatedAt: '2026-01-01T00:00:00.000Z' }));
    await expect(import('../../scripts/export-event-feed.mjs')).resolves.toBeDefined();
    expect(disk.writeFile).not.toHaveBeenCalled();
  });

  it.each(['content', 'revision', 'seedUpdated', 'withdrawn'])(
    'rejects stale %s even when the other fields still match',
    async (field) => {
      const fixture = structuredClone(committed);
      if (field === 'content') fixture.events[0].name += ' stale fixture';
      else if (field === 'revision') fixture.revision = 'stale-revision';
      else if (field === 'seedUpdated') fixture.seedUpdated = '2000-01-01';
      else fixture.withdrawn.push('fixture:withdrawn-event');
      disk.readFile.mockResolvedValue(JSON.stringify(fixture));
      await expect(import('../../scripts/export-event-feed.mjs')).rejects.toThrow('is stale');
      expect(disk.writeFile).not.toHaveBeenCalled();
    },
  );

  it('validates the retained publication timestamp', async () => {
    disk.readFile.mockResolvedValue(JSON.stringify({ ...committed, generatedAt: 'not-a-timestamp' }));
    await expect(import('../../scripts/export-event-feed.mjs')).rejects.toThrow();
    expect(disk.writeFile).not.toHaveBeenCalled();
  });
});
