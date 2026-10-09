export async function staffPlanProgress(entities, emails, offset = 0) {
  if (!emails.length) return { items: [], next_offset: null };
  const summary = await entities.PlanEnrollment.aggregate({
    query: { user_id: { $in: emails }, status: { $ne: 'cancelled' } },
    groupBy: 'plan_id', avg: 'progress_percentage',
    sum: ['courses_completed', 'courses_total'], countDistinct: 'user_id',
    sort: 'plan_id', limit: 1000,
  });
  if (summary.truncated) throw new Error('Plan summary exceeds the reporting limit.');
  const rows = summary.rows.filter(row => typeof row.plan_id === 'string' && row.plan_id);
  const page = rows.slice(offset, offset + 50);
  const ids = page.map(row => row.plan_id);
  const plans = ids.length ? await entities.LearningPlan.filter({ id: { $in: ids } }, { limit: 50, fields: ['name'] }) : { items: [] };
  const names = new Map(plans.items.map(plan => [plan.id, plan.name]));
  return {
    items: page.map(row => ({
      id: row.plan_id, name: names.get(row.plan_id) || 'Training plan (unavailable)',
      progress: Math.round(Math.max(0, Math.min(100, Number(row.avg_progress_percentage) || 0))),
      staff: row.countDistinct_user_id ?? row.count,
      completed_courses: row.sum_courses_completed || 0, total_courses: row.sum_courses_total || 0,
    })),
    next_offset: offset + 50 < rows.length ? offset + 50 : null,
  };
}