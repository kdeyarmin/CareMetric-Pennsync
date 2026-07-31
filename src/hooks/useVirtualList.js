import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { VIRTUALIZE_THRESHOLD, shouldVirtualizeList } from '@/lib/virtualListConfig';

export { VIRTUALIZE_THRESHOLD, shouldVirtualizeList };

/**
 * Thin wrapper around @tanstack/react-virtual for vertical lists.
 */
export function useVirtualList({
  count = 0,
  estimateSize = 72,
  overscan = 6,
  enabled,
  getItemKey,
} = {}) {
  const parentRef = useRef(null);
  const shouldVirtualize = shouldVirtualizeList(count, enabled);

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
