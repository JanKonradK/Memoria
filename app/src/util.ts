import { DateTime } from 'luxon';

export const uid = (): string => crypto.randomUUID();

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function intOr(v: string, fallback: number): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** "2d 4h" / "1h 05m" / "12m" / "<1m" */
export function fmtDur(ms: number): string {
  if (ms <= 0) return 'now';
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return '<1m';
}

/** Local wall-clock for a deadline: "14:30" today, otherwise "Thu 14:30". */
export function fmtClock(at: number, zone: string): string {
  const dt = DateTime.fromMillis(at, { zone });
  const today = DateTime.fromMillis(Date.now(), { zone });
  return dt.hasSame(today, 'day') ? dt.toFormat('HH:mm') : dt.toFormat('ccc HH:mm');
}

/**
 * The next daily reset, in the user's own clock.
 *
 * A game's reset hour is stated in ITS server's zone, so the same stored `4`
 * lands at a different wall-clock time for every server region. Shared by the
 * game card and the settings list so the two can never disagree.
 */
export function localResetLabel(
  game: { tz: string; dailyResetHour: number },
  zone: string,
  now: number,
): string {
  const serverNow = DateTime.fromMillis(now, { zone: game.tz });
  let nextReset = serverNow.set({ hour: game.dailyResetHour, minute: 0, second: 0, millisecond: 0 });
  if (nextReset.toMillis() <= serverNow.toMillis()) nextReset = nextReset.plus({ days: 1 });
  const localReset = nextReset.setZone(zone);
  return localReset.isValid
    ? localReset.toFormat('HH:mm')
    : String(game.dailyResetHour).padStart(2, '0') + ':00';
}

export function fmtDateTimeLocalInput(at: number, zone: string): string {
  return DateTime.fromMillis(at, { zone }).toFormat("yyyy-LL-dd'T'HH:mm");
}

export function parseDateTimeLocalInput(v: string, zone: string): number | null {
  const dt = DateTime.fromISO(v, { zone });
  return dt.isValid ? dt.toMillis() : null;
}

/** Minutes-from-midnight → "HH:mm" for <input type=time>. */
export function minToTimeInput(min: number | null): string {
  if (min == null) return '';
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function timeInputToMin(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return null;
  return intOr(m[1]!, 0) * 60 + intOr(m[2]!, 0);
}

/** Read an image File as a compressed data URL (max ~640px, JPEG) to keep the synced doc small. */
export function fileToImageDataUrl(file: File, maxDim = 640): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no canvas'));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

const DAY = 86_400_000;

/**
 * Countdown urgency: rose <24h, gold <72h, muted beyond that / after the end.
 *
 * The two muted steps were a literal slate, which is a colour chosen against an
 * OLED ground and never re-checked: on the cream theme it measured 2.2:1, so the
 * countdown on anything more than three days out was the least readable text on
 * the card. `later` is the themed step that already means exactly this.
 */
export function endTone(msLeft: number): string {
  if (msLeft <= 0) return 'color-mix(in oklab, var(--color-later) 60%, transparent)';
  if (msLeft < DAY) return 'var(--color-rose)';
  if (msLeft < 3 * DAY) return 'var(--color-gold)';
  return 'var(--color-later)';
}

/** Hex accent → translucent rgba for glows/backgrounds. */
export function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(148,163,184,${alpha})`;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** WCAG-weighted sRGB luminance on a normalized 0–1 scale. */
export function luminance(hex: string): number | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const rgb = parseInt(match[1]!, 16);
  const red = (rgb >> 16) & 255;
  const green = (rgb >> 8) & 255;
  const blue = rgb & 255;
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}
