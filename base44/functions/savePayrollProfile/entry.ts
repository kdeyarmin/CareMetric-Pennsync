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

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>


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
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    // Admin = role 'admin' or an admin account_type (agency/super), matching the
    // app's role model (src/lib/roles.js) and other backend admin gates.
    const isAdmin = user.role === 'admin' || user.account_type === 'super_admin' || user.account_type === 'agency_admin';
    if (!isAdmin) {
      return Response.json({ error: 'Only administrators can manage payroll profiles.' }, { status: 403 });
    }

    const {
      employee_email,
      phone_reimbursement = 0,
      active = true,
      notes = '',
      service_type,
      earns_points,
    } = (await req.json()) || {};
    const email = String(employee_email || '').trim().toLowerCase();
    if (!email) {
      return Response.json({ error: 'employee_email is required.' }, { status: 400 });
    }
    // Company/service line and points-eligibility. Only home-health staff can be
    // flagged points-eligible; hospice (and home-health office) are hourly.
    const resolvedServiceType = service_type === 'hospice' ? 'hospice' : 'home_health';
    const resolvedEarnsPoints = resolvedServiceType === 'home_health' && earns_points === true;

    // Resolve the employee's display name from their user record (best-effort).
    let employee_name = email;
    let targetUser = null;
    try {
      const users = await base44.asServiceRole.entities.User.filter({ email }, undefined, 5000);
      if (users && users[0]) {
        targetUser = users[0];
        employee_name = users[0].full_name || email;
      }
    } catch (_e) {
      employee_name = email;
    }

    // Agency admins may only write payroll profiles for staff in their agency.
    if (user.account_type !== 'super_admin' && user.agency_name && (user.account_type === 'agency_admin' || user.role === 'admin')) {
      if (!user.agency_name || !targetUser || targetUser.agency_name !== user.agency_name) {
        return Response.json({ error: 'Forbidden: target user is outside your agency.' }, { status: 403 });
      }
    }

    const fields = {
      employee_email: email,
      employee_name,
      service_type: resolvedServiceType,
      earns_points: resolvedEarnsPoints,
      phone_reimbursement: toNonNegativeNumber(phone_reimbursement),
      active: active !== false,
      notes: String(notes || '').slice(0, 1000),
    };

    const existing = await base44.asServiceRole.entities.EmployeePayrollProfile
      .filter({ employee_email: email }, undefined, 5000)
      .catch(() => []);

    let saved;
    if (existing && existing[0]) {
      saved = await base44.asServiceRole.entities.EmployeePayrollProfile.update(existing[0].id, fields);
    } else {
      saved = await base44.asServiceRole.entities.EmployeePayrollProfile.create(fields);
      // Concurrent creates can race past the empty filter above. Re-read and
      // collapse to a single row (keep earliest, delete extras, re-apply fields).
      const afterCreate = await base44.asServiceRole.entities.EmployeePayrollProfile
        .filter({ employee_email: email }, undefined, 20)
        .catch(() => []);
      if (afterCreate && afterCreate.length > 1) {
        const sorted = [...afterCreate].sort((a, b) => {
          const ac = String(a.created_date || '');
          const bc = String(b.created_date || '');
          if (ac !== bc) return ac.localeCompare(bc);
          return String(a.id).localeCompare(String(b.id));
        });
        const keep = sorted[0];
        for (const dup of sorted.slice(1)) {
          await base44.asServiceRole.entities.EmployeePayrollProfile.delete(dup.id).catch(() => {});
        }
        saved = await base44.asServiceRole.entities.EmployeePayrollProfile.update(keep.id, fields);
      }
    }

    return Response.json({ success: true, profile: saved });
  } catch (error) {
    console.error('savePayrollProfile failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
