import type { EventProgress } from '../event-parts';
import { PRESETS, presetForGame } from '../presets';
import { effectiveCountTarget, effectiveTaskMode } from '../tracking';
import type { Cadence, Game, GameEvent, Resource, Task, TaskMode } from '../types';

/**
 * Turns OCR text from a screenshot into suggested readings. Nothing is trusted on its own: a "value / cap"
 * fraction only counts when the cap is one of the player's own resources, a number only counts beside a
 * label, and every suggestion carries a confidence so the sheet can ask before anything is saved.
 *
 * A blank line separates two snipped regions. A HUD often sets a label apart from its number ("Daily
 * Training" over "500/500"): a label line with no digits borrows the value on the line beside it, never
 * from another region.
 */

export type OcrConfidence = 'high' | 'medium' | 'low';

/**
 * One word an OCR pass placed: left, top, right and bottom edges. Windows passes give the region's own
 * pixels; the Android `mlkit` pass gives fractions of the image, from 0 to 1, so they survive downscaling.
 */
export interface OcrWordBox {
  text: string;
  l: number;
  t: number;
  r: number;
  b: number;
}

/**
 * One way a region was read: as captured, upscaled twice, as bright text on white, or a window's top band
 * (Windows OCR), or by ML Kit's on-device text recognition (Android).
 */
export type OcrPassName = 'raw1x' | 'raw2x' | 'bright2x' | 'topBand2x' | 'mlkit';

/**
 * One reading of one region. A pass covers a single region (`region`, 0 when missing), so its `lines`
 * never hold the empty separator between regions, and the passes of a capture stay parallel per region.
 */
export interface OcrPass {
  name: OcrPassName;
  lines: string[];
  words?: OcrWordBox[];
  region?: number;
}

/** What a region was taken from: a snipped area, a whole game window, an image file, a camera or a share. */
export type OcrCapture = 'snip' | 'window' | 'file' | 'camera' | 'share';

/** Read by a rule that guesses past an OCR slip, so it is only ever as sure as the rule allows. */
export type OcrReadingRule =
  /** A HUD glyph glued onto the cap ("80/2000" for 80/200 and a "+" read as 0). */
  | 'glued-glyph'
  /** A bare number beside the bar on its row, read as the bar's reserve (WuWa's Waveplate Crystals). */
  | 'reserve-beside-bar';

export interface OcrReadingCandidate {
  resourceId: string;
  resourceName: string;
  /** `value` reads the main bar; `reserve` reads its overflow store. */
  field: 'value' | 'reserve';
  value: number;
  /** The cap the reading was matched against. */
  cap: number;
  confidence: OcrConfidence;
  /** The OCR line it came from, for showing the player. */
  line: string;
  /** Set when a guessing rule read it; a plain read leaves it out. */
  rule?: OcrReadingRule;
}

const RANK: Record<OcrConfidence, number> = { high: 3, medium: 2, low: 1 };

