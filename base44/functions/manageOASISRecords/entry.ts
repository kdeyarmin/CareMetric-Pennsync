import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
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
// <<<BEGIN SHARED HELPER: isSafeFetchUrl — generated, edit base44/_shared/backendHelpers.mjs>>>
// SSRF guard: only fetch https URLs on the app's own storage/app hosts, never
// internal IPs / metadata. The allowlist is hardcoded (always-on, fail-closed)
// rather than env-configured; add a host here if file storage ever moves.
const FILE_URL_ALLOWED_HOSTS = ['qtrypzzcjebvfcihiynt.supabase.co', 'base44.app', 'base44.io'];
function isSafeFetchUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (['localhost', '0.0.0.0', '127.0.0.1', '::1', '169.254.169.254'].includes(host)) return false;
  if (host.endsWith('.internal') || host.endsWith('.local')) return false;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  if (!FILE_URL_ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return false;
  return true;
}
// <<<END SHARED HELPER: isSafeFetchUrl>>>
// <<<BEGIN SHARED HELPER: oasisChartAccess — generated, edit base44/_shared/backendHelpers.mjs>>>
async function assertOasisChartAccess(base44, user, patient) {
  if (!patient) return Response.json({ error: 'Patient not found' }, { status: 404 });
  if (user.role === 'admin') return null;
  const agencyId = typeof user.agency_id === 'string' ? user.agency_id : '';
  if (!agencyId || patient.agency_id !== agencyId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (user.account_type === 'agency_admin' || user.is_manager === true) return null;
  const email = String(user.email || '').trim().toLowerCase();
  if (email && String(patient.created_by_user_email_normalized || '') === email
    && patient.created_by_user_id === user.id) return null;
  const assignments = await base44.asServiceRole.entities.PatientCareTeamAssignment.filter(
    { agency_id: agencyId, patient_id: patient.id, user_id: user.id }, '-updated_date', 5,
  ).catch(() => []);
  const active = (Array.isArray(assignments) ? assignments : []).some((row) => (
    row?.status === 'active'
    && row.agency_id === agencyId
    && row.patient_id === patient.id
    && row.user_id === user.id
  ));
  return active ? null : Response.json({ error: 'Forbidden' }, { status: 403 });
}
// <<<END SHARED HELPER: oasisChartAccess>>>
// <<<BEGIN SHARED HELPER: oasisRecordScope — generated, edit base44/_shared/backendHelpers.mjs>>>
function oasisCallerScope(user) {
  if (!user || typeof user !== 'object') return null;
  const userId = typeof user.id === 'string' ? user.id : '';
  const email = String(user.email || '').trim().toLowerCase();
  if (!userId || !email) return null;
  if (user.role === 'admin') return { platform: true, lead: true, agencyId: '', userId, email };
  const agencyId = typeof user.agency_id === 'string' ? user.agency_id : '';
  if (!agencyId) return null;
  const lead = user.account_type === 'agency_admin' || user.is_manager === true;
  return { platform: false, lead, agencyId, userId, email };
}
async function oasisOpenablePatientIds(base44, scope) {
  // null means "every chart in scope": the platform owner and an agency lead.
  if (!scope || scope.platform || scope.lead) return null;
  const entities = base44.asServiceRole.entities;
  const [created, seats] = await Promise.all([
    entities.Patient.filter(
      { agency_id: scope.agencyId, created_by_user_id: scope.userId }, '-updated_date', 2000,
    ).catch(() => []),
    entities.PatientCareTeamAssignment.filter(
      { agency_id: scope.agencyId, user_id: scope.userId, status: 'active' }, '-updated_date', 2000,
    ).catch(() => []),
  ]);
  const ids = new Set();
  for (const row of Array.isArray(created) ? created : []) {
    if (row?.agency_id === scope.agencyId && row.created_by_user_id === scope.userId
      && String(row.created_by_user_email_normalized || '') === scope.email) ids.add(row.id);
  }
  for (const row of Array.isArray(seats) ? seats : []) {
    if (row?.status === 'active' && row.agency_id === scope.agencyId && row.user_id === scope.userId) {
      ids.add(row.patient_id);
    }
  }
  return ids;
}
// <<<END SHARED HELPER: oasisRecordScope>>>
// <<<BEGIN SHARED HELPER: oasisAuditFlag — generated, edit base44/_shared/backendHelpers.mjs>>>
// Generated verbatim from src/components/oasis/oasisAuditFlag.js.
const OASIS_AUDIT_THRESHOLDS = {"accuracy":75,"compliance":80,"overall":70};
function buildOasisAuditRecord(upload, analysisResults, thresholds) {
  if (!upload || !analysisResults || typeof analysisResults !== 'object') return null;
  const limits = thresholds || { accuracy: 75, compliance: 80, overall: 70 };
  const score = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const accuracy = score(analysisResults.accuracy_score);
  const compliance = score(analysisResults.compliance_score);
  const overall = score(analysisResults.overall_score);
  const below = (value, limit) => value !== null && value < limit;

  const shouldFlag = below(accuracy, limits.accuracy)
    || below(compliance, limits.compliance)
    || below(overall, limits.overall);
  if (!shouldFlag) return null;

  const list = (value) => (Array.isArray(value) ? value : []);
  const text = (value, max) => {
    if (value === null || value === undefined) return '';
    const s = typeof value === 'string' ? value : String(value);
    return s.length > max ? s.slice(0, max) : s;
  };

  // Each arm lines up with a trigger above, so a record flagged for one reason
  // is never mislabeled with another.
  let flagReason = 'low_accuracy';
  let priority = 'medium';
  if (below(accuracy, 60)) {
    flagReason = 'low_accuracy';
    priority = 'critical';
  } else if (below(compliance, limits.compliance)) {
    flagReason = 'low_compliance';
    priority = 'high';
  } else if (list(analysisResults.audit_risk_areas).some((r) => r && r.risk_level === 'high')) {
    flagReason = 'high_audit_risk';
    priority = 'high';
  } else if (below(accuracy, limits.accuracy)) {
    flagReason = 'low_accuracy';
    priority = 'high';
  } else if (below(overall, limits.overall)) {
    flagReason = 'low_overall_score';
    priority = 'high';
  }

  const keyIssues = [];
  for (const issue of list(analysisResults.accuracy_issues).slice(0, 5)) {
    keyIssues.push({
      category: 'accuracy',
      item: text(issue && issue.item, 120),
      issue: text(issue && issue.issue, 1000),
      severity: text(issue && issue.severity, 40),
      recommendation: text(issue && issue.recommendation, 1000),
    });
  }
  for (const concern of list(analysisResults.compliance_concerns).slice(0, 3)) {
    keyIssues.push({
      category: 'compliance',
      item: text(concern && concern.area, 120),
      issue: text(concern && concern.issue, 1000),
      severity: text(concern && concern.severity, 40),
      recommendation: text(concern && concern.recommendation, 1000),
    });
  }
  for (const risk of list(analysisResults.audit_risk_areas).slice(0, 3)) {
    keyIssues.push({
      category: 'audit_risk',
      item: text(risk && risk.area, 120),
      issue: text(risk && risk.explanation, 1000),
      severity: text(risk && risk.risk_level, 40),
      recommendation: text(risk && risk.mitigation, 1000),
    });
  }

  const documentationGaps = list(analysisResults.documentation_gaps).slice(0, 20).map((gap) => ({
    m_item: text(gap && (gap.m_item_code || gap.m_item), 40),
    gap_description: text(gap && gap.gap_description, 1000),
    question: text(gap && (gap.documentation_question || gap.question), 1000),
    supporting_documentation: text(gap && gap.supporting_documentation, 1000),
  }));

  const shown = (value) => (value === null ? 'N/A' : `${value}%`);
  return {
    oasis_upload_id: upload.id,
    patient_id: upload.patient_id || null,
    patient_name: text(upload.patient_name, 200),
    flag_reason: flagReason,
    priority,
    status: 'pending_review',
    accuracy_score: accuracy,
    compliance_score: compliance,
    overall_score: overall,
    key_issues: keyIssues,
    documentation_gaps: documentationGaps,
    summary: `Auto-flagged (${flagReason}) at ${priority} priority — accuracy ${shown(accuracy)}, `
      + `compliance ${shown(compliance)}, overall ${shown(overall)}.`,
  };
}
// <<<END SHARED HELPER: oasisAuditFlag>>>
// <<<BEGIN SHARED HELPER: oasisExtractedItems — generated, edit base44/_shared/backendHelpers.mjs>>>
// Generated verbatim from src/components/oasis/oasisExtractedItems.js.
const OASIS_EXTRACTED_ITEM_MAP = [["M1800","Grooming","functional_scores","m1800_grooming"],["M1810","Current ability to dress upper body","functional_scores","m1810_dress_upper"],["M1820","Current ability to dress lower body","functional_scores","m1820_dress_lower"],["M1830","Bathing","functional_scores","m1830_bathing"],["M1840","Toilet transferring","functional_scores","m1840_toilet_transfer"],["M1850","Transferring","functional_scores","m1850_transferring"],["M1860","Ambulation/locomotion","functional_scores","m1860_ambulation"],["M1400","Dyspnea","clinical_items","dyspnea"],["M1242","Frequency of pain","clinical_items","pain_frequency"]];
function buildExtractedReviewItems(pdgmData, itemMap, extractedAt) {
  const rows = {};
  if (!pdgmData || typeof pdgmData !== 'object' || !Array.isArray(itemMap)) return rows;
  for (const entry of itemMap) {
    if (!Array.isArray(entry) || entry.length !== 4) continue;
    const [itemNumber, label, group, field] = entry;
    const bag = pdgmData[group];
    if (!bag || typeof bag !== 'object') continue;
    const raw = bag[field];
    if (raw === null || raw === undefined || raw === '') continue;
    if (typeof raw !== 'number' && typeof raw !== 'string') continue;
    const value = String(raw).trim().slice(0, 40);
    if (!value) continue;
    rows[itemNumber] = {
      value,
      item_label: label,
      source: 'pdf_extraction',
      extracted_at: extractedAt,
    };
  }
  return rows;
}
// <<<END SHARED HELPER: oasisExtractedItems>>>
// <<<BEGIN SHARED HELPER: oasisWorkflowRules — generated, edit base44/_shared/backendHelpers.mjs>>>
// Generated verbatim from src/components/oasis/workflowEngineUtils.js.
const deriveActionTypes = (rule = {}) => {
  const configuredActions = rule?.action_config?.actions;
  if (Array.isArray(configuredActions) && configuredActions.length > 0) {
    return configuredActions;
  }

  if (rule?.action_type) {
    return [rule.action_type];
  }

  return [];
};
const evaluateRuleTrigger = (rule = {}, analysis = {}, _pdgm = {}) => {
  const conditions = rule.trigger_conditions || {};
  let triggered = false;
  let reason = "";
  let context = {};

  switch (rule.trigger_type) {
    case "compliance_issue":
      if (analysis.compliance_score == null) break;
      if (analysis.compliance_score < (conditions.score_value ?? 80)) {
        triggered = true;
        reason = `Compliance score ${analysis.compliance_score}% below threshold`;
        context = {
          compliance_score: analysis.compliance_score,
          concerns: analysis.compliance_concerns?.slice(0, 3) || []
        };
      }
      break;

    case "accuracy_concern":
      if (analysis.accuracy_score == null) break;
      if (analysis.accuracy_score < (conditions.score_value ?? 80)) {
        triggered = true;
        reason = `Accuracy score ${analysis.accuracy_score}% below threshold`;
        context = {
          accuracy_score: analysis.accuracy_score,
          issues: analysis.accuracy_issues?.slice(0, 3) || []
        };
      }
      break;

    case "score_threshold": {
      const scoreType = conditions.score_type || "overall";
      const scoreMap = {
        overall: analysis.overall_score,
        compliance: analysis.compliance_score,
        accuracy: analysis.accuracy_score
      };
      const scoreToCheck = scoreMap[scoreType];
      if (scoreToCheck == null) break;

      const meetsCondition =
        conditions.score_operator === "less_than"
          ? scoreToCheck < conditions.score_value
          : conditions.score_operator === "greater_than"
            ? scoreToCheck > conditions.score_value
            : scoreToCheck === conditions.score_value;

      if (meetsCondition) {
        triggered = true;
        reason = `${scoreType} score ${scoreToCheck}% ${conditions.score_operator?.replace("_", " ")} ${conditions.score_value}%`;
        context = { score: scoreToCheck };
      }
      break;
    }

    case "specific_m_item": {
      const flaggedItems = analysis.accuracy_issues?.filter((issue) =>
        conditions.m_item_codes?.includes(issue.item)
      ) || [];

      if (flaggedItems.length > 0) {
        triggered = true;
        reason = "Targeted M-items flagged for review";
        context = { flagged_items: flaggedItems };
      }
      break;
    }

    case "missing_documentation":
      if ((analysis.missing_high_value_documentation?.length || 0) > 0) {
        triggered = true;
        reason = "Missing high-value documentation detected";
        context = {
          missing_docs: analysis.missing_high_value_documentation?.slice(0, 3) || []
        };
      }
      break;

    case "clinical_concern": {
      const keywords = (conditions.keywords || [])
        .map((keyword) => String(keyword).toLowerCase().trim())
        .filter(Boolean);

      // Gather clinical signal text from wherever the analysis surfaces it.
      const clinicalSignals = [
        ...(analysis.clinical_concerns || []),
        ...(analysis.compliance_concerns || []),
        ...(analysis.accuracy_issues || []),
        ...(analysis.audit_risk_areas || [])
      ].map((signal) =>
        (typeof signal === "string" ? signal : JSON.stringify(signal)).toLowerCase()
      );

      // With keywords: match them against all clinical signals. Without keywords:
      // only fire on a dedicated clinical_concerns list so this doesn't become an
      // always-on duplicate of the compliance/accuracy rules.
      const matchingSignals = keywords.length > 0
        ? clinicalSignals.filter((signal) => keywords.some((keyword) => signal.includes(keyword)))
        : (analysis.clinical_concerns || []).map((concern) =>
            typeof concern === "string" ? concern : JSON.stringify(concern)
          );

      if (matchingSignals.length > 0) {
        triggered = true;
        reason = keywords.length > 0
          ? "Clinical concern keywords matched in assessment"
          : "Clinical concerns identified in assessment";
        context = { matched_signals: matchingSignals.slice(0, 3) };
      }
      break;
    }

    default:
      break;
  }

  return { triggered, reason, context };
};
// <<<END SHARED HELPER: oasisWorkflowRules>>>

// The OASIS Center's record broker. Released by the owner on 2026-10-08 ("turn
// everything on"): every OASIS record the center reads or writes beyond the
// caller's own uploads goes through here, because each of those entities denies
// every direct client operation and the profile fields a browser could use to
// claim a wider scope (agency_id, agency_name, account_type, is_manager,
// assigned_nurses) are all self-editable.
//
// Authority, in every action, comes from three trusted places only:
//   * the built-in admin role (protected from auth.updateMe) — the platform owner;
//   * the caller's one active AgencyMembership, through withTrustedClaims; and
//   * an exact active PatientCareTeamAssignment or the patient's recorded creator,
//     through assertOasisChartAccess, before any patient-bound read or write.
// The scope is decided before the request body is read, and every write that
// names a patient is refused unless the caller may open that chart.
//
// Writes are idempotent where a retry could duplicate: an upload is keyed on its
// analysis id and author, a task on the caller's own client key, and a workflow
// run on (upload, rule). Base44 has no unique constraint, so each keyed create is
// read back and, if a concurrent twin landed, this request's own row is removed
// and the conflict reported — the same shape createAuthorizedPatient uses.
//
// No money: payment, reimbursement, revenue and rescore keys are stripped from
// everything stored or returned.

const MAX_BODY_BYTES = 1_500_000;
const MAX_ID = 200;
const MAX_TASKS = 25;
const SCAN_LIMIT = 500;
const NO_STORE = { 'Cache-Control': 'no-store' };

const UPLOAD_ASSESSMENT_TYPES = new Set(['SOC', 'ROC', 'Recertification', 'Follow-up', 'Transfer', 'Discharge', 'Other']);
const AUDIT_STATUSES = new Set(['compliant', 'flagged', 'critical', 'pending_review', 'in_review', 'reviewed']);
const TASK_TYPES = new Set(['call', 'notify', 'schedule', 'order', 'coordinate', 'document', 'safety', 'followup', 'other']);
const TASK_PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);
const RULE_TRIGGERS = new Set([
  'compliance_issue', 'accuracy_concern', 'missing_documentation',
  'score_threshold', 'specific_m_item', 'clinical_concern',
]);
const RULE_ACTIONS = new Set(['create_task', 'create_alert', 'notify_clinician', 'flag_for_review']);
const SCORE_OPERATORS = new Set(['less_than', 'greater_than', 'equals']);
const SCORE_TYPES = new Set(['overall', 'compliance', 'accuracy']);
const LEAD_ROLES = new Set(['agency_admin', 'manager']);
const FEEDBACK_TYPES = new Set(['incorrect_match', 'correct_match', 'manual_override']);

