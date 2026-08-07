import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && (
    user.role === 'admin' || user.account_type === 'agency_admin' ||
    user.account_type === 'super_admin'
  );
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


// Compliance-risk monitor. COMPANION-MODE AWARE: PennSync usually runs
// alongside the agency's EMR, so rules that fire on the ABSENCE of EMR-owned
// data (visits, vitals, Discharge OASIS) are gated behind
// AgencySettings.pennsync_is_system_of_record (default OFF) — see the gate in
// the handler. Rules keyed to artifacts that exist in-app always run.
//
// Discharge-OASIS completion enforcer (inlined mirror of the unit-tested
// src/components/oasis/dischargeComplianceEnforcer.js — Deno cannot import from
// src/). Flags episodes that ended without a completed Discharge OASIS, which
// silently drops the patient's demonstrated improvement and erodes the
// 20-episode / 5-measure star-rating eligibility floor. Status and visit-type
// values compare case-insensitively so casing drift in stored records never
// creates false "missing discharge" alarms.
const STAR_MIN_EPISODES = 20;
const STAR_MIN_MEASURES = 5;
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
    'Without a completed Discharge OASIS this episode contributes no demonstrated improvement',
    `Missing episodes erode the ${STAR_MIN_EPISODES}-episode / ${STAR_MIN_MEASURES}-measure star eligibility floor`,
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
      'Pair it with the SOC/ROC to compute the CMS change score',
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
async function persistAlerts(base44, patientAlerts, currentDate, sink) {
  if (!patientAlerts?.length) return;
  const patientId = patientAlerts[0].patient_id;
  // Claim before creates so overlapping crons cannot both see "no duplicate"
  // and double-insert the same compliance alert (best-effort; docs/PLATFORM-CAS.md).
  const claimToken = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `compliance-monitor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await base44.asServiceRole.entities.Patient.update(patientId, {
      compliance_monitor_claimed_by: claimToken,
    });
  } catch {
    return;
  }
  const claimCheck = await base44.asServiceRole.entities.Patient
    .filter({ id: patientId }, '', 1).catch(() => []);
  if (!claimCheck[0] || claimCheck[0].compliance_monitor_claimed_by !== claimToken) {
    return;
  }

  for (const alert of patientAlerts) {
    const existingAlerts = await base44.asServiceRole.entities.PatientAlert.filter({
      patient_id: alert.patient_id,
      alert_type: alert.alert_type,
      status: 'active',
    }, undefined, 5000);
    const isDuplicate = existingAlerts.some((ea) =>
      ea.title === alert.title &&
      new Date(ea.created_date) > new Date(currentDate.getTime() - 24 * 60 * 60 * 1000));
    if (!isDuplicate) {
      const created = await base44.asServiceRole.entities.PatientAlert.create({
        ...alert,
        status: 'active',
        flagged_urgent: alert.severity === 'critical',
      });
      sink.push(created);
    }
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Auth gate (mirrors checkExpiredInvitations): this cron reads every active
    // patient's PHI and writes PatientAlerts. The no-identity cron path is
    // allowed; an authenticated non-admin is rejected.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

    // Companion-EMR gate: PennSync typically runs ALONGSIDE the agency's EMR,
    // so visits, vitals, and Discharge OASIS assessments may be documented only
    // in the EMR. Alerting on the ABSENCE of that data in PennSync would flood
    // the alert bell with false open items for work that was completed — just
    // elsewhere. The absence-based rules below (RISK 1 high-risk dx not seen in
    // 7 days, RISK 3 missing vitals, RISK 6 missing Discharge OASIS plus the
    // discharged-patient sweep) therefore only run when the agency has
    // explicitly set AgencySettings.pennsync_is_system_of_record to true
    // (schema default: false). Anything short of an explicit true — false,
    // unset, or no settings row — keeps them off, the safe companion-mode
    // default. Rules keyed to in-app artifacts (RISK 5: homebound wording
    // missing from a visit note that EXISTS in PennSync) always run.
    // Per-agency SoR flag (cached). Newest-row-wins would enable absence-based
    // alerts for every tenant when only one agency opted into system-of-record.
    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
    const emailToAgency = new Map(
      (allUsers || []).filter((u) => u?.email).map((u) => [u.email, u.agency_name || '']),
    );
    const sorCache = new Map();
    const agencyIsSystemOfRecord = async (agencyName) => {
      const key = agencyName || '__default__';
      if (sorCache.has(key)) return sorCache.get(key);
      let rows = [];
      if (agencyName) {
        rows = await base44.asServiceRole.entities.AgencySettings
          .filter({ agency_code: agencyName }, '-created_date', 1).catch(() => []);
        if (!rows?.length) {
          rows = await base44.asServiceRole.entities.AgencySettings
            .filter({ office_name: agencyName }, '-created_date', 1).catch(() => []);
        }
      }
      if (!rows?.length) {
        // Keyed agency miss: never adopt another tenant's sole SoR row.
        // Legacy single-row fallback only when no agency can be determined.
        if (agencyName) {
          sorCache.set(key, false);
          return false;
        }
        const newest = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 5).catch(() => []);
        if ((newest || []).length > 1) {
          sorCache.set(key, false);
          return false;
        }
        rows = (newest || []).slice(0, 1);
      }
      const flag = rows?.[0]?.pennsync_is_system_of_record === true;
      sorCache.set(key, flag);
      return flag;
    };
    const patientAgencyName = (patient) => {
      if (patient?.created_by && emailToAgency.has(patient.created_by)) {
        return emailToAgency.get(patient.created_by);
      }
      const assigned = Array.isArray(patient?.assigned_nurses) ? patient.assigned_nurses : [];
      for (const email of assigned) {
        if (emailToAgency.has(email)) return emailToAgency.get(email);
      }
      return '';
    };

    // Service role for monitoring all patients (bounded — an unbounded list would
    // silently truncate at the SDK page default and time out at scale).
    const patients = await base44.asServiceRole.entities.Patient.filter({ status: 'active' }, '-created_date', 5000);
    const alerts = [];
    const currentDate = new Date();
    
    for (const patient of patients) {
      const pennsyncIsSystemOfRecord = await agencyIsSystemOfRecord(patientAgencyName(patient));
      const patientAlerts = [];
      
      // Fetch patient data
      const [visits, oasisRecords, oasisAssessments] = await Promise.all([
        base44.asServiceRole.entities.Visit.filter({ patient_id: patient.id }, '-visit_date', 10),
        base44.asServiceRole.entities.OASISUpload.filter({ patient_id: patient.id }, '-created_date', 1),
        base44.asServiceRole.entities.OASISAssessment.filter({ patient_id: patient.id }, '-assessment_date', 20)
      ]);
      
      const lastVisit = visits[0];
      const daysSinceLastVisit = lastVisit
        ? daysBetween(lastVisit.visit_date, currentDate)
        : 999;
      
      // RISK 1: High-risk diagnosis without recent documentation.
      // Absence-based (assumes every visit is documented in PennSync) — gated
      // behind pennsync_is_system_of_record; see the companion-EMR note above.
      const highRiskDiagnoses = ['CHF', 'COPD', 'Diabetes', 'Stroke', 'Cancer', 'Heart Failure'];
      const hasHighRiskDx = highRiskDiagnoses.some(dx =>
        patient.primary_diagnosis?.toUpperCase().includes(dx.toUpperCase())
      );

      if (pennsyncIsSystemOfRecord && hasHighRiskDx && daysSinceLastVisit > 7) {
        patientAlerts.push({
          patient_id: patient.id,
          alert_type: 'care_gap',
          severity: 'high',
          title: 'High-Risk Patient Without Recent Documentation',
          message: `${patient.first_name} ${patient.last_name} has ${patient.primary_diagnosis} and hasn't been seen in ${daysSinceLastVisit} days.`,
          contributing_factors: [
            `High-risk diagnosis: ${patient.primary_diagnosis}`,
            `Last visit: ${daysSinceLastVisit} days ago`,
            'Medicare requires frequent monitoring for high-risk conditions'
          ],
          recommended_actions: [
            'Schedule follow-up visit within 3 days',
            'Contact patient to assess current status',
            'Document any telephonic monitoring',
            'Review care plan for appropriate visit frequency'
          ],
          risk_score: 85,
          data_sources: { last_visit_date: lastVisit?.visit_date, diagnosis: patient.primary_diagnosis }
        });
      }
      
      // RISK 3: Missing vital signs in recent visits.
      // Absence-based (vitals may be charted in the EMR even when the visit is
      // mirrored here) — gated behind pennsync_is_system_of_record.
      const recentVisitsWithoutVitals = visits.slice(0, 3).filter(v =>
        !v.vital_signs || Object.keys(v.vital_signs).length === 0
      );

      if (pennsyncIsSystemOfRecord && recentVisitsWithoutVitals.length >= 2) {
        patientAlerts.push({
          patient_id: patient.id,
          alert_type: 'documentation_risk',
          severity: 'medium',
          title: 'Incomplete Vital Signs Documentation',
          message: `${recentVisitsWithoutVitals.length} of last 3 visits missing vital signs.`,
          contributing_factors: [
            'Vital signs are required for skilled nursing visits',
            'Missing baseline data for condition monitoring',
            'Audit risk for incomplete documentation'
          ],
          recommended_actions: [
            'Ensure vital signs captured at every skilled visit',
            'Add vital signs to previous visit notes if documented elsewhere',
            'Train staff on documentation requirements',
            'Enable Smart Vitals Input feature'
          ],
          risk_score: 65,
          data_sources: { visits_missing_vitals: recentVisitsWithoutVitals.length }
        });
      }
      
      // RISK 4 (removed 2026-07-03): the "Potential LUPA Risk" alert counted
      // therapy visits against the pre-PDGM "4 visits per 60-day episode" rule
      // — under PDGM the LUPA threshold is per-HHRG (2–6 visits per 30-day
      // period), so the rule was simply wrong — AND it was absence-based over
      // visits that in companion mode live in the EMR. LUPA economics belong in
      // the admin PDGM analysis views as reference information, not as alerts.

      // RISK 5: Homebound status not documented in recent notes.
      // Keyed to an in-app artifact (the visit note EXISTS in PennSync but its
      // content lacks homebound wording), so it stays on in companion mode.
      if (lastVisit) {
        const noteMention = lastVisit.nurse_notes?.toLowerCase() || '';
        const homeboundKeywords = ['homebound', 'taxing', 'considerable effort', 'leaving home', 'ambulation'];
        const hasHomeboundDoc = homeboundKeywords.some(kw => noteMention.includes(kw));
        
        if (!hasHomeboundDoc && daysSinceLastVisit < 14) {
          patientAlerts.push({
            patient_id: patient.id,
            alert_type: 'documentation_risk',
            severity: 'critical',
            title: 'Missing Homebound Status Documentation',
            message: 'Recent visit note lacks homebound justification - critical for Medicare eligibility.',
            contributing_factors: [
              'Homebound status is Medicare eligibility requirement',
              'Must be documented at every skilled visit',
              'High audit risk if not clearly stated'
            ],
            recommended_actions: [
              'Add homebound justification to next visit note immediately',
              'Document specific limitations and why leaving home is taxing',
              'Include distance patient can ambulate safely',
              'Use Smart Note Assistant homebound templates'
            ],
            risk_score: 90,
            data_sources: { last_visit_date: lastVisit.visit_date }
          });
        }
      }
      
      // RISK 6: Episode ended without a completed Discharge OASIS. A missing
      // Discharge OASIS silently loses the patient's demonstrated improvement
      // and drags the agency below the star-rating eligibility floor.
      // Absence-based (the discharge assessment most likely lives in the EMR)
      // — gated behind pennsync_is_system_of_record; incomplete pairs surface
      // as the coverage note on the Outcome Measures dashboard instead.
      if (pennsyncIsSystemOfRecord) {
        const dischargeGap = detectMissingDischargeOASIS(
          { patient, oasisAssessments, visits },
          { asOf: currentDate },
        );
        if (dischargeGap) patientAlerts.push(dischargeGap);
      }

      // Create alerts that don't already exist (skips active 24h duplicates).
      await persistAlerts(base44, patientAlerts, currentDate, alerts);
    }

    // Discharged-patient sweep: the main loop only iterates ACTIVE patients, so
    // separately catch recently-discharged patients whose episode closed without
    // a completed Discharge OASIS (the highest-value, critical-severity case).
    // Same absence-based rule as RISK 6 — resolve SoR per patient (never reuse
    // a loop-local flag from the active sweep).
    {
      const dischargedPatients = await base44.asServiceRole.entities.Patient.filter(
        { status: 'discharged' }, '-updated_date', 2000,
      );
      for (const patient of dischargedPatients) {
        const dischargedIsSoR = await agencyIsSystemOfRecord(patientAgencyName(patient));
        if (!dischargedIsSoR) continue;
        const [visits, oasisAssessments] = await Promise.all([
          base44.asServiceRole.entities.Visit.filter({ patient_id: patient.id }, '-visit_date', 10),
          base44.asServiceRole.entities.OASISAssessment.filter({ patient_id: patient.id }, '-assessment_date', 20),
        ]);
        const gap = detectMissingDischargeOASIS({ patient, oasisAssessments, visits }, { asOf: currentDate });
        if (gap) await persistAlerts(base44, [gap], currentDate, alerts);
      }
    }

    return Response.json({
      success: true,
      alerts_generated: alerts.length,
      patients_monitored: patients.length,
      // Per-patient SoR; response reports whether any agency still uses companion mode.
      absence_based_rules_per_agency: true,
      timestamp: currentDate.toISOString()
    });
    
  } catch (error) {
    console.error('Error monitoring compliance risks:', error);
    return Response.json({ 
      success: false,
      error: 'Internal server error' 
    }, { status: 500 });
  }
});