import { staffTrainingCertificates } from './staffTrainingCertificates.ts';

const ENROLLMENT_READ_LIMIT = 5000;

function isPastCalendarDue(dueDate, now) {
  if (dueDate == null || dueDate === '') return false;
  const raw = String(dueDate).trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    const due = new Date(y, m - 1, d);
    if (due.getFullYear() !== y || due.getMonth() !== m - 1 || due.getDate() !== d) return false;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return due < today;
  }
  const due = new Date(dueDate);
  return !Number.isNaN(due.getTime()) && due < now;
}

/** A plan is overdue from its due date. Status is never written to 'overdue'. */
export function enrollmentIsOverdue(row, now = new Date()) {
  const status = String(row?.status || '');
  if (status === 'completed' || status === 'cancelled') return false;
  return status === 'overdue' || isPastCalendarDue(row?.due_date, now);
}

function enrollmentRows(listed) {
  if (Array.isArray(listed)) return listed;
  if (Array.isArray(listed?.items)) return listed.items;
  return [];
}

export async function staffTrainingLeaderboard(entities, emails, offset = 0, staff = [], input = {}) {
  if (!emails.length) return { items: [], next_offset: null };
  const now = input.now instanceof Date ? input.now : new Date();
  const listed = await entities.PlanEnrollment.filter(
    { user_id: { $in: emails } },
    '-due_date',
    ENROLLMENT_READ_LIMIT,
  );
  const enrollments = enrollmentRows(listed);
  if (enrollments.length >= ENROLLMENT_READ_LIMIT) {
    throw new Error('Staff leaderboard exceeds the reporting limit.');
  }
  const overdueByUser = new Map();
  for (const row of enrollments) {
    if (!enrollmentIsOverdue(row, now)) continue;
    const key = String(row.user_id || '').trim().toLowerCase();
    overdueByUser.set(key, (overdueByUser.get(key) || 0) + 1);
  }
  if (input.trainingStatus === 'overdue') {
    emails = emails.filter(email => overdueByUser.has(String(email).trim().toLowerCase()));
    if (!emails.length) return { items: [], next_offset: null };
  }
  const summary = await entities.PlanEnrollment.aggregate({
    query: { user_id: { $in: emails }, status: { $ne: 'cancelled' } },
    groupBy: ['user_id', 'status'], sum: ['progress_percentage', 'courses_completed'], limit: 1000,
  });
  if (summary.truncated) throw new Error('Staff leaderboard exceeds the reporting limit.');
  const identities = new Map(staff.map(user => [String(user.email || '').trim().toLowerCase(), user]));
  const totals = new Map();
  for (const row of summary.rows) {
    const key = String(row.user_id || '').trim().toLowerCase();
    const identity = identities.get(key);
    if (!identity) throw new Error('Leaderboard staff identity could not be verified.');
    const entry = totals.get(key) || {
      id: identity.id, name: identity.full_name || identity.email, plans: 0, progress_sum: 0,
      completed_courses: 0, completed_plans: 0, overdue_plans: overdueByUser.get(key) || 0,
    };
    entry.plans += Number(row.count) || 0;
    if (row.status === 'completed') entry.completed_plans += Number(row.count) || 0;
    entry.progress_sum += Number(row.sum_progress_percentage) || 0;
    entry.completed_courses += Number(row.sum_courses_completed) || 0;
    totals.set(key, entry);
  }
  const ranked = [...totals.values()].map(row => ({
    id: row.id, name: row.name, plans: row.plans,
    progress: Math.round(Math.max(0, Math.min(100, row.progress_sum / (row.plans || 1))) * 10) / 10,
    completed_courses: row.completed_courses, completed_plans: row.completed_plans,
    completion_status: row.completed_plans === row.plans ? 'completed' : row.overdue_plans > 0 ? 'overdue' : row.progress_sum > 0 || row.completed_plans > 0 ? 'in_progress' : 'not_started',
  })).sort((a, b) => b.progress - a.progress || b.completed_courses - a.completed_courses || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  let rank = 0;
  ranked.forEach((row, index) => {
    const previous = ranked[index - 1];
    if (!previous || previous.progress !== row.progress || previous.completed_courses !== row.completed_courses) rank = index + 1;
    row.rank = rank;
  });
  const items = await staffTrainingCertificates(entities, ranked.slice(offset, offset + 50), emails, identities);
  return { items, next_offset: offset + 50 < ranked.length ? offset + 50 : null };
}