// Recursively drop money-shaped keys. PDGM payment was removed from the product;
// a legacy record or a model answer that still carries one never leaves here.
const FINANCIAL_KEY = /revenue|payment|reimburs|rescore/i;
function stripFinancial(value, depth = 0) {
  if (depth > 24) return null;
  if (Array.isArray(value)) return value.map((item) => stripFinancial(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (FINANCIAL_KEY.test(key)) continue;
      out[key] = stripFinancial(item, depth + 1);
    }
    return out;
  }
  return value;
}

class PublicError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

function exactId(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID
    && value.trim() === value && !value.startsWith('$') ? value : '';
}

function text(value: unknown, max: number) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function plainObject(value: unknown) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function rows(value: unknown) {
  return Array.isArray(value) ? value : [];
}

async function readBody(req: Request) {
  const stated = req.headers.get('content-length');
  if (stated !== null && (!/^\d+$/.test(stated) || Number(stated) > MAX_BODY_BYTES)) {
    throw new PublicError(413, 'Request body is too large');
  }
  const raw = await req.text().catch(() => '');
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let body: any;
  try { body = JSON.parse(raw || '{}'); } catch { throw new PublicError(400, 'Invalid JSON body'); }
  if (!plainObject(body)) throw new PublicError(400, 'Request body must be an object');
  return body;
}

