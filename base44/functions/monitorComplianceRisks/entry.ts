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
// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && user.role === 'admin';
}
// Constant-time string compare for the shared-secret check (mirrors
// createTelehealthToken's timingSafeEqual). A plain === short-circuits on the
// first differing character, so response timing could leak how much of the
// secret matched. Dependency-free char-code XOR so the identical source runs
// under Deno (consumers) and Node (tests).
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function getSchedulerAuthError(req, user) {
  if (isSchedulerAdmin(user)) return null;
  const expectedSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expectedSecret) {
    return Response.json(
      { error: 'Server misconfigured: INTERNAL_FN_SECRET is required for scheduled/internal functions' },
      { status: 500 },
    );
  }
  const providedSecret = String(req.headers.get(SCHEDULER_SECRET_HEADER) || '').trim();
  if (timingSafeEqualStr(providedSecret, expectedSecret)) return null;
  return Response.json(
    { error: user ? 'Forbidden: admin or scheduler secret required' : 'Unauthorized: scheduler secret required' },
    { status: user ? 403 : 401 },
  );
}
// <<<END SHARED HELPER: schedulerAuth>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// Released by the owner on 2026-10-08 ("turn everything on"). This is a
// DOCUMENTATION-compliance monitor, not risk prediction: every rule looks for
// a documentation gap (a chronic-condition chart with no recent documented
// visit, missing vitals, homebound wording missing from a note, a missing
// Discharge OASIS), and it stores no risk score. It used to scan every
// tenant's charts, decide each chart's agency from editable created_by /
// assigned_nurses / agency_name values, and claim each Patient row with an
// unconditional service-role write. Now each run covers ONE agency at a time
// from service-owned Agency rows, selects charts by their own agency_id, and
// deduplicates alerts on a deterministic key instead of writing the chart.
const COMPLIANCE_RISK_MONITOR_ENABLED = true;

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


// Compliance-risk monitor. COMPANION-MODE AWARE: PennSync usually runs
// alongside the agency's EMR, so rules that fire on the ABSENCE of EMR-owned
// data (visits, vitals, Discharge OASIS) are gated behind
// AgencySettings.pennsync_is_system_of_record (default OFF) — see the gate in
// the handler. Rules keyed to artifacts that exist in-app always run.
//
// Discharge-OASIS documentation check (inlined mirror of the unit-tested
// src/components/oasis/dischargeComplianceEnforcer.js — Deno cannot import from
// src/). Flags episodes that ended without a completed Discharge OASIS, which
// prevents PennSync from calculating its unadjusted internal episode proxy.
// This is not an official CMS rate, eligibility check, or star input. Status and visit-type
// values compare case-insensitively so casing drift in stored records never
// creates false "missing discharge" alarms.
const INTERNAL_SAMPLE_MIN_PAIRS = 20;
const INTERNAL_SAMPLE_MEASURE_TARGET = 5;
const DC_COMPLETE_STATUSES = new Set(['completed', 'submitted']);
const DC_START_TYPES = new Set(['start of care', 'resumption of care']);
const dcLower = (v) => String(v || '').trim().toLowerCase();

// Parse a date-only ("YYYY-MM-DD") value as LOCAL midnight; other values fall
// through to the platform parser (mirror of dischargeComplianceEnforcer.js).
function dcToLocalDate(v) {
  if (!v) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(v).trim());
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Whole CALENDAR days between two dates (local components), not a raw-ms floor.
// A raw-ms floor undercounts by a day when the later timestamp has a smaller
// time-of-day than the earlier one, which could let a 14-day-stale episode read
// as 13 and skip the missing-Discharge-OASIS alert. Mirrors the unit-tested
// dischargeComplianceEnforcer.js.
function daysBetween(a, b) {
  const da = dcToLocalDate(a);
  const db = dcToLocalDate(b);
  if (!da || !db) return null;
  const dayA = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const dayB = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((dayB - dayA) / (1000 * 60 * 60 * 24));
}

