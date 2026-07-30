import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/** Default: virtualize only when the list is large enough to matter. */
export const VIRTUALIZE_THRESHOLD = 40;

/**
 * Thin wrapper around @tanstack/react-virtual for vertical lists.
 *
 * @param {object} opts
 * @param {number} opts.count
 * @param {number} [opts.estimateSize=72]
 * @param {number} [opts.overscan=6]
 * @param {boolean} [opts.enabled] — defaults to count >= VIRTUALIZE_THRESHOLD
 * @param {(index: number) => number|string} [opts.getItemKey]
 */
export function useVirtualList({
  count = 0,
  estimateSize = 72,
  overscan = 6,
  enabled,
  getItemKey,
} = {}) {
  const parentRef = useRef(null);
  const shouldVirtualize =
    typeof enabled === 'boolean' ? enabled : count >= VIRTUALIZE_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? count : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: typeof estimateSize === 'function' ? estimateSize : () => estimateSize,
    overscan,
    getItemKey,
  });

  return {
    parentRef,
    virtualizer,
    shouldVirtualize,
    virtualItems: shouldVirtualize ? virtualizer.getVirtualItems() : [],
    totalSize: shouldVirtualize ? virtualizer.getTotalSize() : 0,
  };
}
