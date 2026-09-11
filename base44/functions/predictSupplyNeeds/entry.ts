import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: trustedCallerClaims — generated, edit base44/_shared/backendHelpers.mjs>>>
const PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set(['super_admin', 'agency_admin']);
const TRUSTED_CLAIM_AGENCY_STATUSES = new Set(['active', 'trial']);
const normalizeClaimEmail = (value) => String(value || '').trim().toLowerCase();
async function loadTrustedTenantClaim(base44, profileId, email) {
  if (!profileId || !email) return null;
  let membership = null;
  try {
    const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: profileId, status: 'active' },
      undefined,
      2,
    );
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (row
      && String(row.user_id || '').trim() === profileId
      && String(row.status || '') === 'active'
      && normalizeClaimEmail(row.user_email_normalized) === email
      && typeof row.agency_id === 'string'
      && row.agency_id.trim()) {
      membership = row;
    }
  } catch {
    membership = null;
  }
  if (!membership) return null;
  try {
    const agencyId = membership.agency_id.trim();
    const rows = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
    const agency = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    const agencyName = String(agency?.agency_name || '').trim();
    if (!agency || agency.id !== agencyId || !TRUSTED_CLAIM_AGENCY_STATUSES.has(String(agency.status || ''))
      || !agencyName) {
      return null;
    }
    return { tenantRole: String(membership.tenant_role || ''), agencyId, agencyName };
  } catch {
    return null;
  }
}
async function withTrustedClaims(base44, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  // Protected built-in admins (the platform owner included) already hold
  // platform-level RLS authority, so their legacy self-scoping claims cannot
  // widen access; leave them exactly as the handler saw them before.
  if (profile.role === 'admin') return profile;
  const email = normalizeClaimEmail(profile.email);
  const profileId = typeof profile.id === 'string' ? profile.id.trim() : '';
  const tenant = await loadTrustedTenantClaim(base44, profileId, email);
  const claimedType = String(profile.account_type || '');
  const baseType = PRIVILEGED_PROFILE_ACCOUNT_TYPES.has(claimedType) ? 'user' : claimedType;
  if (tenant) {
    return {
      ...profile,
      account_type: tenant.tenantRole === 'agency_admin' ? 'agency_admin' : baseType,
      agency_name: tenant.agencyName,
      agency_id: tenant.agencyId,
      is_approved: true,
    };
  }
  return { ...profile, account_type: baseType, agency_name: '', agency_id: '', is_approved: false };
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

    const { patientId } = await req.json();

    if (!patientId) {
      return Response.json({ error: 'patientId is required' }, { status: 400 });
    }

    // Fetch the requested patient directly by id. (Previously this scanned a
    // Patient.list() and .find()'d by id, which silently missed records outside
    // the page once an agency exceeds the SDK's per-request cap.)
    const patientData = await base44.asServiceRole.entities.Patient.get(patientId).catch(() => null);

    if (!patientData) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }
    // Authorize against the patient (assigned nurse or admin) before reading
    // their supply usage and writing a SupplyPrediction. The 404 above only
    // covers global non-existence, not access. RLS-independent code check.
    const isSuperAdmin = user.account_type === 'super_admin';
    const isAgencyScopedAdmin =
      user.account_type === 'agency_admin'
      || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
    const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
    const isAssigned = patientData.created_by === user.email
      || (Array.isArray(patientData.assigned_nurses) && patientData.assigned_nurses.includes(user.email));
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
      const inAgency = (patientData.created_by && agencyEmails.has(patientData.created_by))
        || (Array.isArray(patientData.assigned_nurses)
          && patientData.assigned_nurses.some((e) => agencyEmails.has(e)));
      if (!inAgency) return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get 6 months of usage logs for this patient
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const sixMonthsAgoStr = sixMonthsAgo.toISOString().split('T')[0];

    const usageLogs = await base44.asServiceRole.entities.SupplyUsageLog.filter({
      patient_id: patientId,
      usage_date: { $gte: sixMonthsAgoStr }
    }, undefined, 5000);

    // Get all supplies (bounded to the SDK's 5000/request max)
    const allSupplies = await base44.asServiceRole.entities.SupplyItem.list('-created_date', 5000);

    // Group usage by supply
    const usageBySupply = {};
    usageLogs.forEach(log => {
      if (!usageBySupply[log.supply_id]) {
        usageBySupply[log.supply_id] = [];
      }
      usageBySupply[log.supply_id].push({
        date: log.usage_date,
        quantity: log.quantity_used
      });
    });

    // Generate predictions for each supply
    const predictions = [];
    const now = new Date();

    for (const supplyId in usageBySupply) {
      const supply = allSupplies.find(s => s.id === supplyId);
      if (!supply) continue;

      const usageData = usageBySupply[supplyId];
      if (usageData.length < 2) continue; // Need at least 2 data points

      // Calculate monthly usage
      const monthlyUsage = {};
      usageData.forEach(u => {
        const date = new Date(u.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthlyUsage[monthKey] = (monthlyUsage[monthKey] || 0) + u.quantity;
      });

      const months = Object.keys(monthlyUsage).sort();
      const quantities = months.map(m => monthlyUsage[m]);

      // Calculate trend
      const avgUsage = quantities.reduce((a, b) => a + b, 0) / quantities.length;
      const recentAvg = quantities.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, quantities.length);
      
      let trend = 'stable';
      if (recentAvg > avgUsage * 1.2) trend = 'increasing';
      else if (recentAvg < avgUsage * 0.8) trend = 'decreasing';

      // Calculate confidence (based on data consistency)
      const variance = quantities.reduce((sum, q) => sum + Math.pow(q - avgUsage, 2), 0) / quantities.length;
      const stdDev = Math.sqrt(variance);
      const coeffVar = avgUsage > 0 ? (stdDev / avgUsage) * 100 : 0;
      const confidence = Math.max(50, Math.min(95, 100 - (coeffVar / 2)));

      // Predict next order date. Guard against zero predicted usage: dividing by
      // it yields Infinity, and setDate(+Infinity) makes an Invalid Date whose
      // toISOString() throws — 500-ing an otherwise valid request.
      const predictedMonthlyUsage = trend === 'increasing' ? recentAvg : trend === 'decreasing' ? Math.max(avgUsage * 0.8, recentAvg) : avgUsage;
      const dailyUsage = predictedMonthlyUsage / 30;
      const daysUntilReorder = dailyUsage > 0
        ? Math.ceil((supply.current_quantity - supply.low_stock_threshold) / dailyUsage)
        : null;
      const nextOrderDate = new Date(now);
      const hasReorderDate = daysUntilReorder !== null && Number.isFinite(daysUntilReorder);
      if (hasReorderDate) {
        nextOrderDate.setDate(nextOrderDate.getDate() + daysUntilReorder);
      }

      // Recommended 3-month supply
      const recommendedQty = Math.ceil(predictedMonthlyUsage * 3);

      const prediction = {
        patient_id: patientId,
        supply_id: supplyId,
        supply_name: supply.name,
        predicted_monthly_usage: Math.round(predictedMonthlyUsage * 10) / 10,
        confidence_score: Math.round(confidence),
        usage_trend: trend,
        predicted_next_order_date: hasReorderDate ? nextOrderDate.toISOString().split('T')[0] : null,
        recommended_quantity: recommendedQty,
        current_inventory: supply.current_quantity,
        estimated_days_until_reorder_needed: hasReorderDate ? daysUntilReorder : null,
        analysis_data: {
          monthly_breakdown: monthlyUsage,
          data_points: quantities.length,
          months_analyzed: months,
          trend_analysis: {
            avg_usage: Math.round(avgUsage * 10) / 10,
            recent_avg: Math.round(recentAvg * 10) / 10,
            std_deviation: Math.round(stdDev * 10) / 10
          }
        },
        generated_date: new Date().toISOString()
      };

      // Save prediction
      await base44.asServiceRole.entities.SupplyPrediction.create(prediction);
      predictions.push(prediction);
    }

    return Response.json({
      success: true,
      patient_id: patientId,
      predictions_generated: predictions.length,
      predictions: predictions.sort((a, b) => a.estimated_days_until_reorder_needed - b.estimated_days_until_reorder_needed)
    });
  } catch (error) {
    console.error('Prediction error:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});