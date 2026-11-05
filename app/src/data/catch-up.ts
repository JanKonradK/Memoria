import genshinArtwork from '../assets/livestreams/genshin-7.2.jpg';
import nteArtwork from '../assets/livestreams/nte-1.5.jpg';
import wuwaArtwork from '../assets/livestreams/wuwa-3.7.jpg';
import hsrArtwork from '../assets/livestreams/hsr-4.7.jpg';

/**
 * What each game version added, curated by hand from official notices and
 * cross-checked press. See docs/catch-up-2026-11-05.md for sources.
 *
 * A section says how far it was checked:
 * - complete: everything is listed. Empty means none were added.
 * - partial: the listed items are confirmed, but there may be more.
 * - unresearched: nobody has checked yet. Never shown as "none".
 *
 * Changing what a version says means raising its revision, so the player sees
 * it as unread again on every device.
 */
export type SectionState = 'complete' | 'partial' | 'unresearched';

export interface Section<T> {
  state: SectionState;
  items: T[];
}

export interface CatchUpCharacter {
  name: string;
  /** "5★"/"4★" for HoYoverse and Kuro games, "S"/"A" where the game ranks that way. */
  rank: string;
  /** Element, path, weapon, role: separate facts, shown separately. */
  traits: string[];
  rerun?: boolean;
  /** When it is not available from the start of the version. */
  note?: string;
}

export interface CatchUpItem {
  name: string;
  rank?: string;
  detail?: string;
}

export interface RedemptionCode {
  code: string;
  rewards: string;
  redeemUrl?: string;
}

export interface RedemptionCodes {
  /** Absent means the expiry is not known, which never reads as active. */
  expiresAt?: number;
  expiryLabel?: string;
  instructions: string;
  codes: RedemptionCode[];
}

export interface VersionDigest {
  id: string;
  /** Preset key of the game. */
  game: string;
  version: string;
  title?: string;
  revision: number;
  /** Released, or announced and still to come. */
  status: 'released' | 'announced';
  /** Release and end dates, YYYY-MM-DD in the game's server time. */
  release: string;
  ends?: string;
  summary: string;
  artwork?: { src: string; alt: string };
  /** The version's livestream, once it has aired. */
  stream?: { aired: string; replay: string };
  characters: Section<CatchUpCharacter>;
  weapons: Section<CatchUpItem>;
  gear: Section<CatchUpItem>;
  outfits: Section<CatchUpItem>;
  /** Story and new areas: shown behind a spoiler disclosure. */
  story: Section<string>;
  events: Section<string>;
  qol: Section<string>;
  codes?: RedemptionCodes;
  sources: { label: string; url: string }[];
  /** When this digest was last checked, YYYY-MM-DD. */
  reviewed: string;
}

/** What each game calls its weapons and its gear sets. Null: the game has none. */
export const CATCH_UP_LABELS: Record<string, { weapons: string; gear: string | null }> = {
  genshin: { weapons: 'Weapons', gear: 'Artifact sets' },
  hsr: { weapons: 'Light Cones', gear: 'Relic sets' },
  zzz: { weapons: 'W-Engines', gear: 'Drive Disc sets' },
  wuwa: { weapons: 'Weapons', gear: 'Echo sets' },
  nte: { weapons: 'Arcs', gear: null },
};

const none = <T>(): Section<T> => ({ state: 'unresearched', items: [] });
const partial = <T>(items: T[]): Section<T> => ({ state: 'partial', items });
const complete = <T>(items: T[]): Section<T> => ({ state: 'complete', items });

export function digestKey(digest: Pick<VersionDigest, 'id' | 'revision'>): string {
  return `${digest.id}@${digest.revision}`;
}