async function loadPatient(entities: any, patientId: string) {
  const found = rows(await entities.Patient.filter({ id: patientId }, undefined, 2).catch(() => []));
  return found.length === 1 && found[0]?.id === patientId ? found[0] : null;
}

/** The chart, when the caller may open it; otherwise a PublicError. */
async function openChart(base44: any, user: any, patientId: unknown) {
  const id = exactId(patientId);
  if (!id) throw new PublicError(400, 'patient_id is invalid');
  const patient = await loadPatient(base44.asServiceRole.entities, id);
  const denied = await assertOasisChartAccess(base44, user, patient);
  if (denied) throw new PublicError(denied.status === 404 ? 404 : 403, denied.status === 404 ? 'Patient not found' : 'Forbidden');
  return patient;
}

function patientDisplayName(patient: any) {
  return [patient?.first_name, patient?.last_name]
    .filter((part) => typeof part === 'string' && part.trim()).join(' ').trim();
}

function requireLead(scope: any) {
  if (!scope.platform && !scope.lead) throw new PublicError(403, 'An agency administrator or manager is required');
}

function requirePlatform(scope: any) {
  if (!scope.platform) throw new PublicError(403, 'Only the platform administrator can change OASIS automation rules');
}

/**
 * Whether the caller may see and work on a saved upload: the platform owner;
 * an agency lead for an upload in their agency; its author; or anyone who may
 * open the chart it is linked to.
 */
async function uploadAccess(base44: any, user: any, scope: any, upload: any) {
  if (!upload) return false;
  if (scope.platform) return true;
  const author = String(upload.created_by || '').trim().toLowerCase() === scope.email;
  if (upload.agency_id && upload.agency_id !== scope.agencyId) return false;
  if (!upload.agency_id) return author;
  if (scope.lead || author) return true;
  if (!upload.patient_id) return false;
  const patient = await loadPatient(base44.asServiceRole.entities, upload.patient_id);
  if (!patient) return false;
  return !(await assertOasisChartAccess(base44, user, patient));
}

async function loadUpload(entities: any, uploadId: unknown) {
  const id = exactId(uploadId);
  if (!id) throw new PublicError(400, 'upload_id is invalid');
  const found = rows(await entities.OASISUpload.filter({ id }, undefined, 2));
  if (found.length !== 1 || found[0]?.id !== id) throw new PublicError(404, 'OASIS upload not found');
  return found[0];
}

const UPLOAD_FIELDS = [
  'id', 'agency_id', 'patient_id', 'patient_name', 'file_url', 'file_name', 'assessment_date',
  'assessment_type', 'analysis_id', 'pdgm_data', 'analysis_results', 'scores', 'status', 'notes',
  'extracted_data', 'supervisor_review_status', 'supervisor_reviewed_by', 'supervisor_reviewed_at',
  'comprehensive_review', 'created_by', 'created_date', 'updated_date',
];
function projectUpload(row: any) {
  const out: Record<string, unknown> = {};
  for (const field of UPLOAD_FIELDS) if (row?.[field] !== undefined) out[field] = row[field];
  return stripFinancial(out);
}

/**
 * A conditional write: succeeds only when the row still carries the
 * updated_date it was read at, so two reviewers cannot silently overwrite each
 * other's half of extracted_data.
 */
async function compareAndSet(entities: any, entity: string, row: any, patch: Record<string, unknown>) {
  const result = await entities[entity].updateMany(
    { id: row.id, updated_date: row.updated_date },
    { $set: patch },
  );
  if (result?.success !== true || result.updated !== 1) {
    throw new PublicError(409, 'This record changed while you were working on it. Reload and try again.');
  }
}

/**
 * Create a row once per key. A retry finds the first one; a concurrent twin is
 * detected on read-back and this request's own row is removed, so the key never
 * names two rows.
 */
async function createKeyedOnce(entities: any, entity: string, keyField: string, key: string, payload: Record<string, unknown>) {
  const before = rows(await entities[entity].filter({ [keyField]: key }, 'created_date', 5))
    .filter((row) => row?.[keyField] === key);
  if (before.length > 0) return { row: before[0], created: false };
  const created = await entities[entity].create({ ...payload, [keyField]: key });
  const createdId = exactId(created?.id);
  if (!createdId) throw new PublicError(502, `${entity} create returned no id`);
  const after = rows(await entities[entity].filter({ [keyField]: key }, 'created_date', 5))
    .filter((row) => row?.[keyField] === key);
  if (after.length !== 1 || after[0].id !== createdId) {
    await entities[entity].delete(createdId).catch(() => {});
    throw new PublicError(409, 'A concurrent request is creating the same record. Try again.');
  }
  return { row: after[0], created: true };
}

