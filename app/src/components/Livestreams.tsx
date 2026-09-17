import { presetForGame } from '@memoria/shared';
import { LIVESTREAMS, type LivestreamRecap } from '../data/livestreams';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { LivestreamCodes } from './LivestreamCodes';

function Recap({ recap }: { recap: LivestreamRecap }) {
  return (
    <article
      aria-labelledby={recap.id}
      className="grid gap-5 border-t border-line py-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-8"
    >
      <figure className="min-w-0">
        <a
          href={recap.replay}
          target="_blank"
          rel="noreferrer"
          aria-label={`Watch ${recap.gameName} ${recap.version} official ${recap.preview ? 'broadcast' : 'replay'}`}
          className="block rounded-ui-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          <img
            src={recap.image}
            alt={recap.imageAlt}
            width={1280}
            height={720}
            loading="lazy"
            className="aspect-video w-full rounded-ui-lg object-contain bg-inset"
          />
        </a>
        <figcaption className="mt-2 text-caption text-muted">Official broadcast artwork · {recap.publisher}</figcaption>
      </figure>
      <div className="min-w-0">
        <p className="text-meta text-muted">
          {recap.gameName} · Version {recap.version}
        </p>
        <h2 id={recap.id} className="mt-1 text-heading font-semibold text-fg">
          {recap.title}
        </h2>
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
  const games = useApp((state) => state.state.games);
  const focusedId = useUI((state) => state.focusedGameId);
  const focused = games.find((game) => game.id === focusedId && !game.deleted);
  const preset = focused ? presetForGame(focused)?.key : undefined;
  const recaps = focused ? LIVESTREAMS.filter((recap) => recap.game === preset) : LIVESTREAMS;
  return (
    <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6" aria-labelledby="livestream-heading">
      <h1 id="livestream-heading" className="text-heading font-semibold text-fg">
        Livestreams
      </h1>
      <p className="mt-2 max-w-prose text-body text-muted">
        What was announced, with official replays and artwork. Dated events stay in the Timeline.
      </p>
      <p className="mt-2 text-caption text-muted">
        Recaps checked 17 September 2026 · Bundled summaries, updated with Memoria.
      </p>
      <div className="mt-6">
        {recaps.map((recap) => (
          <Recap key={recap.id} recap={recap} />
        ))}
        {recaps.length === 0 && (
          <div className="border-t border-line py-8">
            <p className="text-body text-muted">No livestream recap for {focused?.name} yet.</p>
            <button
              type="button"
              onClick={() => useUI.getState().setFocusedGameId(null)}
              className="mt-3 min-h-11 text-body text-accent-fg underline underline-offset-4"
            >
              Show all livestreams
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
