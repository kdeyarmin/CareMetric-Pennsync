import { describe, it, expect } from 'vitest';
import { ITEM_LABELS, OASIS_ITEM_MAX, scaleOptions, optionsForItem, PAIN_FREQUENCY_OPTIONS } from './oasisScales.js';
import { OASIS_SECTIONS } from './oasisQuestions.jsx';

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

  it('pain frequency is its own 0–4 scale (OASIS-E M1242)', () => {
    expect(PAIN_FREQUENCY_OPTIONS.map((o) => o.value)).toEqual(['0', '1', '2', '3', '4']);
  });

  it('quick-entry labels carry each code\'s FORM meaning, not a generic assist scale', () => {
    // Regression: generic labels offered M1830 code 6 as "Unable to perform",
    // but the form (and outcome engine) read 6 as "Unable to rate — artificial
    // opening" — quick-entry would record a dependent bather as not-ratable.
    const m1830 = optionsForItem('m1830');
    expect(m1830[6].label).toMatch(/artificial opening/i);
    expect(m1830[4].label).toMatch(/total person assistance/i);
    expect(m1830[5].label).toMatch(/refused/i);
  });

  it('every quick-entry label matches the main OASIS form label for the same code', () => {
    const formById = {};
    for (const section of OASIS_SECTIONS) {
      for (const q of section.questions || []) formById[q.id] = q;
    }
    const normalize = (s) => String(s).replace(/^\s*\d+\s*[—–-]\s*/, '').trim().toLowerCase();
    for (const [itemKey, labels] of Object.entries(ITEM_LABELS)) {
      const form = formById[itemKey];
      if (!form) continue; // items not on the main form only need internal consistency
      expect(labels.length).toBe(form.options.length);
      labels.forEach((label, code) => {
        expect(normalize(label), `${itemKey} code ${code}`).toBe(normalize(form.options[code].label));
      });
    }
  });
});
