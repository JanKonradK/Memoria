import { z } from 'zod';
import { DateTime } from 'luxon';
import type { BannerKind, EventType } from './types';

export const MAX_EVENT_FEED_BYTES = 512 * 1024;

export interface PublicFeedEvent {
  bannerKind?: BannerKind;
  category?: 'teyvat' | 'miliastra';
  game: string;
  name: string;
  type: EventType;
  start: string;
  end: string;
  dateOnly?: boolean;
  timezone?: string;
  startTimezone?: string;
  endTimezone?: string;
  dailyTouch?: boolean;
  notify?: boolean;
  notes?: string;
  sourceKey: string;
}

const serverTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/)
  .refine(
    (value) =>
      DateTime.fromFormat(value, value.length === 19 ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd HH:mm', { zone: 'UTC' })
        .isValid,
    'The calendar date is invalid.',
  );
const timezone = z
  .string()
  .min(1)
  .max(100)
  .refine((zone) => DateTime.now().setZone(zone).isValid, 'The calendar timezone is invalid.');
export const PublicFeedEventSchema = z.object({
  game: z.string().min(1).max(20),
  name: z.string().min(1).max(500),
  type: z.enum(['banner', 'event', 'cycle', 'maintenance', 'livestream', 'custom']),
  category: z.enum(['teyvat', 'miliastra']).optional(),
  bannerKind: z.enum(['character', 'weapon', 'support', 'memory', 'other']).optional(),
  start: serverTime,
  end: serverTime,
  dateOnly: z.boolean().optional(),
  timezone: timezone.optional(),
  startTimezone: timezone.optional(),
  endTimezone: timezone.optional(),
  dailyTouch: z.boolean().optional(),
  notify: z.boolean().optional(),
  notes: z.string().max(20_000).optional(),
  sourceKey: z.string().min(1).max(300),
});

export const RemoteEventFeedSchema = z
  .object({
    version: z.literal(2),
    generatedAt: z.iso.datetime({ offset: true }),
    seedUpdated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    revision: z.string().min(1).max(80),
    events: z.array(PublicFeedEventSchema).max(3000),
    withdrawn: z.array(z.string().min(1).max(300)).max(1000),
  })
  .superRefine((feed, context) => {
    const seen = new Set<string>();
    for (const event of feed.events) {
      const key = `${event.game}:${event.sourceKey}`;
      if (seen.has(key))
        context.addIssue({ code: 'custom', message: 'The calendar feed has duplicate event identities.' });
      seen.add(key);
    }
  });

export type RemoteEventFeed = z.infer<typeof RemoteEventFeedSchema>;

export interface RemoteEventImportResult {
  applied: number;
  skipped: boolean;
  error?: string;
}
