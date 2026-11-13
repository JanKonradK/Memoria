// Drafts calendar rows from the publishers' own announcement feeds and adds
// the new ones to app/src/data/feed/current.json for a person to review.
//
// It never signs, never removes a row and never changes one: rows it already
// knows (by sourceKey) are only compared, and differences go in the report.
// The scheduled workflow turns the result into a pull request.
//
// Usage: node scripts/feed-draft.mjs [--report path.md] [--dry-run]
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const feedPath = path.join(root, 'app/src/data/feed/current.json');

/**
 * HoYoverse announcement feeds, Europe server. Times tagged `t_lc` are server
 * wall clock and copy straight across; `t_gl` are one global moment in UTC+8
 * (docs/feed-notes.md, "Reading a HoYo notice"). ZZZ's feed answered with an
 * empty list in November 2026; it stays hand-kept until a working query is found.
 */
export const SOURCES = {
  genshin: {
    base: 'https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api',
    params: { game: 'hk4e', game_biz: 'hk4e_global', bundle_id: 'hk4e_global', region: 'os_euro', level: '55' },
  },
  hsr: {
    base: 'https://sg-hkrpg-api.hoyoverse.com/common/hkrpg_global/announcement/api',
    params: {
      game: 'hkrpg',
      game_biz: 'hkrpg_global',
      bundle_id: 'hkrpg_global',
      region: 'prod_official_eur',
      level: '70',
      channel_id: '1',
    },
  },
};

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (text) => text.replace(/&(lt|gt|amp|quot|#39|nbsp);/g, (entity) => ENTITIES[entity]);

const TIME = /<t class="(t_lc|t_gl)"[^>]*>\s*(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})(?::\d{2})?\s*<\/t>/g;

/** "2026/11/24 17:59" in a t tag, as the feed's "2026-11-24 17:59" plus whether it is global. */
function times(html) {
  return [...html.matchAll(TIME)].map((match) => ({
    at: `${match[2]}-${match[3]}-${match[4]} ${match[5]}:${match[6]}`,
    global: match[1] === 't_gl',
    index: match.index,
  }));
}

/** The title as a row name: the quoted event name when there is one, without the tagline. */
export function rowName(title) {
  const quoted = /^"([^"]+)"/.exec(title.trim())?.[1];
  if (quoted) return quoted.trim();
  return title
    .replace(/\s*[-–—]\s*Boosted Drop Rate.*$/i, '')
    .replace(/\s+(Event Details|(?:Web )?Event is Now Online)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Notices that carry dates but are not something to play: patch notes, shops, surveys. */
const NOT_AN_EVENT =
  /Update Details|Store Update|Known Issues?|Optimization|Compensation|Survey|Phishing|Fair (Gaming|Use)|Version \d+\.\d+ "[^"]+" Update$/i;

/**
 * One draft row from one notice, or null when the notice does not state a
 * window this script can read without guessing.
 */
export function draftRow(game, notice, versionStarts) {
  if (NOT_AN_EVENT.test(notice.title ?? '')) return null;
  const html = decode(notice.content ?? '');
  // Genshin says "Duration"; HSR says "Event Period", "Start Date", "Release Time" and so on.
  const duration = html.search(/Duration|Period|Start Date|Release Time|Collection Time/i);
  if (duration < 0) return null;
  const found = times(html).filter((time) => time.index > duration);
  if (!found.length) return null;
  const between = html.slice(duration, found[0].index).replace(/<[^>]+>/g, ' ');
  let start;
  let end;
  if (found.length >= 2 && !/After (?:the )?Version/i.test(between)) {
    [start, end] = found;
  } else {
    const version = /After (?:the )?Version (\d+\.\d+) update/i.exec(between)?.[1];
    const opening = version && versionStarts.get(version);
    if (!opening) return null;
    start = opening;
    end = found[0];
  }
  const row = {
    game,
    name: rowName(notice.title ?? notice.subtitle ?? 'Event'),
    type: /\b(wish|warp)\b/i.test(notice.title ?? '') ? 'banner' : 'event',
    start: start.at,
    end: end.at,
    notes: '',
    sourceKey: `${game}:${notice.ann_id}`,
  };
  if (start.global && end.global) row.timezone = 'UTC+8';
  else {
    if (start.global) row.startTimezone = 'UTC+8';
    if (end.global) row.endTimezone = 'UTC+8';
  }
  return row.start < row.end ? row : null;
}

