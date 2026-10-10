import { staffTrainingCertificates } from './staffTrainingCertificates.ts';

export async function staffTrainingLeaderboard(entities, emails, offset = 0, staff = [], input = {}) {
  if (!emails.length) return { items: [], next_offset: null };
  if (input.trainingStatus === 'overdue') {
    const overdue = await entities.PlanEnrollment.aggregate({
      query: { user_id: { $in: emails }, status: 'overdue' }, groupBy: 'user_id', limit: 1000,
    });
    if (overdue.truncated) throw new Error('Overdue staff summary exceeds the reporting limit.');
    const overdueEmails = new Set(overdue.rows.map(row => String(row.user_id || '').trim().toLowerCase()));
    emails = emails.filter(email => overdueEmails.has(String(email).trim().toLowerCase()));
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
    const entry = totals.get(key) || { id: identity.id, name: identity.full_name || identity.email, plans: 0, progress_sum: 0, completed_courses: 0, completed_plans: 0, overdue_plans: 0 };
    entry.plans += Number(row.count) || 0;
    if (row.status === 'completed') entry.completed_plans += Number(row.count) || 0;
    if (row.status === 'overdue') entry.overdue_plans += Number(row.count) || 0;
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