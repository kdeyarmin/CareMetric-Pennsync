import { describe, it, expect } from 'vitest';
import { OASIS_ITEM_MAX, scaleOptions, optionsForItem, PAIN_FREQUENCY_OPTIONS } from './oasisScales.js';

describe('oasisScales', () => {
  it('gives each OASIS-E item its correct number of responses', () => {
    // M1810/M1845 = 0–3 (4), M1840 = 0–4 (5), M1850 = 0–5 (6), M1830/M1860 = 0–6 (7).
    expect(optionsForItem('m1810').length).toBe(4);
    expect(optionsForItem('m1845').length).toBe(4);
    expect(optionsForItem('m1840').length).toBe(5);
    expect(optionsForItem('m1850').length).toBe(6);
    expect(optionsForItem('m1830').length).toBe(7);
    expect(optionsForItem('m1860').length).toBe(7);
  });

  it('does not offer codes beyond an item max (0–3 items stop at 3)', () => {
    const m1810 = optionsForItem('m1810').map((o) => o.value);
    expect(m1810).toEqual(['0', '1', '2', '3']);
    expect(m1810).not.toContain('4');
  });

  it('covers the full range for 0–6 items', () => {
    expect(optionsForItem('m1860').map((o) => o.value)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
  });

  it('scaleOptions clamps out-of-range and non-integer maxima to a safe set', () => {
    expect(scaleOptions(99).length).toBe(7); // clamped to 6
    expect(scaleOptions(-1).length).toBe(1); // clamped to 0 -> just "0"
    expect(scaleOptions(undefined).length).toBe(7); // default full range
  });

  it('every item in OASIS_ITEM_MAX maps to a max within 0–6', () => {
    for (const max of Object.values(OASIS_ITEM_MAX)) {
      expect(max).toBeGreaterThanOrEqual(0);
      expect(max).toBeLessThanOrEqual(6);
    }
  });

  it('pain frequency is its own 0–3 scale', () => {
    expect(PAIN_FREQUENCY_OPTIONS.map((o) => o.value)).toEqual(['0', '1', '2', '3']);
  });
});
