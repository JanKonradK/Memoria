import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({ readFile: vi.fn(), writeFile: vi.fn() }));
vi.mock('node:fs/promises', () => disk);
const committed = JSON.parse(readFileSync(new URL('../../app/public/events.json', import.meta.url), 'utf8'));
const originalArgs = process.argv;
const contents = JSON.parse(Buffer.from(committed.payload, 'base64')).data;
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const signed = (data) => {
  const bytes = Buffer.from(
    JSON.stringify({ context: 'memoria-event-feed-v1', sequence: Date.parse(data.generatedAt), data }),
  );
  return { payload: bytes.toString('base64'), signature: sign(null, bytes, privateKey).toString('hex') };
};
vi.mock('../../scripts/publisher-signing.mjs', () => ({
  signPublished: (_context, data) => signed(data),
  readPublished: (file) => {
    // The real committed publisher signature is checked by export --check.
    if (
      file.signature !== committed.signature &&
      !verify(null, Buffer.from(file.payload, 'base64'), publicKey, Buffer.from(file.signature, 'hex'))
    )
      throw new Error('Invalid signature.');
    return JSON.parse(Buffer.from(file.payload, 'base64'));
  },
}));
const readFeed = (file) => JSON.parse(Buffer.from(file.payload, 'base64')).data;

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
    expect(readFeed(JSON.parse(disk.writeFile.mock.calls[0][1])).generatedAt).toBe(contents.generatedAt);
  });

  it('signs a new publication when the owner supplies a later timestamp', async () => {
    const timestamp = new Date(Date.parse(contents.generatedAt) + 1).toISOString();
    process.argv = ['node', 'scripts/export-event-feed.mjs', '--generated-at', timestamp];
    await import('../../scripts/export-event-feed.mjs');
    const file = JSON.parse(disk.writeFile.mock.calls[0][1]);
    expect(readFeed(file).generatedAt).toBe(timestamp);
    expect(JSON.parse(Buffer.from(file.payload, 'base64')).sequence).toBe(Date.parse(timestamp));
  });

  it.each([0, -1000])(
    'publishes changed content after the previous timestamp despite clock offset %s',
    async (offset) => {
      process.argv = ['node', 'scripts/export-event-feed.mjs'];
      disk.readFile.mockResolvedValue(JSON.stringify(signed({ ...contents, revision: 'previous-content' })));
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse(contents.generatedAt) + offset);
      await import('../../scripts/export-event-feed.mjs');
      expect(Date.parse(readFeed(JSON.parse(disk.writeFile.mock.calls[0][1])).generatedAt)).toBeGreaterThan(
        Date.parse(contents.generatedAt),
      );
    },
  );

  it('refuses a changed feed whose required timestamp is too far in the future', async () => {
    process.argv = ['node', 'scripts/export-event-feed.mjs'];
    disk.readFile.mockResolvedValue(JSON.stringify(signed({ ...contents, revision: 'previous-content' })));
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(contents.generatedAt) - 300_001);
    await expect(import('../../scripts/export-event-feed.mjs')).rejects.toThrow('future');
    expect(disk.writeFile).not.toHaveBeenCalled();
  });

  it('rejects an explicit timestamp that cannot advance changed content', async () => {
    process.argv = ['node', 'scripts/export-event-feed.mjs', '--generated-at', contents.generatedAt];
    disk.readFile.mockResolvedValue(JSON.stringify(signed({ ...contents, revision: 'previous-content' })));
    await expect(import('../../scripts/export-event-feed.mjs')).rejects.toThrow('later publication');
    expect(disk.writeFile).not.toHaveBeenCalled();
  });

  it('accepts an earlier valid publication timestamp without writing the feed', async () => {
    disk.readFile.mockResolvedValue(JSON.stringify(signed({ ...contents, generatedAt: '2026-01-01T00:00:00.000Z' })));
    await expect(import('../../scripts/export-event-feed.mjs')).resolves.toBeDefined();
    expect(disk.writeFile).not.toHaveBeenCalled();
  });

  it.each(['content', 'revision', 'seedUpdated', 'withdrawn'])(
    'rejects stale %s even when the other fields still match',
    async (field) => {
      const fixture = structuredClone(contents);
      if (field === 'content') fixture.events[0].name += ' stale fixture';
      else if (field === 'revision') fixture.revision = 'stale-revision';
      else if (field === 'seedUpdated') fixture.seedUpdated = '2000-01-01';
      else fixture.withdrawn.push('fixture:withdrawn-event');
      disk.readFile.mockResolvedValue(JSON.stringify(signed(fixture)));
      await expect(import('../../scripts/export-event-feed.mjs')).rejects.toThrow('is stale');
      expect(disk.writeFile).not.toHaveBeenCalled();
    },
  );

  it('validates the retained publication timestamp', async () => {
    disk.readFile.mockResolvedValue(JSON.stringify(signed({ ...contents, generatedAt: 'not-a-timestamp' })));
    await expect(import('../../scripts/export-event-feed.mjs')).rejects.toThrow();
    expect(disk.writeFile).not.toHaveBeenCalled();
  });
});