// ─── Uploads ─────────────────────────────────────────────────────────────────

async function createUpload({ base44, user, scope, body }: any) {
  const entities = base44.asServiceRole.entities;
  const analysisId = exactId(body.analysis_id);
  if (!analysisId) throw new PublicError(400, 'analysis_id is required');
  const fileUrl = typeof body.file_url === 'string' ? body.file_url : '';
  if (!isSafeFetchUrl(fileUrl)) throw new PublicError(400, 'The OASIS document must be uploaded to PennSync first');

  let patient: any = null;
  if (body.patient_id !== undefined && body.patient_id !== null && body.patient_id !== '') {
    patient = await openChart(base44, user, body.patient_id);
  }
  const agencyId = patient ? patient.agency_id : scope.agencyId;

  const prior = rows(await entities.OASISUpload.filter(
    { analysis_id: analysisId, created_by: scope.email }, 'created_date', 5,
  )).filter((row) => row?.analysis_id === analysisId && row.created_by === scope.email);
  if (prior.length > 0) return json({ created: false, upload: projectUpload(prior[0]), audit_flagged: null });

  const analysisResults = plainObject(body.analysis_results) ? stripFinancial(body.analysis_results) : null;
  if (!analysisResults) throw new PublicError(400, 'analysis_results is required');
  const pdgmData = plainObject(body.pdgm_data) ? stripFinancial(body.pdgm_data) : {};
  const scores = plainObject(body.scores) ? stripFinancial(body.scores) : {};
  const nowIso = new Date().toISOString();
  const assessmentType = UPLOAD_ASSESSMENT_TYPES.has(body.assessment_type) ? body.assessment_type : 'Other';

  const record: Record<string, unknown> = {
    agency_id: agencyId || '',
    patient_id: patient ? patient.id : null,
    patient_name: patient ? patientDisplayName(patient) : text(body.patient_name, 200),
    file_url: fileUrl,
    file_name: text(body.file_name, 255) || 'OASIS Document',
    assessment_date: text(body.assessment_date, 40),
    assessment_type: assessmentType,
    analysis_id: analysisId,
    pdgm_data: pdgmData,
    analysis_results: analysisResults,
    scores,
    extracted_data: buildExtractedReviewItems(pdgmData, OASIS_EXTRACTED_ITEM_MAP, nowIso),
    derived_value_origin: 'ai_extracted',
    status: 'analyzed',
    created_by: scope.email,
  };
  if (plainObject(body.comprehensive_review)) record.comprehensive_review = stripFinancial(body.comprehensive_review);

  const created = await entities.OASISUpload.create(record);
  const createdId = exactId(created?.id);
  if (!createdId) throw new PublicError(502, 'OASIS upload create returned no id');
  const twins = rows(await entities.OASISUpload.filter(
    { analysis_id: analysisId, created_by: scope.email }, 'created_date', 5,
  )).filter((row) => row?.analysis_id === analysisId && row.created_by === scope.email);
  if (twins.length !== 1 || twins[0].id !== createdId) {
    await entities.OASISUpload.delete(createdId).catch(() => {});
    throw new PublicError(409, 'This analysis is already being saved. Reload the saved list.');
  }
  const saved = twins[0];

  // The audit flag is the analysis's own verdict, decided here, never sent in.
  let auditFlagged = false;
  try {
    const audit = buildOasisAuditRecord(saved, analysisResults, OASIS_AUDIT_THRESHOLDS);
    if (audit) {
      await createKeyedOnce(entities, 'OASISAudit', 'oasis_upload_id', saved.id, {
        ...audit,
        user_email: scope.email,
        analysis_date: nowIso,
        created_by: scope.email,
      });
      auditFlagged = true;
    }
  } catch (error) {
    console.error('manageOASISRecords: audit flag was not recorded', error instanceof PublicError ? error.message : 'error');
  }
  return json({ created: true, upload: projectUpload(saved), audit_flagged: auditFlagged });
}

async function saveComprehensiveReview({ base44, user, scope, body }: any) {
  const entities = base44.asServiceRole.entities;
  const upload = await loadUpload(entities, body.upload_id);
  if (!(await uploadAccess(base44, user, scope, upload))) throw new PublicError(404, 'OASIS upload not found');
  if (!plainObject(body.comprehensive_review)) throw new PublicError(400, 'comprehensive_review is required');
  await entities.OASISUpload.update(upload.id, { comprehensive_review: stripFinancial(body.comprehensive_review) });
  return json({ saved: true });
}

async function reviewExtractedItem({ base44, user, scope, body }: any) {
  const entities = base44.asServiceRole.entities;
  const upload = await loadUpload(entities, body.upload_id);
  if (!(await uploadAccess(base44, user, scope, upload))) throw new PublicError(404, 'OASIS upload not found');
  if (upload.supervisor_review_status === 'approved') {
    throw new PublicError(409, 'A supervisor has already signed this review off');
  }
  const itemNumber = text(body.item_number, 40);
  const items = plainObject(upload.extracted_data) ? upload.extracted_data : {};
  if (!itemNumber || !plainObject(items[itemNumber])) throw new PublicError(404, 'That item is not on this upload');
  const decision = body.decision;
  const notes = text(body.notes, 1000);
  const stamp = { reviewed: true, reviewed_by: scope.email, reviewed_at: new Date().toISOString() };
  const current = items[itemNumber];
  let next: Record<string, unknown>;
  if (decision === 'approve') {
    next = { ...current, ...stamp, approved: true, rejected: false, review_notes: notes };
  } else if (decision === 'reject') {
    if (!notes) throw new PublicError(400, 'A reason is required to reject an extracted value');
    next = { ...current, ...stamp, approved: false, rejected: true, rejection_reason: notes };
  } else if (decision === 'edit') {
    const value = text(typeof body.value === 'number' ? String(body.value) : body.value, 40);
    if (!value) throw new PublicError(400, 'A corrected value is required');
    next = {
      ...current, ...stamp, value, approved: false, rejected: false, manually_edited: true,
      original_value: current.original_value ?? current.value, edit_notes: notes,
    };
  } else {
    throw new PublicError(400, 'decision must be approve, reject or edit');
  }
  await compareAndSet(entities, 'OASISUpload', upload, { extracted_data: { ...items, [itemNumber]: next } });
  return json({ saved: true, item: next });
}

async function supervisorDecision({ base44, user, scope, body }: any) {
  requireLead(scope);
  const entities = base44.asServiceRole.entities;
  const upload = await loadUpload(entities, body.upload_id);
  if (!(await uploadAccess(base44, user, scope, upload))) throw new PublicError(404, 'OASIS upload not found');
  const decision = body.decision;
  if (decision !== 'approve' && decision !== 'reject') throw new PublicError(400, 'decision must be approve or reject');
  const notes = text(body.notes, 2000);
  if (decision === 'reject' && !notes) throw new PublicError(400, 'Rejection notes are required');
  const nowIso = new Date().toISOString();
  const items = plainObject(upload.extracted_data) ? { ...upload.extracted_data } : {};
  const signed: string[] = [];
  for (const [key, item] of Object.entries(items)) {
    if (!plainObject(item) || !(item as any).reviewed || (item as any).supervisor_approved) continue;
    items[key] = {
      ...(item as any),
      supervisor_approved: decision === 'approve',
      supervisor_rejected: decision === 'reject',
      approved_by: scope.email,
      approval_date: nowIso,
      approval_notes: notes,
    };
    signed.push(key);
  }
  await compareAndSet(entities, 'OASISUpload', upload, {
    extracted_data: items,
    supervisor_review_status: decision === 'approve' ? 'approved' : 'rejected',
    supervisor_reviewed_by: scope.email,
    supervisor_reviewed_at: nowIso,
    status: decision === 'approve' ? 'reviewed' : upload.status,
  });
  return json({ saved: true, items_signed: signed });
}

