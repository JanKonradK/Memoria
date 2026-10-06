import genshinArtwork from '../assets/livestreams/genshin-7.1.jpg';
import nteArtwork from '../assets/livestreams/nte-1.4.jpg';
import wuwaArtwork from '../assets/livestreams/wuwa-3.7.jpg';
import hsrArtwork from '../assets/livestreams/hsr-4.6.jpg';

export interface LivestreamCodes {
  expiresAt?: number;
  expiryLabel?: string;
  instructions: string;
  source: { label: string; url: string };
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
  publisher: string;
  highlights: string[];
  redemption?: LivestreamCodes;
  note?: string;
  sources: { label: string; url: string }[];
}

export const LIVESTREAMS_CHECKED = '3 October 2026';

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
    imageAlt: 'Honkai: Star Rail Version 4.6 official special program artwork',
    publisher: 'HoYoverse',
    highlights: [
      'Pearl joins as a five-star Ice character on the Path of Elation. Her character and Light Cone banners run throughout Version 4.6.',
      'Evanescia returns in the first half; Mortenax Blade returns in the second half.',
      'New workshop and combat events, Astral Imagea companions, and outfits for Hyacine and Evanescia are coming.',
    ],
    note: 'Version 4.6 is live. Pearl and her Light Cone close November 10 at 15:00 server time; Evanescia closes October 21 at 11:59. Verified event deadlines are in Timeline.',
    redemption: {
      expiresAt: Date.parse('2026-09-21T23:59:00+08:00'),
      expiryLabel: '21 September 2026, 23:59 (UTC+8)',
      instructions:
        'Open the official redemption page for each code. Select your server, redeem the code, then claim the reward from your in-game mail.',
      source: {
        label: 'Official code announcement',
        url: 'https://www.reddit.com/r/HonkaiStarRail/comments/1wlfz4a/a_brief_on_the_version_46_special_program/',
      },
      codes: ['KA5SV3FJM7WX', '7S4AD2X35NE3', 'MALSV2F247FP'].map((code) => ({
        code,
        rewards: 'Special Program gift',
        redeemUrl: `https://hsr.hoyoverse.com/gift?code=${code}`,
      })),
    },
    sources: [
      {
        label: 'Official update and event notices',
        url: 'https://sg-hkrpg-api.hoyoverse.com/common/hkrpg_global/announcement/api/getAnnContent?game=hkrpg&game_biz=hkrpg_global&lang=en&bundle_id=hkrpg_global&platform=pc&region=prod_official_eur&level=70',
      },
      {
        label: 'Publisher overview via Gematsu',
        url: 'https://www.gematsu.com/2026/09/honkai-star-rail-version-4-6-update-dance-with-the-beast-before-moonrise-launches-september-28',
      },
    ],
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
    imageAlt: 'Wuthering Waves Version 3.7 official special broadcast artwork',
    publisher: 'Kuro Games',
    highlights: [
      'Hsin and Suoming arrive with new weapons, Blooming Jadehaven and Unspoken Rue.',
      'Continue the main story in the Simulacrum Nexus of Mengzhou. Blooms for the Shadow is permanent content.',
      'Gifts of Singing Drizzle runs from 22 October at 10:00 to 11 November at 03:59, server time, with ten Radiant Tides to claim.',
      'Main quest replay, Echo stacking, camera tools and twenty team slots are coming. Download quality options start as a limited test.',
    ],
    note: 'Version 3.7 is live. Chisa and Iuno reruns close October 22 at 09:59 server time. The dated patch notes now supply the event windows in Timeline. Reward codes remain unverified.',
    sources: [
      {
        label: 'Official version preview',
        url: 'https://wutheringwaves.kurogames.com/en/main/news/detail/5454',
      },
      {
        label: 'Official 3.7 patch notes',
        url: 'https://wutheringwaves.kurogames.com/en/main/news/detail/5571',
      },
    ],
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
    publisher: 'Hotta Studio / Perfect World Games',
    redemption: {
      expiresAt: Date.parse('2026-09-20T23:59:00+08:00'),
      expiryLabel: '20 September 2026, 23:59 (UTC+8)',
      instructions:
        'In NTE: open Menu → ⋯ → Redeem Code. Paste each code, then claim the rewards from your in-game mail. No verified web redemption link is available.',
      source: { label: 'Broadcast codes and expiry', url: 'https://www.ntebuild.com/news/nte-1-4-livestream-summary' },
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
    sources: [
      {
        label: 'Publisher overview via Gematsu',
        url: 'https://www.gematsu.com/2026/09/neverness-to-everness-version-1-4-update-for-whom-the-verses-mourn-launches-september-30',
      },
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
    imageAlt: 'Genshin Impact Version 7.1 Special Program artwork',
    publisher: 'HoYoverse',
    redemption: {
      expiresAt: Date.parse('2026-09-15T12:00:00+08:00'),
      expiryLabel: '15 September 2026, 12:00 (UTC+8)',
      instructions:
        'Use the official redemption page, or open Paimon Menu → Settings → Account → Redeem Code. Requires Adventure Rank 10. Rewards arrive in your in-game mail.',
      source: {
        label: 'Official code announcement',
        url: 'https://www.reddit.com/r/Genshin_Impact/comments/1wectrl/genshin_impact_version_71_special_program_recap/',
      },
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
    sources: [
      {
        label: 'Publisher overview via Gematsu',
        url: 'https://www.gematsu.com/2026/09/genshin-impact-version-version-7-1-update-a-rekviem-for-the-underworld-launches-september-23',
      },
    ],
  },
];
