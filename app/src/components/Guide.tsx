import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useReducedMotion } from '../hooks';
import { useUI } from '../ui-store';
import { NightMark } from './NightMark';
import { Tick } from './primitives';
import { Sheet } from './Sheet';
import { Btn } from './ui';
import '../guide.css';

/** Sample games for the demos: a colour and a letter, nothing real. */
const GAMES = {
  amber: { ink: '#f0a63a', letter: 'C' },
  rose: { ink: '#e8506a', letter: 'N' },
  sky: { ink: '#5aa9f0', letter: 'S' },
} as const;
type Sample = keyof typeof GAMES;

/** A beat that repeats while the card is open; still under reduced motion. */
function useBeat(ms: number, steps: number): number {
  const reduced = useReducedMotion();
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setBeat((current) => (current + 1) % steps), ms);
    return () => clearInterval(timer);
  }, [ms, steps, reduced]);
  return reduced ? steps - 1 : beat;
}

function Coin({ game, size = 32 }: { game: Sample; size?: number }) {
  const { ink, letter } = GAMES[game];
  return (
    <span className="guide-coin" style={{ '--ink': ink, width: size, height: size } as CSSProperties} aria-hidden>
      {letter}
    </span>
  );
}

function Meter({ value, ink, full = false }: { value: number; ink: string; full?: boolean }) {
  return (
    <span className="guide-meter" data-full={full || undefined} aria-hidden>
      <i style={{ transform: `scaleX(${value})`, background: ink }} />
    </span>
  );
}

/** Today: soonest first, and a tick sends the row to the done pile. */
function TodayDemo() {
  const beat = useBeat(1600, 3);
  const rows: { game: Sample; name: string; left: string }[] = [
    { game: 'amber', name: 'Daily Missions', left: '2h' },
    { game: 'rose', name: 'Outpost Defense', left: '5h' },
    { game: 'sky', name: 'Weekly Bosses', left: '1d' },
  ];
  return (
    <ul className="guide-today">
      {rows.map((row, index) => {
        const done = index === 0 && beat > 0;
        return (
          <li key={row.name} data-done={done || undefined}>
            <Coin game={row.game} />
            <span className="guide-today-name">{row.name}</span>
            <b className="numeral" data-soon={index === 0 || undefined}>
              {done ? 'Done' : row.left}
            </b>
            <Tick checked={done} color={GAMES[row.game].ink} className="guide-tick" />
          </li>
        );
      })}
    </ul>
  );
}

/** A bar: type what the game shows, it counts on, and its reserve fills once it is full. */
function BarDemo() {
  const beat = useBeat(700, 8);
  const value = Math.min(200, 186 + beat * 2);
  const full = value >= 200;
  const reserve = full ? (beat - 6) * 0.18 + 0.1 : 0;
  return (
    <div className="guide-bar">
      <span className="guide-bar-name">Original Resin</span>
      <span className="guide-pill numeral" data-full={full || undefined}>
        <b>{value}</b> / 200
      </span>
      <Meter value={value / 200} ink={GAMES.amber.ink} full={full} />
      <span className="guide-bar-reserve">
        <Meter value={reserve} ink="#9b8cf0" />
        <span className="numeral">{Math.round(reserve * 2400)}</span>
      </span>
    </div>
  );
}

/** The rail: each game's next deadline and its two meters. */
function RailDemo() {
  const beat = useBeat(1200, 4);
  const games: { game: Sample; left: string; bar: number; bank: number; tone?: string }[] = [
    { game: 'amber', left: '2h', bar: 0.82, bank: 0.3, tone: 'warn' },
    { game: 'rose', left: '45m', bar: 0.97, bank: 0.6, tone: 'rose' },
    { game: 'sky', left: '9h', bar: 0.4, bank: 0 },
  ];
  return (
    <div className="guide-rail">
      {games.map((item, index) => (
        <span key={item.game} className="guide-rail-game" data-current={index === beat % 3 || undefined}>
          <Coin game={item.game} size={36} />
          <span className="guide-rail-meters">
            <Meter value={item.bar} ink={GAMES[item.game].ink} />
            {item.bank > 0 && <Meter value={item.bank} ink="#9b8cf0" />}
          </span>
          <b className="numeral" data-tone={item.tone}>
            {item.left}
          </b>
        </span>
      ))}
    </div>
  );
}

/** Ends overnight: the bar stops at the midnight before, with a crescent. */
function NightDemo() {
  const days = ['Mon', 'Tue', 'Wed'];
  return (
    <div className="guide-night">
      <div className="guide-night-days">
        {days.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="guide-night-track">
        <span className="guide-night-bar" style={{ '--ink': GAMES.sky.ink } as CSSProperties}>
          <span>Event</span>
          <span className="numeral">
            <NightMark at={0} tz="UTC" />
            04:00
          </span>
        </span>
        <span className="guide-night-ghost" aria-hidden />
      </div>
    </div>
  );
}

const CARDS: { title: string; line: string; demo: () => ReactNode }[] = [
  { title: 'Today', line: 'Soonest first. Tick it when it’s done.', demo: TodayDemo },
  { title: 'Bars', line: 'Type what your game shows. Memoria counts on.', demo: BarDemo },
  { title: 'Your games', line: 'Next deadline, bar and reserve at a glance.', demo: RailDemo },
  { title: 'Overnight', line: 'Ends while you sleep? The night before is the last day.', demo: NightDemo },
];

/**
 * The guide: four cards, each a working miniature of the thing it is about
 * and one line under it. Opened after setup and from Settings, never in the
 * middle of the app.
 */
export function Guide({ open }: { open: boolean }) {
  const closeSheet = useUI((s) => s.closeSheet);
  const [at, setAt] = useState(0);
  const card = CARDS[at]!;
  const Demo = card.demo;
  const last = at === CARDS.length - 1;
  return (
    <Sheet
      open={open}
      onClose={closeSheet}
      title="Guide"
      hideTitle
      footer={
        <div className="guide-foot">
          <div className="guide-dots" role="tablist" aria-label="Guide cards">
            {CARDS.map((item, index) => (
              <button
                key={item.title}
                type="button"
                role="tab"
                aria-selected={index === at}
                aria-label={item.title}
                className="guide-dot"
                onClick={() => setAt(index)}
              />
            ))}
          </div>
          {at > 0 && <Btn onClick={() => setAt(at - 1)}>Back</Btn>}
          <Btn kind="primary" onClick={() => (last ? closeSheet() : setAt(at + 1))}>
            {last ? 'Done' : 'Next'}
          </Btn>
        </div>
      }
    >
      <section className="guide-card" aria-live="polite" aria-labelledby="guide-card-title">
        <div className="guide-stage" key={at}>
          <Demo />
        </div>
        <h2 id="guide-card-title" className="guide-title">
          {card.title}
        </h2>
        <p className="guide-line">{card.line}</p>
      </section>
    </Sheet>
  );
}
