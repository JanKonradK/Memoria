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
export function fmtClock(at: number): string {
  const dt = DateTime.fromMillis(at);
  const today = DateTime.now();
  return dt.hasSame(today, 'day') ? dt.toFormat('HH:mm') : dt.toFormat('ccc HH:mm');
}

export function fmtDateTimeLocalInput(at: number): string {
  return DateTime.fromMillis(at).toFormat("yyyy-LL-dd'T'HH:mm");
}

export function parseDateTimeLocalInput(v: string): number | null {
  const dt = DateTime.fromISO(v);
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

/** Countdown urgency: rose <24h, gold <72h, muted beyond that / after the end. */
export function endTone(msLeft: number): string {
  if (msLeft <= 0) return 'rgba(148,163,184,0.6)';
  if (msLeft < DAY) return 'var(--color-rose)';
  if (msLeft < 3 * DAY) return 'var(--color-gold)';
  return 'rgb(148,163,184)';
}

/** Hex accent → translucent rgba for glows/backgrounds. */
export function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(148,163,184,${alpha})`;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