/** One step less sure: a value read from the line above its label. */
function lowered(confidence: OcrConfidence): OcrConfidence {
  return confidence === 'high' ? 'medium' : confidence;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function includesWord(lower: string, word: string): boolean {
  return new RegExp(`(?<![a-z])${escapeRegExp(word.toLowerCase())}(?![a-z])`).test(lower);
}

/** Letters and digits only, so "Spiral  Abyss:" and "SpiralAbyss" read alike. */
function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// ---------------------------------------------------------------------------
// Numbers: fractions, numbers beside a label, bare numbers.
// ---------------------------------------------------------------------------

const DIGIT = '[\\dOolI|]';
/** "1,200", "14 000", "1.200": thousands with a separator. */
const GROUPED = `${DIGIT}{1,3}(?:[,.\\u00a0\\u202f ]${DIGIT}{3})+`;
/**
 * A stray HUD icon OCR reads as one letter right before the number (Q180/300). Never v (v2/3 is a
 * version), and never the letters OCR uses for digits, which are read as digits instead.
 */
const GLYPH = '[A-HJ-NP-UW-Zabcdefghijkmnpqrstuwxyz]';
/**
 * Never inside a word (level2/3), a chain (2026/11/24) or a date with a time (11/24 04:00). A "Q" glued
 * on the total is captured apart: it is a HUD glyph, read only by the glued-glyph rule.
 */
const FRACTION = new RegExp(
  `(?<![A-Za-z\\d|,.])(?<![/\\\\]\\s*)(${GLYPH})?(${GROUPED}|${DIGIT}{1,6})\\s*[/\\\\]\\s*(${GROUPED}|${DIGIT}{1,6})(Q)?` +
    `(?![A-Za-z\\d|]|[,.]\\d|\\s*[/\\\\]\\s*\\d|\\s+\\d{1,2}:\\d{2})`,
  'g',
);

/** OCR misreads of digits, fixed only inside a number so words are never rewritten. */
function fractionDigits(token: string): number | undefined {
  if (!/\d/.test(token)) return undefined;
  const digits = token
    .replace(/[,.\u00a0\u202f ]/g, '')
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1');
  return /^\d{1,6}$/.test(digits) ? Number(digits) : undefined;
}

interface OcrFraction {
  value: number;
  total: number;
  /** Read past a stray glyph before the number: trusted only against a known cap or target. */
  glyph: boolean;
}

/** A token and, when a plain space split it, the part touching the slash ("Lv 80 145/200"). */
function spaceVariants(token: string, keep: 'first' | 'last'): string[] {
  const parts = token.split(' ');
  if (parts.length === 1) return [token];
  return [token, keep === 'last' ? parts[parts.length - 1]! : parts[0]!];
}

/** A total read past one glyph glued on its end: "80/2000" as 80/200, or "80/200Q". */
interface GluedFraction {
  value: number;
  /** The total as OCR read it, glyph and all; undefined when the glyph is a letter. */
  total: number | undefined;
  /** The total without the glyph. */
  cap: number;
  glyph: boolean;
}

/** One slash in a line: where it starts, its readings grouped thousands first, and its glued-glyph readings. */
interface FractionMatch {
  index: number;
  fractions: OcrFraction[];
  glued: GluedFraction[];
}

/** A total's digits without one glued glyph on its end (0, O, o or a captured Q), or undefined. */
function gluedStem(right: string, suffix: boolean): string | undefined {
  // Only a plain run of digits: "2,400" is grouped thousands, not a glyph.
  if (!/^[\dOolI|]+$/.test(right)) return undefined;
  const stem = suffix ? right : /[0Oo]$/.test(right) ? right.slice(0, -1) : undefined;
  return stem !== undefined && stem.length >= 3 ? stem : undefined;
}

function fractionMatches(line: string): FractionMatch[] {
  const out: FractionMatch[] = [];
  for (const match of line.matchAll(FRACTION)) {
    const glyph = match[1] !== undefined;
    // A letter glued on the total is never a plain reading.
    const suffix = match[4] !== undefined;
    const fractions: OcrFraction[] = [];
    const glued: GluedFraction[] = [];
    const lefts = spaceVariants(match[2]!, 'last');
    // A leading "|" is read as a 1 first, then as the HUD divider it often is ("Resin |145/200").
    const touching = lefts[lefts.length - 1]!;
    if (/^\|[\dOolI]/.test(touching)) lefts.push(touching.slice(1));
    const stem = gluedStem(match[3]!, suffix);
    const cap = stem === undefined ? undefined : fractionDigits(stem);
    for (const left of lefts) {
      const value = fractionDigits(left);
      if (value === undefined) continue;
      if (!suffix) {
        for (const right of spaceVariants(match[3]!, 'first')) {
          const total = fractionDigits(right);
          if (total !== undefined && total > 0) fractions.push({ value, total, glyph });
        }
      }
      if (cap !== undefined && cap > 0) {
        glued.push({ value, total: suffix ? undefined : fractionDigits(match[3]!), cap, glyph });
      }
    }
    if (fractions.length > 0 || glued.length > 0) out.push({ index: match.index, fractions, glued });
  }
  return out;
}

/** Every "value / total" in a line: one group per slash, its readings grouped thousands first. */
function lineFractions(line: string): OcrFraction[][] {
  return fractionMatches(line)
    .map((match) => match.fractions)
    .filter((group) => group.length > 0);
}

/** A fraction that can be one of these bars: its main cap (overflow up to double), or its reserve. */
function barFraction(live: readonly Resource[], fraction: OcrFraction): boolean {
  return live.some(
    (res) =>
      (res.cap === fraction.total && fraction.value <= fraction.total * 2) ||
      (res.reserveCap > 0 && res.reserveCap === fraction.total && fraction.value <= fraction.total),
  );
}

/** "14,250", "14 250", "14250" — and the OCR O/l slips inside them. */
const NUMBER_TOKEN = '([\\dOolI]{1,3}(?:[,.\\u00a0\\u202f ][\\dOolI]{3})+|[\\dOolI]{1,9})';

function savingsNumber(token: string): number | undefined {
  if (!/\d/.test(token)) return undefined;
  const digits = token
    .replace(/[,.\u00a0\u202f ]/g, '')
    .replace(/[Oo]/g, '0')
    .replace(/[Il]/g, '1');
  return /^\d+$/.test(digits) ? Number(digits) : undefined;
}

/** A line that is one whole number, with at most an icon beside it: "14,250", "×35", "◆ 1200". */
const BARE_NUMBER = new RegExp(`^[^A-Za-z\\d/\\\\%:]{0,2}\\s*[x×X]?\\s*${NUMBER_TOKEN}\\s*[^A-Za-z\\d/\\\\%:]{0,2}$`);

function bareNumber(line: string): number | undefined {
  const match = BARE_NUMBER.exec(line.trim());
  return match?.[1] ? savingsNumber(match[1]) : undefined;
}

const LABEL_NUMBER = '(\\d{1,3}(?:[,.\\u00a0\\u202f]\\d{3})+|\\d{1,6})';

/** A number written right next to the label, on either side; never half of a fraction. */
function numberBesideLabel(line: string, label: string): number | undefined {
  const name = escapeRegExp(label);
  const after = new RegExp(`${name}[^\\d\\n]{0,12}?${LABEL_NUMBER}(?!\\d|[,.]\\d)(?!\\s*[/\\\\]\\s*\\d)`, 'i').exec(
    line,
  );
  if (after?.[1]) return savingsNumber(after[1]);
  const before = new RegExp(`(?<![/\\\\]\\s*)(?<![\\d,.])${LABEL_NUMBER}\\s*[:x×]?\\s*${name}`, 'i').exec(line);
  return before?.[1] ? savingsNumber(before[1]) : undefined;
}

// ---------------------------------------------------------------------------
// Labels, regions and split label/value pairs.
// ---------------------------------------------------------------------------

const GENERIC_RESERVE_LABELS = ['reserved', 'backup', 'waveplate crystal', 'crystal', 'photo paper', 'essence'];

/** Whether a line names this resource's overflow store, by its own label or a generic one. */
function mentionsReserve(line: string, reserveLabel: string | undefined): boolean {
  const lower = line.toLowerCase();
  const own = reserveLabel?.trim().toLowerCase();
  if (own && lower.includes(own)) return true;
  return GENERIC_RESERVE_LABELS.some((label) => lower.includes(label));
}

/** Labels for a reserve number: its own, its bar's name with a reserve word, then the generic ones. */
function reserveLabels(res: Resource): Array<[string, OcrConfidence]> {
  const own = [res.reserveLabel, `Reserved ${res.name}`, `Reserve ${res.name}`, `Backup ${res.name}`]
    .map((label) => label?.trim())
    .filter((label, index, all): label is string => !!label && all.indexOf(label) === index);
  return [
    ...own.map((label): [string, OcrConfidence] => [label, 'medium']),
    ...GENERIC_RESERVE_LABELS.map((label): [string, OcrConfidence] => [label, 'low']),
  ];
}

/** Words too common in resource names to tell two bars apart. */
const NAME_STOPWORDS = new Set([
  'original',
  'power',
  'charge',
  'supply',
  'the',
  'of',
  'and',
  'attempts',
  'hours',
  'stored',
  'defense',
  'character',
  'realm',
  'currency',
]);

/** Whether the line names this resource or its reserve, by full name or a significant word of it. */
function resourceNamed(line: string, res: Resource): boolean {
  const lower = line.toLowerCase();
  const names = [res.name, res.reserveLabel].filter((name): name is string => !!name?.trim());
  return names.some((name) => {
    if (includesWord(lower, name.trim())) return true;
    return name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some(
        (word) =>
          (word.length >= 3 || /^[a-z]{2}$/.test(word)) && !NAME_STOPWORDS.has(word) && includesWord(lower, word),
      );
  });
}

/**
 * One snipped box of the screenshot. The desktop snip separates boxes with a blank line, and a label is
 * never paired with a value from another box.
 */
interface OcrRegion {
  lines: string[];
  /** The line names something read here: a bar, a reserve, a task, a savings count or an endgame mode. */
  labelled: boolean[];
  /** The line holds a fraction whose total is a tracked cap, so it is that bar's reading. */
  bar: boolean[];
}

interface LabelIndex {
  resources: readonly Resource[];
  tasks: readonly Task[];
  savings: readonly string[];
  /** Endgame mode names, compacted. */
  modes: readonly string[];
}

function lineLabelled(line: string, index: LabelIndex): boolean {
  const lower = line.toLowerCase();
  const flat = compact(line);
  return (
    mentionsReserve(line, undefined) ||
    index.resources.some((res) => resourceNamed(line, res) || mentionsReserve(line, res.reserveLabel)) ||
    index.tasks.some((task) => taskAnchored(lower, task)) ||
    index.savings.some((label) => includesWord(lower, label)) ||
    index.modes.some((name) => flat.includes(name))
  );
}

function ocrRegions(lines: readonly string[], index: LabelIndex): OcrRegion[] {
  const groups: string[][] = [[]];
  for (const raw of lines) {
    const line = raw.trim();
    if (line) groups[groups.length - 1]!.push(line);
    else if (groups[groups.length - 1]!.length > 0) groups.push([]);
  }
  return groups
    .filter((group) => group.length > 0)
    .map((group) => ({
      lines: group,
      labelled: group.map((line) => lineLabelled(line, index)),
      bar: group.map((line) =>
        lineFractions(line).some((fractions) => fractions.some((f) => barFraction(index.resources, f))),
      ),
    }));
}

interface PairedText {
  text: string;
  /** The value sat on the line above the label, which is trusted one step less. */
  above: boolean;
}

/**
 * A label line with no digits, joined with the value its HUD set on the next line ("Daily Training" over
 * "500/500"), or failing that the line before ("14,250" over "Stellar Jade"). The partner line must hold
 * no label of its own and no bar reading, and a value already sitting under another label stays with it.
 */
function pairedText(region: OcrRegion, i: number, holdsValue: (line: string) => boolean): PairedText | undefined {
  const line = region.lines[i]!;
  if (/\d/.test(line)) return undefined;
  const below = region.lines[i + 1];
  if (below !== undefined && !region.labelled[i + 1] && !region.bar[i + 1] && holdsValue(below)) {
    return { text: `${line} ${below}`, above: false };
  }
  const above = region.lines[i - 1];
  if (above === undefined || region.labelled[i - 1] || region.bar[i - 1] || !holdsValue(above)) return undefined;
  const owner = region.lines[i - 2];
  if (owner !== undefined && region.labelled[i - 2] && !/\d/.test(owner)) return undefined;
  return { text: `${above} ${line}`, above: true };
}

// ---------------------------------------------------------------------------
// Bars and reserves.
// ---------------------------------------------------------------------------

export function matchOcrReadings(lines: readonly string[], resources: readonly Resource[]): OcrReadingCandidate[] {
  const live = resources.filter((res) => !res.deleted);
  const index: LabelIndex = { resources: live, tasks: [], savings: allSavingsLabels(undefined), modes: MODE_NAMES };
  return collectReadings(ocrRegions(lines, index), live, { disambiguate: false });
}

/** How far bar matching may guess past what OCR read. */
interface ReadingRules {
  /** Bars of one game sharing a cap: a line naming one of them rules the others out. */
  disambiguate: boolean;
  /**
   * The glued-glyph rule, on for one game: these totals are real caps there (its own bars and its
   * preset's), so a total among them is never a cap with a glyph glued on.
   */
  glued?: ReadonlySet<number>;
  /** The reserve-beside-bar rule: WuWa's HUD sets Waveplate Crystals as a bare number left of the bar. */
  beside?: boolean;
}

/** Glued totals are only read against caps this large: a small cap ("5" in "3/50") is too easy to fake. */
const GLUED_MIN_CAP = 100;

/** "388   61/240": a bare number in its own column right before the bar, at the start of the row. */
const BESIDE_BAR = /(?:^| {3})(\d{1,3}) {3}$/;

function collectReadings(
  regions: readonly OcrRegion[],
  live: readonly Resource[],
  rules: ReadingRules,
): OcrReadingCandidate[] {
  const found: OcrReadingCandidate[] = [];
  const namesBar = (text: string) =>
    live.some((res) => resourceNamed(text, res) || mentionsReserve(text, res.reserveLabel));

  for (const region of regions) {
    region.lines.forEach((line, i) => {
      // A bar named on the line above its unlabelled number ("Reserved Trailblaze Power" over "1,200/2,400").
      const prev = region.lines[i - 1];
      const context =
        prev !== undefined && !/\d/.test(prev) && namesBar(prev) && !namesBar(line) ? `${prev} ${line}` : line;

      for (const match of fractionMatches(line)) {
        const plain = match.fractions.find((f) => barFraction(live, f));
        const glued = plain ? undefined : gluedBar(live, match, rules.glued);
        const fraction = plain ?? glued;
        if (!fraction) continue;
        const { value } = fraction;
        const cap = plain ? plain.total : glued!.cap;
        const rule = glued ? ({ rule: 'glued-glyph' } as const) : {};
        // Bars of one game sharing a cap: when the line names one of them, the others are not it.
        const sharing = live.filter((res) => res.cap === cap || res.reserveCap === cap);
        const named = rules.disambiguate ? sharing.filter((res) => resourceNamed(context, res)) : [];
        const allowed = (res: Resource) =>
          named.length === 0 || named.includes(res) || !named.some((other) => other.gameId === res.gameId);
        const bars: Resource[] = [];
        for (const res of live) {
          if (res.cap !== cap || !allowed(res)) continue;
          // Over the cap is real for overflow stores (Condensed Resin, coffee Battery), but not by more than double.
          // A glued glyph is a guess, never surer than low.
          const confidence: OcrConfidence | undefined = glued
            ? 'low'
            : value <= cap
              ? 'high'
              : value <= cap * 2
                ? 'medium'
                : undefined;
          if (!confidence) continue;
          bars.push(res);
          found.push({
            resourceId: res.id,
            resourceName: res.name,
            field: 'value',
            value,
            cap,
            confidence,
            line: context,
            ...rule,
          });
        }
        if (rules.beside) {
          found.push(...reservesBeside(line.slice(0, match.index), bars, context, glued ? 'low' : 'medium'));
        }
        // A guessed total is a main bar's cap, never a reserve's.
        if (glued) continue;
        // The same fraction can be an overflow store read against its own cap (320/480 Waveplate Crystals,
        // 1200/2400 Reserved Trailblaze Power). Trusted when the line names the store, or when no main bar
        // shares that cap so the fraction cannot be anything else.
        for (const res of live) {
          if (!(res.reserveCap > 0) || cap !== res.reserveCap || value > res.reserveCap || !allowed(res)) continue;
          const storeNamed = mentionsReserve(context, res.reserveLabel);
          if (!storeNamed && live.some((other) => other.cap === cap)) continue;
          found.push({
            resourceId: res.id,
            resourceName: res.name,
            field: 'reserve',
            value,
            cap,
            confidence: storeNamed ? 'high' : 'medium',
            line: context,
          });
        }
      }

      const texts: PairedText[] = [{ text: context, above: false }];
      const pair = pairedText(region, i, (text) => bareNumber(text) !== undefined);
      if (pair) texts.push(pair);
      for (const res of live) {
        if (!(res.reserveCap > 0)) continue;
        const labels = reserveLabels(res);
        for (const { text, above } of texts) {
          for (const [label, confidence] of labels) {
            const value = numberBesideLabel(text, label);
            if (value === undefined || value > res.reserveCap) continue;
            found.push({
              resourceId: res.id,
              resourceName: res.name,
              field: 'reserve',
              value,
              cap: res.reserveCap,
              confidence: above ? lowered(confidence) : confidence,
              line: text,
            });
            break;
          }
        }
      }
    });
  }

  // One suggestion per resource and field: the most confident, then the first seen.
  const best = new Map<string, OcrReadingCandidate>();
  for (const candidate of found) {
    const key = `${candidate.resourceId}|${candidate.field}`;
    const current = best.get(key);
    if (!current || RANK[candidate.confidence] > RANK[current.confidence]) best.set(key, candidate);
  }
  return [...best.values()].sort((a, b) => RANK[b.confidence] - RANK[a.confidence]);
}

/**
 * The bar a glued glyph hides ("80/2000" as 80 of the 200 Resin cap): only when the total as read is no
 * real cap here, the cap without the glyph is a bar's own and at least `GLUED_MIN_CAP`, and the value fits it.
 */
function gluedBar(
  live: readonly Resource[],
  match: FractionMatch,
  blocked: ReadonlySet<number> | undefined,
): GluedFraction | undefined {
  if (!blocked || match.fractions.some((f) => blocked.has(f.total))) return undefined;
  return match.glued.find(
    (g) =>
      (g.total === undefined || !blocked.has(g.total)) &&
      g.cap >= GLUED_MIN_CAP &&
      g.value <= g.cap &&
      live.some((res) => res.cap === g.cap),
  );
}

/** The reserve a bare number left of its bar shows ("388   61/240"), for bars that have one. */
function reservesBeside(
  before: string,
  bars: readonly Resource[],
  line: string,
  confidence: OcrConfidence = 'medium',
): OcrReadingCandidate[] {
  const number = BESIDE_BAR.exec(before)?.[1];
  if (number === undefined) return [];
  const value = Number(number);
  return bars
    .filter((res) => res.reserveCap > 0 && value <= res.reserveCap)
    .map((res) => ({
      resourceId: res.id,
      resourceName: res.name,
      field: 'reserve' as const,
      value,
      cap: res.reserveCap,
      confidence,
      line,
      rule: 'reserve-beside-bar' as const,
    }));
}

// ---------------------------------------------------------------------------
// Whole-screenshot matching: bars, tasks, savings and endgame cycles in one pass.
// ---------------------------------------------------------------------------

export interface OcrTaskCandidate {
  taskId: string;
  taskName: string;
  cadence: Cadence;
  mode: TaskMode;
  /** `done` ticks the task off; `count` sets its progress to `countDone`. */
  action: 'done' | 'count';
  countDone?: number;
  countTarget?: number;
  confidence: OcrConfidence;
  line: string;
}

export interface OcrSavingsCandidate {
  field: 'currency' | 'tickets';
  label: string;
  value: number;
  confidence: OcrConfidence;
  line: string;
}

/** Progress on a timeline endgame cycle (Spiral Abyss, Memory of Chaos, Shiyu Defense…) read from a screenshot. */
export interface OcrEventCandidate {
  eventId: string;
  eventName: string;
  /** `done` for a full clear, else `partial`; never `none`. */
  progress: EventProgress;
  /** The stars or stage the screen showed (33 of 36 stars, Act 9 of 10), when it showed one. */
  partsDone?: number;
  partsTotal?: number;
  /** What was read, for the sheet: "36/36 ★", "Act 10", "Rank S". */
  detail: string;
  line: string;
  confidence: OcrConfidence;
}

export interface OcrScreenshotMatches {
  readings: OcrReadingCandidate[];
  tasks: OcrTaskCandidate[];
  savings: OcrSavingsCandidate[];
  events: OcrEventCandidate[];
}

export interface OcrScreenshotContext {
  game?: Pick<Game, 'id' | 'name' | 'short' | 'presetKey'>;
  resources: readonly Resource[];
  tasks: readonly Task[];
  /** Timeline events; the game's live cycle events take endgame progress. */
  events?: readonly GameEvent[];
  /** When the screenshot was taken, to pick the cycle it shows. Defaults to now. */
  observedAt?: number;
  /**
   * What the text was read from. A whole game window holds stray text anywhere, so rules that read a
   * bare number or a bare HUD label wait for its top band or a clean bar there.
   */
  capture?: OcrCapture;
  /** Which pass of the capture this text is. */
  pass?: OcrPassName;
}

type GameRef = NonNullable<OcrScreenshotContext['game']>;

/** Extra anchors for preset rows whose in-game wording differs from the task name. */
const TASK_ALIASES: Record<string, string[]> = {
  'genshin-commissions': ['daily commission'],
  'genshin-weekly-bosses': ['weekly boss', 'half-cost'],
  'hsr-daily-training': ['daily training'],
  'hsr-universe': ['weekly points', 'divergent universe', 'simulated universe', 'currency wars'],
  'hsr-echo-of-war': ['echo of war'],
  'zzz-engagement': ['daily engagement', 'errand'],
  'zzz-ridu': ['ridu weekly'],
  'zzz-notorious-hunt': ['notorious hunt'],
  'wuwa-daily-activity': ['daily activity', 'activity points'],
  'wuwa-weekly-boss': ['weekly challenge'],
  'wuwa-toa': ['tower of adversity', 'hazard zone'],
  'wuwa-whimpering-wastes': ['whimpering wastes'],
  'nte-daily-quests': ['participation', 'daily quests'],
  'nte-anomaly-pilgrimage': ['anomaly pilgrimage'],
  'lads-daily-agenda': ['daily agenda'],
  'lads-weekly-agenda': ['weekly agenda'],
  'lads-supply-claims': ['supply claim'],
  'uma-daily-missions': ['daily mission'],
  'uma-daily-race': ['daily race'],
  'uma-guest-legacies': ['guest legac'],
  'nikke-daily-missions': ['daily mission'],
  'nikke-weekly-missions': ['weekly mission'],
  'nikke-rookie-arena': ['rookie arena', 'rookies arena'],
  'nikke-interception': ['interception'],
  'endfield-daily-activity': ['daily activity', 'activity points'],
  'endfield-swordmancy': ['swordmancy'],
  'endfield-weekly-routine': ['weekly routine'],
  'crumble-daily-missions': ['daily mission'],
};

/** The task's own name without its ×N suffix or note: "Daily Commissions ×4" → "daily commissions". */
function cleanTaskName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[×x]\s*\d+\b/gi, ' ')
    .split(/[:/]/)[0]!
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Whether the line names the task, by its own name (plural either way) or a preset alias. */
function taskAnchored(lower: string, task: Task): boolean {
  const clean = cleanTaskName(task.name);
  if (clean.length >= 4) {
    const stem = escapeRegExp(clean.replace(/e?s$/, ''));
    if (new RegExp(`(?<![a-z])${stem}(?:e?s)?(?![a-z])`).test(lower)) return true;
  }
  const aliases = task.presetTaskKey ? TASK_ALIASES[task.presetTaskKey] : undefined;
  return !!aliases?.some((alias) => lower.includes(alias));
}

