const statuses = ['assigned', 'in_progress', 'completed', 'overdue', 'failed', 'locked'];
const priorities = ['low', 'medium', 'high', 'critical'];
export function validTrainingAssignmentFilters(input) {
  return (!input.status || statuses.includes(input.status)) && (!input.priority || priorities.includes(input.priority))
    && (input.department == null || typeof input.department === 'string' && input.department.length <= 200)
    && (input.cursor == null || typeof input.cursor === 'string' && input.cursor.length <= 4096);
}
export async function filteredTrainingAssignments(entities, emails, offset, staff, input) {
  if (!emails.length) return { items: [], departments: [], next_cursor: null, has_more: false };
  const scope = { assigned_to_user_id: { $in: emails }, archived_status: { $ne: true } };
  const query = { ...scope };
  if (input.status === 'completed') query.$or = [{ status: 'completed' }, { pass_fail_result: 'passed' }];
  else if (input.status) { query.status = input.status; query.pass_fail_result = { $ne: 'passed' }; }
  if (input.priority) query.priority = input.priority;
  if (input.department === '__unspecified__') query.$and = [{ $or: [{ assigned_to_department: { $exists: false } }, { assigned_to_department: { $in: ['', null] } }] }];
  else if (input.department) query.assigned_to_department = input.department;
  const [page, departments] = await Promise.all([
    entities.TrainingAssignment.filter(query, { sort: 'due_date', limit: 50, ...(input.cursor ? { cursor: input.cursor } : {}), fields: ['assigned_to_user_id', 'course_title', 'assigned_to_department', 'status', 'pass_fail_result', 'priority', 'progress_percentage', 'due_date'] }),
    entities.TrainingAssignment.filter(scope, { distinct: 'assigned_to_department', limit: 1000 }),
  ]);
  if (departments.has_more) throw new Error('Department list exceeds the reporting limit.');
  const names = new Map(staff.map(user => [String(user.email || '').trim().toLowerCase(), user.full_name || user.email]));
  return {
    items: page.items.map(row => ({ id: row.id, staff_name: names.get(String(row.assigned_to_user_id || '').trim().toLowerCase()) || row.assigned_to_user_id,
      course_title: row.course_title || 'Training course', department: row.assigned_to_department || 'Unspecified department',
      status: row.status === 'completed' || row.pass_fail_result === 'passed' ? 'completed' : row.status || 'assigned',
      priority: row.priority || 'medium', progress: row.status === 'completed' || row.pass_fail_result === 'passed' ? 100 : Math.max(0, Math.min(100, Number(row.progress_percentage) || 0)), due_date: row.due_date || null })),
    departments: departments.items.filter(value => typeof value === 'string' && value).sort((a, b) => a.localeCompare(b)),
    next_cursor: page.next_cursor || null, has_more: page.has_more,
  };
}