// ─── Audit queue ─────────────────────────────────────────────────────────────

/** The agency each audit belongs to, read from its upload, else its patient. */
async function auditAgencies(entities: any, audits: any[]) {
  const uploadIds = [...new Set(audits.map((a) => a?.oasis_upload_id).filter((id) => exactId(id)))];
  const byUpload = new Map();
  if (uploadIds.length) {
    for (const row of rows(await entities.OASISUpload.filter({ id: { $in: uploadIds } }, undefined, uploadIds.length))) {
      if (row?.id) byUpload.set(row.id, row.agency_id || '');
    }
  }
  const patientIds = [...new Set(audits
    .filter((a) => !byUpload.get(a?.oasis_upload_id))
    .map((a) => a?.patient_id).filter((id) => exactId(id)))];
  const byPatient = new Map();
  if (patientIds.length) {
    for (const row of rows(await entities.Patient.filter({ id: { $in: patientIds } }, undefined, patientIds.length))) {
      if (row?.id) byPatient.set(row.id, row.agency_id || '');
    }
  }
  return (audit: any) => byUpload.get(audit?.oasis_upload_id) || byPatient.get(audit?.patient_id) || '';
}

const AUDIT_FIELDS = [
  'id', 'oasis_upload_id', 'patient_id', 'patient_name', 'user_email', 'status', 'priority', 'flag_reason',
  'summary', 'details', 'analysis_date', 'accuracy_score', 'compliance_score', 'overall_score', 'key_issues',
  'documentation_gaps', 'missing_data_points', 'accuracy_flags', 'assigned_to', 'reviewed_by', 'reviewed_at',
  'auditor_findings', 'auditor_recommendations', 'corrections_made', 'report_generated', 'created_date',
  'updated_date',
];
function projectAudit(row: any) {
  const out: Record<string, unknown> = {};
  for (const field of AUDIT_FIELDS) if (row?.[field] !== undefined) out[field] = row[field];
  return stripFinancial(out);
}

async function loadScopedAudit(entities: any, scope: any, auditId: unknown) {
  const id = exactId(auditId);
  if (!id) throw new PublicError(400, 'audit_id is invalid');
  const found = rows(await entities.OASISAudit.filter({ id }, undefined, 2));
  if (found.length !== 1 || found[0]?.id !== id) throw new PublicError(404, 'Audit not found');
  const agencyOf = await auditAgencies(entities, found);
  const agencyId = agencyOf(found[0]);
  if (!scope.platform && agencyId !== scope.agencyId) throw new PublicError(404, 'Audit not found');
  return { audit: found[0], agencyId };
}

async function listAudits({ base44, scope, body }: any) {
  requireLead(scope);
  const entities = base44.asServiceRole.entities;
  const limit = Math.min(Math.max(Number(body.limit) || 100, 1), SCAN_LIMIT);
  const all = rows(await entities.OASISAudit.list('-created_date', SCAN_LIMIT));
  let visible = all;
  if (!scope.platform) {
    const agencyOf = await auditAgencies(entities, all);
    visible = all.filter((audit) => agencyOf(audit) === scope.agencyId);
  }
  return json({ audits: visible.slice(0, limit).map(projectAudit) });
}

async function leadEmails(entities: any, agencyId: string) {
  if (!agencyId) return [];
  const members = rows(await entities.AgencyMembership.filter({ agency_id: agencyId, status: 'active' }, undefined, SCAN_LIMIT));
  return members
    .filter((row) => row?.agency_id === agencyId && row.status === 'active' && LEAD_ROLES.has(row.tenant_role))
    .map((row) => ({ email: String(row.user_email_normalized || ''), tenant_role: row.tenant_role }))
    .filter((row) => row.email.includes('@'));
}

async function listAuditors({ base44, scope, body }: any) {
  requireLead(scope);
  const entities = base44.asServiceRole.entities;
  const { agencyId } = await loadScopedAudit(entities, scope, body.audit_id);
  return json({ auditors: await leadEmails(entities, agencyId) });
}

async function updateAudit({ base44, scope, body }: any) {
  requireLead(scope);
  const entities = base44.asServiceRole.entities;
  const { audit, agencyId } = await loadScopedAudit(entities, scope, body.audit_id);
  const patch = plainObject(body.patch) ? body.patch : {};
  const allowed = new Set(['status', 'assigned_to', 'auditor_findings', 'auditor_recommendations', 'corrections_made', 'report_generated']);
  const unknown = Object.keys(patch).filter((key) => !allowed.has(key));
  if (unknown.length) throw new PublicError(400, `Unsupported audit fields: ${unknown.join(', ')}`);
  const next: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    if (!AUDIT_STATUSES.has(patch.status)) throw new PublicError(400, 'status is invalid');
    next.status = patch.status;
    if (patch.status === 'reviewed') {
      next.reviewed_by = scope.email;
      next.reviewed_at = new Date().toISOString();
    }
  }
  if (patch.assigned_to !== undefined) {
    const email = String(patch.assigned_to || '').trim().toLowerCase();
    if (email) {
      const leads = await leadEmails(entities, agencyId);
      if (!leads.some((lead) => lead.email === email) && email !== scope.email) {
        throw new PublicError(400, 'An audit can only be assigned to an administrator or manager of its agency');
      }
    }
    next.assigned_to = email || null;
  }
  if (patch.auditor_findings !== undefined) next.auditor_findings = text(patch.auditor_findings, 5000);
  if (patch.auditor_recommendations !== undefined) {
    next.auditor_recommendations = rows(patch.auditor_recommendations)
      .map((item) => text(item, 1000)).filter(Boolean).slice(0, 30);
  }
  if (patch.corrections_made !== undefined) {
    next.corrections_made = rows(patch.corrections_made).filter(plainObject).slice(0, 30).map((item: any) => ({
      item: text(item.item, 120),
      original: text(item.original, 500),
      corrected: text(item.corrected, 500),
      rationale: text(item.rationale, 1000),
    })).filter((item) => item.item && item.corrected);
  }
  if (patch.report_generated !== undefined) next.report_generated = patch.report_generated === true;
  if (!Object.keys(next).length) throw new PublicError(400, 'Nothing to update');
  await entities.OASISAudit.update(audit.id, next);
  return json({ saved: true, audit: projectAudit({ ...audit, ...next }) });
}

// ─── Automation ──────────────────────────────────────────────────────────────

const RULE_FIELDS = [
  'id', 'rule_name', 'description', 'trigger_type', 'trigger_conditions', 'action_type', 'action_config',
  'is_active', 'priority', 'apply_to_patient_types', 'created_date', 'updated_date',
];
function projectRule(row: any) {
  const out: Record<string, unknown> = {};
  for (const field of RULE_FIELDS) if (row?.[field] !== undefined) out[field] = row[field];
  return out;
}

async function listRules({ base44 }: any) {
  const all = rows(await base44.asServiceRole.entities.OASISAutomationRule.list('-priority', SCAN_LIMIT));
  return json({ rules: all.map(projectRule) });
}