const DONE_WORDS = /(?<![a-z])(completed|complete|claimed|received|done)(?![a-z])|100\s*%/i;
const REMAINING = /(?<![a-z])(remaining|left)(?![a-z])/i;

/** A value a task reads: a fraction or a done word. */
function holdsTaskValue(line: string): boolean {
  return lineFractions(line).length > 0 || DONE_WORDS.test(line);
}

/** A task reading from one line. Never without the task named in that text. */
function matchTask(line: string, task: Task): OcrTaskCandidate | undefined {
  if (!taskAnchored(line.toLowerCase(), task)) return undefined;
  const mode = effectiveTaskMode(task);
  if (mode === 'timer') return undefined;
  const base = { taskId: task.id, taskName: task.name, cadence: task.cadence, mode, line };
  const target = effectiveCountTarget(task);
  // Never past its own total (a date like 2026/11 reads as one); a stray glyph only against the task's target.
  const fraction = lineFractions(line)
    .flat()
    .find((f) => f.value <= f.total && (!f.glyph || mode === 'check' || f.total === target));
  const remaining = REMAINING.test(line);
  const doneWord = DONE_WORDS.test(line);

  if (mode === 'count') {
    if (fraction) {
      const { value: n, total: m } = fraction;
      // "Remaining 1/3" is one left of three, so two done.
      const shown = remaining ? m - n : n;
      const countDone = m === target ? shown : Math.round((shown / m) * target);
      return {
        ...base,
        action: 'count',
        countDone: Math.min(target, Math.max(0, countDone)),
        countTarget: target,
        confidence: m === target ? 'high' : 'medium',
      };
    }
    if (doneWord) return { ...base, action: 'count', countDone: target, countTarget: target, confidence: 'medium' };
    return undefined;
  }

  if (fraction) {
    const { value: n, total: m } = fraction;
    return (remaining ? n === 0 : n >= m) ? { ...base, action: 'done', confidence: 'high' } : undefined;
  }
  return doneWord ? { ...base, action: 'done', confidence: 'medium' } : undefined;
}

