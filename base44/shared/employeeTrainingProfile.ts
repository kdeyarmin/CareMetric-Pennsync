const sections = {
  certificates: { entity: 'TrainingCertificate', owner: 'user_id', sort: '-issued_at', fields: ['course_id', 'course_title', 'certificate_id', 'issued_at', 'completion_date', 'expiration_date', 'score', 'hours', 'training_category', 'revoked'] },
  plans: { entity: 'PlanEnrollment', owner: 'user_id', sort: 'due_date', fields: ['plan_id', 'plan_name', 'status', 'progress_percentage', 'courses_completed', 'courses_total', 'due_date', 'enrolled_at'] },
  courses: { entity: 'TrainingAssignment', owner: 'assigned_to_user_id', sort: 'due_date', fields: ['course_id', 'course_title', 'plan_id', 'status', 'priority', 'progress_percentage', 'due_date', 'assigned_date'] },
};
export function validEmployeeTrainingProfile(input) {
  return typeof input.employeeId === 'string' && input.employeeId.length > 0 && input.employeeId.length <= 200 && !input.employeeId.startsWith('$')
    && (input.profileSection == null || ['all', ...Object.keys(sections)].includes(input.profileSection))
    && (input.cursor == null || typeof input.cursor === 'string' && input.cursor.length <= 4096)
    && (!input.cursor || input.profileSection && input.profileSection !== 'all');
}
export async function employeeTrainingProfile(entities, emails, offset, staff, input) {
  const employee = staff.find(row => row.id === input.employeeId && row.is_active !== false && row.disabled !== true && row.is_service !== true && emails.includes(row.email));
  if (!employee) return { error: 'Employee not found or unavailable in your agency.', code: 'EMPLOYEE_UNAVAILABLE' };
  const ownerEmails = [...new Set([employee.email, String(employee.email).trim().toLowerCase()])];
  const selected = input.profileSection && input.profileSection !== 'all' ? [input.profileSection] : Object.keys(sections);
  const pages = await Promise.all(selected.map(async section => {
    const config = sections[section];
    const query = { [config.owner]: { $in: ownerEmails } };
    if (section === 'certificates') Object.assign(query, { issued_at: { $exists: true, $lte: new Date().toISOString() }, certificate_id: { $exists: true, $nin: ['', null] } });
    if (section === 'plans') query.status = { $nin: ['completed', 'cancelled'] };
    if (section === 'courses') Object.assign(query, { required: { $ne: false }, archived_status: { $ne: true }, status: { $ne: 'completed' }, pass_fail_result: { $ne: 'passed' } });
    const page = await entities[config.entity].filter(query, { sort: config.sort, limit: 50, fields: config.fields, ...(input.cursor ? { cursor: input.cursor } : {}) });
    const nameField = section === 'plans' ? 'plan_name' : 'course_title';
    const reference = section === 'plans' ? 'plan_id' : 'course_id';
    const ids = [...new Set(page.items.filter(row => !row[nameField]).map(row => row[reference]).filter(Boolean))];
    const names = ids.length ? await entities[section === 'plans' ? 'LearningPlan' : 'TrainingCourse'].filter({ id: { $in: ids } }, { limit: 50, fields: [section === 'plans' ? 'name' : 'title'] }) : { items: [] };
    const lookup = new Map(names.items.map(row => [row.id, row.name || row.title]));
    return [section, { items: page.items.map(row => ({ ...row, [nameField]: row[nameField] || lookup.get(row[reference]) || (section === 'plans' ? 'Training plan (unavailable)' : 'Course (unavailable)') })), next_cursor: page.next_cursor || null, has_more: page.has_more }];
  }));
  return { employee: { id: employee.id, name: employee.full_name || employee.email, email: employee.email }, ...Object.fromEntries(pages) };
}