/** When each version went live, from the update maintenance rows already in the feed. */
export function versionStarts(events, game) {
  const starts = new Map();
  for (const row of events) {
    if (row.game !== game || row.type !== 'maintenance') continue;
    const version = /\bv?(\d+\.\d+)\b/.exec(row.name)?.[1];
    if (version) starts.set(version, { at: row.end, global: row.timezone === 'UTC+8' });
  }
  return starts;
}

async function notices(source) {
  const query = new URLSearchParams({ ...source.params, lang: 'en', platform: 'pc', uid: '100000000' });
  const response = await fetch(`${source.base}/getAnnContent?${query}`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (body.retcode !== 0) throw new Error(body.message || 'retcode');
  return [...(body.data?.list ?? []), ...(body.data?.pic_list ?? [])];
}

async function main() {
  const reportIndex = process.argv.indexOf('--report');
  const dryRun = process.argv.includes('--dry-run');
  const feed = JSON.parse(await readFile(feedPath, 'utf8'));
  const known = new Map();
  for (const row of feed.events)
    if (row.sourceKey) known.set(row.sourceKey, [...(known.get(row.sourceKey) ?? []), row]);
  const today = new Date().toISOString().slice(0, 10);
  const added = [];
  const differs = [];
  const failed = [];
  for (const [game, source] of Object.entries(SOURCES)) {
    let list;
    try {
      list = await notices(source);
    } catch (error) {
      failed.push(`${game}: ${error.message}`);
      continue;
    }
    const starts = versionStarts(feed.events, game);
    for (const notice of list) {
      const row = draftRow(game, notice, starts);
      if (!row || row.end.slice(0, 10) < today) continue;
      const existing = known.get(row.sourceKey);
      // A row written by hand (seed:… key) for the same window is the same thing.
      const twin = feed.events.some(
        (item) =>
          item.game === row.game && item.type === row.type && item.end === row.end && item.sourceKey !== row.sourceKey,
      );
      if (!existing && twin) continue;
      if (!existing) {
        added.push(row);
        known.set(row.sourceKey, [row]);
      } else if (existing.length === 1 && (existing[0].start !== row.start || existing[0].end !== row.end))
        differs.push({ row, existing: existing[0] });
    }
  }

  const lines = [`# Calendar draft ${today}`, ''];
  lines.push(
    'Drafted from the official announcement feeds. Review each row against its notice, set `notes`,',
    'then run `npm run export:events` and sign as for a release. Nothing here is signed.',
    '',
  );
  lines.push(`## New rows (${added.length})`, '');
  for (const row of added)
    lines.push(`- **${row.game}** ${row.type}: ${row.name} · ${row.start} – ${row.end} · \`${row.sourceKey}\``);
  lines.push('', `## Known rows whose dates differ (${differs.length})`, '');
  for (const { row, existing } of differs)
    lines.push(
      `- \`${row.sourceKey}\` ${existing.name}: feed has ${existing.start} – ${existing.end}, notice says ${row.start} – ${row.end}`,
    );
  if (failed.length) lines.push('', '## Sources that failed', '', ...failed.map((item) => `- ${item}`));
  const report = lines.join('\n') + '\n';
  if (reportIndex >= 0) await writeFile(process.argv[reportIndex + 1], report);
  else console.log(report);

  if (!dryRun && added.length) {
    feed.events.push(...added);
    await writeFile(feedPath, JSON.stringify(feed, null, 2) + '\n');
  }
  // A source failing is worth a red run; it is how a broken feed gets noticed.
  if (failed.length === Object.keys(SOURCES).length) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
