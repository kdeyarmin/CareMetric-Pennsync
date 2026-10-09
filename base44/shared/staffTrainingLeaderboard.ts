export async function staffTrainingLeaderboard(entities, emails, offset = 0, staff = []) {
  if (!emails.length) return { items: [], next_offset: null };
  const summary = await entities.PlanEnrollment.aggregate({
    query: { user_id: { $in: emails }, status: { $ne: 'cancelled' } },
    groupBy: 'user_id', sum: ['progress_percentage', 'courses_completed'], limit: 1000,
  });
  if (summary.truncated) throw new Error('Staff leaderboard exceeds the reporting limit.');
  const identities = new Map(staff.map(user => [String(user.email || '').trim().toLowerCase(), user]));
  const totals = new Map();
  for (const row of summary.rows) {
    const key = String(row.user_id || '').trim().toLowerCase();
    const identity = identities.get(key);
    if (!identity) throw new Error('Leaderboard staff identity could not be verified.');
    const entry = totals.get(key) || { id: identity.id, name: identity.full_name || identity.email, plans: 0, progress_sum: 0, completed_courses: 0 };
    entry.plans += Number(row.count) || 0;
    entry.progress_sum += Number(row.sum_progress_percentage) || 0;
    entry.completed_courses += Number(row.sum_courses_completed) || 0;
    totals.set(key, entry);
  }
  const ranked = [...totals.values()].map(row => ({
    id: row.id, name: row.name, plans: row.plans,
    progress: Math.round(Math.max(0, Math.min(100, row.progress_sum / (row.plans || 1))) * 10) / 10,
    completed_courses: row.completed_courses,
  })).sort((a, b) => b.progress - a.progress || b.completed_courses - a.completed_courses || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  let rank = 0;
  ranked.forEach((row, index) => {
    const previous = ranked[index - 1];
    if (!previous || previous.progress !== row.progress || previous.completed_courses !== row.completed_courses) rank = index + 1;
    row.rank = rank;
  });
  return { items: ranked.slice(offset, offset + 50), next_offset: offset + 50 < ranked.length ? offset + 50 : null };
}