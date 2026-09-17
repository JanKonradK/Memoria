/** Undefined or invalid deadlines must never imply that a code still works. */
export function redemptionCodeStatus(expiresAt: number | undefined, now: number): 'expired' | 'available' | 'unknown' {
  if (expiresAt === undefined || !Number.isFinite(expiresAt)) return 'unknown';
  return now >= expiresAt ? 'expired' : 'available';
}
