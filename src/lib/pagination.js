export function clampPageSize(pageSize, { min = 1, max = 100, fallback = 25 } = {}) {
  const n = Number(pageSize);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function paginateRows(rows = [], { page = 1, pageSize = 25, maxPageSize = 100 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const size = clampPageSize(pageSize, { max: maxPageSize });
  const totalItems = list.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / size));
  const currentPage = Math.min(totalPages, Math.max(1, Math.floor(Number(page) || 1)));
  const startIndex = (currentPage - 1) * size;
  const items = list.slice(startIndex, startIndex + size);
  return {
    items,
    page: currentPage,
    pageSize: size,
    totalItems,
    totalPages,
    hasPreviousPage: currentPage > 1,
    hasNextPage: currentPage < totalPages,
    startIndex,
    endIndex: items.length ? startIndex + items.length - 1 : -1,
  };
}

export function filterSortPaginateRows(rows = [], { search = '', searchFields = [], sortBy, sortDirection = 'asc', page, pageSize } = {}) {
  const query = String(search || '').trim().toLowerCase();
  let filtered = Array.isArray(rows) ? [...rows] : [];
  if (query && searchFields.length) {
    filtered = filtered.filter((row) => searchFields.some((field) => String(row?.[field] ?? '').toLowerCase().includes(query)));
  }
  if (sortBy) {
    const direction = sortDirection === 'desc' ? -1 : 1;
    filtered.sort((a, b) => String(a?.[sortBy] ?? '').localeCompare(String(b?.[sortBy] ?? '')) * direction);
  }
  return paginateRows(filtered, { page, pageSize });
}