function matchTasks(regions: readonly OcrRegion[], tasks: readonly Task[]): OcrTaskCandidate[] {
  const best = new Map<string, OcrTaskCandidate>();
  for (const region of regions) {
    region.lines.forEach((line, i) => {
      const pair = pairedText(region, i, holdsTaskValue);
      for (const task of tasks) {
        let candidate = matchTask(line, task);
        if (!candidate && pair) {
          const paired = matchTask(pair.text, task);
          if (paired) candidate = pair.above ? { ...paired, confidence: lowered(paired.confidence) } : paired;
        }
        if (!candidate) continue;
        const current = best.get(task.id);
        if (!current || RANK[candidate.confidence] > RANK[current.confidence]) best.set(task.id, candidate);
      }
    });
  }
  return [...best.values()];
}

// ---------------------------------------------------------------------------
// Savings.
// ---------------------------------------------------------------------------

interface SavingsLabels {
  currency: string[];
  tickets: string[];
}

const SAVINGS_LABELS: Record<string, SavingsLabels> = {
  genshin: {
    currency: ['Primogems', 'Primogem', 'Genesis Crystals', 'Genesis Crystal'],
    tickets: ['Intertwined Fates', 'Intertwined Fate'],
  },
  hsr: {
    currency: ['Stellar Jade', 'Oneiric Shards', 'Oneiric Shard'],
    tickets: ['Star Rail Special Pass', 'Special Pass'],
  },
  zzz: {
    currency: ['Polychromes', 'Polychrome', 'Monochromes', 'Monochrome'],
    tickets: ['Encrypted Master Tapes', 'Encrypted Master Tape'],
  },
  wuwa: {
    currency: ['Astrites', 'Astrite', 'Lunites', 'Lunite'],
    tickets: ['Radiant Tides', 'Radiant Tide', 'Forging Tides', 'Forging Tide'],
  },
  endfield: {
    currency: ['Oroberyls', 'Oroberyl', 'Origeometry'],
    tickets: ['Chartered Headhunting Permit', 'Headhunting Permit', 'HH Permit'],
  },
  lads: { currency: ['Diamonds', 'Diamond'], tickets: ['Deepspace Wishes', 'Deepspace Wish', 'Empyrean Wish'] },
  uma: { currency: ['Carats', 'Carat'], tickets: ['Trainee Scout Ticket', 'Scout Ticket', 'Support Card Ticket'] },
  nikke: { currency: ['Gems', 'Gem'], tickets: ['Advanced Recruit Voucher', 'Recruit Voucher'] },
  crumble: { currency: ['Crystals', 'Crystal'], tickets: ['Special Cookie Cutter', 'Cookie Cutter'] },
  // NTE's premium names are not settled in any source yet; only the one unambiguous ticket.
  nte: { currency: [], tickets: ['Fabricated Dice'] },
};