function detectMissingDischargeOASIS(ctx, opts = {}) {
  const { patient, oasisAssessments = [], visits = [] } = ctx || {};
  if (!patient || !patient.id) return null;
  const asOf = opts.asOf || new Date();
  const staleDays = opts.staleDays ?? 14;

  const dischargeAssessments = oasisAssessments.filter((a) => dcLower(a?.visit_type) === 'discharge');
  const hasCompletedDischarge = dischargeAssessments.some((a) => DC_COMPLETE_STATUSES.has(dcLower(a?.status)));
  const hasDraftDischarge = dischargeAssessments.length > 0 && !hasCompletedDischarge;
  const hasBaseline = oasisAssessments.some((a) => DC_START_TYPES.has(dcLower(a?.visit_type)));
  if (hasCompletedDischarge) return null;

  const status = String(patient.status || '').toLowerCase();
  const isDischargedPatient = status === 'discharged' || status === 'deceased';

  let daysSinceLastVisit = null;
  if (visits.length) {
    const lastVisitDate = visits.map((v) => v?.visit_date).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
    if (lastVisitDate) daysSinceLastVisit = daysBetween(lastVisitDate, asOf);
  }
  const episodeLikelyEnded = isDischargedPatient || (daysSinceLastVisit !== null && daysSinceLastVisit >= staleDays);
  if (!episodeLikelyEnded) return null;
  if (status === 'deceased') return null;

  const severity = isDischargedPatient ? 'critical' : 'high';
  const name = `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || 'Patient';
  const factors = [];
  if (isDischargedPatient) factors.push('Patient is discharged but has no completed Discharge OASIS on file');
  else factors.push(`No visit in ${daysSinceLastVisit} days — episode appears to have ended`);
  if (hasDraftDischarge) factors.push('A Discharge OASIS exists but is still in draft/in-progress');
  if (!hasBaseline) factors.push('No SOC/ROC assessment on file to pair for a change score');
  factors.push(
    'Without a completed in-app Discharge OASIS, PennSync cannot calculate its internal episode proxy',
    `Internal sample context uses ${INTERNAL_SAMPLE_MIN_PAIRS} pairs per measure and a ${INTERNAL_SAMPLE_MEASURE_TARGET}-measure marker; neither is official CMS eligibility`,
  );

  return {
    patient_id: patient.id,
    alert_type: 'documentation_risk',
    severity,
    title: hasDraftDischarge ? 'Discharge OASIS Not Completed' : 'Missing Discharge OASIS Assessment',
    message: hasDraftDischarge
      ? `${name}'s Discharge OASIS is started but not completed — finalize it to capture outcome improvement.`
      : `${name}'s episode has ended without a Discharge OASIS — demonstrated improvement will be lost.`,
    contributing_factors: factors,
    recommended_actions: [
      hasDraftDischarge ? 'Complete and submit the in-progress Discharge OASIS' : 'Complete a Discharge OASIS assessment for this episode',
      'When the tenant-authorized outcome broker is available, pair it with SOC/ROC for the internal unadjusted proxy',
      'Verify functional items (M1860, M1850, M1830, M1400, M2020) are scored',
    ],
    risk_score: isDischargedPatient ? 88 : 72,
    data_sources: {
      patient_status: patient.status,
      days_since_last_visit: daysSinceLastVisit,
      has_baseline_oasis: hasBaseline,
      has_draft_discharge: hasDraftDischarge,
    },
  };
}

// Persist a batch of candidate alerts for one patient, skipping active
// same-type/same-title duplicates created within the last 24h.
// One row per (patient, day, rule). A repeated or overlapping run checks the
// deterministic key first and, if two runs passed that check together, keeps
// the lowest id and removes the rest, so neither run needs to write the
// Patient row (the old claim did, unconditionally, through the service role).
function complianceAlertKey(alert, currentDate) {
  const day = currentDate.toISOString().slice(0, 10);
  const slug = String(alert.title || alert.alert_type || 'alert').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80);
  return `compliance-monitor:${alert.patient_id}:${day}:${slug}`;
}

