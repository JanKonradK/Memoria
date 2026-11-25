import { describe, expect, it } from 'vitest';
import { inferScreenshotGame, matchOcrReadings, matchScreenshotOcr } from '../src/connectors';
import { makeEvent, makeGame, makeResource, makeTask } from './helpers';

const resin = makeResource({ id: 'resin', name: 'Original Resin', cap: 200 });
const tb = makeResource({
  id: 'tb',
  name: 'Trailblaze Power',
  cap: 240,
  reserveCap: 2400,
  reserveLabel: 'Reserve TB Power',
});

describe('matchOcrReadings', () => {
  it('matches fractions only against known caps', () => {
    const found = matchOcrReadings(['Resin 120/200', 'HP 3500/9000'], [resin, tb]);
    expect(found).toEqual([
      {
        resourceId: 'resin',
        resourceName: 'Original Resin',
        field: 'value',
        value: 120,
        cap: 200,
        confidence: 'high',
        line: 'Resin 120/200',
      },
    ]);
  });

  it('fixes digit glitches inside fractions', () => {
    const found = matchOcrReadings(['l2O / 2OO'], [resin]);
    expect(found[0]).toMatchObject({ value: 120, confidence: 'high' });
  });

  it('accepts overflow as medium and drops implausible values', () => {
    expect(matchOcrReadings(['300/240'], [tb])[0]).toMatchObject({ value: 300, confidence: 'medium' });
    expect(matchOcrReadings(['900/240'], [tb])).toEqual([]);
  });

  it('reads label-anchored reserve numbers', () => {
    const found = matchOcrReadings(['180/240', 'Reserve TB Power: 1500'], [tb]);
    expect(found.map((c) => [c.field, c.value, c.confidence])).toEqual([
      ['value', 180, 'high'],
      ['reserve', 1500, 'medium'],
    ]);
    expect(matchOcrReadings(['Backup 900'], [tb])[0]).toMatchObject({ field: 'reserve', confidence: 'low' });
    expect(matchOcrReadings(['Backup 9000'], [tb])).toEqual([]);
  });

  it('keeps the most confident reading per resource and skips deleted ones', () => {
    const found = matchOcrReadings(['400/200', '150/200'], [resin]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ value: 150, confidence: 'high' });
    expect(matchOcrReadings(['120/200'], [{ ...resin, deleted: true }])).toEqual([]);
  });

  describe('reserve fractions', () => {
    const waveplates = makeResource({
      id: 'wp',
      name: 'Waveplates',
      cap: 240,
      reserveCap: 480,
      reserveLabel: 'Waveplate Crystals',
    });
    const pixels = makeResource({
      id: 'px',
      name: 'Character Pixels',
      cap: 240,
      reserveCap: 2400,
      reserveLabel: 'Photo Paper Supply',
    });

    it('reads WuWa Waveplate Crystals as a reserve fraction', () => {
      const found = matchOcrReadings(['Waveplate Crystals 320/480', '180/240'], [waveplates]);
      expect(found).toEqual([
        {
          resourceId: 'wp',
          resourceName: 'Waveplates',
          field: 'reserve',
          value: 320,
          cap: 480,
          confidence: 'high',
          line: 'Waveplate Crystals 320/480',
        },
        {
          resourceId: 'wp',
          resourceName: 'Waveplates',
          field: 'value',
          value: 180,
          cap: 240,
          confidence: 'high',
          line: '180/240',
        },
      ]);
    });

    it('trusts an unlabelled reserve fraction only when no main bar shares the cap', () => {
      expect(matchOcrReadings(['320/480'], [waveplates])).toEqual([
        expect.objectContaining({ field: 'reserve', value: 320, cap: 480, confidence: 'medium' }),
      ]);
      const bar480 = makeResource({ id: 'other', name: 'Other', cap: 480 });
      const found = matchOcrReadings(['320/480'], [waveplates, bar480]);
      expect(found).toEqual([expect.objectContaining({ resourceId: 'other', field: 'value', value: 320 })]);
      expect(matchOcrReadings(['600/480'], [waveplates])).toEqual([]);
    });

    it('reads NTE Photo Paper Supply and HSR Reserved Trailblaze Power fractions', () => {
      expect(matchOcrReadings(['Photo Paper Supply 1200/2400'], [pixels])).toEqual([
        expect.objectContaining({ resourceId: 'px', field: 'reserve', value: 1200, cap: 2400, confidence: 'high' }),
      ]);
      expect(matchOcrReadings(['Reserved Trailblaze Power 1500 / 2400'], [tb])).toEqual([
        expect.objectContaining({ resourceId: 'tb', field: 'reserve', value: 1500, cap: 2400, confidence: 'high' }),
      ]);
    });

    it('matches the generic essence and waveplate crystal labels beside a number', () => {
      const plain = makeResource({ id: 'plain', name: 'Stamina', cap: 160, reserveCap: 999 });
      expect(matchOcrReadings(['Essence 420'], [plain])[0]).toMatchObject({
        field: 'reserve',
        value: 420,
        confidence: 'low',
      });
      expect(matchOcrReadings(['Waveplate Crystal: 75'], [plain])[0]).toMatchObject({
        field: 'reserve',
        value: 75,
        confidence: 'low',
      });
      expect(matchOcrReadings(['Waveplate Crystals 75'], [waveplates])[0]).toMatchObject({
        field: 'reserve',
        value: 75,
        confidence: 'medium',
      });
    });
  });
});

