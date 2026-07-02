import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Discharge-OASIS completion enforcer (inlined mirror of the unit-tested
// src/components/oasis/dischargeComplianceEnforcer.js — Deno cannot import from
// src/). Flags episodes that ended without a completed Discharge OASIS, which
// silently drops the patient's demonstrated improvement and erodes the
// 20-episode / 5-of-7-measure star-rating eligibility floor.
const STAR_MIN_EPISODES = 20;
const STAR_MIN_MEASURES = 5;
const DC_COMPLETE_STATUSES = new Set(['completed', 'submitted']);
const DC_START_TYPES = new Set(['Start of Care', 'Resumption of Care']);

function daysBetween(a, b) {
  const t1 = new Date(a).getTime();
  const t2 = new Date(b).getTime();
  if (Number.isNaN(t1) || Number.isNaN(t2)) return null;
  return Math.floor((t2 - t1) / (1000 * 60 * 60 * 24));
}

function detectMissingDischargeOASIS(ctx, opts = {}) {
  const { patient, oasisAssessments = [], visits = [] } = ctx || {};
  if (!patient || !patient.id) return null;
  const asOf = opts.asOf ? new Date(opts.asOf) : new Date();
  const staleDays = opts.staleDays ?? 14;

  const dischargeAssessments = oasisAssessments.filter((a) => a?.visit_type === 'Discharge');
  const hasCompletedDischarge = dischargeAssessments.some((a) => DC_COMPLETE_STATUSES.has(a?.status));
  const hasDraftDischarge = dischargeAssessments.length > 0 && !hasCompletedDischarge;
  const hasBaseline = oasisAssessments.some((a) => DC_START_TYPES.has(a?.visit_type));
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
    `Missing episodes erode the ${STAR_MIN_EPISODES}-episode / ${STAR_MIN_MEASURES}-of-7-measure star eligibility floor`,
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
  for (const alert of patientAlerts) {
    const existingAlerts = await base44.asServiceRole.entities.PatientAlert.filter({
      patient_id: alert.patient_id,
      alert_type: alert.alert_type,
      status: 'active',
    });
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
    const isAdmin = me?.role === 'admin';
    if (me && !isAdmin) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    // Service role for monitoring all patients (bounded — an unbounded list would
    // silently truncate at the SDK page default and time out at scale).
    const patients = await base44.asServiceRole.entities.Patient.filter({ status: 'active' }, '-created_date', 5000);
    const alerts = [];
    const currentDate = new Date();
    
    for (const patient of patients) {
      const patientAlerts = [];
      
      // Fetch patient data
      const [visits, oasisRecords, oasisAssessments] = await Promise.all([
        base44.asServiceRole.entities.Visit.filter({ patient_id: patient.id }, '-visit_date', 10),
        base44.asServiceRole.entities.OASISUpload.filter({ patient_id: patient.id }, '-created_date', 1),
        base44.asServiceRole.entities.OASISAssessment.filter({ patient_id: patient.id }, '-assessment_date', 20)
      ]);
      
      const lastVisit = visits[0];
      const daysSinceLastVisit = lastVisit ? 
        Math.floor((currentDate - new Date(lastVisit.visit_date)) / (1000 * 60 * 60 * 24)) : 999;
      
      // RISK 1: High-risk diagnosis without recent documentation
      const highRiskDiagnoses = ['CHF', 'COPD', 'Diabetes', 'Stroke', 'Cancer', 'Heart Failure'];
      const hasHighRiskDx = highRiskDiagnoses.some(dx => 
        patient.primary_diagnosis?.toUpperCase().includes(dx.toUpperCase())
      );
      
      if (hasHighRiskDx && daysSinceLastVisit > 7) {
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
      
      // RISK 3: Missing vital signs in recent visits
      const recentVisitsWithoutVitals = visits.slice(0, 3).filter(v => 
        !v.vital_signs || Object.keys(v.vital_signs).length === 0
      );
      
      if (recentVisitsWithoutVitals.length >= 2) {
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
      
      // RISK 4: Therapy utilization threshold for LUPA avoidance
      const therapyVisits = visits.filter(v => 
        v.visit_type?.toLowerCase().includes('therapy') || 
        v.visit_type?.toLowerCase().includes('pt') ||
        v.visit_type?.toLowerCase().includes('ot')
      );
      
      // Gate ONLY the episode-day (LUPA) check on a valid admission_date — do not
      // `continue`, or RISK 5/6 and the alert-persistence block below would be
      // skipped for any patient missing/with an unparseable admission_date,
      // silently discarding the RISK 1-3 alerts already queued for them.
      const admissionDate = patient.admission_date ? new Date(patient.admission_date) : null;
      if (admissionDate && !isNaN(admissionDate.getTime())) {
        const daysInEpisode = Math.floor((currentDate - admissionDate) / (1000 * 60 * 60 * 24));

        if (daysInEpisode < 60 && daysInEpisode > 7 && therapyVisits.length < 4) {
          patientAlerts.push({
            patient_id: patient.id,
            alert_type: 'readmission_risk',
            severity: 'high',
            title: 'Potential LUPA Risk - Low Therapy Utilization',
            message: `Only ${therapyVisits.length} therapy visits documented ${daysInEpisode} days into episode.`,
            contributing_factors: [
              `Episode day: ${daysInEpisode}`,
              `Therapy visits: ${therapyVisits.length}`,
              'Medicare LUPA threshold is typically 4 visits in 60-day episode',
              'Low utilization may trigger payment adjustment'
            ],
            recommended_actions: [
              'Review therapy orders and appropriateness',
              'Schedule additional PT/OT visits if clinically indicated',
              'Document medical necessity for therapy',
              'Consider therapy consultation for assessment'
            ],
            risk_score: 75,
            data_sources: { episode_day: daysInEpisode, therapy_visits: therapyVisits.length }
          });
        }
      }
      
      // RISK 5: Homebound status not documented in recent notes
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
      const dischargeGap = detectMissingDischargeOASIS(
        { patient, oasisAssessments, visits },
        { asOf: currentDate },
      );
      if (dischargeGap) patientAlerts.push(dischargeGap);

      // Create alerts that don't already exist (skips active 24h duplicates).
      await persistAlerts(base44, patientAlerts, currentDate, alerts);
    }

    // Discharged-patient sweep: the main loop only iterates ACTIVE patients, so
    // separately catch recently-discharged patients whose episode closed without
    // a completed Discharge OASIS (the highest-value, critical-severity case).
    const dischargedPatients = await base44.asServiceRole.entities.Patient.filter(
      { status: 'discharged' }, '-updated_date', 2000,
    );
    for (const patient of dischargedPatients) {
      const [visits, oasisAssessments] = await Promise.all([
        base44.asServiceRole.entities.Visit.filter({ patient_id: patient.id }, '-visit_date', 10),
        base44.asServiceRole.entities.OASISAssessment.filter({ patient_id: patient.id }, '-assessment_date', 20),
      ]);
      const gap = detectMissingDischargeOASIS({ patient, oasisAssessments, visits }, { asOf: currentDate });
      if (gap) await persistAlerts(base44, [gap], currentDate, alerts);
    }

    return Response.json({
      success: true,
      alerts_generated: alerts.length,
      patients_monitored: patients.length,
      timestamp: currentDate.toISOString()
    });
    
  } catch (error) {
    console.error('Error monitoring compliance risks:', error);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});