async function persistAlerts(base44, patientAlerts, currentDate, sink) {
  if (!patientAlerts?.length) return;
  const entities = base44.asServiceRole.entities;
  for (const alert of patientAlerts) {
    // The documentation alerts carry a rule priority, not a clinical risk
    // estimate; the owner removed risk prediction, so no risk_score is stored.
    const { risk_score: _ignoredRiskScore, ...documented } = alert;
    const key = complianceAlertKey(alert, currentDate);
    const query = { patient_id: alert.patient_id, triggered_by_rule_id: key };
    let rows = await entities.PatientAlert.filter(query, undefined, 10);
    if (!Array.isArray(rows)) rows = [];
    if (rows.length === 0) {
      const created = await entities.PatientAlert.create({
        ...documented,
        triggered_by_rule_id: key,
        status: 'active',
        flagged_urgent: alert.severity === 'critical',
      });
      rows = await entities.PatientAlert.filter(query, undefined, 10);
      if (!Array.isArray(rows) || rows.length === 0) rows = created ? [created] : [];
      if (created && rows.some((row) => row?.id === created.id)) sink.push(created);
    }
    const survivor = [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)))[0];
    for (const row of rows) {
      if (survivor && row.id !== survivor.id) await entities.PatientAlert.delete(row.id).catch(() => {});
    }
  }
}

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const PATIENT_LIMIT = 2_000;
const DISCHARGED_LIMIT = 1_000;
const AGENCY_LIMIT = 200;

async function readBody(req) {
  let body = {};
  try {
    const raw = await req.text();
    if (raw.length > 1_000) return { error: Response.json({ error: 'Request body is too large' }, { status: 413 }) };
    body = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return { error: Response.json({ error: 'Invalid JSON body' }, { status: 400 }) };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'agency_id')) {
    return { error: Response.json({ error: 'Request contains unsupported fields' }, { status: 400 }) };
  }
  if (body.agency_id != null && !claimIdentifier(body.agency_id)) {
    return { error: Response.json({ error: 'agency_id is invalid' }, { status: 400 }) };
  }
  return { agencyId: body.agency_id ?? null };
}

async function enabledAgencies(entities, requested) {
  const rows = [];
  if (requested) {
    const found = await entities.Agency.filter({ id: requested }, undefined, 2);
    if (Array.isArray(found) && found.length === 1 && found[0]?.id === requested
      && ['active', 'trial'].includes(found[0].status)) rows.push(found[0]);
    return rows;
  }
  for (const status of ['active', 'trial']) {
    const found = await entities.Agency.filter({ status }, undefined, AGENCY_LIMIT);
    for (const agency of Array.isArray(found) ? found : []) {
      if (claimIdentifier(agency?.id) && agency.status === status && !rows.some((row) => row.id === agency.id)) {
        rows.push(agency);
      }
    }
  }
  return rows;
}

