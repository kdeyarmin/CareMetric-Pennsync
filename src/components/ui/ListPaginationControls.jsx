import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Thin UI consumer for pure `paginateRows` / `filterSortPaginateRows` metadata (P2-03).
 * Expects the window shape returned by those helpers.
 */
export default function ListPaginationControls({
  page = 1,
  totalPages = 1,
  totalItems = 0,
  startIndex = 0,
  endIndex = -1,
  hasPreviousPage = false,
  hasNextPage = false,
  onPageChange,
  itemLabel = 'items',
}) {
  if (totalPages <= 1) return null;

  const pageButtons = (() => {
    const pages = [];
    for (let idx = 0; idx < Math.min(5, totalPages); idx += 1) {
      let pageNum;
      if (totalPages <= 5) pageNum = idx + 1;
      else if (page <= 3) pageNum = idx + 1;
      else if (page >= totalPages - 2) pageNum = totalPages - 4 + idx;
      else pageNum = page - 2 + idx;
      pages.push(pageNum);
    }
    return pages;
  })();

  return (
    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-600">
        {totalItems === 0
          ? `No ${itemLabel}`
          : `Showing ${startIndex + 1}–${endIndex + 1} of ${totalItems} ${itemLabel}`}
      </p>
      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange?.(page - 1)}
          disabled={!hasPreviousPage}
          className="min-h-[40px]"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Previous
        </Button>
        <div className="flex items-center gap-1">
          {pageButtons.map((pageNum) => (
            <Button
              key={pageNum}
              variant={page === pageNum ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPageChange?.(pageNum)}
              className="h-8 w-8 p-0"
            >
              {pageNum}
            </Button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange?.(page + 1)}
          disabled={!hasNextPage}
          className="min-h-[40px]"
        >
          Next
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
