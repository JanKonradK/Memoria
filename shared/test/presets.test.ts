import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/presets';

describe('game presets', () => {
  it('ships editable defaults for every supported title', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const preset of PRESETS) {
      expect(preset.key).toBeTruthy();
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.short.length).toBeGreaterThan(0);
      expect(preset.resources.length).toBeGreaterThan(0);
      expect(preset.tz).toMatch(/^Etc\/GMT/);
      for (const resource of preset.resources) {
        expect(resource.cap).toBeGreaterThan(0);
        expect(resource.regenMinutes).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
