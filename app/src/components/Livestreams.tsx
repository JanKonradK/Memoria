import { presetForGame } from '@memoria/shared';
import { DateTime } from 'luxon';
import { LIVESTREAMS, LIVESTREAMS_CHECKED, type LivestreamRecap } from '../data/livestreams';
import { SEED_UPDATED } from '../data/seed-feed';
import { upcomingBroadcasts } from '../data/upcoming-broadcasts';
import { useNow } from '../hooks';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { LivestreamCodes } from './LivestreamCodes';
import { Btn } from './ui';
import { Pill } from './primitives';

function Recap({ recap }: { recap: LivestreamRecap }) {
  return (
    <article
      aria-labelledby={recap.id}
      className="broadcast-story grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-8"
    >
      <figure className="min-w-0">
        <a
          href={recap.replay}
          target="_blank"
          rel="noreferrer"
          aria-label={`Watch ${recap.gameName} ${recap.version} official ${recap.preview ? 'broadcast' : 'replay'}`}
          className="block rounded-ui-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          <img
            src={recap.image}
            alt={recap.imageAlt}
            width={1280}
            height={720}
            loading="lazy"
            className="aspect-video w-full rounded-ui-md object-contain bg-inset"
          />
        </a>
        <figcaption className="mt-2 text-caption text-muted">Official broadcast artwork · {recap.publisher}</figcaption>
      </figure>
      <div className="min-w-0">
        <p className="text-meta text-muted">
          {recap.gameName} · Version {recap.version}
        </p>
        <h3 id={recap.id} className="mt-1 text-heading font-semibold text-fg">
          {recap.title}
        </h3>
        <p className="mt-2 text-meta text-muted">
          Broadcast <time dateTime={recap.broadcast}>{recap.broadcastLabel}</time>
          {!recap.preview && <> · Update {recap.releaseLabel}</>}
        </p>
        <ul className="mt-4 space-y-2 pl-4 text-body leading-relaxed text-fg-soft list-disc">
          {recap.highlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
        </ul>
        {recap.note && <p className="mt-4 text-meta text-muted">{recap.note}</p>}
        {recap.redemption && (
          <LivestreamCodes redemption={recap.redemption} gameName={`${recap.gameName} ${recap.version}`} />
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-meta">
          <a
            href={recap.replay}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center font-medium text-accent-fg underline underline-offset-4"
          >
            {recap.preview ? 'Open official broadcast ↗' : 'Watch official replay ↗'}
          </a>
          {recap.sources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center text-muted underline underline-offset-4 hover:text-fg"
            >
              {source.label} ↗
            </a>
          ))}
        </div>
      </div>
    </article>
  );
}

export function LivestreamsPage() {
  const state = useApp((store) => store.state);
  const games = state.games;
  const now = useNow(30_000);
  const focusedId = useUI((state) => state.focusedGameId);
  const focused = games.find((game) => game.id === focusedId && !game.deleted);
  const preset = focused ? presetForGame(focused)?.key : undefined;
  const recaps = focused ? LIVESTREAMS.filter((recap) => recap.game === preset) : LIVESTREAMS;
  const broadcasts = upcomingBroadcasts(state, now).filter((broadcast) => !focused || broadcast.gameId === focused.id);
  const dateLabel = (at: number) =>
    DateTime.fromMillis(at, { zone: state.settings.localTz }).toFormat('ccc d LLL yyyy · HH:mm');
  return (
    <section className="app-page mx-auto max-w-6xl px-4 py-6 sm:px-6" aria-labelledby="livestream-heading">
      <h1 id="livestream-heading" className="text-heading font-semibold text-fg">
        Livestreams
      </h1>
      <p className="mt-2 max-w-prose text-body text-muted">
        What was announced, with official replays and artwork. Dated events stay in the Timeline.
      </p>
      <p className="mt-2 text-caption text-muted">
        Calendar updated {DateTime.fromISO(SEED_UPDATED).toFormat('d LLLL yyyy')} · Recaps checked {LIVESTREAMS_CHECKED}
        . Dates and summaries update with Memoria.
      </p>
      <section aria-labelledby="upcoming-broadcasts-heading" className="broadcast-story mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="upcoming-broadcasts-heading" className="text-lead font-semibold text-fg">
            Upcoming broadcasts
          </h2>
          <span className="text-caption text-muted">Times use {state.settings.localTz}</span>
        </div>
        {broadcasts.length > 0 ? (
          <ul className="mt-3 divide-y divide-line">
            {broadcasts.map((broadcast) => (
              <li key={broadcast.id} className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 py-3">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-caption text-muted">{broadcast.gameName}</p>
                  <p className="mt-1 break-words text-body font-semibold text-fg">{broadcast.name}</p>
                  <p className="mt-1 text-meta text-muted">
                    <time dateTime={new Date(broadcast.start).toISOString()}>{dateLabel(broadcast.start)}</time>
                    {broadcast.predicted && (
                      <>
                        {' '}
                        – <time dateTime={new Date(broadcast.end).toISOString()}>{dateLabel(broadcast.end)}</time>
                      </>
                    )}
                  </p>
                  {broadcast.predicted && (
                    <p className="mt-1 text-caption text-muted">
                      The publisher has not confirmed the date. This range is an estimate.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Pill variant={broadcast.predicted ? 'warn' : 'neutral'}>
                    {broadcast.predicted ? 'Date unconfirmed' : broadcast.start <= now ? 'Now' : 'Scheduled'}
                  </Pill>
                  <Btn
                    onClick={() =>
                      broadcast.eventId
                        ? useUI.getState().openSheet({ kind: 'event', eventId: broadcast.eventId })
                        : useUI.getState().openSheet({ kind: 'addGame' })
                    }
                  >
                    {broadcast.eventId ? 'Edit event' : 'Track game'}
                  </Btn>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-body text-muted">
            No upcoming broadcasts in this view{focused ? ` for ${focused.name}` : ''}.
          </p>
        )}
      </section>
      <h2 className="mt-8 text-lead font-semibold text-fg">Recent broadcasts</h2>
      <div className="mt-4">
        {recaps.map((recap) => (
          <Recap key={recap.id} recap={recap} />
        ))}
        {recaps.length === 0 && (
          <div className="broadcast-story">
            <p className="text-body text-muted">No livestream recap for {focused?.name} yet.</p>
            <Btn onClick={() => useUI.getState().setFocusedGameId(null)} className="mt-4 !min-h-11 text-meta">
              Show all livestreams
            </Btn>
          </div>
        )}
      </div>
    </section>
  );
}
