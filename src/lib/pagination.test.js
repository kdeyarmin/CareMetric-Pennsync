import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPageSize, filterSortPaginateRows, paginateRows } from './pagination.js';

test('paginateRows returns deterministic metadata and slices', () => {
  const rows = Array.from({ length: 55 }, (_, i) => ({ id: i + 1 }));
  const page = paginateRows(rows, { page: 3, pageSize: 20 });
  assert.deepEqual(page.items.map((r) => r.id), Array.from({ length: 15 }, (_, i) => i + 41));
  assert.equal(page.totalPages, 3);
  assert.equal(page.hasPreviousPage, true);
  assert.equal(page.hasNextPage, false);
});

test('pagination clamps invalid and excessive page sizes', () => {
  assert.equal(clampPageSize('bad'), 25);
  assert.equal(clampPageSize(500, { max: 75 }), 75);
  assert.equal(paginateRows([1, 2], { page: 99, pageSize: 1 }).page, 2);
});

test('filterSortPaginateRows handles 10k synthetic records', () => {
  const rows = Array.from({ length: 10000 }, (_, i) => ({ name: `Patient ${String(i).padStart(5, '0')}`, status: i % 2 ? 'active' : 'discharged' }));
  const page = filterSortPaginateRows(rows, { search: 'Patient 099', searchFields: ['name'], sortBy: 'name', sortDirection: 'desc', page: 1, pageSize: 10 });
  assert.equal(page.totalItems, 100);
  assert.equal(page.items.length, 10);
  assert.equal(page.items[0].name, 'Patient 09999');
});