describe('matchScreenshotOcr', () => {
  const genshin = makeGame({ id: 'gi', name: 'Genshin Impact', short: 'Genshin', presetKey: 'genshin' });
  const giResin = makeResource({ id: 'gi-resin', gameId: 'gi', name: 'Original Resin', cap: 200 });
  const giCondensed = makeResource({ id: 'gi-cond', gameId: 'gi', name: 'Condensed Resin', cap: 5, regenMinutes: 0 });
  const giCommissions = makeTask({
    id: 'gi-comm',
    gameId: 'gi',
    name: 'Daily Commissions ×4',
    mode: 'check',
    presetTaskKey: 'genshin-commissions',
  });
  const giBosses = makeTask({
    id: 'gi-boss',
    gameId: 'gi',
    name: 'Weekly Bosses ×3',
    cadence: 'weekly',
    mode: 'count',
    countTarget: 3,
    presetTaskKey: 'genshin-weekly-bosses',
  });

  it('reads a whole Genshin screen in one pass', () => {
    const found = matchScreenshotOcr(
      [
        'Original Resin 145/200',
        'Condensed Resin 4/5',
        'Daily Commissions 4/4',
        'Weekly Boss Half-Cost Remaining 1/3',
        'Primogems 14,250',
        'Intertwined Fate 23',
      ],
      { game: genshin, resources: [giResin, giCondensed], tasks: [giCommissions, giBosses] },
    );
    expect(found.readings.map((r) => [r.resourceId, r.field, r.value])).toEqual([
      ['gi-resin', 'value', 145],
      ['gi-cond', 'value', 4],
    ]);
    expect(found.tasks).toEqual([
      expect.objectContaining({ taskId: 'gi-comm', action: 'done', confidence: 'high' }),
      expect.objectContaining({ taskId: 'gi-boss', action: 'count', countDone: 2, countTarget: 3 }),
    ]);
    expect(found.savings).toEqual([
      expect.objectContaining({ field: 'currency', label: 'Primogems', value: 14250, confidence: 'high' }),
      expect.objectContaining({ field: 'tickets', label: 'Intertwined Fate', value: 23, confidence: 'high' }),
    ]);
  });

  it('reads HSR power, reserve, jade, passes and Echo of War', () => {
    const hsr = makeGame({ id: 'hsr', name: 'Honkai: Star Rail', short: 'HSR', presetKey: 'hsr' });
    const power = makeResource({
      id: 'tbp',
      gameId: 'hsr',
      name: 'Trailblaze Power',
      cap: 300,
      reserveCap: 2400,
      reserveLabel: 'Reserve TB Power',
    });
    const echo = makeTask({
      id: 'echo',
      gameId: 'hsr',
      name: 'Echo of War ×3',
      cadence: 'weekly',
      mode: 'count',
      countTarget: 3,
      presetTaskKey: 'hsr-echo-of-war',
    });
    const found = matchScreenshotOcr(
      [
        '180/300',
        'Reserved Trailblaze Power 1200/2400',
        'Stellar Jade 8,960',
        'Star Rail Special Pass 15',
        'Echo of War Remaining 2/3',
      ],
      { game: hsr, resources: [power], tasks: [echo] },
    );
    expect(found.readings.map((r) => [r.field, r.value])).toEqual([
      ['value', 180],
      ['reserve', 1200],
    ]);
    expect(found.tasks).toEqual([expect.objectContaining({ taskId: 'echo', countDone: 1 })]);
    expect(found.savings.map((s) => [s.field, s.label, s.value])).toEqual([
      ['currency', 'Stellar Jade', 8960],
      ['tickets', 'Star Rail Special Pass', 15],
    ]);
  });

  it('reads ZZZ and WuWa screens', () => {
    const zzz = makeGame({ id: 'zzz', name: 'Zenless Zone Zero', short: 'ZZZ', presetKey: 'zzz' });
    const battery = makeResource({
      id: 'bat',
      gameId: 'zzz',
      name: 'Battery Charge',
      cap: 240,
      reserveCap: 2400,
      reserveLabel: 'Backup Battery Charge',
    });
    const z = matchScreenshotOcr(['190/240', 'Backup Battery 600', 'Polychrome 12000', 'Encrypted Master Tape 10'], {
      game: zzz,
      resources: [battery],
      tasks: [],
    });
    expect(z.readings.map((r) => [r.field, r.value])).toEqual([
      ['value', 190],
      ['reserve', 600],
    ]);
    expect(z.savings.map((s) => s.value)).toEqual([12000, 10]);

    const wuwa = makeGame({ id: 'ww', name: 'Wuthering Waves', short: 'WuWa', presetKey: 'wuwa' });
    const plates = makeResource({ id: 'wp', gameId: 'ww', name: 'Waveplates', cap: 240, reserveCap: 480 });
    const w = matchScreenshotOcr(['180/240', 'Astrite 6400', 'Radiant Tide 8'], {
      game: wuwa,
      resources: [plates],
      tasks: [],
    });
    expect(w.readings).toEqual([expect.objectContaining({ resourceId: 'wp', value: 180 })]);
    expect(w.savings.map((s) => [s.label, s.value])).toEqual([
      ['Astrite', 6400],
      ['Radiant Tide', 8],
    ]);
  });

  it('prefers the bar the line names when two share a cap', () => {
    const a = makeResource({ id: 'a', gameId: 'g', name: 'Sanity', cap: 240 });
    const b = makeResource({ id: 'b', gameId: 'g', name: 'Stamina', cap: 240 });
    expect(matchScreenshotOcr(['Sanity 100/240'], { resources: [a, b], tasks: [] }).readings).toEqual([
      expect.objectContaining({ resourceId: 'a' }),
    ]);
    expect(matchScreenshotOcr(['100/240'], { resources: [a, b], tasks: [] }).readings).toHaveLength(2);
  });

  it('never invents tasks or savings from unlabelled numbers', () => {
    const found = matchScreenshotOcr(['3/5', '2/3', 'Primogems 120/200', '14250', 'Primogems 900000000'], {
      game: genshin,
      resources: [],
      tasks: [giCommissions, giBosses],
    });
    expect(found.tasks).toEqual([]);
    expect(found.savings).toEqual([]);
    expect(matchScreenshotOcr(['Intertwined Fate 20000'], { game: genshin, resources: [], tasks: [] }).savings).toEqual(
      [],
    );
    expect(
      matchScreenshotOcr(['Daily Commissions 2/4'], { game: genshin, resources: [], tasks: [giCommissions] }).tasks,
    ).toEqual([]);
    expect(
      matchScreenshotOcr(['Weekly Bosses 2/3'], { game: genshin, resources: [], tasks: [giBosses] }).tasks,
    ).toEqual([expect.objectContaining({ countDone: 2 })]);
  });

  it('fixes O/l slips only inside numbers beside a label', () => {
    const found = matchScreenshotOcr(['Primogems l4,25O', 'Intertwined Fate lol'], {
      game: genshin,
      resources: [],
      tasks: [],
    });
    expect(found.savings).toEqual([expect.objectContaining({ field: 'currency', value: 14250 })]);
  });
});

