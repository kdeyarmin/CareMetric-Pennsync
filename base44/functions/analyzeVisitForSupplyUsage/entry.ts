import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: trustedCallerClaims — generated, edit base44/_shared/backendHelpers.mjs>>>
const PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set(['super_admin', 'agency_admin']);
const TRUSTED_CLAIM_AGENCY_STATUSES = new Set(['active', 'trial']);
const TRUSTED_CLAIM_TENANT_ROLES = new Set(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);
const normalizeClaimEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const claimIdentifier = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 200 && value.trim() === value && !value.startsWith('$');
const claimEmail = (value) => typeof value === 'string' && value.length <= 320
  && value.includes('@') && !/\s/.test(value) && value === normalizeClaimEmail(value);
const claimInstant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const claimReason = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 500 && value.trim() === value;
function canonicalClaimMembership(row, userId, normalizedEmail) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const status = row.status;
  return claimIdentifier(row.id) && claimIdentifier(row.agency_id)
    && row.user_id === userId && claimIdentifier(row.membership_key)
    && row.membership_key === row.agency_id + ':' + userId
    && claimEmail(row.user_email_normalized) && row.user_email_normalized === normalizedEmail
    && TRUSTED_CLAIM_TENANT_ROLES.has(row.tenant_role)
    && ['pending', 'active', 'suspended', 'revoked'].includes(status)
    && Number.isSafeInteger(row.version) && row.version >= 1
    && (row.invitation_id == null || claimIdentifier(row.invitation_id))
    && claimIdentifier(row.created_by_user_id) && claimIdentifier(row.last_transition_by_user_id)
    && claimEmail(row.last_transition_by_email_normalized) && claimInstant(row.last_transition_at)
    && claimReason(row.last_transition_reason)
    && (row.activated_at == null || claimInstant(row.activated_at))
    && (!['active', 'suspended'].includes(status) || claimInstant(row.activated_at))
    && (status !== 'pending' || row.activated_at == null)
    && (status === 'revoked'
      ? claimInstant(row.revoked_at) && claimReason(row.revocation_reason)
      : row.revoked_at == null && row.revocation_reason == null);
}
async function loadTrustedTenantClaim(base44, profileId, normalizedEmail) {
  if (!claimIdentifier(profileId) || !claimEmail(normalizedEmail)) return null;
  try {
    // Inspect all lifecycle states before choosing an active membership. An
    // active row plus a revoked/suspended duplicate is never a trusted grant.
    const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: profileId }, undefined, 101,
    );
    if (!Array.isArray(rows) || rows.length > 100
      || rows.some(row => !canonicalClaimMembership(row, profileId, normalizedEmail))) return null;
    for (const key of ['id', 'membership_key', 'agency_id']) {
      if (new Set(rows.map(row => row[key])).size !== rows.length) return null;
    }
    const active = rows.filter(row => row.status === 'active');
    // Legacy callers do not carry an explicit tenant selector. Multiple active
    // memberships cannot safely be resolved by choosing the first result.
    if (active.length !== 1) return null;
    const membership = active[0];
    const agencyId = membership.agency_id;
    const agencies = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
    const agency = Array.isArray(agencies) && agencies.length === 1 ? agencies[0] : null;
    const agencyName = typeof agency?.agency_name === 'string' ? agency.agency_name.trim() : '';
    if (!agency || agency.id !== agencyId || !TRUSTED_CLAIM_AGENCY_STATUSES.has(agency.status)
      || !agencyName || agencyName.length > 200) return null;
    return { tenantRole: membership.tenant_role, agencyId, agencyName };
  } catch {
    // No lookup failure may be interpreted as membership approval.
    return null;
  }
}
async function withTrustedClaims(base44, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  // Preserve the repository's existing protected built-in-admin boundary. This
  // compatibility helper does not grant or change built-in roles.
  if (profile.role === 'admin') return profile;
  const normalizedEmail = normalizeClaimEmail(profile.email);
  const profileId = profile.id;
  const eligible = profile.role === 'user' && profile.is_active !== false
    && profile.disabled !== true && profile.is_service !== true;
  const tenant = eligible ? await loadTrustedTenantClaim(base44, profileId, normalizedEmail) : null;
  const claimedType = String(profile.account_type || '');
  const baseType = PRIVILEGED_PROFILE_ACCOUNT_TYPES.has(claimedType) ? 'user' : claimedType;
  if (tenant) {
    return {
      ...profile,
      account_type: tenant.tenantRole === 'agency_admin' ? 'agency_admin' : baseType,
      agency_name: tenant.agencyName,
      agency_id: tenant.agencyId,
      is_approved: true,
      is_manager: tenant.tenantRole === 'manager' || tenant.tenantRole === 'agency_admin',
    };
  }
  return { ...profile, account_type: baseType, agency_name: '', agency_id: '', is_approved: false, is_manager: false };
}
// <<<END SHARED HELPER: trustedCallerClaims>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { visitId, visitNotes, patientId } = await req.json();

    if (!visitNotes || !patientId) {
      return Response.json(
        { error: 'visitNotes and patientId are required' },
        { status: 400 }
      );
    }

    // Authorize against the patient (assigned nurse or admin) before writing a
    // SupplyUsageLog stamped with this patient_id and decrementing shared
    // SupplyItem inventory. Agency-scoped admins must match patient agency.
    const [supplyPatient] = await base44.asServiceRole.entities.Patient.filter({ id: patientId }, '', 1);
    if (!supplyPatient) return Response.json({ error: 'Patient not found' }, { status: 404 });
    const isSuperAdmin = user.account_type === 'super_admin';
    const isAgencyScopedAdmin =
      user.account_type === 'agency_admin'
      || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
    const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
    const isAssigned = supplyPatient.created_by === user.email
      || (Array.isArray(supplyPatient.assigned_nurses) && supplyPatient.assigned_nurses.includes(user.email));
    if (!isPlatformAdmin && !isAgencyScopedAdmin && !isAssigned) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (isAgencyScopedAdmin) {
      if (!user.agency_name) return Response.json({ error: 'Forbidden' }, { status: 403 });
      const agencyUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
      const agencyEmails = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name && u.email)
          .map((u) => u.email),
      );
      const inAgency = (supplyPatient.created_by && agencyEmails.has(supplyPatient.created_by))
        || (Array.isArray(supplyPatient.assigned_nurses)
          && supplyPatient.assigned_nurses.some((e) => agencyEmails.has(e)));
      if (!inAgency) return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Bind visitId to the authorized patient before logging usage against it.
    if (visitId) {
      const [visit] = await base44.asServiceRole.entities.Visit
        .filter({ id: visitId }, '', 1).catch(() => []);
      if (!visit || visit.patient_id !== patientId) {
        return Response.json({ error: 'Visit not found for this patient' }, { status: 404 });
      }
      // Claim before the slow LLM + inventory writes so concurrent runs cannot
      // both see empty SupplyUsageLog and double-decrement stock.
      const claimToken = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `supply-usage-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try {
        await base44.asServiceRole.entities.Visit.update(visitId, {
          supply_usage_claimed_by: claimToken,
        });
      } catch {
        return Response.json({ error: 'Could not claim visit for supply analysis' }, { status: 409 });
      }
      const claimCheck = await base44.asServiceRole.entities.Visit
        .filter({ id: visitId }, '', 1).catch(() => []);
      if (!claimCheck[0] || claimCheck[0].supply_usage_claimed_by !== claimToken) {
        return Response.json({
          success: true,
          already_processed: true,
          usageLogs: 0,
          alertsCreated: 0,
          alerts: [],
          skipped: 'claimed by concurrent run',
        });
      }
    }

    // Use LLM to extract supply/medication usage from visit notes
    const extractionPrompt = `You are a clinical documentation analyzer. Extract all medications and medical supplies mentioned as being used or administered during this visit. For each supply/medication, identify:
1. Name of the medication or supply
2. Quantity used (extract the number)
3. Unit of measurement (tablets, ml, boxes, etc.)
4. Indication/purpose of use

Return as JSON array with objects: { name, quantity, unit, purpose }. Only include items actually used/administered, not just mentioned.

Visit Notes: "${visitNotes}"

Return ONLY valid JSON array, no other text.`;

    // Call LLM integration
    const analysisResult = await base44.integrations.Core.InvokeLLM({
      prompt: extractionPrompt,
      model: 'automatic',
      response_json_schema: {
        type: 'object',
        properties: {
          supplies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                quantity: { type: 'number' },
                unit: { type: 'string' },
                purpose: { type: 'string' }
              }
            }
          }
        }
      }
    });

    const extractedSupplies = analysisResult?.supplies || [];

    // Look up each supply in SupplyItem entity (bounded to the SDK's 5000/request max)
    const allSupplies = await base44.asServiceRole.entities.SupplyItem.list('-created_date', 5000);
    const usageLogs = [];
    const alertsToCreate = [];

    // Idempotency: a client retry after the slow LLM call (or a double-click) must
    // not create duplicate SupplyUsageLog rows or double-decrement shared
    // inventory. Skip any supply already logged for this visit.
    const alreadyLoggedSupplyIds = new Set();
    if (visitId) {
      const existingUsageLogs = await base44.asServiceRole.entities.SupplyUsageLog.filter({ visit_id: visitId }, '', 5000);
      for (const log of existingUsageLogs) alreadyLoggedSupplyIds.add(log.supply_id);
    }

    // Track the running quantity per supply so two extracted line items that match
    // the SAME SupplyItem in one run both decrement from the latest value instead
    // of the frozen snapshot (which would let the last write clobber the first).
    const runningQuantities = {};

    for (const extracted of extractedSupplies) {
      // The LLM schema marks no field required, so guard against a missing name
      // or a non-numeric/zero quantity: an unchecked value would throw on
      // .toLowerCase() or write NaN into the shared SupplyItem inventory.
      const qty = Number(extracted?.quantity);
      if (!extracted?.name || !Number.isFinite(qty) || qty <= 0) continue;

      // Find matching supply (case-insensitive fuzzy match)
      const extractedName = extracted.name.toLowerCase();
      const matchedSupply = allSupplies.find(s =>
        typeof s.name === 'string' && (
          s.name.toLowerCase().includes(extractedName) ||
          extractedName.includes(s.name.toLowerCase())
        )
      );

      if (matchedSupply) {
        // Already logged for this visit on a prior (retried) run — don't
        // re-decrement inventory or duplicate the log.
        if (alreadyLoggedSupplyIds.has(matchedSupply.id)) continue;

        // Create usage log
        const usageLog = await base44.asServiceRole.entities.SupplyUsageLog.create({
          supply_id: matchedSupply.id,
          supply_name: matchedSupply.name,
          patient_id: patientId,
          visit_id: visitId,
          quantity_used: qty,
          unit: extracted.unit,
          usage_date: new Date().toISOString().split('T')[0],
          documented_by: user.email,
          extracted_from_note: true,
          extraction_confidence: 85,
          notes: extracted.purpose
        });

        usageLogs.push(usageLog);

        // Update supply inventory — decrement from the running quantity (which
        // starts from the snapshot the first time this item is touched this run).
        const baseQuantity = Object.prototype.hasOwnProperty.call(runningQuantities, matchedSupply.id)
          ? runningQuantities[matchedSupply.id]
          : (Number(matchedSupply.current_quantity) || 0);
        const newQuantity = Math.max(0, baseQuantity - qty);
        runningQuantities[matchedSupply.id] = newQuantity;
        await base44.asServiceRole.entities.SupplyItem.update(matchedSupply.id, {
          current_quantity: newQuantity,
          status: newQuantity === 0 ? 'out_of_stock' : 
                  newQuantity <= matchedSupply.low_stock_threshold ? 'low_stock' : 'in_stock',
          last_updated: new Date().toISOString()
        });

        // Check if alert needed
        if (newQuantity <= matchedSupply.low_stock_threshold) {
          const severity = newQuantity === 0 ? 'out_of_stock' : 
                          newQuantity <= (matchedSupply.low_stock_threshold * 0.3) ? 'critical' : 'warning';

          // Check if alert already exists
          const existingAlerts = await base44.asServiceRole.entities.SupplyLowStockAlert.filter({
            supply_id: matchedSupply.id,
            status: 'active'
          }, undefined, 5000);

          if (existingAlerts.length === 0) {
            const alert = await base44.asServiceRole.entities.SupplyLowStockAlert.create({
              supply_id: matchedSupply.id,
              supply_name: matchedSupply.name,
              current_quantity: newQuantity,
              threshold_quantity: matchedSupply.low_stock_threshold,
              recommended_reorder: matchedSupply.reorder_quantity,
              severity,
              status: 'active',
              triggered_date: new Date().toISOString()
            });

            // Auto-create reorder task
            const task = await base44.asServiceRole.entities.Task.create({
              title: `Reorder ${matchedSupply.name}`,
              description: `${matchedSupply.name} is ${severity === 'out_of_stock' ? 'out of stock' : 'running low'}. Current: ${newQuantity} ${matchedSupply.unit}, recommend reordering ${matchedSupply.reorder_quantity} units.`,
              status: 'pending',
              priority: severity === 'critical' ? 'high' : severity === 'out_of_stock' ? 'high' : 'medium',
              assigned_to: user.email,
              due_date: new Date().toISOString().split('T')[0]
            });

            // Link task to alert
            await base44.asServiceRole.entities.SupplyLowStockAlert.update(alert.id, {
              reorder_task_created: true,
              task_id: task.id
            });

            alertsToCreate.push(alert);
          }
        }
      }
    }

    return Response.json({
      success: true,
      usageLogs: usageLogs.length,
      alertsCreated: alertsToCreate.length,
      alerts: alertsToCreate
    });
  } catch (error) {
    console.error('Supply analysis error:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});