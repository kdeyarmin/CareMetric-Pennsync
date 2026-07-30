import { useVirtualList, VIRTUALIZE_THRESHOLD } from '@/hooks/useVirtualList';
import { cn } from '@/lib/utils';

/**
 * Headless-style virtual list for large row collections (P2-03).
 *
 * Below VIRTUALIZE_THRESHOLD items, renders a normal stacked list (no virtualizer).
 * Above the threshold, only visible rows mount — keeps mobile patient / offline
 * cache lists snappy with 100s–1000s of rows still in memory from Base44 fetches.
 *
 * Note: this does not reduce network size; server-side paging is still required
 * for true multi-tenant scale past ALL_ROWS ceilings.
 */
export default function VirtualList({
  items = [],
  estimateSize = 72,
  overscan = 6,
  height = 480,
  className,
  itemClassName,
  getItemKey,
  renderItem,
  empty = null,
  enabled,
}) {
  const list = Array.isArray(items) ? items : [];
  const count = list.length;

  const { parentRef, virtualizer, shouldVirtualize, virtualItems, totalSize } = useVirtualList({
    count,
    estimateSize,
    overscan,
    enabled,
    getItemKey: getItemKey
      ? (index) => getItemKey(list[index], index)
      : (index) => list[index]?.id ?? index,
  });

  if (count === 0) return empty;

  // Small lists: plain render — avoids virtualizer overhead and keeps tests simple.
  if (!shouldVirtualize) {
    return (
      <div
        className={cn('space-y-2 overflow-y-auto', className)}
        style={height ? { maxHeight: typeof height === 'number' ? `${height}px` : height } : undefined}
        role="list"
      >
        {list.map((item, index) => (
          <div key={getItemKey ? getItemKey(item, index) : item?.id ?? index} role="listitem" className={itemClassName}>
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={cn('overflow-y-auto', className)}
      style={{
        height: typeof height === 'number' ? `${height}px` : height,
        maxHeight: typeof height === 'number' ? `${height}px` : height,
      }}
      role="list"
      aria-rowcount={count}
    >
      <div
        style={{
          height: `${totalSize}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const item = list[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              role="listitem"
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className={itemClassName}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderItem(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { VIRTUALIZE_THRESHOLD };