function cleanRule(input: any) {
  if (!plainObject(input)) throw new PublicError(400, 'rule is required');
  const ruleName = text(input.rule_name, 200);
  if (!ruleName) throw new PublicError(400, 'rule_name is required');
  if (!RULE_TRIGGERS.has(input.trigger_type)) throw new PublicError(400, 'trigger_type is invalid');
  if (!RULE_ACTIONS.has(input.action_type)) throw new PublicError(400, 'action_type is invalid');
  const conditions = plainObject(input.trigger_conditions) ? input.trigger_conditions : {};
  const cleanConditions: Record<string, unknown> = {};
  if (conditions.score_operator !== undefined) {
    if (!SCORE_OPERATORS.has(conditions.score_operator)) throw new PublicError(400, 'score_operator is invalid');
    cleanConditions.score_operator = conditions.score_operator;
  }
  if (conditions.score_type !== undefined) {
    if (!SCORE_TYPES.has(conditions.score_type)) throw new PublicError(400, 'score_type is invalid');
    cleanConditions.score_type = conditions.score_type;
  }
  if (conditions.score_value !== undefined && conditions.score_value !== null) {
    const value = Number(conditions.score_value);
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new PublicError(400, 'score_value must be 0-100');
    cleanConditions.score_value = value;
  }
  for (const key of ['m_item_codes', 'keywords']) {
    if (conditions[key] !== undefined) {
      cleanConditions[key] = rows(conditions[key]).map((item) => text(item, 80)).filter(Boolean).slice(0, 25);
    }
  }
  const config = plainObject(input.action_config) ? input.action_config : {};
  const cleanConfig: Record<string, unknown> = {};
  for (const [key, max] of [['task_title_template', 200], ['task_description_template', 1000], ['notification_message', 500]] as const) {
    if (config[key] !== undefined) cleanConfig[key] = text(config[key], max);
  }
  if (config.task_priority !== undefined) {
    if (!['high', 'medium', 'low'].includes(config.task_priority)) throw new PublicError(400, 'task_priority is invalid');
    cleanConfig.task_priority = config.task_priority;
  }
  if (config.task_type !== undefined) {
    if (!TASK_TYPES.has(config.task_type)) throw new PublicError(400, 'task_type is invalid');
    cleanConfig.task_type = config.task_type;
  }
  if (config.due_in_days !== undefined && config.due_in_days !== null && config.due_in_days !== '') {
    const days = Number(config.due_in_days);
    if (!Number.isInteger(days) || days < 0 || days > 365) throw new PublicError(400, 'due_in_days must be 0-365');
    cleanConfig.due_in_days = days;
  }
  if (config.actions !== undefined) {
    const actions = rows(config.actions).filter((action) => RULE_ACTIONS.has(action));
    if (actions.length) cleanConfig.actions = [...new Set(actions)];
  }
  const priority = Number(input.priority ?? 0);
  return {
    rule_name: ruleName,
    description: text(input.description, 1000),
    trigger_type: input.trigger_type,
    trigger_conditions: cleanConditions,
    action_type: input.action_type,
    action_config: cleanConfig,
    is_active: input.is_active !== false,
    priority: Number.isFinite(priority) ? Math.max(-100, Math.min(100, Math.round(priority))) : 0,
  };
}

async function saveRule({ base44, scope, body }: any) {
  requirePlatform(scope);
  const entities = base44.asServiceRole.entities;
  if (body.rule_id !== undefined && body.rule_id !== null) {
    const id = exactId(body.rule_id);
    if (!id) throw new PublicError(400, 'rule_id is invalid');
    const found = rows(await entities.OASISAutomationRule.filter({ id }, undefined, 2));
    if (found.length !== 1 || found[0]?.id !== id) throw new PublicError(404, 'Rule not found');
    // A partial update (the active toggle) keeps every other stored field.
    const merged = plainObject(body.rule) ? { ...found[0], ...body.rule } : found[0];
    const clean = cleanRule(merged);
    await entities.OASISAutomationRule.update(id, clean);
    return json({ saved: true, rule: projectRule({ ...found[0], ...clean }) });
  }
  const created = await entities.OASISAutomationRule.create({ ...cleanRule(body.rule), created_by: scope.email });
  return json({ saved: true, rule: projectRule(created) });
}

async function deleteRule({ base44, scope, body }: any) {
  requirePlatform(scope);
  const entities = base44.asServiceRole.entities;
  const id = exactId(body.rule_id);
  if (!id) throw new PublicError(400, 'rule_id is invalid');
  const found = rows(await entities.OASISAutomationRule.filter({ id }, undefined, 2));
  if (found.length !== 1 || found[0]?.id !== id) throw new PublicError(404, 'Rule not found');
  await entities.OASISAutomationRule.delete(id);
  return json({ deleted: true });
}

function localDatePlus(days: number) {
  const date = new Date(Date.now() + days * 86400000);
  // Calendar date in the agency's working zone (Eastern), not UTC.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function runRuleAction(ctx: any, actionType: string, rule: any, trigger: any) {
  const { base44, scope, upload, patient, runId } = ctx;
  const entities = base44.asServiceRole.entities;
  const config = plainObject(rule.action_config) ? rule.action_config : {};
  const at = new Date().toISOString();
  try {
    if (actionType === 'create_task') {
      const { row, created } = await createKeyedOnce(entities, 'Task', 'client_request_id', `oasis-wf:${runId}`, {
        patient_id: patient.id,
        assigned_to: scope.email,
        title: text(config.task_title_template, 200) || `${rule.rule_name} - Action Required`,
        description: [
          text(config.task_description_template, 1000) || `Automated OASIS workflow: ${text(rule.description, 500)}`,
          trigger.reason ? `Triggered because: ${trigger.reason}` : '',
        ].filter(Boolean).join('\n\n'),
        type: TASK_TYPES.has(config.task_type) ? config.task_type : 'document',
        priority: TASK_PRIORITIES.has(config.task_priority) ? config.task_priority : 'medium',
        status: 'pending',
        due_date: Number.isInteger(config.due_in_days) ? localDatePlus(config.due_in_days) : null,
        source: 'ai_generated',
        ai_reason: text(trigger.reason, 500) || 'Automation rule triggered',
        related_entity: 'OASISUpload',
        related_entity_id: upload.id,
        created_by: scope.email,
      });
      return { action_type: actionType, status: 'completed', result: { id: row.id, reused: !created }, executed_at: at };
    }
    if (actionType === 'create_alert') {
      const alert = await entities.PatientAlert.create({
        patient_id: patient.id,
        alert_type: 'documentation_risk',
        severity: TASK_PRIORITIES.has(config.task_priority) ? config.task_priority : 'medium',
        title: text(rule.rule_name, 200),
        message: text(config.notification_message, 500) || text(rule.description, 500) || 'Review this OASIS assessment',
        contributing_factors: [text(trigger.reason, 300) || 'Automated rule trigger'],
        recommended_actions: [text(config.task_description_template, 500) || 'Review the OASIS assessment'],
        status: 'active',
        detected_date: at,
        created_by: scope.email,
      });
      return { action_type: actionType, status: 'completed', result: { id: alert?.id || null }, executed_at: at };
    }
    if (actionType === 'notify_clinician') {
      await base44.functions.invoke('createNotification', {
        user_email: scope.email,
        title: text(rule.rule_name, 120) || 'OASIS workflow',
        message: text(config.notification_message, 500) || `An OASIS automation rule fired: ${text(trigger.reason, 300)}`,
        type: 'info',
        priority: TASK_PRIORITIES.has(config.task_priority) ? config.task_priority : 'medium',
        action_url: '/OASISCenter?tab=clinical',
      });
      return { action_type: actionType, status: 'completed', result: { recipient: scope.email }, executed_at: at };
    }
    if (actionType === 'flag_for_review') {
      const audit = buildOasisAuditRecord(upload, upload.analysis_results, OASIS_AUDIT_THRESHOLDS) || {
        oasis_upload_id: upload.id,
        patient_id: upload.patient_id || null,
        patient_name: text(upload.patient_name, 200),
        flag_reason: 'automation_rule',
        priority: TASK_PRIORITIES.has(config.task_priority) ? config.task_priority : 'medium',
        status: 'pending_review',
        summary: `Flagged by automation rule "${text(rule.rule_name, 200)}": ${text(trigger.reason, 300)}`,
      };
      const { row } = await createKeyedOnce(entities, 'OASISAudit', 'oasis_upload_id', upload.id, {
        ...audit, user_email: scope.email, analysis_date: at, created_by: scope.email,
      });
      return { action_type: actionType, status: 'completed', result: { flagged: true, audit_id: row.id }, executed_at: at };
    }
    return { action_type: actionType || 'unknown_action', status: 'failed', error: 'Unsupported action type', executed_at: at };
  } catch (error) {
    return {
      action_type: actionType,
      status: 'failed',
      error: error instanceof PublicError ? error.message : 'The action could not be completed',
      executed_at: at,
    };
  }
}