const GENERIC_SAVINGS: SavingsLabels = {
  currency: ['Premium Currency', 'Gems', 'Crystals'],
  tickets: ['Pull Tickets', 'Pull Ticket', 'Summon Tickets', 'Summon Ticket'],
};

const SAVINGS_MAX = { currency: 100_000_000, tickets: 10_000 } as const;

/** A whole number beside the label, never one half of a fraction or a percentage. */
function numberBesideSavingsLabel(line: string, label: string): number | undefined {
  const name = escapeRegExp(label).replace(/ /g, '\\s+');
  const after = new RegExp(
    `(?<![A-Za-z])${name}(?![A-Za-z])\\s*[:×x*]?\\s*${NUMBER_TOKEN}(?![\\dOolI]|\\s*[/\\\\%]|[A-Za-z])`,
    'i',
  ).exec(line);
  const fromAfter = after?.[1] ? savingsNumber(after[1]) : undefined;
  if (fromAfter !== undefined) return fromAfter;
  const before = new RegExp(
    `(?<![/\\\\]\\s*)(?<![\\dOolI.,A-Za-z])${NUMBER_TOKEN}\\s*[×x*:]?\\s*${name}(?![A-Za-z])`,
    'i',
  ).exec(line);
  return before?.[1] ? savingsNumber(before[1]) : undefined;
}

function savingsLabelsFor(game: GameRef | undefined): Array<[SavingsLabels, OcrConfidence]> {
  const preset = game ? presetForGame(game) : undefined;
  const own = preset ? SAVINGS_LABELS[preset.key] : undefined;
  if (own) return [[own, 'high']];
  if (game) return [[GENERIC_SAVINGS, 'medium']];
  // No game picked yet: every preset's labels, none of them fully trusted.
  return [
    ...Object.values(SAVINGS_LABELS).map((labels): [SavingsLabels, OcrConfidence] => [labels, 'medium']),
    [GENERIC_SAVINGS, 'low'],
  ];
}

function allSavingsLabels(game: GameRef | undefined): string[] {
  return savingsLabelsFor(game).flatMap(([labels]) => [...labels.currency, ...labels.tickets]);
}

function matchSavings(regions: readonly OcrRegion[], game: GameRef | undefined): OcrSavingsCandidate[] {
  const sets = savingsLabelsFor(game);
  const best = new Map<'currency' | 'tickets', OcrSavingsCandidate>();
  for (const region of regions) {
    region.lines.forEach((line, i) => {
      const pair = pairedText(region, i, (text) => bareNumber(text) !== undefined);
      for (const field of ['currency', 'tickets'] as const) {
        for (const [labels, trust] of sets) {
          // Longest label first, so "Genesis Crystals" wins over "Crystals".
          const ordered = [...labels[field]].sort((a, b) => b.length - a.length);
          for (const label of ordered) {
            let value = numberBesideSavingsLabel(line, label);
            let text = line;
            let confidence = trust;
            if (value === undefined && pair) {
              value = numberBesideSavingsLabel(pair.text, label);
              text = pair.text;
              if (pair.above) confidence = lowered(trust);
            }
            if (value === undefined || value > SAVINGS_MAX[field]) continue;
            const current = best.get(field);
            if (!current || RANK[confidence] > RANK[current.confidence]) {
              best.set(field, { field, label, value, confidence, line: text });
            }
            break;
          }
        }
      }
    });
  }
  return [...best.values()];
}

// ---------------------------------------------------------------------------
// Endgame cycles.
// ---------------------------------------------------------------------------

interface EndgameMode {
  /** The game it belongs to, by preset key; empty for a cycle known only by its timeline name. */
  preset: string;
  /** Names as the screen shows them. An event whose name holds one of them is this mode's. */
  names: string[];
  /** Totals read as stars ("36/36 ★"). */
  stars?: number[];
  /** Other totals the mode shows: stages, floors, acts. */
  stages?: number[];
  /** The word before the stage reached ("Act 10") and the stage that clears the mode. */
  stage?: { word: string; full: number };
  /**
   * Rooms inside each stage, shown on the HUD while one is being fought ("Floor 12 Chamber 3"): the room
   * word, the first stage counted and the rooms per stage. A room in progress is never a clear.
   */
  rooms?: { word: string; first: number; per: number };
  /** Shows a letter rank; S is the clear. */
  ranked?: boolean;
  /** Shows a points total, which says it was played but not how far. */
  scored?: boolean;
}

