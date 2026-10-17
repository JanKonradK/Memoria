import genshinArtwork from '../assets/livestreams/genshin-7.1.jpg';
import nteArtwork from '../assets/livestreams/nte-1.4.jpg';
import wuwaArtwork from '../assets/livestreams/wuwa-3.7.jpg';
import hsrArtwork from '../assets/livestreams/hsr-4.6.jpg';

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

/** Newest broadcasts first. See docs/game-news-review-2026-10-03.md.
 * This editorial feed does not modify the player's events or create alerts.
 */
export const LIVESTREAMS: LivestreamRecap[] = [
  {
    id: 'hsr-4.6',
    game: 'hsr',
    gameName: 'Honkai: Star Rail',
    version: '4.6',
    title: 'Dance With the Beast Before Moonrise',
    broadcast: '2026-09-20T11:30:00Z',
    broadcastLabel: '20 September 2026 · 11:30 UTC / 12:30 UK',
    releaseLabel: '28 September 2026',
    replay: 'https://www.youtube.com/watch?v=drFgtruoPe8',
    image: hsrArtwork,
    imageAlt: 'Honkai: Star Rail Version 4.6 artwork',
    highlights: [
      'Pearl joins as a five-star Ice character on the Path of Elation. Her character and Light Cone banners run throughout Version 4.6.',
      'Evanescia returns in the first half; Mortenax Blade returns in the second half.',
      'New workshop and combat events, Astral Imagea companions, and outfits for Hyacine and Evanescia are coming.',
    ],
    note: 'Pearl and her Light Cone close November 10 at 15:00; Evanescia closes October 21 at 11:59.',
    redemption: {
      expiresAt: Date.parse('2026-09-21T23:59:00+08:00'),
      expiryLabel: '21 September 2026, 23:59 (UTC+8)',
      instructions: 'Redeem each code, pick your server, then claim the reward from in-game mail.',
      codes: ['KA5SV3FJM7WX', '7S4AD2X35NE3', 'MALSV2F247FP'].map((code) => ({
        code,
        rewards: 'Special Program gift',
        redeemUrl: `https://hsr.hoyoverse.com/gift?code=${code}`,
      })),
    },
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
  {
    id: 'nte-1.4',
    game: 'nte',
    gameName: 'Neverness to Everness',
    version: '1.4',
    title: 'For Whom the Verses Mourn',
    broadcast: '2026-09-16',
    broadcastLabel: '16 September 2026',
    releaseLabel: '30 September 2026',
    replay: 'https://www.youtube.com/watch?v=zrDTlGF6Pg8',
    image: nteArtwork,
    imageAlt: 'NTE 1.4 preview artwork with Blackbird and Akane Rin',
    redemption: {
      expiresAt: Date.parse('2026-09-20T23:59:00+08:00'),
      expiryLabel: '20 September 2026, 23:59 (UTC+8)',
      instructions: 'In game: Menu → ⋯ → Redeem Code. Rewards arrive in in-game mail.',
      codes: [
        { code: 'WITCHHOUSE', rewards: '100 Annulith + Hunter Guides, dye and Beetle Coins' },
        { code: 'THEWHOOTS', rewards: '100 Annulith + Hunter Guides, dye and Beetle Coins' },
        { code: 'PUKALANDGOGO', rewards: '100 Annulith + Hunter Guides, dye and Beetle Coins' },
      ],
    },
    highlights: [
      'New Espers: Blackbird and Akane Rin.',
      'Explore Pukaland and St. Arbor, with the new main episode The Witch and spinoff To Us, Back Then.',
      'Pukaland Travelogue starts on 30 September. Multiplayer Volley Star and one-tap Bond gifting are also coming.',
    ],
  },
  {
    id: 'genshin-7.1',
    game: 'genshin',
    gameName: 'Genshin Impact',
    version: '7.1',
    title: 'A Rekviem for the Underworld',
    broadcast: '2026-09-12',
    broadcastLabel: '12 September 2026',
    releaseLabel: '23 September 2026',
    replay: 'https://www.youtube.com/watch?v=fSwBYIeAieo',
    image: genshinArtwork,
    imageAlt: 'Genshin Impact Version 7.1 artwork',
    redemption: {
      expiresAt: Date.parse('2026-09-15T12:00:00+08:00'),
      expiryLabel: '15 September 2026, 12:00 (UTC+8)',
      instructions:
        'Redeem on the web or in game: Paimon Menu → Settings → Account → Redeem Code. Needs AR 10. Rewards arrive in in-game mail.',
      codes: [
        {
          code: 'Rekviem',
          rewards: '100 Primogems + 10 Mystic Enhancement Ore',
          redeemUrl: 'https://genshin.hoyoverse.com/en/gift?code=Rekviem',
        },
        {
          code: 'Vesna0923',
          rewards: '100 Primogems + 5 Hero’s Wit',
          redeemUrl: 'https://genshin.hoyoverse.com/en/gift?code=Vesna0923',
        },
        {
          code: 'PrimaDonna',
          rewards: '100 Primogems + 50,000 Mora',
          redeemUrl: 'https://genshin.hoyoverse.com/en/gift?code=PrimaDonna',
        },
      ],
    },
    highlights: [
      'Vesna and Vodyanitsa debut. Skirk and Escoffier return in the second phase.',
      'A new Snezhnaya Archon Quest and weekly boss continue the story.',
      'Moonchase Festival returns, alongside sixth-anniversary character selections and login rewards.',
    ],
  },
];
