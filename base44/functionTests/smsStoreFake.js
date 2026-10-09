// What the SMS function harnesses share with the hosted entity store, so a
// compare-and-set claim is exercised with its REAL predicate semantics:
//   - every write moves updated_date (a millisecond clock that never repeats),
//     and a seeded SmsMessage row carries one, as a hosted row always does;
//   - updateMany applies $set to exactly the rows its predicate matches ($and,
//     $or, $exists, and null-as-missing, through the e-signature harness's
//     matcher) and answers { success, updated, has_more } as the SDK does;
//   - reads return copies, so what a run OBSERVED stays what it observed while
//     another run writes the row.
import { matches } from './esignRuntimeHarness.js';

export { matches };

export function createStamp(start = Date.parse('2026-10-08T12:00:00.000Z')) {
  let clock = start;
  return () => new Date(clock++).toISOString();
}

export function stampSmsRows(data, stamp) {
  for (const row of data.SmsMessage || []) {
    if (row && typeof row === 'object' && row.updated_date === undefined) row.updated_date = stamp();
  }
}

export function copyRows(rows) {
  return rows.map((row) => structuredClone(row));
}

export function updateManyRows(rows, query, operations, stamp) {
  const matched = (rows || []).filter((row) => matches(row, query));
  for (const row of matched) {
    Object.assign(row, structuredClone(operations?.$set || {}));
    row.updated_date = stamp();
  }
  return { success: true, updated: matched.length, has_more: false };
}
