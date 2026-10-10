import { useState, type ReactNode } from 'react';
import { detectLocalTz, missingPresetTasks } from '@memoria/shared';
import { useApp } from '../store';
import { utcOffsetLabel } from '../timezone';

const PRESET_GAP_KEY = 'memoria-preset-gap-dismissed';
/** The key this counter shipped under before the rename. */
const LEGACY_PRESET_GAP_KEY = 'void-preset-gap-dismissed';
const LEGACY_HOME_TZ_KEY = 'memoria-legacy-home-timezone-dismissed';

function readDismissedGap(): number {
  return Number(localStorage.getItem(PRESET_GAP_KEY) ?? localStorage.getItem(LEGACY_PRESET_GAP_KEY) ?? '0');
}

function readLegacyHomeTzDismissed(): boolean {
  return localStorage.getItem(LEGACY_HOME_TZ_KEY) === '1';
}

/**
 * A dismissible line across the top of Today: something the app noticed, the
 * one thing to do about it, and a way to say "not now".
 *
 * Both notices are the same object — a sentence, a verb and an ✕ — so they are
 * one component rather than two copies that can drift a padding apart.
 */
function Notice({
  label,
  title,
  detail,
  action,
  onAction,
  dismissLabel,
  onDismiss,
}: {
  /** Names the region for assistive tech; the visible title is the heading line. */
  label: string;
  title: ReactNode;
  detail: ReactNode;
  action: string;
  onAction: () => void;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  return (
    <section className="panel grain mb-3 rounded-ui-card p-3" aria-label={label}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-fg">{title}</p>
          <p className="mt-0.5 text-meta text-muted">{detail}</p>
        </div>
        <button
          type="button"
          onClick={onAction}
          className="min-h-11 shrink-0 rounded-ui-md border border-line-strong bg-inset px-3 py-1 text-meta font-medium text-fg transition-colors hover:border-line-strong hover:bg-surface-2"
        >
          {action}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ui-md text-muted transition-colors hover:text-fg"
          aria-label={dismissLabel}
        >
          ✕
        </button>
      </div>
    </section>
  );
}

export function TodayNotices({ now }: { now: number }) {
  const state = useApp((s) => s.state);
  const addMissingPresetTasksEverywhere = useApp((s) => s.addMissingPresetTasksEverywhere);
  const updateSettings = useApp((s) => s.updateSettings);

  // Presets only apply when a game is ADDED, so a preset that grows later is
  // invisible to everyone already tracking that game — which is exactly the case
  // where the new routines matter. The banner is dismissed against the COUNT, so
  // it comes back when a later update adds more.
  const presetShortfalls = state.games
    .filter((game) => !game.deleted)
    .map(
      (game) =>
        missingPresetTasks(
          game,
          state.tasks.filter((task) => task.gameId === game.id),
        ).length,
    );
  const presetGap = presetShortfalls.reduce((sum, count) => sum + count, 0);
  const presetGamesBehind = presetShortfalls.filter((count) => count > 0).length;
  const [dismissedGap, setDismissedGap] = useState(readDismissedGap);
  const presetGapDismissed = dismissedGap >= presetGap;
  const detectedTz = detectLocalTz();
  const [legacyHomeTzDismissed, setLegacyHomeTzDismissed] = useState(readLegacyHomeTzDismissed);
  const showLegacyHomeTz =
    !legacyHomeTzDismissed && state.settings.localTz === 'Europe/Warsaw' && detectedTz !== 'Europe/Warsaw';
  const showPresetGap = presetGap > 0 && !presetGapDismissed;

  if (!showLegacyHomeTz && !showPresetGap) return null;

  return (
    <div className="today-notices">
      {showLegacyHomeTz && (
        <Notice
          label="Home timezone correction"
          title="Check your home timezone"
          detail={
            <>
              Memoria is set to Europe/Warsaw ({utcOffsetLabel('Europe/Warsaw', now)}). This system reports {detectedTz}{' '}
              ({utcOffsetLabel(detectedTz, now)}).
            </>
          }
          action={`Switch to ${detectedTz}`}
          onAction={() => updateSettings({ localTz: detectedTz })}
          dismissLabel="Dismiss home timezone correction"
          onDismiss={() => {
            localStorage.setItem(LEGACY_HOME_TZ_KEY, '1');
            setLegacyHomeTzDismissed(true);
          }}
        />
      )}

      {showPresetGap && (
        <Notice
          label="New preset routines"
          title={`${presetGap} new ${presetGap === 1 ? 'routine' : 'routines'} for ${presetGamesBehind} ${
            presetGamesBehind === 1 ? 'game' : 'games'
          }`}
          detail="Presets gained dailies and weeklies since these games were added. Nothing you deleted comes back."
          action="Add them"
          onAction={() => addMissingPresetTasksEverywhere()}
          dismissLabel="Dismiss new routines"
          onDismiss={() => {
            localStorage.setItem(PRESET_GAP_KEY, String(presetGap));
            setDismissedGap(presetGap);
          }}
        />
      )}
    </div>
  );
}