const ENDGAME_MODES: EndgameMode[] = [
  {
    preset: 'genshin',
    names: ['Spiral Abyss', 'Abyssal Stars'],
    stars: [36],
    stage: { word: 'Floor', full: 12 },
    // Floors 9 to 12 hold three chambers each: the stars that count.
    rooms: { word: 'Chamber', first: 9, per: 3 },
  },
  {
    preset: 'genshin',
    names: ['Imaginarium Theater', 'Imaginarium Theatre'],
    stages: [10],
    stage: { word: 'Act', full: 10 },
  },
  { preset: 'genshin', names: ['Stygian Onslaught'] },
  {
    preset: 'hsr',
    names: ['Memory of Chaos', 'Forgotten Hall'],
    stars: [36],
    stages: [12],
    stage: { word: 'Stage', full: 12 },
  },
  { preset: 'hsr', names: ['Pure Fiction'], stars: [12], scored: true },
  { preset: 'hsr', names: ['Apocalyptic Shadow'], stars: [12] },
  { preset: 'hsr', names: ['Anomaly Arbitration'] },
  { preset: 'zzz', names: ['Shiyu Defense', 'Shiyu Defence'], stages: [7], ranked: true },
  { preset: 'zzz', names: ['Deadly Assault'], stars: [9] },
  { preset: 'wuwa', names: ['Tower of Adversity', 'Hazard Zone'], stars: [30] },
  { preset: 'wuwa', names: ['Whimpering Wastes'] },
];

const MODE_NAMES = ENDGAME_MODES.flatMap((mode) => mode.names.map(compact));

function namesMode(text: string, mode: EndgameMode): boolean {
  const flat = compact(text);
  return mode.names.some((name) => flat.includes(compact(name)));
}

