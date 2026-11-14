/** The repeat choices offered for a custom reminder, in days. 0 = once. */
export const REPEAT_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 0, label: 'Once' },
  { days: 1, label: 'Every day' },
  { days: 7, label: 'Every week' },
  { days: 14, label: 'Every 2 weeks' },
  { days: 30, label: 'Every 30 days' },
];

export function repeatLabel(days: number | undefined): string {
  if (!days) return 'Once';
  return REPEAT_OPTIONS.find((option) => option.days === days)?.label ?? `Every ${days} days`;
}
