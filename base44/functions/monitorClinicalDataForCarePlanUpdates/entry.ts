import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Tolerant JSON extractor: we ask for strict JSON in-prompt instead of passing
// response_json_schema, because the provider rejects deeply-nested object
// schemas that lack an explicit `required` array at every level.
function parseLLMJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin only' }, { status: 403 });
    }

    const { patient_id, visit_id, timeframe_days = 7 } = await req.json();

    // Fetch patient data
    const patient = patient_id ? 
      await base44.asServiceRole.entities.Patient.get(patient_id) :
      null;

    // Determine which patients to analyze
    let patientsToAnalyze = [];
    if (patient_id) {
      patientsToAnalyze = [patient];
    } else {
      // Analyze all active patients
      patientsToAnalyze = await base44.asServiceRole.entities.Patient.filter(
        { status: 'active' }, 
        '-updated_date', 
        100
      );
    }

    const proposals = [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - timeframe_days);

    for (const pt of patientsToAnalyze) {
      // Gather clinical data
      const [visits, carePlans, medications, incidents] = await Promise.all([
        base44.asServiceRole.entities.Visit.filter(
          { patient_id: pt.id, status: 'completed' },
          '-visit_date',
          20
        ),
        base44.asServiceRole.entities.CarePlan.filter(
          { patient_id: pt.id, status: 'active' },
          '-created_date',
          10
        ),
        base44.asServiceRole.entities.Medication.filter(
          { patient_id: pt.id, status: 'active' },
          '-updated_date',
          50
        ),
        base44.asServiceRole.entities.Incident.filter(
          { patient_id: pt.id },
          '-incident_date',
          10
        )
      ]);

      // Filter to recent data
      const recentVisits = visits.filter(v => new Date(v.visit_date) >= cutoffDate);
      const recentIncidents = incidents.filter(i => new Date(i.incident_date) >= cutoffDate);

      if (recentVisits.length === 0) continue;

      // Extract vital signs trends
      const vitalsTrend = recentVisits
        .filter(v => v.vital_signs)
        .map(v => ({
          date: v.visit_date,
          bp_sys: v.vital_signs.blood_pressure_systolic,
          bp_dia: v.vital_signs.blood_pressure_diastolic,
          hr: v.vital_signs.heart_rate,
          temp: v.vital_signs.temperature,
          o2: v.vital_signs.oxygen_saturation,
          pain: v.vital_signs.pain_level,
          weight: v.vital_signs.weight
        }));

      // Extract clinical notes
      const clinicalNotes = recentVisits
        .filter(v => v.nurse_notes)
        .map(v => ({
          date: v.visit_date,
          note: v.nurse_notes,
          visit_type: v.visit_type
        }));

      // Current care plan interventions
      const currentInterventions = carePlans.flatMap(cp => cp.interventions || []);

      // AI Analysis. The raw result must go through parseLLMJson (this function
      // intentionally omits response_json_schema). Every use below referenced an
      // undeclared `analysis` — a guaranteed ReferenceError that 500'd the run, so
      // no CarePlanProposal/notification/alert was ever produced. Parse it here.
      const rawAnalysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: "claude_opus_4_8",
        prompt: `You are a clinical AI monitoring patient data to propose care plan updates when clinical thresholds are met.

PATIENT: ${pt.first_name} ${pt.last_name} (${pt.id})
PRIMARY DIAGNOSIS: ${pt.primary_diagnosis || 'Unknown'}
SECONDARY DIAGNOSES: ${pt.secondary_diagnoses?.join(', ') || 'None'}
CURRENT CARE SCOPE: ${pt.care_scope || 'home_health'}

VITAL SIGNS TREND (Last ${timeframe_days} days):
${vitalsTrend.map(v => `${v.date}: BP ${v.bp_sys}/${v.bp_dia}, HR ${v.hr}, Temp ${v.temp}°F, O2 ${v.o2}%, Pain ${v.pain}, Weight ${v.weight}`).join('\n')}

RECENT CLINICAL NOTES:
${clinicalNotes.map(n => `${n.date} (${n.visit_type}):\n${n.note.substring(0, 800)}`).join('\n\n---\n\n')}

CURRENT MEDICATIONS:
${medications.map(m => `${m.name} ${m.dosage} ${m.frequency} - ${m.indication || ''}`).join('\n')}

CURRENT CARE PLAN INTERVENTIONS:
${currentInterventions.map(i => `- ${i.description || i.intervention_name || i}`).join('\n') || 'No active interventions documented'}

RECENT INCIDENTS:
${recentIncidents.map(i => `${i.incident_date} - ${i.incident_type} (${i.severity}): ${i.description}`).join('\n') || 'None'}

ANALYZE FOR CARE PLAN UPDATE TRIGGERS:

1. VITAL SIGNS THRESHOLDS:
   - Hypertension: SBP >140 or DBP >90 sustained
   - Hypotension: SBP <90 or DBP <60
   - Tachycardia: HR >100 sustained
   - Bradycardia: HR <60
   - Fever: Temp >100.4°F
   - Hypoxia: O2 <92%
   - Pain escalation: Pain >5 or increasing trend
   - Weight changes: >5 lbs in week

2. CLINICAL NOTE PATTERNS:
   - New symptoms mentioned
   - Worsening of existing conditions
   - Functional decline
   - Fall risk increase
   - Infection signs
   - Mental status changes
   - Non-adherence to current plan
   - Family concerns
   - Safety issues

3. CARE GAPS:
   - Missing interventions for documented problems
   - Outdated goals
   - Need for additional disciplines (PT, OT, SW, etc.)

Identify if ANY care plan updates are warranted. Be conservative but proactive.`,
        response_json_schema: {
          type: "object",
          properties: {
            requires_care_plan_update: {
              type: "boolean",
              description: "Whether any care plan changes are needed"
            },
            findings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  finding_type: {
                    type: "string",
                    enum: ["vital_threshold_met", "clinical_deterioration", "new_symptom", "care_gap", "safety_concern", "functional_decline"]
                  },
                  severity: {
                    type: "string",
                    enum: ["low", "moderate", "high", "critical"]
                  },
                  description: { type: "string" },
                  evidence: {
                    type: "array",
                    items: { type: "string" }
                  },
                  proposed_intervention: { type: "string" },
                  expected_outcome: { type: "string" },
                  frequency: { type: "string" },
                  clinical_guidelines: {
                    type: "array",
                    items: { type: "string" }
                  }
                }
              }
            },
            proposed_new_goals: {
              type: "array",
              items: { type: "string" }
            },
            priority_level: {
              type: "string",
              enum: ["routine", "elevated", "urgent", "critical"]
            },
            confidence_score: {
              type: "number",
              description: "Overall confidence 0-100"
            },
            summary: {
              type: "string",
              description: "Executive summary for the nurse"
            }
          }
        }
      });

      // parseLLMJson tolerates both a returned object and raw/fenced JSON text.
      const analysis = parseLLMJson(rawAnalysis) || {};

      // Confidence gate: don't auto-create review artifacts from low-confidence AI
      // output. The model returns confidence_score (0–100); below the floor we skip
      // proposal creation entirely (a human can still review the chart directly).
      // Override with CARE_PLAN_MONITOR_MIN_CONFIDENCE.
      const minConfidence = Number(Deno.env.get('CARE_PLAN_MONITOR_MIN_CONFIDENCE') || '60');
      const confidence = Number(analysis.confidence_score);
      const confidentEnough = !Number.isFinite(confidence) || confidence >= minConfidence;

      if (analysis.requires_care_plan_update && analysis.findings?.length > 0 && confidentEnough) {
        // Create care plan proposal for each significant finding
        for (const finding of analysis.findings) {
          if (finding.severity === 'low') continue; // Skip low-severity findings

          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + (finding.severity === 'critical' ? 1 : finding.severity === 'high' ? 3 : 7));

          const proposal = await base44.asServiceRole.entities.CarePlanProposal.create({
            patient_id: pt.id,
            care_plan_id: carePlans[0]?.id || null,
            proposal_type: finding.finding_type === 'care_gap' ? 'new_intervention' : 'update_existing',
            trigger_source: finding.finding_type.includes('vital') ? 'vital_signs' : 'clinical_notes',
            trigger_data: {
              vitals: vitalsTrend.slice(0, 3),
              note_excerpts: clinicalNotes.slice(0, 2).map(n => n.note.substring(0, 200)),
              finding_type: finding.finding_type
            },
            ai_analysis: {
              clinical_finding: finding.description,
              severity_level: finding.severity,
              confidence_score: analysis.confidence_score,
              rationale: analysis.summary,
              evidence_based_guidelines: finding.clinical_guidelines || []
            },
            proposed_interventions: [{
              intervention_type: finding.finding_type,
              description: finding.proposed_intervention,
              frequency: finding.frequency || 'Daily',
              expected_outcome: finding.expected_outcome
            }],
            proposed_goals: analysis.proposed_new_goals || [],
            priority: analysis.priority_level || 'routine',
            status: 'pending_review',
            assigned_nurse: recentVisits[0]?.created_by || pt.primary_nurse || null,
            expires_at: expiresAt.toISOString()
          });

          proposals.push(proposal);

          // Create notification for assigned nurse
          if (proposal.assigned_nurse) {
            await base44.asServiceRole.entities.Notification.create({
              user_email: proposal.assigned_nurse,
              type: 'care_plan_proposal',
              title: `Care Plan Update Proposed: ${pt.first_name} ${pt.last_name}`,
              message: `AI has detected ${finding.severity} priority clinical changes requiring care plan review.`,
              priority: finding.severity === 'critical' ? 'critical' : 'medium',
              action_url: `/PatientDetails?id=${pt.id}`,
              is_read: false
            }).catch((err) => console.error('Failed to create notification:', err));
          }

          // Create patient alert for critical findings
          if (finding.severity === 'critical' || finding.severity === 'high') {
            await base44.asServiceRole.entities.PatientAlert.create({
              patient_id: pt.id,
              alert_type: 'care_gap',
              severity: finding.severity,
              title: `Care Plan Review Needed: ${finding.finding_type}`,
              message: finding.description,
              recommended_actions: finding.proposed_intervention ? [finding.proposed_intervention] : [],
              status: 'active'
            }).catch((err) => console.error('Failed to create care plan alert:', err));
          }
        }
      }
    }

    return Response.json({
      success: true,
      patients_analyzed: patientsToAnalyze.length,
      proposals_created: proposals.length,
      proposals: proposals.map(p => ({
        id: p.id,
        patient_id: p.patient_id,
        type: p.proposal_type,
        priority: p.priority,
        severity: p.ai_analysis.severity_level,
        assigned_nurse: p.assigned_nurse
      }))
    });

  } catch (error) {
    console.error('Clinical monitoring error:', error);
    return Response.json({
      error: error.message
    }, { status: 500 });
  }
});