import { describe, expect, it } from 'vitest';
// @ts-expect-error A plain build script without type declarations.
import { draftRow, rowName, versionStarts } from '../../scripts/feed-draft.mjs';

const starts = versionStarts(
  [{ game: 'hsr', type: 'maintenance', name: 'v4.7 update maintenance', end: '2026-11-11 11:00', timezone: 'UTC+8' }],
  'hsr',
);

describe('calendar drafts from publisher notices', () => {
  it('reads "after the update" windows, keeping global times marked as UTC+8', () => {
    const row = draftRow(
      'hsr',
      {
        ann_id: 1402,
        title: '"The Fluffy Movie: Overheated": Manage a dessert shop!',
        content:
          '<p>Limited-Time Event Period</p><p>After the Version 4.7 update – &lt;t class="t_gl"&gt;2026/12/23 03:59:00&lt;/t&gt;</p>',
      },
      starts,
    );
    expect(row).toEqual({
      game: 'hsr',
      name: 'The Fluffy Movie: Overheated',
      type: 'event',
      start: '2026-11-11 11:00',
      end: '2026-12-23 03:59',
      notes: '',
      sourceKey: 'hsr:1402',
      timezone: 'UTC+8',
    });
  });

  it('reads two server-local times as they are, and names banners', () => {
    const row = draftRow(
      'genshin',
      {
        ann_id: 1,
        title: 'Event Wish "Chanson" - Boosted Drop Rate for X',
        content: '〓Event Wish Duration〓 <t class="t_lc">2026/11/24 18:00</t> – <t class="t_lc">2026/12/15 14:59</t>',
      },
      new Map(),
    );
    expect(row).toMatchObject({ type: 'banner', start: '2026-11-24 18:00', end: '2026-12-15 14:59' });
    expect(row.timezone).toBeUndefined();
  });

  it('skips what it cannot place without guessing, and notices that are not events', () => {
    const unknownVersion = {
      ann_id: 2,
      title: 'Something',
      content: 'Event Duration After the Version 9.9 update – <t class="t_lc">2027/01/01 03:59</t>',
    };
    expect(draftRow('hsr', unknownVersion, starts)).toBeNull();
    expect(draftRow('hsr', { ann_id: 3, title: 'Version 4.7 Store Update', content: '' }, starts)).toBeNull();
    expect(rowName('"Sacred Spirit Chronicle" Event Details')).toBe('Sacred Spirit Chronicle');
  });
});
