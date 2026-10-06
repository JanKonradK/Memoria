import type { ReactNode } from 'react';
import {
  effectiveCountTarget,
  effectiveTaskMode,
  effectiveTimerDurationMinutes,
  type Cadence,
  type Task,
  type TaskMode,
} from '@memoria/shared';
import { useApp } from '../../store';
import { intOr } from '../../util';
import { COMPACT_INPUT, Field, NumInput, Select, TextInput, Toggle } from '../ui';

export const TASK_CADENCES: { value: Cadence; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Cycle' },
];
const TASK_MODES: { value: TaskMode; label: string }[] = [
  { value: 'check', label: 'Checkbox' },
  { value: 'timer', label: 'Timer' },
  { value: 'count', label: 'Counter' },
];

export function taskSettingsSummary(task: Task): string {
  return `${TASK_CADENCES.find((entry) => entry.value === task.cadence)?.label} · ${TASK_MODES.find((entry) => entry.value === effectiveTaskMode(task))?.label}${task.core ? ' · Priority' : ''}`;
}

/** The same task rules in Settings and directly inside the card's Edit view. */
export function TaskFields({
  task,
  nameLabel = 'Name',
  actions,
  showSaveHint = true,
}: {
  task: Task;
  nameLabel?: string;
  actions?: ReactNode;
  showSaveHint?: boolean;
}) {
  const updateTask = useApp((store) => store.updateTask);
  const mode = effectiveTaskMode(task);
  const hasRules = task.cadence === 'custom' || mode === 'timer' || mode === 'count';
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
        <Field label={nameLabel} className="sm:col-span-2">
          <TextInput
            className={COMPACT_INPUT}
            value={task.name}
            maxLength={500}
            aria-label={nameLabel === 'Name' ? `Task name: ${task.name}` : undefined}
            onChange={(event) => updateTask(task.id, { name: event.target.value })}
          />
        </Field>
        <Field label="Cadence">
          <Select
            className={COMPACT_INPUT}
            value={task.cadence}
            aria-label={`Cadence for ${task.name}`}
            onChange={(event) => updateTask(task.id, { cadence: event.target.value as Cadence })}
          >
            {TASK_CADENCES.map((cadence) => (
              <option key={cadence.value} value={cadence.value}>
                {cadence.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mode">
          <Select
            className={COMPACT_INPUT}
            value={mode}
            aria-label={`Mode for ${task.name}`}
            onChange={(event) => updateTask(task.id, { mode: event.target.value as TaskMode })}
          >
            {TASK_MODES.map((taskMode) => (
              <option key={taskMode.value} value={taskMode.value}>
                {taskMode.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {hasRules && (
        <div className="grid grid-cols-1 gap-3 border-t border-line-hairline pt-3 sm:grid-cols-2">
          {task.cadence === 'custom' && (
            <>
              <Field label="Cycle days">
                <NumInput
                  className={COMPACT_INPUT}
                  min={1}
                  aria-label={`Cycle days for ${task.name}`}
                  value={String(task.intervalDays)}
                  onChange={(event) => updateTask(task.id, { intervalDays: Math.max(1, intOr(event.target.value, 2)) })}
                />
              </Field>
              <Field label="Timeline window">
                <Toggle
                  checked={task.timelineLinked !== false}
                  onChange={(value) => updateTask(task.id, { timelineLinked: value ? undefined : false })}
                  label="Follow matching event"
                />
              </Field>
              {task.timelineLinked !== false && (
                <Field label="Timeline match" className="sm:col-span-2">
                  <TextInput
                    className={COMPACT_INPUT}
                    placeholder="Auto (task name)"
                    maxLength={120}
                    aria-label={`Timeline match for ${task.name}`}
                    value={task.timelineMatch ?? ''}
                    onChange={(event) => updateTask(task.id, { timelineMatch: event.target.value || undefined })}
                  />
                </Field>
              )}
            </>
          )}
          {mode === 'timer' && (
            <>
              <Field label="Timer minutes">
                <NumInput
                  className={COMPACT_INPUT}
                  min={1}
                  aria-label={`Timer minutes for ${task.name}`}
                  value={String(effectiveTimerDurationMinutes(task))}
                  onChange={(event) =>
                    updateTask(task.id, { timerDurationMinutes: Math.max(1, intOr(event.target.value, 20 * 60)) })
                  }
                />
              </Field>
              <Field label="Timer step minutes">
                <NumInput
                  className={COMPACT_INPUT}
                  min={1}
                  aria-label={`Timer step minutes for ${task.name}`}
                  placeholder="No step"
                  value={task.timerStepMinutes ?? ''}
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    updateTask(task.id, { timerStepMinutes: value ? Math.max(1, intOr(value, 1)) : undefined });
                  }}
                />
              </Field>
            </>
          )}
          {mode === 'count' && (
            <Field label="Count target">
              <NumInput
                className={COMPACT_INPUT}
                min={1}
                max={365}
                aria-label={`Count target for ${task.name}`}
                value={String(effectiveCountTarget(task))}
                onChange={(event) =>
                  updateTask(task.id, { countTarget: Math.min(365, Math.max(1, intOr(event.target.value, 1))) })
                }
              />
            </Field>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Toggle
            checked={task.core === true}
            onChange={(core) => updateTask(task.id, { core })}
            label="Priority task"
          />
          <p className="text-label text-muted">Priority tasks appear first in their group.</p>
        </div>
        {actions}
      </div>
      {showSaveHint && <p className="text-label text-muted">Task settings save automatically.</p>}
    </div>
  );
}