async function executeWorkflows({ base44, user, scope, body }: any) {
  const entities = base44.asServiceRole.entities;
  const upload = await loadUpload(entities, body.upload_id);
  if (!(await uploadAccess(base44, user, scope, upload))) throw new PublicError(404, 'OASIS upload not found');
  if (!upload.patient_id) throw new PublicError(409, 'Link this OASIS analysis to a patient before running automation');
  // Tasks and alerts land on the chart, so the chart rule applies even to the author.
  const patient = await openChart(base44, user, upload.patient_id);
  const analysis = plainObject(upload.analysis_results) ? upload.analysis_results : {};
  const rules = rows(await entities.OASISAutomationRule.filter({ is_active: true }, '-priority', SCAN_LIMIT))
    .filter((rule) => rule?.is_active === true && RULE_TRIGGERS.has(rule.trigger_type));
  const results: any[] = [];
  for (const rule of rules) {
    const trigger = evaluateRuleTrigger(rule, analysis, upload.pdgm_data || {});
    if (!trigger.triggered) continue;
    const runId = `${upload.id}:${rule.id}`;
    const started = Date.now();
    let claim;
    try {
      claim = await createKeyedOnce(entities, 'OASISWorkflowExecution', 'run_id', runId, {
        oasis_upload_id: upload.id,
        patient_id: patient.id,
        patient_name: patientDisplayName(patient),
        automation_rule_id: rule.id,
        rule_name: text(rule.rule_name, 200),
        trigger_reason: text(trigger.reason, 500) || 'Rule triggered',
        trigger_data: stripFinancial(trigger.context || {}),
        status: 'running',
        completion_percentage: 0,
        created_by: scope.email,
      });
    } catch (error) {
      results.push({ rule_id: rule.id, rule_name: rule.rule_name, status: 'skipped', reason: error instanceof PublicError ? error.message : 'claim failed' });
      continue;
    }
    if (!claim.created) {
      results.push({ rule_id: rule.id, rule_name: rule.rule_name, status: claim.row.status || 'completed', already_executed: true, actions: rows(claim.row.actions_executed) });
      continue;
    }
    const actionTypes = deriveActionTypes(rule).filter((action: string) => RULE_ACTIONS.has(action));
    const actions = [];
    for (const actionType of actionTypes) {
      actions.push(await runRuleAction({ base44, scope, upload, patient, runId: `${runId}:${actionType}` }, actionType, rule, trigger));
    }
    const completed = actions.filter((action) => action.status === 'completed').length;
    const failed = actions.filter((action) => action.status === 'failed').length;
    const status = actions.length === 0 ? 'failed'
      : failed === 0 ? 'completed' : completed > 0 ? 'partially_completed' : 'failed';
    await entities.OASISWorkflowExecution.update(claim.row.id, {
      actions_executed: actions,
      tasks_created: actions.filter((a) => a.action_type === 'create_task' && a.result?.id).map((a) => a.result.id),
      alerts_created: actions.filter((a) => a.action_type === 'create_alert' && a.result?.id).map((a) => a.result.id),
      notifications_sent: actions.filter((a) => a.action_type === 'notify_clinician' && a.status === 'completed').map((a) => a.result),
      status,
      completion_percentage: actions.length ? Math.round((completed / actions.length) * 100) : 0,
      execution_time_ms: Date.now() - started,
      outcome_summary: `Executed ${completed} of ${actions.length} actions`,
      error_message: failed ? actions.filter((a) => a.status === 'failed').map((a) => a.error).join('; ').slice(0, 500) : null,
    }).catch(() => {});
    results.push({ rule_id: rule.id, rule_name: rule.rule_name, trigger_reason: trigger.reason, status, actions });
  }
  return json({ evaluated_rules: rules.length, results });
}

const EXECUTION_FIELDS = [
  'id', 'oasis_upload_id', 'patient_id', 'patient_name', 'automation_rule_id', 'rule_name', 'trigger_reason',
  'actions_executed', 'tasks_created', 'alerts_created', 'notifications_sent', 'status', 'completion_percentage',
  'error_message', 'execution_time_ms', 'outcome_summary', 'run_id', 'created_by', 'created_date',
];
function projectExecution(row: any) {
  const out: Record<string, unknown> = {};
  for (const field of EXECUTION_FIELDS) if (row?.[field] !== undefined) out[field] = row[field];
  return out;
}

async function listExecutions({ base44, scope, body }: any) {
  const entities = base44.asServiceRole.entities;
  const limit = Math.min(Math.max(Number(body.limit) || 200, 1), SCAN_LIMIT);
  if (!scope.platform && !scope.lead) {
    const mine = rows(await entities.OASISWorkflowExecution.filter({ created_by: scope.email }, '-created_date', limit))
      .filter((row) => row?.created_by === scope.email);
    return json({ executions: mine.map(projectExecution) });
  }
  const all = rows(await entities.OASISWorkflowExecution.list('-created_date', SCAN_LIMIT));
  let visible = all;
  if (!scope.platform) {
    const uploadIds = [...new Set(all.map((row) => row?.oasis_upload_id).filter((id) => exactId(id)))];
    const agencyByUpload = new Map();
    if (uploadIds.length) {
      for (const row of rows(await entities.OASISUpload.filter({ id: { $in: uploadIds } }, undefined, uploadIds.length))) {
        if (row?.id) agencyByUpload.set(row.id, row.agency_id || '');
      }
    }
    visible = all.filter((row) => agencyByUpload.get(row?.oasis_upload_id) === scope.agencyId);
  }
  return json({ executions: visible.slice(0, limit).map(projectExecution) });
}

// ─── Tasks, feedback, pathways, report ──────────────────────────────────────

