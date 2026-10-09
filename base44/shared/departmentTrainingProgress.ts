export async function departmentTrainingProgress(entities, emails, offset = 0) {
  if (!emails.length) return { overall: { total: 0, completed: 0, percentage: null }, items: [], next_offset: null };
  const result = await entities.TrainingAssignment.aggregate({
    query: { assigned_to_user_id: { $in: emails }, archived_status: { $ne: true }, course_id: { $exists: true, $nin: ['', null] } },
    groupBy: ['assigned_to_department', 'status', 'pass_fail_result'], limit: 1000,
  });
  if (result.truncated) throw new Error('Department summary exceeds the reporting limit.');
  const departments = new Map();
  let total = 0;
  let completed = 0;
  for (const row of result.rows) {
    const key = typeof row.assigned_to_department === 'string' ? row.assigned_to_department.trim() : '';
    const count = Number(row.count) || 0;
    const done = row.status === 'completed' || row.pass_fail_result === 'passed' ? count : 0;
    const department = departments.get(key) || { id: key || '__unspecified__', name: key || 'Unspecified department', total: 0, completed: 0 };
    department.total += count;
    department.completed += done;
    departments.set(key, department);
    total += count;
    completed += done;
  }
  const items = [...departments.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    overall: { total, completed, percentage: total ? Math.round(completed / total * 100) : null },
    items: items.slice(offset, offset + 50).map(row => ({ ...row, percentage: row.total ? Math.round(row.completed / row.total * 100) : 0 })),
    next_offset: offset + 50 < items.length ? offset + 50 : null,
  };
}