describe('inferScreenshotGame', () => {
  const games = [
    makeGame({ id: 'zzz', name: 'Zenless Zone Zero', short: 'ZZZ', presetKey: 'zzz' }),
    makeGame({ id: 'ww', name: 'Wuthering Waves', short: 'WuWa', presetKey: 'wuwa' }),
    makeGame({ id: 'nte', name: 'Neverness to Everness', short: 'NTE', presetKey: 'nte' }),
  ];
  const resources = [
    makeResource({ id: 'bat', gameId: 'zzz', name: 'Battery Charge', cap: 240, reserveCap: 2400 }),
    makeResource({ id: 'wp', gameId: 'ww', name: 'Waveplates', cap: 240, reserveCap: 480 }),
    makeResource({ id: 'px', gameId: 'nte', name: 'Character Pixels', cap: 240, reserveCap: 2400 }),
  ];
  const tasks = [
    makeTask({ id: 'act', gameId: 'ww', name: 'Daily Activity (100)', presetTaskKey: 'wuwa-daily-activity' }),
  ];

  it('resolves a shared 240 cap from savings, tasks and labels', () => {
    expect(inferScreenshotGame(['190/240'], games, resources, tasks)).toBeUndefined();
    expect(inferScreenshotGame(['190/240', 'Polychrome 12000'], games, resources, tasks)).toBe('zzz');
    expect(inferScreenshotGame(['180/240', 'Daily Activity 100/100'], games, resources, tasks)).toBe('ww');
    expect(inferScreenshotGame(['Pixels 200/240'], games, resources, tasks)).toBe('nte');
    expect(inferScreenshotGame(['nothing here'], games, resources, tasks)).toBeUndefined();
  });

  it('skips deleted games', () => {
    const gone = games.map((g) => (g.id === 'zzz' ? { ...g, deleted: true } : g));
    expect(inferScreenshotGame(['190/240', 'Polychrome 12000'], gone, resources, tasks)).toBeUndefined();
  });
});

