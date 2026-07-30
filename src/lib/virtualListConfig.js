/** Default: virtualize only when the list is large enough to matter. */
export const VIRTUALIZE_THRESHOLD = 40;

export function shouldVirtualizeList(count, enabled) {
  if (typeof enabled === 'boolean') return enabled;
  return Number(count) >= VIRTUALIZE_THRESHOLD;
}