/** The modes these events can take: the known ones, plus any other cycle by its own name ("Beyond the Rails"). */
function endgameModes(pool: readonly GameEvent[]): EndgameMode[] {
  const extra = new Map<string, EndgameMode>();
  for (const ev of pool) {
    if (ENDGAME_MODES.some((mode) => namesMode(ev.name, mode))) continue;
    const label = ev.name.split(/[:(—–]| - /)[0]!.trim();
    if (compact(label).length >= 6 && !extra.has(compact(label))) {
      extra.set(compact(label), { preset: '', names: [label] });
    }
  }
  return [...ENDGAME_MODES, ...extra.values()];
}

const DAY_MS = 86_400_000;

/** The mode's cycle on the timeline: the one open at `at`, else one that closed within the last day. */
function cycleEventFor(pool: readonly GameEvent[], mode: EndgameMode, at: number): GameEvent | undefined {
  const named = pool.filter((ev) => namesMode(ev.name, mode));
  const open = named.find((ev) => ev.start <= at && at < ev.end);
  if (open) return open;
  return named.filter((ev) => ev.end <= at && at - ev.end < DAY_MS).sort((a, b) => b.end - a.end)[0];
}

interface EndgameReading {
  progress: EventProgress;
  partsDone?: number;
  partsTotal?: number;
  detail: string;
  confidence: OcrConfidence;
}

const STAR_COUNT = /(?<![\d,./\\])(\d{1,2})\s*[★☆✦*]/;
const LETTER_RANK = /(?<![A-Za-z\d])(S\+?|A|B)(?![A-Za-z\d+])/;
const SCORE = /(?<![\d,./\\:])(\d{1,3}(?:[,.\u00a0\u202f ]\d{3})+|\d{4,7})(?![\d%:]|[,.]\d|\s*[/\\]\s*\d)/;
const CLEAR_WORDS = /(?<![a-z])(cleared|completed|complete|done)(?![a-z])/i;
/** Totals beyond this are not stars or stages (a bar's 200, a score). */
const MAX_STAGE_TOTAL = 60;

function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The stage and room a HUD shows ("Floor 12 Chamber 3"), when both are ones the mode has. */
function roomReached(text: string, mode: EndgameMode): { stage: number; room: number } | undefined {
  if (!mode.stage || !mode.rooms) return undefined;
  const { word, full } = mode.stage;
  const { word: roomWord, first, per } = mode.rooms;
  const found = new RegExp(
    `(?<![A-Za-z])${word}\\s*[:#.]?\\s*(\\d{1,2})\\s*[,:·•\\-–—]?\\s*${roomWord}\\s*[:#.]?\\s*(\\d)(?!\\d)`,
    'i',
  ).exec(text);
  const stage = Number(found?.[1] ?? 0);
  const room = Number(found?.[2] ?? 0);
  return stage >= first && stage <= full && room >= 1 && room <= per ? { stage, room } : undefined;
}

/** What the text says about one mode: a star or stage fraction, stars, the stage reached, a rank or a score. */
function readEndgame(text: string, mode: EndgameMode): EndgameReading | undefined {
  const known = [...(mode.stars ?? []), ...(mode.stages ?? [])];
  const fraction = lineFractions(text)
    .flat()
    .find(
      (f) => f.value > 0 && f.value <= f.total && f.total <= MAX_STAGE_TOTAL && (!f.glyph || known.includes(f.total)),
    );
  if (fraction) {
    const { value, total } = fraction;
    return {
      progress: value >= total ? 'done' : 'partial',
      partsDone: value,
      partsTotal: total,
      detail: mode.stars?.includes(total) ? `${value}/${total} ★` : `${value}/${total}`,
      confidence: known.includes(total) ? 'high' : 'medium',
    };
  }
  const fullStars = mode.stars?.[0];
  const stars = fullStars ? Number(STAR_COUNT.exec(text)?.[1] ?? 0) : 0;
  if (fullStars && stars > 0 && stars <= fullStars) {
    return {
      progress: stars >= fullStars ? 'done' : 'partial',
      partsDone: stars,
      partsTotal: fullStars,
      detail: `${stars} ★`,
      confidence: 'high',
    };
  }
  // A room on the HUD is the one being fought, so the chamber itself is not yet cleared.
  const at = roomReached(text, mode);
  if (at && mode.stage && mode.rooms) {
    const { first, per } = mode.rooms;
    return {
      progress: 'partial',
      partsDone: (at.stage - first) * per + at.room - 1,
      partsTotal: (mode.stage.full - first + 1) * per,
      detail: `${mode.stage.word} ${at.stage} ${mode.rooms.word} ${at.room}`,
      confidence: 'low',
    };
  }
  if (mode.stage) {
    const { word, full } = mode.stage;
    const reached = Number(new RegExp(`(?<![A-Za-z])${word}\\s*[:#.]?\\s*(\\d{1,2})(?!\\d)`, 'i').exec(text)?.[1] ?? 0);
    if (reached > 0 && reached <= full) {
      return {
        progress: reached >= full ? 'done' : 'partial',
        partsDone: reached,
        partsTotal: full,
        detail: `${word} ${reached}`,
        // Where stars are the real measure, the stage reached says less.
        confidence: mode.stars ? 'medium' : 'high',
      };
    }
  }
  const rank = mode.ranked ? LETTER_RANK.exec(text)?.[1] : undefined;
  if (rank)
    return { progress: rank.startsWith('S') ? 'done' : 'partial', detail: `Rank ${rank}`, confidence: 'medium' };
  const score = mode.scored ? savingsNumber(SCORE.exec(text)?.[1] ?? '') : undefined;
  if (score !== undefined && score > 0) {
    return { progress: 'partial', detail: `${groupThousands(score)} pts`, confidence: 'medium' };
  }
  return CLEAR_WORDS.test(text) ? { progress: 'done', detail: 'Cleared', confidence: 'medium' } : undefined;
}

function matchEvents(
  regions: readonly OcrRegion[],
  pool: readonly GameEvent[],
  modes: readonly EndgameMode[],
  at: number,
  bareRooms: { preset: string | undefined; anywhere: boolean },
): OcrEventCandidate[] {
  const best = new Map<string, OcrEventCandidate>();
  if (pool.length === 0) return [];
  for (const region of regions) {
    region.lines.forEach((line, i) => {
      for (const mode of modes) {
        // The HUD inside a mode shows its room without the mode's name ("Floor 12 Chamber 3"). Read alone
        // only for the mode's own game, and in a whole window only beside a clean bar or in its top band.
        const bare =
          mode.preset !== '' &&
          mode.preset === bareRooms.preset &&
          (bareRooms.anywhere || region.bar[i] === true) &&
          roomReached(line, mode) !== undefined;
        if (!bare && !namesMode(line, mode)) continue;
        const event = cycleEventFor(pool, mode, at);
        if (!event) continue;
        let reading = readEndgame(line, mode);
        let text = line;
        let above = false;
        if (!reading) {
          const pair = pairedText(region, i, (other) => readEndgame(other, mode) !== undefined);
          if (!pair) continue;
          reading = readEndgame(pair.text, mode);
          text = pair.text;
          above = pair.above;
        }
        if (!reading) continue;
        const candidate: OcrEventCandidate = {
          eventId: event.id,
          eventName: event.name,
          progress: reading.progress,
          ...(reading.partsDone !== undefined ? { partsDone: reading.partsDone, partsTotal: reading.partsTotal } : {}),
          detail: reading.detail,
          line: text,
          confidence: above ? lowered(reading.confidence) : reading.confidence,
        };
        const current = best.get(event.id);
        if (!current || RANK[candidate.confidence] > RANK[current.confidence]) best.set(event.id, candidate);
      }
    });
  }
  return [...best.values()];
}

/** Every bar, reserve, task, savings count and endgame cycle a screenshot shows, in one pass. */
export function matchScreenshotOcr(lines: readonly string[], context: OcrScreenshotContext): OcrScreenshotMatches {
  const { game } = context;
  const resources = context.resources.filter((res) => !res.deleted);
  const tasks = context.tasks.filter((task) => !task.deleted);
  const pool = (context.events ?? []).filter(
    (ev) => !ev.deleted && ev.type === 'cycle' && (!game || ev.gameId === game.id),
  );
  const modes = endgameModes(pool);
  const regions = ocrRegions(lines, {
    resources,
    tasks,
    savings: allSavingsLabels(game),
    modes: modes.flatMap((mode) => mode.names.map(compact)),
  });
  const preset = game ? presetForGame(game) : undefined;
  // Stray text fills a whole window; its top band, a snip or a file holds the HUD and little else.
  const hud = context.capture !== 'window' || context.pass === 'topBand2x';
  const rules: ReadingRules = {
    disambiguate: true,
    ...(game && hud ? { glued: realCaps(resources, preset?.key) } : {}),
    beside: preset?.key === 'wuwa' && hud,
  };
  return {
    readings: collectReadings(regions, resources, rules),
    tasks: matchTasks(regions, tasks),
    savings: matchSavings(regions, game),
    events: matchEvents(regions, pool, modes, context.observedAt ?? Date.now(), {
      preset: preset?.key,
      anywhere: hud,
    }),
  };
}

/** Every cap and reserve cap a game really has: its own bars' and its preset's. */
function realCaps(resources: readonly Resource[], presetKey: string | undefined): Set<number> {
  const preset = PRESETS.find((item) => item.key === presetKey);
  return new Set(
    [...resources, ...(preset?.resources ?? [])].flatMap((res) => [res.cap, res.reserveCap]).filter((cap) => cap > 0),
  );
}

// ---------------------------------------------------------------------------
// Several passes over the same regions.
// ---------------------------------------------------------------------------

export interface OcrScreenshotInput {
  /** The primary reading, one empty line between regions (see `OcrPass`). */
  lines: readonly string[];
  /** Other readings of the same regions; a region with passes is read from them alone. */
  passes?: readonly OcrPass[];
  /** How each region was captured, by region index. */
  captures?: readonly (OcrCapture | null | undefined)[];
}

/** `lines` cut at every empty line, so region i of the text is region i of the passes. */
function splitRegions(lines: readonly string[]): string[][] {
  const out: string[][] = [[]];
  for (const line of lines) {
    if (line.trim() === '') out.push([]);
    else out[out.length - 1]!.push(line);
  }
  return out;
}

/**
 * One candidate per key from several reads of one region. The views show the same picture, so they
 * vote no further than this: a plain read beats a rule's guess (and lifts it when they agree), two
 * guesses never lift each other, and views that disagree on the value leave only a rough match.
 */
function mergeViews<T extends { confidence: OcrConfidence; rule?: OcrReadingRule }>(
  views: readonly (readonly T[])[],
  key: (candidate: T) => string,
  same: (a: T, b: T) => boolean,
): T[] {
  const groups = new Map<string, T[]>();
  for (const view of views) {
    for (const candidate of view) {
      const id = key(candidate);
      const group = groups.get(id);
      if (group) group.push(candidate);
      else groups.set(id, [candidate]);
    }
  }
  return [...groups.values()].map((group) => {
    // Stable: on a tie the earlier view wins.
    const best = [...group].sort(
      (a, b) => Number(a.rule !== undefined) - Number(b.rule !== undefined) || RANK[b.confidence] - RANK[a.confidence],
    )[0]!;
    return group.every((other) => same(other, best)) ? best : { ...best, confidence: 'low' };
  });
}

/** The most confident candidate per key across regions, the first seen on a tie. */
function bestPerKey<T extends { confidence: OcrConfidence }>(
  lists: readonly (readonly T[])[],
  key: (candidate: T) => string,
): T[] {
  const best = new Map<string, T>();
  for (const list of lists) {
    for (const candidate of list) {
      const id = key(candidate);
      const current = best.get(id);
      if (!current || RANK[candidate.confidence] > RANK[current.confidence]) best.set(id, candidate);
    }
  }
  return [...best.values()];
}

const readingKey = (c: OcrReadingCandidate) => `${c.resourceId}|${c.field}`;
const taskKey = (c: OcrTaskCandidate) => c.taskId;
const savingsKey = (c: OcrSavingsCandidate) => c.field;
const eventKey = (c: OcrEventCandidate) => c.eventId;

/**
 * `matchScreenshotOcr` over every pass of every region: a region's passes are merged (see `mergeViews`),
 * then regions keep the most confident candidate, as one reading's regions always have. Without passes
 * or captures it is `matchScreenshotOcr` on `lines`.
 */
export function matchScreenshotOcrPasses(
  input: OcrScreenshotInput,
  context: OcrScreenshotContext,
): OcrScreenshotMatches {
  const passes = input.passes ?? [];
  if (passes.length === 0 && !input.captures?.some(Boolean)) return matchScreenshotOcr(input.lines, context);
  const regionOf = (pass: OcrPass) =>
    pass.region !== undefined && Number.isInteger(pass.region) && pass.region >= 0 ? pass.region : 0;
  const texts = splitRegions(input.lines);
  const count = Math.max(texts.length, ...passes.map((pass) => regionOf(pass) + 1));
  const regions: OcrScreenshotMatches[] = [];
  for (let region = 0; region < count; region++) {
    const own: Array<{ name?: OcrPassName; lines: readonly string[] }> = passes.filter(
      (pass) => regionOf(pass) === region,
    );
    const capture = input.captures?.[region] ?? context.capture;
    const views = (own.length > 0 ? own : [{ lines: texts[region] ?? [] }])
      .filter((view) => view.lines.some((line) => line.trim() !== ''))
      .map((view) =>
        matchScreenshotOcr(view.lines, {
          ...context,
          ...(capture ? { capture } : {}),
          ...(view.name ? { pass: view.name } : {}),
        }),
      );
    regions.push({
      readings: mergeViews(
        views.map((view) => view.readings),
        readingKey,
        (a, b) => a.value === b.value,
      ),
      tasks: mergeViews(
        views.map((view) => view.tasks),
        taskKey,
        (a, b) => a.action === b.action && a.countDone === b.countDone,
      ),
      savings: mergeViews(
        views.map((view) => view.savings),
        savingsKey,
        (a, b) => a.value === b.value,
      ),
      events: mergeViews(
        views.map((view) => view.events),
        eventKey,
        (a, b) => a.progress === b.progress && a.partsDone === b.partsDone,
      ),
    });
  }
  const readings = bestPerKey(
    regions.map((region) => region.readings),
    readingKey,
  );
  return {
    readings: readings.sort((a, b) => RANK[b.confidence] - RANK[a.confidence]),
    tasks: bestPerKey(
      regions.map((region) => region.tasks),
      taskKey,
    ),
    savings: bestPerKey(
      regions.map((region) => region.savings),
      savingsKey,
    ),
    events: bestPerKey(
      regions.map((region) => region.events),
      eventKey,
    ),
  };
}

// ---------------------------------------------------------------------------
// Which game a screenshot shows.
// ---------------------------------------------------------------------------

const READING_SCORE: Record<OcrConfidence, number> = { high: 6, medium: 3, low: 1 };
const OTHER_SCORE: Record<OcrConfidence, number> = { high: 5, medium: 3, low: 0 };
/** A name only one game uses (a currency, an endgame mode), seen anywhere, even with its number elsewhere. */
const CUE_SCORE = 3;

/** Singular and plural alike: "Crystal" collides with "Crystals". */
function labelStem(label: string): string {
  return label.toLowerCase().replace(/e?s$/, '');
}

/** Savings labels a single preset owns: "Primogems" points at Genshin, "Gems" at nothing. */
function presetCues(presetKey: string): string[] {
  const own = SAVINGS_LABELS[presetKey];
  if (!own) return [];
  const others = [
    ...GENERIC_SAVINGS.currency,
    ...GENERIC_SAVINGS.tickets,
    ...Object.entries(SAVINGS_LABELS)
      .filter(([key]) => key !== presetKey)
      .flatMap(([, labels]) => [...labels.currency, ...labels.tickets]),
  ].map(labelStem);
  return [...own.currency, ...own.tickets].filter((label) => !others.includes(labelStem(label)));
}

/** How many presets have a bar or reserve with this cap: 200 is Genshin's alone, 240 is three games'. */
function presetsWithCap(cap: number): number {
  return PRESETS.filter((preset) => preset.resources.some((res) => res.cap === cap || res.reserveCap === cap)).length;
}

/** Whether a reading says which game this is. A guessed reserve never does, nor a glued cap two games share. */
function pointsAtGame(reading: OcrReadingCandidate): boolean {
  if (reading.rule === 'reserve-beside-bar') return false;
  return reading.rule !== 'glued-glyph' || presetsWithCap(reading.cap) === 1;
}

/** The game a screenshot most likely shows, or undefined when nothing points at one game alone. */
export function inferScreenshotGame(
  lines: readonly string[],
  games: readonly Game[],
  resources: readonly Resource[],
  tasks: readonly Task[],
  extra: {
    events?: readonly GameEvent[];
    observedAt?: number;
    passes?: readonly OcrPass[];
    captures?: readonly (OcrCapture | null | undefined)[];
  } = {},
): string | undefined {
  const allLines = [...lines, ...(extra.passes ?? []).flatMap((pass) => pass.lines)];
  const hudViews: Array<{
    lines: readonly string[];
    capture: OcrCapture | null | undefined;
    pass: OcrPass['name'] | undefined;
  }> = extra.passes?.length
    ? extra.passes.map((pass) => {
        const region = pass.region !== undefined && Number.isInteger(pass.region) && pass.region >= 0 ? pass.region : 0;
        return { lines: pass.lines, capture: extra.captures?.[region], pass: pass.name };
      })
    : splitRegions(lines).map((regionLines, region) => ({
        lines: regionLines,
        capture: extra.captures?.[region],
        pass: undefined,
      }));
  const text = allLines.join('\n').toLowerCase();
  // Joined across lines too, so a label the OCR wrapped ("Spiral" / "Abyss") still reads.
  const flat = compact(text);
  const input: OcrScreenshotInput = {
    lines,
    ...(extra.passes ? { passes: extra.passes } : {}),
    ...(extra.captures ? { captures: extra.captures } : {}),
  };
  let bestId: string | undefined;
  let bestScore = 0;
  let tied = false;
  for (const game of games) {
    if (game.deleted) continue;
    const own = resources.filter((res) => res.gameId === game.id && !res.deleted);
    const found = matchScreenshotOcrPasses(input, {
      game,
      resources: own,
      tasks: tasks.filter((task) => task.gameId === game.id),
      ...(extra.events ? { events: extra.events } : {}),
      ...(extra.observedAt !== undefined ? { observedAt: extra.observedAt } : {}),
    });
    let score = 0;
    for (const reading of found.readings) {
      if (!pointsAtGame(reading)) continue;
      score += READING_SCORE[reading.confidence];
      const res = own.find((r) => r.id === reading.resourceId);
      if (res && resourceNamed(reading.line, res)) score += 4;
    }
    for (const task of found.tasks) score += OTHER_SCORE[task.confidence];
    for (const saving of found.savings) score += OTHER_SCORE[saving.confidence];
    for (const event of found.events) score += OTHER_SCORE[event.confidence];
    const presetKey = presetForGame(game)?.key;
    if (presetKey) {
      const cues = [
        ...presetCues(presetKey).filter((label) => includesWord(text, label)),
        // A mode's name, or the room a single HUD line shows when its view allows it.
        ...ENDGAME_MODES.filter((mode) => {
          if (mode.preset !== presetKey) return false;
          if (namesMode(flat, mode)) return true;
          return hudViews.some((view) => {
            const hud = view.capture !== 'window' || view.pass === 'topBand2x';
            return view.lines.some((line) => {
              if (!roomReached(line, mode)) return false;
              if (hud) return true;
              return fractionMatches(line).some((match) => match.fractions.some((f) => barFraction(own, f)));
            });
          });
        }),
      ];
      score += cues.length * CUE_SCORE;
    }
    if ([game.name, game.short].some((label) => label.trim() && includesWord(text, label.trim()))) score += 8;
    if (score > bestScore) {
      bestScore = score;
      bestId = game.id;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  }
  return tied ? undefined : bestId;
}
