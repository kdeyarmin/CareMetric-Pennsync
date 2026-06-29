/**
 * Canonical categorical palette for charts (recharts `<Cell>` fills, series
 * colors, etc.). Centralizing the previously-duplicated `const COLORS = [...]`
 * arrays keeps chart theming consistent and editable in one place.
 *
 * Order is significant: callers cycle with `CHART_COLORS[i % CHART_COLORS.length]`,
 * so appending new colors is safe but reordering changes existing chart output.
 */
export const CHART_COLORS = [
  '#264491', // navy — brand primary
  '#0e9f6e', // emerald
  '#dcab35', // gold — brand accent
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#dc2626', // red
  '#0d9488', // teal
  '#ea580c', // orange
];

/**
 * Six-color subset — the first six entries of {@link CHART_COLORS} — for call
 * sites that want a fixed six-element palette. It is derived from CHART_COLORS,
 * so it always reflects the current navy/gold-led palette (it does not pin the
 * previous colors).
 */
export const CHART_COLORS_6 = CHART_COLORS.slice(0, 6);
