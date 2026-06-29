/**
 * safePercent — compute a 0–100 percentage without ever producing `NaN` or
 * `Infinity` when the denominator is zero or missing.
 *
 * Across the training/learning UI, "how much of N did the user complete" is
 * rendered as `(completed / total) * 100`. When `total` is 0 (a quiz with no
 * questions yet, a path with no enrolled courses, an empty video library) that
 * expression yields `NaN`, which then leaks into score badges, progress bars,
 * and `onQuizCompleted` payloads. Routing those computations through this
 * helper returns `0` for the empty case — the natural "nothing done yet" value
 * already used by the many call sites that guard with `total > 0 ? … : 0`.
 *
 * @param {number} numerator   Count completed/correct.
 * @param {number} denominator Total possible.
 * @param {{ round?: boolean }} [opts] `round` (default true) rounds to a whole
 *   percent; pass `false` for a raw fractional value (e.g. a progress bar).
 * @returns {number} A percentage in [0, …]; `0` when the denominator is
 *   non-positive or either argument is not a finite number.
 */
export function safePercent(numerator, denominator, { round = true } = {}) {
  const d = Number(denominator);
  const n = Number(numerator);
  if (!Number.isFinite(d) || d <= 0 || !Number.isFinite(n)) return 0;
  const pct = (n / d) * 100;
  return round ? Math.round(pct) : pct;
}
