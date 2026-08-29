import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Progress, { clampPercent } from './progress';

// The bar's fill is the first child of the track.
const fillWidth = (container) => container.firstChild.firstChild.style.width;

describe('clampPercent', () => {
  it('passes finite values through, clamped to 0-100', () => {
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(42.5)).toBe(42.5);
    expect(clampPercent(100)).toBe(100);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(-20)).toBe(0);
  });

  it('treats a missing or unrepresentable score as empty, not full', () => {
    // `undefined` is what a record that never carried the score reads as, and
    // NaN is what `count / total` yields when total is 0.
    expect(clampPercent(undefined)).toBe(0);
    expect(clampPercent(null)).toBe(0);
    expect(clampPercent(NaN)).toBe(0);
    expect(clampPercent(0 / 0)).toBe(0);
    expect(clampPercent(Infinity)).toBe(0);
    expect(clampPercent('not a number')).toBe(0);
  });

  it('accepts numeric strings, which is how form/JSON round-trips arrive', () => {
    expect(clampPercent('37')).toBe(37);
  });
});

describe('Progress', () => {
  it('renders the fill at the given percentage', () => {
    const { container } = render(<Progress value={40} />);
    expect(fillWidth(container)).toBe('40%');
  });

  it('renders an EMPTY bar for a missing or NaN value', () => {
    // Regression: `width: "NaN%"` is invalid CSS, so the CSSOM dropped the
    // declaration and the fill fell back to `width: auto` — filling the whole
    // track. A patient with no risk score then rendered as 100% risk.
    for (const value of [undefined, null, NaN, 'n/a']) {
      const { container, unmount } = render(<Progress value={value} />);
      expect(fillWidth(container)).toBe('0%');
      unmount();
    }
  });

  it('never overflows the track', () => {
    const { container } = render(<Progress value={480} />);
    expect(fillWidth(container)).toBe('100%');
  });
});
