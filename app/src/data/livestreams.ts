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

/** Upcoming broadcasts first, then newest recaps. See the September 17 source audits.
 * This editorial feed does not modify the player's events or create alerts.
 */
export const LIVESTREAMS: LivestreamRecap[] = [
  {
    id: 'wuwa-3.7',
    game: 'wuwa',
    gameName: 'Wuthering Waves',
    version: '3.7',
    title: 'Version 3.7 Preview Special Broadcast',
    preview: true,
    broadcast: '2026-09-19T11:00:00Z',
    broadcastLabel: '19 September 2026 · 11:00 UTC / 12:00 UK',
    releaseLabel: 'Schedule awaits the broadcast',
    replay: 'https://www.youtube.com/watch?v=nMa_e5ChL6w',
    image: wuwaArtwork,
    imageAlt: 'Wuthering Waves Version 3.7 official special broadcast artwork',
    publisher: 'Kuro Games',
    highlights: [
      'The official broadcast is scheduled for 19 September at 19:00 (UTC+8).',
      'New content and reward codes will be added after they are announced and checked.',
    ],
    sources: [{ label: 'Official Twitch channel', url: 'https://www.twitch.tv/wuthering_waves' }],
  },
  {
    id: 'hsr-4.6',
    game: 'hsr',
    gameName: 'Honkai: Star Rail',
    version: '4.6',
    title: 'Dance With the Beast Before Moonrise',
    preview: true,
    broadcast: '2026-09-20T11:30:00Z',
    broadcastLabel: '20 September 2026 · 11:30 UTC / 12:30 UK',
    releaseLabel: 'Schedule awaits the broadcast',
    replay: 'https://www.youtube.com/watch?v=drFgtruoPe8',
    image: hsrArtwork,
    imageAlt: 'Honkai: Star Rail Version 4.6 official special program artwork',
    publisher: 'HoYoverse',
    highlights: [
      'The official program is scheduled for 20 September at 19:30 (UTC+8).',
      'The program will introduce Pearl. The recap and codes will be added after the broadcast is checked.',
    ],
    sources: [],
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
