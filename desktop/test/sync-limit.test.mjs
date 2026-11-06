import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MAX_SYNC_BYTES } from '@memoria/shared';

// The page refuses to send more than the PC accepts. If the two drift, the PC
// rejects every sync and refuses to close for an update.
it('the PC accepts the same sync size the app sends', () => {
  const core = readFileSync(new URL('../tauri/src/core.rs', import.meta.url), 'utf8');
  const limit = core.match(/pub const MAX_STATE_BYTES: usize = ([\d_]+);/)?.[1];
  expect(Number(limit?.replaceAll('_', ''))).toBe(MAX_SYNC_BYTES);
});
