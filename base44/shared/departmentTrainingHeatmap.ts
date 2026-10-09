export async function departmentTrainingHeatmap(entities, emails, offset = 0) {
  if (!emails.length) return { items: [], next_offset: null };
  const summary = await entities.TrainingAssignment.aggregate({
    query: { assigned_to_user_id: { $in: emails }, archived_status: { $ne: true }, course_id: { $exists: true, $nin: ['', null] } },
    groupBy: ['assigned_to_department', 'status', 'pass_fail_result'], sum: 'progress_percentage', limit: 1000,
  });
  if (summary.truncated) throw new Error('Department heat map exceeds the reporting limit.');
  const departments = new Map();
  for (const row of summary.rows) {
    const key = typeof row.assigned_to_department === 'string' ? row.assigned_to_department.trim() : '';
    const count = Number(row.count) || 0;
    if (!count) continue;
    const done = row.status === 'completed' || row.pass_fail_result === 'passed';
    const entry = departments.get(key) || { id: JSON.stringify(key), name: key || 'Unspecified department', assignments: 0, progress_sum: 0 };
    entry.assignments += count;
    entry.progress_sum += done ? count * 100 : Math.max(0, Math.min(count * 100, Number(row.sum_progress_percentage) || 0));
    departments.set(key, entry);
  }
  const ranked = [...departments.values()].map(row => ({ id: row.id, name: row.name, assignments: row.assignments, progress: row.progress_sum / row.assignments }))
    .sort((a, b) => a.progress - b.progress || a.name.localeCompare(b.name));
  const lowest = ranked[0]?.progress;
  return {
    items: ranked.slice(offset, offset + 50).map(row => ({ ...row, lowest: Math.abs(row.progress - lowest) < 0.000001,
      band: row.progress < 25 ? 'low' : row.progress < 50 ? 'watch' : row.progress < 75 ? 'moderate' : 'high',
      progress: Math.round(row.progress * 10) / 10 })),
    next_offset: offset + 50 < ranked.length ? offset + 50 : null,
  };
}