describe('fractions with thousands, glyphs and dates', () => {
  const reserve = makeResource({
    id: 'tb',
    name: 'Trailblaze Power',
    cap: 300,
    reserveCap: 2400,
    reserveLabel: 'Reserved Trailblaze Power',
  });

  it('reads comma- and space-grouped fractions', () => {
    for (const line of ['1,200/2,400', '1 200 / 2 400', '1200/2400']) {
      expect(matchOcrReadings([line], [reserve])).toEqual([
        expect.objectContaining({ field: 'reserve', value: 1200, cap: 2400 }),
      ]);
    }
    expect(matchOcrReadings(['Lv 80 145/200'], [resin])).toEqual([
      expect.objectContaining({ resourceId: 'resin', value: 145 }),
    ]);
  });

  it('reads past a stray HUD glyph before a tracked cap', () => {
    for (const line of ['◆145/200', '★145/200', 'Q145/200', '×145/200']) {
      expect(matchOcrReadings([line], [resin])).toEqual([expect.objectContaining({ resourceId: 'resin', value: 145 })]);
    }
    expect(matchOcrReadings(['o86/200'], [resin])[0]).toMatchObject({ value: 86 });
    expect(matchOcrReadings(['Resin |145/200'], [resin])[0]).toMatchObject({ value: 145 });
    expect(matchOcrReadings(['|45/200'], [resin])[0]).toMatchObject({ value: 145 });
  });

  it('rejects versions, words, dates and times', () => {
    const three = makeResource({ id: 'three', name: 'Attempts', cap: 3 });
    const hours = makeResource({ id: 'hours', name: 'Outpost', cap: 24 });
    expect(matchOcrReadings(['v2/3', 'level2/3', 'Lv2/3'], [three])).toEqual([]);
    expect(matchOcrReadings(['2026/11/24', '11/24/2026', 'Ends 11/24 04:00'], [hours])).toEqual([]);
    expect(matchOcrReadings(['2026/11'], [makeResource({ id: 'm', cap: 11 })])).toEqual([]);
  });
});

