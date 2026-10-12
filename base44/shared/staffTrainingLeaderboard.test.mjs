import test from 'node:test';
import assert from 'node:assert/strict';
import { staffTrainingLeaderboard } from './staffTrainingLeaderboard.ts';

const NOW = new Date(2026, 9, 12); // 2026-10-12 local

function entitiesFor(enrollments) {
  return {
    PlanEnrollment: {
      filter: async () => enrollments,
      aggregate: async ({ query }) => {
        const wanted = new Set(query.user_id.$in.map((email) => String(email).toLowerCase()));
        const grouped = new Map();
        for (const row of enrollments) {
          const key = String(row.user_id).toLowerCase();
          if (!wanted.has(key) || row.status === 'cancelled') continue;
          const group = `${key}|${row.status}`;
          const current = grouped.get(group) || {
            user_id: row.user_id, status: row.status, count: 0,
            sum_progress_percentage: 0, sum_courses_completed: 0,
          };
          current.count += 1;
          current.sum_progress_percentage += Number(row.progress_percentage) || 0;
          current.sum_courses_completed += Number(row.courses_completed) || 0;
          grouped.set(group, current);
        }
        return { rows: [...grouped.values()], truncated: false };
      },
    },
    TrainingCertificate: {
      aggregate: async () => ({ rows: [], truncated: false }),
    },
  };
}

const staff = [
  { id: 'a', email: 'a@agency.test', full_name: 'Ada' },
  { id: 'b', email: 'b@agency.test', full_name: 'Bea' },
];

test('overdue training is a past due date, not a status nothing writes', async () => {
  const result = await staffTrainingLeaderboard(
    entitiesFor([
      { user_id: 'a@agency.test', status: 'active', due_date: '2026-10-11', progress_percentage: 0, courses_completed: 0 },
      { user_id: 'b@agency.test', status: 'active', due_date: '2026-11-01', progress_percentage: 0, courses_completed: 0 },
      { user_id: 'a@agency.test', status: 'completed', due_date: '2026-01-01', progress_percentage: 100, courses_completed: 1 },
    ]),
    ['a@agency.test', 'b@agency.test'],
    0,
    staff,
    { trainingStatus: 'overdue', now: NOW },
  );
  assert.deepEqual(result.items.map((row) => row.id), ['a']);
  assert.equal(result.items[0].completion_status, 'overdue');
  assert.equal(result.items[0].overdue_plans, undefined);
});