/** Newest version first. */
export const VERSION_DIGESTS: VersionDigest[] = [
  {
    id: 'genshin-7.2',
    game: 'genshin',
    version: '7.2',
    title: 'Hour of Ruin',
    revision: 1,
    status: 'released',
    release: '2026-11-04',
    ends: '2026-12-16',
    summary:
      'Mitya arrives with Valeriy, the Archon Quest continues into Novokitezhgrad and Wingspan Peak, and The Grand Defense hands out a four-star of your choice.',
    artwork: { src: genshinArtwork, alt: 'Genshin Impact Version 7.2 Special Program artwork, Hour of Ruin' },
    stream: { aired: '2026-10-23T12:00:00Z', replay: 'https://www.youtube.com/watch?v=8XhQlIxJzUk' },
    characters: complete([
      { name: 'Mitya', rank: '5★', traits: ['Electro', 'Catalyst'] },
      { name: 'Valeriy', rank: '4★', traits: ['Electro', 'Sword'] },
      { name: 'Furina', rank: '5★', traits: ['Hydro', 'Sword'], rerun: true },
    ]),
    weapons: partial([{ name: 'Starsealed Edict', rank: '5★', detail: 'Catalyst · Mitya’s signature' }]),
    gear: none(),
    outfits: partial([{ name: 'Event outfit', rank: '4★', detail: 'From A World of Starry Seas' }]),
    story: partial([
      'Archon Quest Chapter VII, Acts V and VI.',
      'Novokitezhgrad and Wingspan Peak open in Snezhnaya, with the Where Kristall Roots Run Deep exploration reward.',
    ]),
    events: partial([
      'The Grand Defense: invite a four-star character of your choice.',
      'A World of Starry Seas: a masquerade lobby and a four-star outfit.',
      'Repertoire of Myriad Melodies and the Sacred Spirit Chronicle Battle Pass run all version.',
    ]),
    qol: partial([
      'Spiral Abyss Floors 11 and 12 now run two phases, each with its own Ley Line Disorders.',
      'Firearm assembly greys out inactive full-loadout effects, and Go takes you to where a locked accessory comes from.',
      'The Eye of Graeae character view faces forward again after you switch screens.',
    ]),
    codes: {
      expiresAt: Date.parse('2026-10-26T00:00:00-04:00'),
      expiryLabel: '26 October 2026, 00:00 (UTC-4)',
      instructions:
        'Redeem on the web or in game: Paimon Menu → Settings → Account → Redeem Code. Needs AR 10. Rewards arrive in in-game mail.',
      codes: [
        { code: 'HourofRuin', rewards: '100 Primogems + 10 Mystic Enhancement Ore' },
        { code: 'ExpertMitya', rewards: '100 Primogems + 5 Hero’s Wit' },
        { code: 'PhotoTime', rewards: '100 Primogems + 50,000 Mora' },
      ].map((entry) => ({ ...entry, redeemUrl: `https://genshin.hoyoverse.com/en/gift?code=${entry.code}` })),
    },
    sources: [
      { label: 'Official 7.2 update notes', url: 'https://genshin.hoyoverse.com/m/en/news/detail/167187' },
      {
        label: 'Inven Global launch summary',
        url: 'https://www.invenglobal.com/articles/27693/genshin-impact-version-72-hour-of-ruin-launches-november-4',
      },
    ],
    reviewed: '2026-11-05',
  },
  {
    id: 'genshin-7.1',
    game: 'genshin',
    version: '7.1',
    revision: 1,
    status: 'released',
    release: '2026-09-23',
    ends: '2026-11-04',
    summary:
      'Vesna and Vodyanitsa debut, Skirk and Escoffier rerun, and Silverwing in Pursuit of the Moon gives away the four-star Silver Light.',
    characters: complete([
      { name: 'Vesna', rank: '5★', traits: ['Anemo', 'Sword'] },
      { name: 'Vodyanitsa', rank: '5★', traits: ['Hydro', 'Catalyst'] },
      { name: 'Skirk', rank: '5★', traits: ['Cryo', 'Sword'], rerun: true, note: 'Phase 2' },
      { name: 'Escoffier', rank: '5★', traits: ['Cryo', 'Polearm'], rerun: true, note: 'Phase 2' },
    ]),
    weapons: complete([
      { name: 'Beyond the Chrysalis', rank: '5★', detail: 'Sword · Vesna’s signature' },
      { name: 'Hymn of the Maelstrom', rank: '5★', detail: 'Catalyst · Vodyanitsa’s signature' },
      { name: 'New Bough', rank: '4★', detail: 'Sword' },
      { name: 'Winter’s Heavy Heart', rank: '4★', detail: 'Catalyst' },
      { name: 'Breezeborne Refrain', rank: '4★', detail: 'Bow' },
      { name: 'Silver Light', rank: '4★', detail: 'Free from Silverwing in Pursuit of the Moon' },
    ]),
    gear: complete([]),
    outfits: none(),
    story: none(),
    events: partial([
      'Silverwing in Pursuit of the Moon: the free Silver Light and a Crown of Insight.',
      'A new boss, Guardian Blade of Drifting Snow.',
    ]),
    qol: none(),
    sources: [
      { label: 'Game8 Version 7.1 guide', url: 'https://game8.co/games/Genshin-Impact/archives/615781' },
      { label: 'Icy Veins patch overview', url: 'https://www.icy-veins.com/genshin-impact/patch-overview' },
      { label: 'Timesaver: 7.1 weapons', url: 'https://timesaver.gg/blog/genshin-7-1-new-weapons' },
    ],
    reviewed: '2026-11-05',
  },
  {
    id: 'hsr-4.7',
    game: 'hsr',
    version: '4.7',
    title: 'Now, Lay Laughter to All Stars',
    revision: 1,
    status: 'announced',
    release: '2026-11-11',
    summary:
      'Aha joins as the first playable Aeon, alongside a new Currency Wars season and a free character selection.',
    artwork: { src: hsrArtwork, alt: 'Honkai: Star Rail Version 4.7 Special Program artwork, Aha’s Night' },
    stream: { aired: '2026-10-30T11:30:00Z', replay: 'https://www.youtube.com/watch?v=psifFhA2QAA' },
    characters: partial([{ name: 'Aha', rank: '5★', traits: ['Quantum', 'Elation'] }]),
    weapons: partial([
      { name: 'Upon the First Echo of Aha', rank: '5★', detail: 'Aha’s signature' },
      { name: 'See You at the World’s End!', rank: '4★', detail: 'Elation' },
    ]),
    gear: none(),
    outfits: partial([{ name: 'Aha outfit', detail: 'Limited' }]),
    story: none(),
    events: partial(['A new Currency Wars season.', 'A free character selection.']),
    qol: partial(['Jiaoqiu’s Light Cone joins the Stellar Convergence catalogue.']),
    sources: [
      { label: 'Official 4.7 Special Program', url: 'https://www.youtube.com/watch?v=psifFhA2QAA' },
      { label: 'Game8 livestream summary', url: 'https://game8.co/games/Honkai-Star-Rail/archives/633515' },
      {
        label: 'Icy Veins program overview',
        url: 'https://www.icy-veins.com/honkai-star-rail/news/honkai-star-rail-special-program-version-4-7-now-lay-laughter-to-all-stars-overview/',
      },
    ],
    reviewed: '2026-11-05',
  },
  {
    id: 'hsr-4.6',
    game: 'hsr',
    version: '4.6',
    revision: 1,
    status: 'released',
    release: '2026-09-28',
    ends: '2026-11-11',
    summary: 'Pearl debuts on the Path of Elation, with Evanescia and Blade reruns and two new Cavern relic sets.',
    characters: complete([
      { name: 'Pearl', rank: '5★', traits: ['Ice', 'Elation'] },
      { name: 'Evanescia', rank: '5★', traits: [], rerun: true },
      { name: 'Blade', rank: '5★', traits: ['Wind', 'Destruction'], rerun: true, note: 'From 21 October' },
    ]),
    weapons: partial([{ name: 'Colors for Tomorrow', rank: '5★', detail: 'Pearl’s signature' }]),
    gear: partial([
      { name: 'Dreamlit Actor', detail: 'Cavern relic set' },
      { name: 'The Edacious Heretic', detail: 'Cavern relic set' },
    ]),
    outfits: none(),
    story: none(),
    events: none(),
    qol: partial(['The launcher checks game files faster when a version update installs.']),
    sources: [
      {
        label: 'Sportskeeda 4.6 patch notes',
        url: 'https://www.sportskeeda.com/esports/honkai-star-rail-4-6-update-patch-notes-new-character-events',
      },
      { label: 'Game8 4.6 banners', url: 'https://game8.co/games/Honkai-Star-Rail/archives/614847' },
    ],
    reviewed: '2026-11-05',
  },
  {
    id: 'zzz-3.3',
    game: 'zzz',
    version: '3.3',
    title: 'Journey to the Sky',
    revision: 1,
    status: 'released',
    release: '2026-10-21',
    ends: '2026-12-02',
    summary: 'Phoenix and Severian arrive, and you can pilot combat mechs for the first time.',
    stream: { aired: '2026-10-09T11:30:00Z', replay: 'https://www.youtube.com/watch?v=eskKHxhmjCE' },
    characters: complete([
      { name: 'Phoenix', rank: 'S', traits: ['Fire', 'Anomaly'] },
      { name: 'Severian', rank: 'S', traits: ['Wind'], note: 'From 11 November' },
      { name: 'Velina', rank: 'S', traits: [], rerun: true },
    ]),
    weapons: partial([
      { name: 'Plume of Rebirth', rank: 'S', detail: 'Phoenix’s signature' },
      { name: 'Incarcerating Grip', rank: 'S', detail: 'From 11 November' },
    ]),
    gear: none(),
    outfits: none(),
    story: partial(['Playable combat mechs join the new story chapter.']),
    events: partial(['Hollow Zero Tactical Prisms.', 'Double Drive Disc drops in Routine Cleanup.']),
    qol: none(),
    sources: [
      { label: 'Official 3.3 announcement', url: 'https://zenless.hoyoverse.com/en-us/news/166963' },
      {
        label: 'Gematsu',
        url: 'https://www.gematsu.com/2026/10/zenless-zone-zero-version-3-3-update-journey-to-the-sky-launches-october-21',
      },
    ],
    reviewed: '2026-11-05',
  },
  {
    id: 'zzz-3.2',
    game: 'zzz',
    version: '3.2',
    title: 'Their Secret Histories',
    revision: 1,
    status: 'released',
    release: '2026-09-09',
    ends: '2026-10-21',
    summary: 'Claret and Roxy debut as Phaethon’s story moves to Vyrium and Flint Workshop.',
    characters: complete([
      { name: 'Claret', rank: 'S', traits: ['Electric'] },
      { name: 'Roxy', rank: 'S', traits: ['Wind', 'Stun'], note: 'Second half' },
      { name: 'Nangong Yu', rank: 'S', traits: [], rerun: true },
      { name: 'Promeia', rank: 'S', traits: [], rerun: true },
    ]),
    weapons: partial([
      { name: 'Crimson Thirst', detail: 'First half' },
      { name: 'Neon Fantasies', detail: 'First half' },
      { name: 'Crimson Moon Casket', detail: 'Second half' },
      { name: 'Frostfall Sickle', detail: 'Second half' },
    ]),
    gear: none(),
    outfits: none(),
    story: partial(['Phaethon’s story continues in Vyrium, with Flint Workshop’s operations.']),
    events: partial([
      'Operation Bagel II: Enigma of the Labyrinth, with Armorer gear and extra missions.',
      'The Kusarikku challenge stage.',
      'New commissions and Hidden Space exploration.',
    ]),
    qol: partial([
      'Koleda gets a Potential enhancement.',
      'New Proxies can pick Jane Doe, Hugo or Soldier 0 – Anby from the Beginner Guide.',
      'Special Training Plans recommend better Drive Discs.',
    ]),
    sources: [{ label: 'Official 3.2 announcement', url: 'https://zenless.hoyoverse.com/en-us/news/166000' }],
    reviewed: '2026-11-05',
  },
  {
    id: 'wuwa-3.7',
    game: 'wuwa',
    version: '3.7',
    title: 'Prism’s Illusion, Heart’s Illumination',
    revision: 1,
    status: 'released',
    release: '2026-09-30',
    summary:
      'Hsin and Suoming arrive with three new Echo sets, and a long list of comforts lands: main quest replay, Echo stacking and twenty team slots.',
    artwork: { src: wuwaArtwork, alt: 'Wuthering Waves Version 3.7 artwork' },
    stream: { aired: '2026-09-19T11:00:00Z', replay: 'https://www.youtube.com/watch?v=nMa_e5ChL6w' },
    characters: complete([
      { name: 'Hsin', rank: '5★', traits: ['Electro'] },
      { name: 'Suoming', rank: '5★', traits: ['Electro'], note: 'From 22 October' },
      { name: 'Chisa', rank: '5★', traits: [], rerun: true },
      { name: 'Iuno', rank: '5★', traits: [], rerun: true },
      { name: 'Lucilla', rank: '5★', traits: [], rerun: true, note: 'From 22 October' },
      { name: 'Lynae', rank: '5★', traits: [], rerun: true, note: 'From 22 October' },
    ]),
    weapons: complete([
      { name: 'Blooming Jadehaven', rank: '5★', detail: 'Hsin’s signature' },
      { name: 'Unspoken Rue', rank: '5★', detail: 'Suoming’s signature' },
    ]),
    gear: complete([
      { name: 'Heart of Sworn Vigil', detail: 'Hsin’s set: rewards Electro Flare and Unison' },
      { name: 'Flash of Electric Reflection' },
      { name: 'Flower of Tinged Yearning' },
      {
        name: 'Five new Echoes',
        detail: 'Formrender, Soulfrayer, Skywatch Lancer, Bloomburst Puppet and Jade Nether Serpent',
      },
    ]),
    outfits: none(),
    story: partial([
      'The main story continues in the Simulacrum Nexus of Mengzhou.',
      'Blooms for the Shadow stays as permanent content.',
    ]),
    events: partial(['Gifts of Singing Drizzle, 22 October to 11 November: ten Radiant Tides to claim.']),
    qol: complete([
      'Replay main quests.',
      'Unlevelled, unequipped Echoes with the same type, set and main stat stack, up to 999.',
      'Expanded camera tools.',
      'Twenty team slots.',
      'Echo recommendations account for Resonators with two Resonance Modes.',
      'Download quality options start as a limited test.',
    ]),
    sources: [
      {
        label: 'Noisy Pixel 3.7 overview',
        url: 'https://noisypixel.net/wuthering-waves-version-3-7-hsin-suoming-main-quest-replay/',
      },
      { label: 'Official 3.7 broadcast', url: 'https://www.youtube.com/watch?v=nMa_e5ChL6w' },
    ],
    reviewed: '2026-11-05',
  },
  {
    id: 'nte-1.5',
    game: 'nte',
    version: '1.5',
    title: 'Once Upon a Glitched Call',
    revision: 1,
    status: 'announced',
    release: '2026-11-11',
    ends: '2026-12-23',
    summary: 'Elyms and Exe join, the city gets logistics runs and tank battles, and auto-drive learns to roam.',
    artwork: { src: nteArtwork, alt: 'NTE Version 1.5 preview artwork, Once Upon a Glitched Call' },
    stream: { aired: '2026-10-28T11:30:00Z', replay: 'https://www.youtube.com/watch?v=UxT6b7h5Mcc' },
    characters: partial([
      { name: 'Elyms', rank: 'S', traits: ['Cosmos', 'Support'] },
      { name: 'Exe', rank: 'S', traits: ['Chaos', 'Main DPS'], note: 'Phase 2' },
      { name: 'Shinku', rank: 'S', traits: [], rerun: true },
    ]),
    weapons: partial([{ name: 'Signature Arcs for Elyms and Exe', detail: 'Arc Research Program' }]),
    gear: complete([]),
    outfits: partial([{ name: 'Elyms and Exe outfits' }, { name: 'New accessories, gliders and liveries' }]),
    story: partial(['A new main story episode, Meet Me in the Data Stream.']),
    events: partial([
      'City Logistics deliveries.',
      'Full Tank Ahead tank battles.',
      'Two new vehicles: Iron Ogre and Prototype Land Overland 001.',
    ]),
    qol: partial([
      'Auto-drive can roam freely without a destination.',
      'City Stamina and Character Pixels overflow into storage instead of being lost.',
      'A clearer resource overview.',
      'Shadow-n-Seek fills slow matches with AI opponents and shuffles object locations.',
    ]),
    sources: [
      {
        label: 'Inven Global livestream recap',
        url: 'https://www.invenglobal.com/articles/27824/tanks-take-the-field-in-neverness-to-everness-version-15-livestream-recap-featuring-elyms-and-exe',
      },
      { label: 'Techtroduce', url: 'https://www.techtroduce.com/neverness-to-everness-version-1-5-november-11' },
    ],
    reviewed: '2026-11-05',
  },
  {
    id: 'nte-1.4',
    game: 'nte',
    version: '1.4',
    title: 'For Whom the Verses Mourn',
    revision: 1,
    status: 'released',
    release: '2026-09-30',
    ends: '2026-11-11',
    summary: 'Blackbird and Akane Rin join, Pukaland opens, and the Porsche collaboration returns with the 918 Spyder.',
    characters: complete([
      { name: 'Blackbird', rank: 'S', traits: [] },
      { name: 'Akane Rin', rank: 'S', traits: [], note: 'From 21 October' },
      { name: 'Lacrimosa', rank: 'S', traits: [], rerun: true },
    ]),
    weapons: partial([
      { name: 'Crime and Punishment', detail: 'Roostfeather Special' },
      { name: 'Far Side of the Moon', detail: 'Celestial Special · from 21 October' },
      { name: 'The Last Rose', detail: 'Nocturne Special · Lacrimosa’s, rerun' },
    ]),
    gear: complete([]),
    outfits: partial([{ name: 'Four Akane Rin outfits', detail: 'Available at her release' }]),
    story: partial(['A new main story chapter.', 'A new location, Pukaland.']),
    events: partial(['The Porsche collaboration’s second part, with the 918 Spyder.', 'New Anomaly Commissions.']),
    qol: partial(['Linko’s Awakening effect and Ultimate cooldown display are fixed.']),
    sources: [
      {
        label: 'Official 1.4 patch notes',
        url: 'https://nte.perfectworld.com/en/article/news/gamenews/20260929/264409.html',
      },
      {
        label: 'Sportskeeda 1.4 patch notes',
        url: 'https://www.sportskeeda.com/esports/nte-1-4-patch-notes-pukaland-new-characters-porsche-collab-part-2-neverness-everness',
      },
    ],
    reviewed: '2026-11-05',
  },
];

export function digestsForGame(presetKey: string | undefined): VersionDigest[] {
  return presetKey ? VERSION_DIGESTS.filter((digest) => digest.game === presetKey) : [];
}

export function unreadDigests(digests: VersionDigest[], seen: readonly string[] | undefined): VersionDigest[] {
  const read = new Set(seen ?? []);
  return digests.filter((digest) => !read.has(digestKey(digest)));
}