async function scanAgency(base44, agency, currentDate, alerts) {
  const entities = base44.asServiceRole.entities;
  const agencyId = agency.id;
  // Companion-EMR gate: PennSync usually runs ALONGSIDE the agency's EMR, so
  // visits, vitals and Discharge OASIS assessments may be documented only in
  // the EMR. The absence-based rules (1, 3, 6 and the discharged sweep) run
  // only when this agency's AgencySettings.pennsync_is_system_of_record is
  // explicitly true; anything else keeps them off. Rule 5 is keyed to a note
  // that EXISTS in PennSync, so it always runs.
  // The flag is looked up by the service-owned Agency name (AgencySettings has
  // no agency_id). A miss or an ambiguous match is false: never adopt another
  // tenant's settings row, and never fall back to "the newest row".
  const sorCache = new Map();
  const agencyIsSystemOfRecord = async (agencyName) => {
    const key = agencyName || '__none__';
    if (sorCache.has(key)) return sorCache.get(key);
    let rows = [];
    if (agencyName) {
      rows = await entities.AgencySettings.filter({ agency_code: agencyName }, '-created_date', 2).catch(() => []);
      if (!rows?.length) {
        rows = await entities.AgencySettings.filter({ office_name: agencyName }, '-created_date', 2).catch(() => []);
      }
      if (!rows?.length || rows.length > 1) {
        sorCache.set(key, false);
        return false;
      }
    }
    const flag = !!agencyName && rows?.[0]?.pennsync_is_system_of_record === true;
    sorCache.set(key, flag);
    return flag;
  };
  const agencyName = typeof agency.agency_name === 'string' ? agency.agency_name.trim() : '';

  const patients = (await entities.Patient.filter({ agency_id: agencyId, status: 'active' }, '-created_date', PATIENT_LIMIT) || [])
    .filter((patient) => patient?.agency_id === agencyId && claimIdentifier(patient.id));
  for (const patient of patients) {
    const pennsyncIsSystemOfRecord = await agencyIsSystemOfRecord(agencyName);
    const patientAlerts = [];
    const own = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => row?.patient_id === patient.id);
    const [visitRows, oasisAssessmentRows] = await Promise.all([
      entities.Visit.filter({ patient_id: patient.id }, '-visit_date', 10),
      entities.OASISAssessment.filter({ patient_id: patient.id }, '-assessment_date', 20),
    ]);
    const visits = own(visitRows);
    const oasisAssessments = own(oasisAssessmentRows);
    const lastVisit = visits[0];
    const daysSinceLastVisit = lastVisit ? daysBetween(lastVisit.visit_date, currentDate) : 999;

    // RULE 1: chronic-condition chart without a recent documented visit.
    // Absence-based (assumes every visit is documented in PennSync) — gated
    // behind pennsync_is_system_of_record; see the companion-EMR note above.
    const chronicDiagnoses = ['CHF', 'COPD', 'Diabetes', 'Stroke', 'Cancer', 'Heart Failure'];
    const hasChronicDx = chronicDiagnoses.some((dx) => patient.primary_diagnosis?.toUpperCase().includes(dx.toUpperCase()));
    if (pennsyncIsSystemOfRecord && hasChronicDx && daysSinceLastVisit > 7) {
      patientAlerts.push({
        patient_id: patient.id,
        alert_type: 'care_gap',
        severity: 'high',
        title: 'Chronic-Condition Patient Without Recent Documentation',
        message: `No visit has been documented in ${daysSinceLastVisit} days for a patient with ${patient.primary_diagnosis}.`,
        contributing_factors: [
          `Primary diagnosis: ${patient.primary_diagnosis}`,
          `Last documented visit: ${daysSinceLastVisit} days ago`,
        ],
        recommended_actions: [
          'Confirm the visit schedule matches the plan of care frequency',
          'Document any telephonic monitoring',
          'Review the care plan for the appropriate visit frequency',
        ],
        data_sources: { last_visit_date: lastVisit?.visit_date, diagnosis: patient.primary_diagnosis },
      });
    }

    // RULE 3: missing vital signs in recent visits. Absence-based (vitals may
    // be charted in the EMR) — gated behind pennsync_is_system_of_record.
    const recentVisitsWithoutVitals = visits.slice(0, 3).filter((v) => !v.vital_signs || Object.keys(v.vital_signs).length === 0);
    if (pennsyncIsSystemOfRecord && recentVisitsWithoutVitals.length >= 2) {
      patientAlerts.push({
        patient_id: patient.id,
        alert_type: 'documentation_risk',
        severity: 'medium',
        title: 'Incomplete Vital Signs Documentation',
        message: `${recentVisitsWithoutVitals.length} of the last 3 visits are missing vital signs.`,
        contributing_factors: [
          'Vital signs are expected at skilled nursing visits',
          'Missing baseline data for condition monitoring',
        ],
        recommended_actions: [
          'Capture vital signs at every skilled visit',
          'Add vital signs to previous visit notes if documented elsewhere',
        ],
        data_sources: { visits_missing_vitals: recentVisitsWithoutVitals.length },
      });
    }

    // RULE 5: homebound status not documented in the most recent note. Keyed
    // to an in-app artifact (the note EXISTS in PennSync), so it stays on in
    // companion mode. A documentation gap, so it is high, not critical.
    if (lastVisit) {
      const noteMention = lastVisit.nurse_notes?.toLowerCase() || '';
      const homeboundKeywords = ['homebound', 'taxing', 'considerable effort', 'leaving home', 'ambulation'];
      if (!homeboundKeywords.some((kw) => noteMention.includes(kw)) && daysSinceLastVisit < 14) {
        patientAlerts.push({
          patient_id: patient.id,
          alert_type: 'documentation_risk',
          severity: 'high',
          title: 'Missing Homebound Status Documentation',
          message: 'The most recent visit note does not document homebound status, which Medicare eligibility requires.',
          contributing_factors: [
            'Homebound status is a Medicare eligibility requirement',
            'It should be documented at every skilled visit',
          ],
          recommended_actions: [
            'Add homebound justification to the next visit note',
            'Document specific limitations and why leaving home is taxing',
            'Use the Smart Note Assistant homebound templates',
          ],
          data_sources: { last_visit_date: lastVisit.visit_date },
        });
      }
    }

    // RULE 6: episode ended without a completed in-app Discharge OASIS.
    // Absence-based — gated behind pennsync_is_system_of_record.
    if (pennsyncIsSystemOfRecord) {
      const dischargeGap = detectMissingDischargeOASIS({ patient, oasisAssessments, visits }, { asOf: currentDate });
      if (dischargeGap) patientAlerts.push(dischargeGap);
    }

    await persistAlerts(base44, patientAlerts, currentDate, alerts);
  }

  // Discharged-patient sweep, same agency only. Resolve SoR per patient
  // (never reuse a loop-local flag from the active sweep).
  const dischargedPatients = (await entities.Patient.filter({ agency_id: agencyId, status: 'discharged' }, '-updated_date', DISCHARGED_LIMIT) || [])
    .filter((patient) => patient?.agency_id === agencyId && claimIdentifier(patient.id));
  for (const patient of dischargedPatients) {
    const dischargedIsSoR = await agencyIsSystemOfRecord(agencyName);
    if (!dischargedIsSoR) continue;
    const own = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => row?.patient_id === patient.id);
    const [visitRows, oasisAssessmentRows] = await Promise.all([
      entities.Visit.filter({ patient_id: patient.id }, '-visit_date', 10),
      entities.OASISAssessment.filter({ patient_id: patient.id }, '-assessment_date', 20),
    ]);
    const gap = detectMissingDischargeOASIS(
      { patient, oasisAssessments: own(oasisAssessmentRows), visits: own(visitRows) },
      { asOf: currentDate },
    );
    if (gap) await persistAlerts(base44, [gap], currentDate, alerts);
  }
  return { agency_id: agencyId, patients_monitored: patients.length, discharged_reviewed: dischargedPatients.length };
}

