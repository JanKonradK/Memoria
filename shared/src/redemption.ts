/** Undefined or invalid deadlines must never imply that a code still works. */
export function redemptionCodeStatus(expiresAt: number | undefined, now: number): 'expired' | 'available' | 'unknown' {
  if (expiresAt === undefined || !Number.isFinite(expiresAt)) return 'unknown';
  return now >= expiresAt ? 'expired' : 'available';
}

/** Longest code Memoria keeps; matches GameCodeSchema. */
export const MAX_CODE_LENGTH = 80;

const REDEEM_PAGES: Record<string, string> = {
  genshin: 'https://genshin.hoyoverse.com/en/gift?code=',
  hsr: 'https://hsr.hoyoverse.com/gift?code=',
  zzz: 'https://zenless.hoyoverse.com/redemption?code=',
};

/** The official web page that redeems `code` directly, for games that have one. */
export function defaultRedeemUrl(presetKey: string | undefined, code: string): string | undefined {
  const trimmed = code.trim();
  const page = presetKey ? REDEEM_PAGES[presetKey] : undefined;
  return page && trimmed ? `${page}${encodeURIComponent(trimmed)}` : undefined;
}

const REDEEM_PORTALS: Record<string, string> = {
  genshin: 'https://genshin.hoyoverse.com/en/gift',
  hsr: 'https://hsr.hoyoverse.com/gift',
  zzz: 'https://zenless.hoyoverse.com/redemption',
};

/** The official web redemption page itself, for games that have one. */
export function redeemPortalUrl(presetKey: string | undefined): string | undefined {
  return presetKey ? REDEEM_PORTALS[presetKey] : undefined;
}

const REDEEM_STEPS: Record<string, string> = {
  genshin:
    'Open the redemption link and sign in, or in game open Paimon Menu, Settings, Account, Redeem Code. Needs Adventure Rank 10; rewards arrive by in-game mail.',
  hsr: 'Open the redemption link and sign in, or in game open the Phone menu, the ··· button, Redemption Code. Rewards arrive by in-game mail.',
  zzz: 'Open the redemption link and sign in, or in game open the Phone menu, More, Redemption Code. Rewards arrive by in-game mail.',
  wuwa: 'In game open the Terminal, Settings, Other Settings, Redemption Code, then paste the code. Rewards arrive by in-game mail.',
  nte: 'In game open the menu, Settings, then the redeem code option under your account. Rewards arrive by in-game mail.',
  endfield:
    'In game open the menu, Settings, then the redemption code option under your account. Rewards arrive by in-game mail.',
};

const GENERAL_STEPS =
  "Find the game's Redeem Code option, usually under Settings or Account in the main menu, then paste the code. Rewards usually arrive by in-game mail.";

/** Short steps for redeeming a code in one game; a general hint for anything else. */
export function redeemInstructionsFor(presetKey: string | undefined): string {
  return (presetKey && REDEEM_STEPS[presetKey]) || GENERAL_STEPS;
}

/** Leading and trailing characters that are never part of a code (quotes, brackets, bullets, stops). */
const EDGE_JUNK = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * Codes pasted as a list, in any shape people share them: one per line, or
 * split by commas, semicolons or spaces. Surrounding punctuation is dropped
 * while `-` and `_` inside a code stay; duplicates (any case) keep the first.
 */
export function parseCodeList(input: string): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const token of input.split(/[\s,;]+/)) {
    const code = token.replace(EDGE_JUNK, '');
    if (!code || code.length > MAX_CODE_LENGTH) continue;
    const key = code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    codes.push(code);
  }
  return codes;
}
