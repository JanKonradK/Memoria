import { presetForGame } from './presets';
import type { Game, GameEvent } from './types';

/** Each game's premium currency, the one pulls are bought with. */
export const PULL_CURRENCY: Record<string, string> = {
  genshin: 'Primogems',
  hsr: 'Stellar Jade',
  zzz: 'Polychromes',
  wuwa: 'Astrite',
  lads: 'Diamonds',
  uma: 'Carats',
  nikke: 'Gems',
  endfield: 'Oroberyl',
};

const AMOUNT =
  /(\d{1,3}(?:,\d{3})+|\d+)\s+(Primogems|Stellar Jade|Polychromes|Astrite|Diamonds|Carats|Gems|Oroberyl)\b/i;

export interface EventReward {
  amount: number;
  currency: string;
  /** "420 Primogems". */
  label: string;
}

/**
 * What an event pays, when known: the feed's `reward`, or failing that an
 * amount of the game's currency stated in its notes. A 40-Primogem web event
 * and a 1,600-Primogem flagship must not look the same.
 */
export function eventReward(event: Pick<GameEvent, 'reward' | 'notes'>, game?: Game): EventReward | null {
  const key = game ? (game.presetKey ?? presetForGame(game)?.key) : undefined;
  if (event.reward) {
    const currency = (key && PULL_CURRENCY[key]) || 'currency';
    return { amount: event.reward, currency, label: `${event.reward.toLocaleString('en-US')} ${currency}` };
  }
  const match = AMOUNT.exec(event.notes ?? '');
  if (!match) return null;
  const amount = Number(match[1]!.replace(/,/g, ''));
  return amount > 0 ? { amount, currency: match[2]!, label: `${amount.toLocaleString('en-US')} ${match[2]}` } : null;
}
