import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * savePayrollProfile — admin upsert of an employee's standing payroll profile
 * (currently the recurring phone reimbursement). One profile per employee: the
 * function finds an existing row by email and updates it, otherwise creates one.
 *
 * Admin-only. The reimbursement is an expense reimbursement figure — this system
 * tracks hours/points and standing reimbursements only; it holds NO pay rates or
 * wage/gross-pay math.
 */

function toNonNegativeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : Math.round(n * 100) / 100;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') {
      return Response.json({ error: 'Only administrators can manage payroll profiles.' }, { status: 403 });
    }

    const { employee_email, phone_reimbursement = 0, active = true, notes = '' } = (await req.json()) || {};
    const email = String(employee_email || '').trim().toLowerCase();
    if (!email) {
      return Response.json({ error: 'employee_email is required.' }, { status: 400 });
    }

    // Resolve the employee's display name from their user record (best-effort).
    let employee_name = email;
    try {
      const users = await base44.asServiceRole.entities.User.filter({ email });
      if (users && users[0]) employee_name = users[0].full_name || email;
    } catch (_e) {
      employee_name = email;
    }

    const fields = {
      employee_email: email,
      employee_name,
      phone_reimbursement: toNonNegativeNumber(phone_reimbursement),
      active: active !== false,
      notes: String(notes || '').slice(0, 1000),
    };

    const existing = await base44.asServiceRole.entities.EmployeePayrollProfile
      .filter({ employee_email: email })
      .catch(() => []);

    let saved;
    if (existing && existing[0]) {
      saved = await base44.asServiceRole.entities.EmployeePayrollProfile.update(existing[0].id, fields);
    } else {
      saved = await base44.asServiceRole.entities.EmployeePayrollProfile.create(fields);
    }

    return Response.json({ success: true, profile: saved });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