describe('split labels and regions', () => {
  const hsr = makeGame({ id: 'hsr', name: 'Honkai: Star Rail', short: 'HSR', presetKey: 'hsr' });
  const power = makeResource({
    id: 'tbp',
    gameId: 'hsr',
    name: 'Trailblaze Power',
    cap: 300,
    reserveCap: 2400,
    reserveLabel: 'Reserved Trailblaze Power',
  });
  const training = makeTask({
    id: 'train',
    gameId: 'hsr',
    name: 'Daily Training (500)',
    presetTaskKey: 'hsr-daily-training',
  });
  const universe = makeTask({
    id: 'uni',
    gameId: 'hsr',
    name: 'Weekly points: Divergent Universe / Currency Wars',
    cadence: 'weekly',
    presetTaskKey: 'hsr-universe',
  });
  const echo = makeTask({
    id: 'echo',
    gameId: 'hsr',
    name: 'Echo of War ×3',
    cadence: 'weekly',
    mode: 'count',
    countTarget: 3,
    presetTaskKey: 'hsr-echo-of-war',
  });
  const hsrCtx = { game: hsr, resources: [power], tasks: [training, universe, echo] };

  it('pairs a task label with the value on the next line', () => {
    for (const value of ['500/500', 'Active Score 500/500']) {
      expect(matchScreenshotOcr(['Daily Training', value], hsrCtx).tasks).toEqual([
        expect.objectContaining({ taskId: 'train', action: 'done', confidence: 'high' }),
      ]);
    }
    for (const label of ['Divergent Universe', 'Simulated Universe', 'Currency Wars']) {
      for (const value of ['14,000 / 14,000', '14000/14000', '8,000/8,000']) {
        expect(matchScreenshotOcr([label, value], hsrCtx).tasks).toEqual([
          expect.objectContaining({ taskId: 'uni', action: 'done' }),
        ]);
      }
    }
    expect(matchScreenshotOcr(['Echo of War', 'Remaining: 1/3'], hsrCtx).tasks).toEqual([
      expect.objectContaining({ taskId: 'echo', countDone: 2, line: 'Echo of War Remaining: 1/3' }),
    ]);
    expect(matchScreenshotOcr(['Echo of War', '2/3'], hsrCtx).tasks).toEqual([
      expect.objectContaining({ taskId: 'echo', countDone: 2, confidence: 'high' }),
    ]);
  });

  it('reads a value above its label one step less sure', () => {
    expect(matchScreenshotOcr(['2/3', 'Echo of War'], hsrCtx).tasks).toEqual([
      expect.objectContaining({ taskId: 'echo', countDone: 2, confidence: 'medium' }),
    ]);
    expect(matchScreenshotOcr(['14,250', 'Stellar Jade'], hsrCtx).savings).toEqual([
      expect.objectContaining({ field: 'currency', value: 14250, confidence: 'medium' }),
    ]);
  });

  it('never pairs across a region break, a labelled line or a bar reading', () => {
    expect(matchScreenshotOcr(['Daily Training', '', '500/500'], hsrCtx).tasks).toEqual([]);
    expect(matchScreenshotOcr(['Echo of War', '   ', '2/3'], hsrCtx).tasks).toEqual([]);
    expect(matchScreenshotOcr(['Stellar Jade', '', '14,250'], hsrCtx).savings).toEqual([]);
    // The next line belongs to a label of its own.
    expect(matchScreenshotOcr(['Daily Training', 'Echo of War 2/3'], hsrCtx).tasks).toEqual([
      expect.objectContaining({ taskId: 'echo' }),
    ]);
    // 180/300 is the Trailblaze Power bar, not Echo of War progress.
    const barLine = matchScreenshotOcr(['Echo of War', '180/300'], hsrCtx);
    expect(barLine.tasks).toEqual([]);
    expect(barLine.readings).toEqual([expect.objectContaining({ resourceId: 'tbp', value: 180 })]);
    // A number already under its own label stays with it.
    expect(matchScreenshotOcr(['Stellar Jade', '14,250', 'Star Rail Special Pass'], hsrCtx).savings).toEqual([
      expect.objectContaining({ field: 'currency', value: 14250 }),
    ]);
    // A label line with numbers of its own never borrows.
    expect(matchScreenshotOcr(['Stellar Jade 120/200', '14250'], hsrCtx).savings).toEqual([]);
  });

  it('reads split reserve labels and savings', () => {
    expect(matchScreenshotOcr(['Reserved Trailblaze Power', '1,200/2,400'], hsrCtx).readings).toEqual([
      expect.objectContaining({
        field: 'reserve',
        value: 1200,
        confidence: 'high',
        line: 'Reserved Trailblaze Power 1,200/2,400',
      }),
    ]);
    expect(matchScreenshotOcr(['Reserved Trailblaze Power', '1200'], hsrCtx).readings).toEqual([
      expect.objectContaining({ field: 'reserve', value: 1200, confidence: 'medium' }),
    ]);
    expect(
      matchOcrReadings(['Reserved Trailblaze Power 1200'], [{ ...power, reserveLabel: 'Reserve TB Power' }]),
    ).toEqual([expect.objectContaining({ field: 'reserve', value: 1200, confidence: 'medium' })]);
    const savings = matchScreenshotOcr(['Stellar Jade', '14,250', 'Star Rail Special Pass', '42'], hsrCtx).savings;
    expect(savings.map((s) => [s.field, s.value, s.confidence])).toEqual([
      ['currency', 14250, 'high'],
      ['tickets', 42, 'high'],
    ]);
  });

  it('reads split savings for every preset currency', () => {
    const cases: Array<[string, string, string, number]> = [
      ['genshin', 'Primogems', '28,410', 28410],
      ['genshin', 'Intertwined Fate', '35', 35],
      ['wuwa', 'Astrite', '19,200', 19200],
      ['zzz', 'Polychrome', '12,800', 12800],
      ['endfield', 'Oroberyl', '15,400', 15400],
    ];
    for (const [presetKey, label, value, expected] of cases) {
      const game = makeGame({ id: presetKey, presetKey, short: presetKey });
      expect(matchScreenshotOcr([label, value], { game, resources: [], tasks: [] }).savings).toEqual([
        expect.objectContaining({ label, value: expected, confidence: 'high' }),
      ]);
    }
  });

  it('reads Genshin and ZZZ task splits', () => {
    const genshin = makeGame({ id: 'gi', presetKey: 'genshin', short: 'Genshin' });
    const commissions = makeTask({
      id: 'comm',
      gameId: 'gi',
      name: 'Daily Commissions ×4',
      mode: 'check',
      presetTaskKey: 'genshin-commissions',
    });
    const bosses = makeTask({
      id: 'boss',
      gameId: 'gi',
      name: 'Weekly Bosses ×3',
      cadence: 'weekly',
      mode: 'count',
      countTarget: 3,
      presetTaskKey: 'genshin-weekly-bosses',
    });
    const found = matchScreenshotOcr(['Daily Commissions', '4/4', 'Weekly Boss', 'Remaining 1/3'], {
      game: genshin,
      resources: [],
      tasks: [commissions, bosses],
    });
    expect(found.tasks).toEqual([
      expect.objectContaining({ taskId: 'comm', action: 'done' }),
      expect.objectContaining({ taskId: 'boss', countDone: 2 }),
    ]);

    const zzz = makeGame({ id: 'zzz', presetKey: 'zzz', short: 'ZZZ' });
    const engagement = makeTask({
      id: 'eng',
      gameId: 'zzz',
      name: 'Daily Engagement (400)',
      presetTaskKey: 'zzz-engagement',
    });
    expect(matchScreenshotOcr(['Errands', '400/400'], { game: zzz, resources: [], tasks: [engagement] }).tasks).toEqual(
      [expect.objectContaining({ taskId: 'eng', action: 'done' })],
    );
  });

  it('names the bar on the line above its number when two share a cap', () => {
    const a = makeResource({ id: 'a', gameId: 'g', name: 'Sanity', cap: 240 });
    const b = makeResource({ id: 'b', gameId: 'g', name: 'Stamina', cap: 240 });
    expect(matchScreenshotOcr(['Sanity', '100/240'], { resources: [a, b], tasks: [] }).readings).toEqual([
      expect.objectContaining({ resourceId: 'a', line: 'Sanity 100/240' }),
    ]);
    expect(matchScreenshotOcr(['Sanity', '', '100/240'], { resources: [a, b], tasks: [] }).readings).toHaveLength(2);
  });

  it('keeps the most confident candidate when snipped regions overlap', () => {
    const found = matchScreenshotOcr(
      ['14,250', 'Stellar Jade', '', 'Stellar Jade 14,250', '', '180/300', '', 'Trailblaze Power 180/300'],
      hsrCtx,
    );
    expect(found.savings).toEqual([
      expect.objectContaining({ field: 'currency', value: 14250, confidence: 'high', line: 'Stellar Jade 14,250' }),
    ]);
    expect(found.readings).toEqual([expect.objectContaining({ resourceId: 'tbp', field: 'value', value: 180 })]);
  });
});

