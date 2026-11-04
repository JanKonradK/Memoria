import genshinArtwork from '../assets/livestreams/genshin-7.2.jpg';
import nteArtwork from '../assets/livestreams/nte-1.5.jpg';
import wuwaArtwork from '../assets/livestreams/wuwa-3.7.jpg';
import hsrArtwork from '../assets/livestreams/hsr-4.7.jpg';

export interface LivestreamCodes {
  expiresAt?: number;
  expiryLabel?: string;
  instructions: string;
  codes: { code: string; rewards: string; redeemUrl?: string }[];
}

export interface LivestreamRecap {
  id: string;
  game: string;
  gameName: string;
  version: string;
  title: string;
  broadcast: string;
  broadcastLabel: string;
  preview?: boolean;
  releaseLabel: string;
  replay: string;
  image: string;
  imageAlt: string;
  highlights: string[];
  redemption?: LivestreamCodes;
  note?: string;
}

/** Newest broadcasts first. See docs/game-news-review-2026-11-03.md.
 * This editorial feed does not modify the player's events or create alerts.
 */
export const LIVESTREAMS: LivestreamRecap[] = [
  {
    id: 'hsr-4.7',
    game: 'hsr',
    gameName: 'Honkai: Star Rail',
    version: '4.7',
    title: 'Now, Lay Laughter to All Stars',
    broadcast: '2026-10-30T11:30:00Z',
    broadcastLabel: '30 October 2026 · 11:30 UTC / 11:30 UK',
    releaseLabel: '11 November 2026',
    replay: 'https://www.youtube.com/watch?v=psifFhA2QAA',
    image: hsrArtwork,
    imageAlt: 'Honkai: Star Rail Version 4.7 Special Program artwork, Aha’s Night',
    highlights: [
      'Aha joins as a five-star Quantum character on the Path of Elation, the first playable Aeon.',
      'Version 4.7 also brings a new Currency Wars season, new events and a free character selection.',
    ],
    note: 'The stream codes expired on 31 October at 23:59 (UTC+8).',
  },
  {
    id: 'nte-1.5',
    game: 'nte',
    gameName: 'Neverness to Everness',
    version: '1.5',
    title: 'Once Upon a Glitched Call',
    broadcast: '2026-10-28T11:30:00Z',
    broadcastLabel: '28 October 2026 · 11:30 UTC / 11:30 UK',
    releaseLabel: '11 November 2026',
    replay: 'https://www.youtube.com/watch?v=UxT6b7h5Mcc',
    image: nteArtwork,
    imageAlt: 'NTE Version 1.5 preview artwork, Once Upon a Glitched Call',
    highlights: [
      'New limited S-Class Espers: Elyms and Exe of ETD Team 6.',
      'New activities: City Logistics deliveries and Full Tank Ahead tank battles.',
    ],
    note: 'The stream codes expired on 1 November.',
  },
  {
    id: 'genshin-7.2',
    game: 'genshin',
    gameName: 'Genshin Impact',
    version: '7.2',
    title: 'Hour of Ruin',
    broadcast: '2026-10-23T12:00:00Z',
    broadcastLabel: '23 October 2026 · 12:00 UTC / 13:00 UK',
    releaseLabel: '4 November 2026',
    replay: 'https://www.youtube.com/watch?v=8XhQlIxJzUk',
    image: genshinArtwork,
    imageAlt: 'Genshin Impact Version 7.2 Special Program artwork, Hour of Ruin',
    redemption: {
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
    highlights: [
      'Mitya debuts as a five-star Electro character, with Furina’s rerun alongside. Valeriy is the new four-star.',
      'Archon Quest Chapter VII Acts V and VI continue the story. Novokitezhgrad and Wingspan Peak open in Snezhnaya.',
      'The Grand Defense lets you invite a four-star character of your choice.',
    ],
    note: 'Phase-one banners close on 24 November at 17:59 server time.',
  },
  {
    id: 'wuwa-3.7',
    game: 'wuwa',
    gameName: 'Wuthering Waves',
    version: '3.7',
    title: 'Prism’s Illusion, Heart’s Illumination',
    broadcast: '2026-09-19T11:00:00Z',
    broadcastLabel: '19 September 2026 · 11:00 UTC / 12:00 UK',
    releaseLabel: '30 September 2026 (UTC+8)',
    replay: 'https://www.youtube.com/watch?v=nMa_e5ChL6w',
    image: wuwaArtwork,
    imageAlt: 'Wuthering Waves Version 3.7 artwork',
    highlights: [
      'Hsin and Suoming arrive with new weapons, Blooming Jadehaven and Unspoken Rue.',
      'Continue the main story in the Simulacrum Nexus of Mengzhou. Blooms for the Shadow is permanent content.',
      'Gifts of Singing Drizzle runs from 22 October at 10:00 to 11 November at 03:59, server time, with ten Radiant Tides to claim.',
      'Main quest replay, Echo stacking, camera tools and twenty team slots are coming. Download quality options start as a limited test.',
    ],
    note: 'Chisa and Iuno reruns close October 22 at 09:59.',
  },
];