async function createTasks({ base44, user, scope, body }: any) {
  const patient = await openChart(base44, user, body.patient_id);
  const entities = base44.asServiceRole.entities;
  const tasks = rows(body.tasks);
  if (tasks.length === 0 || tasks.length > MAX_TASKS) throw new PublicError(400, `Send 1 to ${MAX_TASKS} tasks`);
  const results = [];
  for (const input of tasks) {
    const key = exactId(input?.key);
    const title = text(input?.title, 200);
    if (!key || key.length > 120 || !title) {
      results.push({ key: key || null, status: 'invalid' });
      continue;
    }
    const dueDate = typeof input.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.due_date) ? input.due_date : null;
    try {
      const { row, created } = await createKeyedOnce(entities, 'Task', 'client_request_id', `oasis:${scope.userId}:${key}`, {
        patient_id: patient.id,
        assigned_to: scope.email,
        title,
        description: text(input.description, 2000),
        type: TASK_TYPES.has(input.type) ? input.type : 'document',
        priority: TASK_PRIORITIES.has(input.priority) ? input.priority : 'medium',
        status: 'pending',
        due_date: dueDate,
        source: 'ai_generated',
        ai_reason: text(input.ai_reason, 500),
        created_by: scope.email,
      });
      results.push({ key, status: created ? 'created' : 'existing', task_id: row.id });
    } catch (error) {
      results.push({ key, status: 'failed', error: error instanceof PublicError ? error.message : 'Task could not be created' });
    }
  }
  return json({ results });
}

async function recordFeedback({ base44, user, scope, body }: any) {
  const entities = base44.asServiceRole.entities;
  const input = plainObject(body.feedback) ? body.feedback : null;
  if (!input) throw new PublicError(400, 'feedback is required');
  for (const field of ['suggested_patient_id', 'actual_patient_id', 'patient_id']) {
    if (input[field]) await openChart(base44, user, input[field]);
  }
  const record: Record<string, unknown> = {
    oasis_upload_id: exactId(input.oasis_upload_id) || null,
    feedback_type: FEEDBACK_TYPES.has(input.feedback_type) ? input.feedback_type : 'manual_override',
    extracted_name: text(input.extracted_name, 200),
    extracted_dob: text(input.extracted_dob, 40),
    extracted_medicare_id: text(input.extracted_medicare_id, 40),
    suggested_patient_id: exactId(input.suggested_patient_id) || null,
    suggested_confidence: Number.isFinite(Number(input.suggested_confidence)) ? Number(input.suggested_confidence) : null,
    actual_patient_id: exactId(input.actual_patient_id) || null,
    user_notes: text(input.user_notes, 2000),
    match_factors_used: rows(input.match_factors_used).map((item) => text(typeof item === 'string' ? item : JSON.stringify(item), 200)).filter(Boolean).slice(0, 25),
    created_by: scope.email,
  };
  const created = await entities.OASISFeedback.create(record);
  return json({ saved: true, feedback_id: created?.id || null });
}

const PATHWAY_FIELDS = [
  'id', 'pathway_name', 'condition', 'icd10_codes', 'description', 'phases', 'typical_los', 'evidence_level',
  'references', 'is_active', 'trigger_conditions', 'priority_level', 'documentation_prompts',
  'recommended_tasks', 'comorbidity_checklist', 'functional_focus_areas',
];
async function listPathways({ base44 }: any) {
  const all = rows(await base44.asServiceRole.entities.ClinicalPathway.filter({ is_active: true }, undefined, SCAN_LIMIT));
  return json({
    pathways: all.filter((row) => row?.is_active === true).map((row) => {
      const out: Record<string, unknown> = {};
      for (const field of PATHWAY_FIELDS) if (row?.[field] !== undefined) out[field] = row[field];
      return stripFinancial(out);
    }),
  });
}

function inRange(value: unknown, from: string, to: string) {
  const day = typeof value === 'string' ? value.slice(0, 10) : '';
  if (!day) return false;
  return (!from || day >= from) && (!to || day <= to);
}

async function assessmentReport({ base44, scope, body }: any) {
  const entities = base44.asServiceRole.entities;
  const from = typeof body.date_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date_from) ? body.date_from : '';
  const to = typeof body.date_to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date_to) ? body.date_to : '';
  let assessments: any[];
  let audits: any[];
  if (scope.platform) {
    assessments = rows(await entities.OASISAssessment.list('-created_date', 5000));
    audits = rows(await entities.ComplianceAudit.list('-created_date', 5000));
  } else {
    const openable = await oasisOpenablePatientIds(base44, scope);
    assessments = rows(await entities.OASISAssessment.filter({ agency_id: scope.agencyId }, '-created_date', 5000))
      .filter((row) => row?.agency_id === scope.agencyId && (!openable || openable.has(row.patient_id)));
    if (scope.lead) {
      const patients = rows(await entities.Patient.filter({ agency_id: scope.agencyId }, undefined, 5000))
        .filter((row) => row?.agency_id === scope.agencyId).map((row) => row.id);
      audits = patients.length
        ? rows(await entities.ComplianceAudit.filter({ patient_id: { $in: patients } }, '-created_date', 5000))
          .filter((row) => patients.includes(row?.patient_id))
        : [];
    } else {
      audits = rows(await entities.ComplianceAudit.filter({ nurse_email: scope.email }, '-created_date', 5000))
        .filter((row) => String(row?.nurse_email || '').toLowerCase() === scope.email);
    }
  }
  return json({
    assessments: assessments.map((row) => ({
      id: row.id,
      patient_id: row.patient_id,
      visit_type: row.visit_type,
      assessment_date: row.assessment_date,
      status: row.status,
      completion_percentage: row.completion_percentage ?? null,
      response_schema_id: row.response_schema_id ?? null,
    })),
    compliance_audits: audits
      .filter((row) => !from && !to ? true : inRange(row?.audit_date, from, to))
      .map((row) => ({ id: row.id, audit_date: row.audit_date, compliance_score: row.compliance_score ?? null, status: row.status })),
  });
}

// The agencies a reporting screen may ask about: every active agency for the
// platform owner, otherwise only the caller's own trusted agency. Names and ids
// only — nothing about an agency's contacts, billing or users.
async function listAgencies({ base44, scope }: any) {
  const entities = base44.asServiceRole.entities;
  const found = scope.platform
    ? rows(await entities.Agency.list('agency_name', 500))
    : rows(await entities.Agency.filter({ id: scope.agencyId }, undefined, 2))
      .filter((row) => row?.id === scope.agencyId);
  return json({
    agencies: found
      .filter((row) => exactId(row?.id) && ['active', 'trial'].includes(row?.status ?? 'active'))
      .map((row) => ({ id: row.id, name: text(row.agency_name, 200) || row.id })),
  });
}

const ACTIONS: Record<string, (ctx: any) => Promise<Response>> = {
  create_upload: createUpload,
  save_comprehensive_review: saveComprehensiveReview,
  review_extracted_item: reviewExtractedItem,
  supervisor_decision: supervisorDecision,
  list_audits: listAudits,
  list_auditors: listAuditors,
  update_audit: updateAudit,
  list_rules: listRules,
  save_rule: saveRule,
  delete_rule: deleteRule,
  execute_workflows: executeWorkflows,
  list_executions: listExecutions,
  create_tasks: createTasks,
  record_feedback: recordFeedback,
  list_pathways: listPathways,
  assessment_report: assessmentReport,
  list_agencies: listAgencies,
};

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (!user) return json({ error: 'Unauthorized' }, 401);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    // Scope before payload: a caller with no trusted agency (and not the
    // platform owner) is refused before the request body is read.
    const scope = oasisCallerScope(user);
    if (!scope) return json({ error: 'An active agency membership is required' }, 403);
    const body = await readBody(req);
    const handler = Object.hasOwn(ACTIONS, body.action) ? ACTIONS[body.action] : null;
    if (!handler) return json({ error: 'Unknown action' }, 400);
    return await handler({ base44, user, scope, body });
  } catch (error) {
    if (error instanceof PublicError) return json({ error: error.message }, error.status);
    // Provider errors can carry predicates or PHI; never return them.
    console.error('manageOASISRecords failed');
    return json({ error: 'Internal server error' }, 500);
  }
});