describe('endgame cycles', () => {
  const at = Date.UTC(2026, 10, 24, 12);
  const open = { type: 'cycle' as const, start: at - 5 * 86_400_000, end: at + 5 * 86_400_000 };
  const genshin = makeGame({ id: 'gi', name: 'Genshin Impact', short: 'Genshin', presetKey: 'genshin' });
  const hsr = makeGame({ id: 'hsr', name: 'Honkai: Star Rail', short: 'HSR', presetKey: 'hsr' });
  const zzz = makeGame({ id: 'zzz', name: 'Zenless Zone Zero', short: 'ZZZ', presetKey: 'zzz' });
  const wuwa = makeGame({ id: 'ww', name: 'Wuthering Waves', short: 'WuWa', presetKey: 'wuwa' });
  const events = [
    makeEvent({ id: 'abyss-old', gameId: 'gi', name: 'Spiral Abyss', type: 'cycle', start: 0, end: at - 9e8 }),
    makeEvent({ id: 'abyss', gameId: 'gi', name: 'Spiral Abyss', ...open }),
    makeEvent({ id: 'theater', gameId: 'gi', name: 'Imaginarium Theater', ...open }),
    makeEvent({ id: 'moc', gameId: 'hsr', name: 'Memory of Chaos', ...open }),
    makeEvent({ id: 'pf', gameId: 'hsr', name: 'Pure Fiction', ...open }),
    makeEvent({ id: 'as', gameId: 'hsr', name: 'Apocalyptic Shadow', ...open }),
    makeEvent({ id: 'shiyu', gameId: 'zzz', name: 'Shiyu Defense: Critical', ...open }),
    makeEvent({ id: 'da', gameId: 'zzz', name: 'Deadly Assault', ...open }),
    makeEvent({ id: 'toa', gameId: 'ww', name: 'Tower of Adversity', ...open }),
    makeEvent({ id: 'gone', gameId: 'ww', name: 'Whimpering Wastes', ...open, deleted: true }),
    makeEvent({ id: 'banner', gameId: 'gi', name: 'Spiral Abyss banner', type: 'banner', start: 0, end: at * 2 }),
  ];
  const read = (lines: string[], game: typeof genshin) =>
    matchScreenshotOcr(lines, { game, resources: [], tasks: [], events, observedAt: at }).events;

  it('reads Genshin stars, floors and acts', () => {
    expect(read(['Spiral Abyss 36/36'], genshin)).toEqual([
      {
        eventId: 'abyss',
        eventName: 'Spiral Abyss',
        progress: 'done',
        partsDone: 36,
        partsTotal: 36,
        detail: '36/36 ★',
        line: 'Spiral Abyss 36/36',
        confidence: 'high',
      },
    ]);
    expect(read(['Spiral Abyss', 'Abyssal Stars 33/36'], genshin)).toEqual([
      expect.objectContaining({ eventId: 'abyss', progress: 'partial', partsDone: 33, partsTotal: 36 }),
    ]);
    expect(read(['Spiral Abyss', 'Floor 12'], genshin)).toEqual([
      expect.objectContaining({ eventId: 'abyss', progress: 'done', detail: 'Floor 12', confidence: 'medium' }),
    ]);
    expect(read(['Imaginarium Theater', 'Act 10'], genshin)).toEqual([
      expect.objectContaining({ eventId: 'theater', progress: 'done', detail: 'Act 10', confidence: 'high' }),
    ]);
    expect(read(['Imaginarium Theater 9/10'], genshin)).toEqual([
      expect.objectContaining({ eventId: 'theater', progress: 'partial', partsDone: 9, partsTotal: 10 }),
    ]);
  });

  it('reads HSR, ZZZ and WuWa endgame screens', () => {
    expect(read(['Forgotten Hall', 'Stage 12'], hsr)).toEqual([
      expect.objectContaining({ eventId: 'moc', progress: 'done', detail: 'Stage 12' }),
    ]);
    expect(read(['Memory of Chaos 12/12'], hsr)).toEqual([
      expect.objectContaining({ eventId: 'moc', progress: 'done', detail: '12/12', confidence: 'high' }),
    ]);
    expect(read(['Pure Fiction', '60000'], hsr)).toEqual([
      expect.objectContaining({ eventId: 'pf', progress: 'partial', detail: '60,000 pts', confidence: 'medium' }),
    ]);
    expect(read(['Apocalyptic Shadow 12/12'], hsr)).toEqual([
      expect.objectContaining({ eventId: 'as', progress: 'done', detail: '12/12 ★' }),
    ]);
    expect(read(['Shiyu Defense', '7/7'], zzz)).toEqual([
      expect.objectContaining({ eventId: 'shiyu', progress: 'done' }),
    ]);
    expect(read(['Shiyu Defense Rank S'], zzz)).toEqual([
      expect.objectContaining({ eventId: 'shiyu', progress: 'done', detail: 'Rank S' }),
    ]);
    expect(read(['Deadly Assault', '9★'], zzz)).toEqual([
      expect.objectContaining({ eventId: 'da', progress: 'done', partsDone: 9, partsTotal: 9, detail: '9 ★' }),
    ]);
    expect(read(['Deadly Assault 6/9'], zzz)).toEqual([
      expect.objectContaining({ eventId: 'da', progress: 'partial' }),
    ]);
    expect(read(['Tower of Adversity', '30/30'], wuwa)).toEqual([
      expect.objectContaining({ eventId: 'toa', progress: 'done' }),
    ]);
  });

  it('matches only live cycle events of the game, open at the time', () => {
    expect(read(['Whimpering Wastes 3/3'], wuwa)).toEqual([]);
    expect(read(['Spiral Abyss 36/36'], hsr)).toEqual([]);
    expect(read(['Spiral Abyss 0/36', 'Spiral Abyss 120/200'], genshin)).toEqual([]);
    expect(matchScreenshotOcr(['Spiral Abyss 36/36'], { game: genshin, resources: [], tasks: [] }).events).toEqual([]);
    const later = matchScreenshotOcr(['Spiral Abyss 36/36'], {
      game: genshin,
      resources: [],
      tasks: [],
      events,
      observedAt: at + 30 * 86_400_000,
    });
    expect(later.events).toEqual([]);
  });

  it('reads any other cycle by its own timeline name', () => {
    const nte = makeGame({ id: 'nte', name: 'Neverness to Everness', short: 'NTE', presetKey: 'nte' });
    const rails = makeEvent({ id: 'rails', gameId: 'nte', name: 'Beyond the Rails: Sunset Circle', ...open });
    const found = matchScreenshotOcr(['Beyond the Rails', '8/8'], {
      game: nte,
      resources: [],
      tasks: [],
      events: [rails],
      observedAt: at,
    });
    expect(found.events).toEqual([
      expect.objectContaining({ eventId: 'rails', progress: 'done', confidence: 'medium' }),
    ]);
  });

  it('infers the game from endgame names and split labels', () => {
    const games = [genshin, hsr, zzz];
    expect(inferScreenshotGame(['Spiral', 'Abyss', '36/36'], games, [], [])).toBe('gi');
    expect(inferScreenshotGame(['Memory of Chaos'], games, [], [])).toBe('hsr');
    expect(inferScreenshotGame(['Polychrome', '12,800'], games, [], [])).toBe('zzz');
    expect(inferScreenshotGame(['Crystal 900'], games, [], [])).toBeUndefined();
  });
});