Deno.serve(async (req) => {
  if (!COMPLIANCE_RISK_MONITOR_ENABLED) {
    return Response.json({
      success: false,
      available: false,
      reason: 'compliance_risk_monitor_paused',
      message: 'Automated compliance-risk monitoring is unavailable pending tenant-bound authorization and clinical validation.',
      alerts_created: 0,
    }, { status: 409 });
  }

  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const me = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();
    // An agency_admin/manager scans their own agency; the scheduled run and the
    // built-in administrator use the shared scheduler auth and scan each agency
    // separately (D49's per-agency rule).
    const claims = me && me.role !== 'admin' ? await withTrustedClaims(base44, me) : me;
    const agencyLead = !!claims && claims.role !== 'admin' && claimIdentifier(claims.agency_id) && claims.is_manager === true;
    if (!agencyLead) {
      const authError = getSchedulerAuthError(req, me);
      if (authError) return authError;
    }
    const input = await readBody(req);
    if (input.error) return input.error;
    if (agencyLead && input.agencyId && input.agencyId !== claims.agency_id) {
      return Response.json({ error: 'Forbidden: that agency is not yours' }, { status: 403, headers: NO_STORE_HEADERS });
    }

    const entities = base44.asServiceRole.entities;
    const agencies = await enabledAgencies(entities, agencyLead ? claims.agency_id : input.agencyId);
    if (agencyLead && agencies.length !== 1) {
      return Response.json({ error: 'Agency is unavailable' }, { status: 403, headers: NO_STORE_HEADERS });
    }
    const currentDate = new Date();
    const alerts = [];
    const scanned = [];
    let failed = 0;
    for (const agency of agencies) {
      try {
        scanned.push(await scanAgency(base44, agency, currentDate, alerts));
      } catch {
        failed += 1;
      }
    }

    return Response.json({
      success: failed === 0,
      alerts_generated: alerts.length,
      agencies_scanned: scanned.length,
      agencies_failed: failed,
      patients_monitored: scanned.reduce((sum, row) => sum + row.patients_monitored, 0),
      absence_based_rules_per_agency: true,
      timestamp: currentDate.toISOString(),
    }, { headers: NO_STORE_HEADERS });
  } catch {
    console.error('monitorComplianceRisks failed');
    return Response.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
});
