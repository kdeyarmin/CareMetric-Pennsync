import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { 
  Shield, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  FileText,
  TrendingUp,
  Clock,
  Loader2,
  AlertCircle,
  BookOpen,
  ChevronRight
} from "lucide-react";
import { trackRecommendation } from "../training/RecommendationTracker";
import { logActivity, ActivityActions } from "../utils/activityLogger";
import { buildComprehensivePatientHistory, formatHistoryForAI, extractKeyInsights } from "../utils/patientHistoryAnalyzer";

export default function AIComplianceAuditor({ 
  patientId, 
  visitId = null,
  autoRun = false,
  onIssuesFound,
  _scope = "comprehensive" // "comprehensive", "visit", "documentation", "oasis"
}) {
  const ai = useAICall();
  const [auditResults, setAuditResults] = useState(null);
  const [_expandedSection, _setExpandedSection] = useState(null);
  const queryClient = useQueryClient();

  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => base44.entities.Patient.filter({ id: patientId }),
    select: (data) => data[0],
    enabled: !!patientId,
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['patientVisits', patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 10),
    enabled: !!patientId,
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['patientCarePlans', patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId }),
    enabled: !!patientId,
  });

  const { data: oasisData = [] } = useQuery({
    queryKey: ['patientOASIS', patientId],
    queryFn: () => base44.entities.OASISUpload.filter({ patient_id: patientId }, '-created_date', 1),
    enabled: !!patientId,
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['patientIncidents', patientId],
    queryFn: () => base44.entities.Incident.filter({ patient_id: patientId }),
    enabled: !!patientId,
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const runComplianceAudit = useCallback(async () => {
    if (!patient) return;

    try {
      // Build comprehensive patient history
      const patientHistory = await buildComprehensivePatientHistory(patient.id);
      const historyContext = formatHistoryForAI(patientHistory);
      const keyInsights = extractKeyInsights(patientHistory);

      const _targetVisit = visitId ? visits.find(v => v.id === visitId) : visits[0];
      const latestOASIS = oasisData[0];

      const prompt = `You are an expert healthcare compliance auditor specializing in home health and hospice regulations. Perform a comprehensive compliance audit of this patient record WITH EMPHASIS ON CONTINUITY OF CARE AND TREND ANALYSIS.

${historyContext}

PATIENT COMPREHENSIVE DATA:
Name: ${patient.first_name} ${patient.middle_name || ''} ${patient.last_name}
DOB: ${patient.date_of_birth || 'Not provided'}
MRN: ${patient.medical_record_number || 'Not provided'}
Care Type: ${patient.care_type || 'home_health'}
Status: ${patient.status}
Admission Date: ${patient.admission_date || 'Not documented'}
Admission Source: ${patient.admission_source || 'Not documented'}

CLINICAL INFORMATION:
Primary Diagnosis: ${patient.primary_diagnosis || 'Not documented'}
Secondary Diagnoses: ${patient.secondary_diagnoses?.length > 0 ? patient.secondary_diagnoses.join(', ') : 'None documented'}
Allergies: ${patient.allergies || 'Not documented'}

CURRENT MEDICATIONS: ${patient.current_medications?.length > 0 ? 
  patient.current_medications.map(m => `${m.name} ${m.dosage} ${m.frequency}`).join('; ') : 
  'Not documented'}

PAST MEDICAL HISTORY: ${patient.past_medical_history?.length > 0 ? patient.past_medical_history.join(', ') : 'Not documented'}

HOSPITALIZATIONS: ${patient.past_hospitalizations?.length > 0 ? 
  patient.past_hospitalizations.map(h => `${h.date}: ${h.reason} at ${h.hospital}`).join('; ') : 
  'No recent hospitalizations documented'}

BASELINE VITALS:
${patient.baseline_vitals ? `
- BP: ${patient.baseline_vitals.blood_pressure_systolic}/${patient.baseline_vitals.blood_pressure_diastolic}
- HR: ${patient.baseline_vitals.heart_rate}
- RR: ${patient.baseline_vitals.respiratory_rate}
- O2 Sat: ${patient.baseline_vitals.oxygen_saturation}%
- Weight: ${patient.baseline_vitals.weight} lbs
- Height: ${patient.baseline_vitals.height} inches
- BMI: ${patient.baseline_vitals.bmi}
` : 'Baseline vitals not documented'}

FUNCTIONAL STATUS:
${patient.functional_status ? `
- Ambulation: ${patient.functional_status.ambulation || 'Not assessed'}
- ADL Independence: ${patient.functional_status.adl_independence || 'Not assessed'}
- Cognitive Status: ${patient.functional_status.cognitive_status || 'Not assessed'}
- Fall Risk: ${patient.functional_status.fall_risk || 'Not assessed'}
- Notes: ${patient.functional_status.notes || 'None'}
` : 'Functional status not documented'}

SOCIAL HISTORY:
${patient.social_history ? `
- Living Situation: ${patient.social_history.living_situation || 'Unknown'}
- Primary Language: ${patient.social_history.primary_language || 'Not documented'}
- Interpreter Needed: ${patient.social_history.interpreter_needed ? 'Yes' : 'No'}
- Smoking Status: ${patient.social_history.smoking_status || 'Unknown'}
- Support System: ${patient.social_history.support_system || 'Not documented'}
` : 'Social history not documented'}

MENTAL HEALTH:
${patient.mental_health ? `
- Depression Screening: ${patient.mental_health.depression_screening || 'Not completed'}
- Anxiety Level: ${patient.mental_health.anxiety_level || 'Not assessed'}
- Psychiatric History: ${patient.mental_health.psychiatric_history || 'None documented'}
` : 'Mental health assessment not documented'}

PAIN MANAGEMENT:
${patient.pain_management ? `
- Chronic Pain: ${patient.pain_management.chronic_pain ? 'Yes' : 'No'}
- Pain Locations: ${patient.pain_management.pain_location?.join(', ') || 'None'}
- Interventions: ${patient.pain_management.pain_interventions?.join(', ') || 'None'}
- Pain Goals: ${patient.pain_management.pain_goals || 'Not established'}
` : 'Pain management plan not documented'}

WOUNDS: ${patient.wounds?.length > 0 ? 
  patient.wounds.map(w => `${w.location} - ${w.type} (${w.stage}): ${w.size_length}x${w.size_width}x${w.size_depth}cm`).join('; ') : 
  'No active wounds'}

ADVANCE DIRECTIVES:
${patient.advance_directives ? `
- Living Will: ${patient.advance_directives.has_living_will ? 'Yes' : 'No'}
- Healthcare Proxy: ${patient.advance_directives.has_healthcare_proxy ? 'Yes' : 'No'}
- DNR Status: ${patient.advance_directives.dnr_status ? 'Yes' : 'No'}
- Proxy: ${patient.advance_directives.proxy_name || 'Not designated'}
` : 'Advance directives not documented'}

INSURANCE:
Primary: ${patient.insurance_primary?.provider || 'Not documented'}
Secondary: ${patient.insurance_secondary?.provider || 'None'}

EMERGENCY CONTACT:
${patient.emergency_contact_name || 'Not provided'} (${patient.emergency_contact_relationship || 'Unknown'})
Phone: ${patient.emergency_contact_phone || 'Not provided'}

PHYSICIAN:
${patient.physician_name || 'Not provided'}
Phone: ${patient.physician_phone || 'Not provided'}

RECENT VISITS (Last ${visits.length}):
${visits.map(v => `
Date: ${v.visit_date}
Type: ${v.visit_type}
Status: ${v.status}
Vitals: ${v.vital_signs ? `BP ${v.vital_signs.blood_pressure_systolic}/${v.vital_signs.blood_pressure_diastolic}, HR ${v.vital_signs.heart_rate}, O2 ${v.vital_signs.oxygen_saturation}%` : 'Not recorded'}
Notes Length: ${v.nurse_notes?.length || 0} characters
${v.nurse_notes ? 'Has documentation' : 'Missing documentation'}
`).join('\n')}

ACTIVE CARE PLANS (${carePlans.filter(cp => cp.status === 'active').length}):
${carePlans.filter(cp => cp.status === 'active').map(cp => `
- Problem: ${cp.problem}
- Goal: ${cp.goal}
- Interventions: ${cp.interventions?.join(', ')}
- Status: ${cp.status}
`).join('\n')}

OASIS DATA:
${latestOASIS ? `
Assessment Date: ${latestOASIS.created_date}
PDGM Clinical Group: ${latestOASIS.pdgm_data?.clinical_grouping || 'Not specified'}
Functional Level: ${latestOASIS.pdgm_data?.functional_impairment_level || 'Not specified'}
Comorbidities: ${latestOASIS.pdgm_data?.comorbidity_level?.join(', ') || 'None'}
` : 'No OASIS assessment on file'}

INCIDENTS (${incidents.length}):
${incidents.map(i => `${i.incident_date}: ${i.incident_type} - ${i.severity} severity`).join('; ')}

COMPLIANCE AUDIT REQUIREMENTS:
Analyze this comprehensive patient record against the following compliance areas:

1. DOCUMENTATION COMPLETENESS (CMS CoP 484.50)
   - Is admission documentation complete?
   - Are baseline assessments documented?
   - Are all required patient demographics captured?
   - Is emergency contact information complete?
   - Are advance directives documented?
   - Is insurance information complete?

2. CLINICAL ASSESSMENT (CMS CoP 484.55)
   - Are baseline vitals documented?
   - Is functional status properly assessed?
   - Is pain assessed and managed?
   - Are wounds properly documented and tracked?
   - Is mental health screening completed?
   - Are social determinants addressed?

3. MEDICATION MANAGEMENT (CMS CoP 484.60)
   - Is current medication list complete and accurate?
   - Are medication reconciliation processes followed?
   - Are high-risk medications identified?
   - Are medication side effects monitored?

4. CARE PLANNING (CMS CoP 484.60) ${carePlans?.length > 0 ? '- Care plans exist, assess alignment:' : '- No care plans on file (may be appropriate for some patients):'}
   ${carePlans?.length > 0 ? `- Are care plans based on comprehensive assessment?
   - Do care plans address all identified problems?
   - Are patient/family goals documented?
   - Are interventions specific and measurable?` : '- Assess if care plan development is warranted based on patient needs'}

5. VISIT DOCUMENTATION (Medicare Guidelines)
   - Are skilled nursing interventions documented?
   - Is homebound status justified?
   - Is patient response documented?
   - Are teaching efforts and comprehension noted?
   - Are vital signs trended and compared to baseline?

6. OASIS COMPLIANCE (OASIS-E Requirements) ${latestOASIS ? '- OASIS exists, verify alignment:' : '- No OASIS data (skip if not required for this patient/visit):'}
   ${latestOASIS ? `- Is OASIS assessment current (within 5 days of SOC)?
   - Does clinical documentation support OASIS answers?
   - Are discrepancies between OASIS and clinical notes identified?` : '- OASIS not applicable - skip this compliance area'}

7. SAFETY AND RISK MANAGEMENT
   - Is fall risk assessed and addressed?
   - Are infection prevention measures documented?
   - Are emergency procedures established?
   - Are caregiver training needs identified?

8. REGULATORY COMPLIANCE
   - Are CoP (Conditions of Participation) requirements met?
   - Are state-specific regulations followed?
   - Are privacy (HIPAA) standards maintained?
   - Are coordination of care requirements met?

9. CONTINUITY OF CARE (Critical Focus):
   - Are trends from patient history addressed?
   - Are changes from baseline vitals documented?
   - Are previous visit concerns followed up?
   - Is patient response to interventions tracked?
   - Are care plan goals progressing appropriately?
   - Are recurring issues identified and managed?

10. CONTEXTUAL COMPLIANCE:
   - Does documentation reflect understanding of patient trajectory?
   - Are concerning trends escalated appropriately?
   - Is historical context referenced where relevant?

KEY HISTORICAL INSIGHTS TO CONSIDER:
${keyInsights.map(insight => `- [${insight.priority.toUpperCase()}] ${insight.message}`).join('\n')}

For each area, provide:
{
  "overall_compliance_score": 0-100,
  "compliance_level": "compliant" | "minor_issues" | "major_issues" | "critical_issues",
  "critical_findings": [
    {
      "category": "string",
      "regulation": "CMS CoP reference or regulation name",
      "issue": "Specific issue found",
      "risk_level": "critical" | "high" | "medium" | "low",
      "current_state": "What is currently documented",
      "required_state": "What should be documented",
      "actionable_steps": ["Step 1", "Step 2"],
      "timeline": "Immediate" | "Within 24 hours" | "Within 1 week",
      "affected_areas": ["List of affected documentation areas"]
    }
  ],
  "minor_findings": [same structure as critical],
  "best_practices": [
    {
      "area": "string",
      "recommendation": "string",
      "rationale": "string",
      "impact": "Potential improvement from following this practice"
    }
  ],
  "documentation_gaps": [
    {
      "field": "Field name in patient record",
      "importance": "Required" | "Recommended" | "Best Practice",
      "impact": "Impact of missing this data",
      "suggested_action": "How to obtain/document this"
    }
  ],
  "trending_concerns": [
    {
      "concern": "Pattern or trend identified",
      "evidence": "What data supports this concern",
      "recommendation": "What to do about it",
      "historical_context": "Reference to patient history that supports this concern"
    }
  ],
  "continuity_issues": [
    {
      "issue": "Continuity gap identified",
      "impact": "Impact on patient care",
      "previous_documentation": "What was documented before",
      "current_gap": "What's missing now",
      "resolution": "How to address this gap"
    }
  ],
  "compliance_strengths": ["List areas where documentation is strong"],
  "priority_actions": [
    {
      "action": "Specific action to take",
      "rationale": "Why this is important",
      "assigned_to": "Who should handle this",
      "deadline": "When it must be completed"
    }
  ]
}`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            overall_compliance_score: { type: "number" },
            compliance_level: { type: "string" },
            critical_findings: { 
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  regulation: { type: "string" },
                  issue: { type: "string" },
                  risk_level: { type: "string" },
                  current_state: { type: "string" },
                  required_state: { type: "string" },
                  actionable_steps: { type: "array", items: { type: "string" } },
                  timeline: { type: "string" },
                  affected_areas: { type: "array", items: { type: "string" } }
                }
              }
            },
            minor_findings: { 
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  regulation: { type: "string" },
                  issue: { type: "string" },
                  risk_level: { type: "string" },
                  current_state: { type: "string" },
                  required_state: { type: "string" },
                  actionable_steps: { type: "array", items: { type: "string" } },
                  timeline: { type: "string" },
                  affected_areas: { type: "array", items: { type: "string" } }
                }
              }
            },
            best_practices: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  recommendation: { type: "string" },
                  rationale: { type: "string" },
                  impact: { type: "string" }
                }
              }
            },
            documentation_gaps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  importance: { type: "string" },
                  impact: { type: "string" },
                  suggested_action: { type: "string" }
                }
              }
            },
            trending_concerns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  concern: { type: "string" },
                  evidence: { type: "string" },
                  recommendation: { type: "string" },
                  historical_context: { type: "string" }
                }
              }
            },
            continuity_issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  issue: { type: "string" },
                  impact: { type: "string" },
                  previous_documentation: { type: "string" },
                  current_gap: { type: "string" },
                  resolution: { type: "string" }
                }
              }
            },
            compliance_strengths: { type: "array", items: { type: "string" } },
            priority_actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: { type: "string" },
                  rationale: { type: "string" },
                  assigned_to: { type: "string" },
                  deadline: { type: "string" }
                }
              }
            }
          }
        }
      });

      setAuditResults(result);

      // Track findings for training
      if (currentUser?.email && result.critical_findings?.length > 0) {
        result.critical_findings.forEach(finding => {
          trackRecommendation({
            nurseEmail: currentUser.email,
            type: 'compliance',
            text: `${finding.category}: ${finding.issue}`,
            source: 'compliance_checker',
            severity: finding.risk_level === 'critical' ? 'critical' : finding.risk_level === 'high' ? 'high' : 'medium',
            patientId: patientId,
            contextData: {
              regulation: finding.regulation,
              required_state: finding.required_state,
              actionable_steps: finding.actionable_steps
            }
          });
        });
      }

      // Log audit activity
      logActivity(ActivityActions.NOTE_COMPLIANCE_CHECK, {
        patient_id: patientId,
        visit_id: visitId,
        compliance_score: result.overall_compliance_score,
        critical_findings_count: result.critical_findings?.length || 0,
        minor_findings_count: result.minor_findings?.length || 0,
        page: 'AIComplianceAuditor'
      });

      // Callback with issues
      if (onIssuesFound) {
        onIssuesFound(result);
      }

      // Create ComplianceAudit record. visit_id is required; for a patient with no
      // visit on file it would resolve to undefined and the create would reject
      // (silently losing the audit). Skip persistence in that case — the analysis
      // is already shown — and tell the user why.
      const resolvedVisitId = visitId || visits[0]?.id;
      if (!resolvedVisitId) {
        toast.warning('Audit completed, but there is no visit on file to attach it to. Document a visit to save this compliance audit.');
        return;
      }
      await base44.entities.ComplianceAudit.create({
        visit_id: resolvedVisitId,
        nurse_email: currentUser?.email || 'system',
        patient_id: patientId,
        compliance_score: result.overall_compliance_score,
        status: result.compliance_level === 'compliant' ? 'passed' : 
                result.compliance_level === 'critical_issues' ? 'critical' : 'flagged',
        issues: [...(result.critical_findings || []), ...(result.minor_findings || [])],
        compliant_elements: result.compliance_strengths || [],
        audit_type: 'automated'
      });

      // Refresh the compliance dashboards that read ComplianceAudit (prefix match
      // covers the keyed variants ['complianceAudits', dateRange|timeRange]).
      queryClient.invalidateQueries({ queryKey: ['complianceAudits'] });

    } catch (error) {
      console.error("Compliance audit failed:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [patient, visits, carePlans, oasisData, incidents, currentUser, patientId, visitId, onIssuesFound, queryClient]);

  useEffect(() => {
    if (autoRun && patient && !auditResults && !ai.loading) {
      runComplianceAudit();
    }
  }, [autoRun, patient, auditResults, ai.loading, runComplianceAudit]);

  const getRiskColor = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  const getComplianceColor = (level) => {
    switch (level) {
      case 'compliant': return 'text-green-600';
      case 'minor_issues': return 'text-yellow-600';
      case 'major_issues': return 'text-orange-600';
      case 'critical_issues': return 'text-red-600';
      default: return 'text-slate-600';
    }
  };

  if (!patient) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-slate-500">
          No patient data available
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-indigo-50">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-navy-600" />
            <span>AI Compliance Auditor</span>
            {auditResults && (
              <Badge className={getRiskColor(
                auditResults.compliance_level === 'compliant' ? 'low' : 
                auditResults.compliance_level === 'critical_issues' ? 'critical' : 'medium'
              )}>
                {auditResults.overall_compliance_score}% Compliant
              </Badge>
            )}
          </div>
          <Button
            onClick={runComplianceAudit}
            disabled={ai.loading}
            size="sm"
            className="bg-navy-600 hover:bg-navy-700"
          >
            {ai.loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
            ) : (
              <><Shield className="w-4 h-4 mr-2" /> Run Audit</>
            )}
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className="p-4">
        {!auditResults && !ai.loading && (
          <Alert className="bg-blue-50 border-blue-200">
            <AlertCircle className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-800">
              Click "Run Audit" to perform a comprehensive compliance check against CMS CoP, OASIS-E, and Medicare guidelines.
            </AlertDescription>
          </Alert>
        )}

        {auditResults && (
          <div className="space-y-4">
            {/* Overall Score */}
            <div className="flex items-center justify-between p-4 bg-gradient-to-r from-navy-50 to-blue-50 rounded-lg">
              <div>
                <p className="text-sm text-slate-600">Overall Compliance</p>
                <p className={`text-3xl font-bold ${getComplianceColor(auditResults.compliance_level)}`}>
                  {auditResults.overall_compliance_score}%
                </p>
                <p className="text-sm text-slate-500 capitalize">{auditResults.compliance_level?.replace(/_/g, ' ')}</p>
              </div>
              <div className="text-right">
                <div className="flex gap-2 mb-2">
                  <Badge className="bg-red-100 text-red-800">
                    {auditResults.critical_findings?.length || 0} Critical
                  </Badge>
                  <Badge className="bg-yellow-100 text-yellow-800">
                    {auditResults.minor_findings?.length || 0} Minor
                  </Badge>
                </div>
                <p className="text-xs text-slate-500">
                  {auditResults.compliance_strengths?.length || 0} areas of strength
                </p>
              </div>
            </div>

            {/* Critical Findings */}
            {auditResults.critical_findings?.length > 0 && (
              <Alert className="bg-red-50 border-red-300">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <AlertDescription>
                  <p className="font-semibold text-red-900 mb-2">
                    {auditResults.critical_findings.length} Critical Compliance Issue{auditResults.critical_findings.length > 1 ? 's' : ''} Require Immediate Attention
                  </p>
                  <Accordion type="single" collapsible className="mt-3">
                    {auditResults.critical_findings.map((finding, idx) => (
                      <AccordionItem key={idx} value={`critical-${idx}`} className="border-red-200">
                        <AccordionTrigger className="text-red-800 hover:text-red-900">
                          <div className="flex items-center gap-2 flex-1 text-left">
                            <XCircle className="w-4 h-4 flex-shrink-0" />
                            <span className="font-medium">{finding.category}</span>
                            <Badge className={getRiskColor(finding.risk_level)} variant="outline">
                              {finding.timeline}
                            </Badge>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="text-red-900 space-y-3 pl-6">
                          <div>
                            <p className="font-semibold text-sm mb-1">Issue:</p>
                            <p className="text-sm">{finding.issue}</p>
                          </div>
                          <div>
                            <p className="font-semibold text-sm mb-1">Regulation:</p>
                            <Badge variant="outline" className="bg-white">{finding.regulation}</Badge>
                          </div>
                          <div className="grid md:grid-cols-2 gap-3">
                            <div>
                              <p className="font-semibold text-sm mb-1">Current State:</p>
                              <p className="text-sm bg-white p-2 rounded">{finding.current_state}</p>
                            </div>
                            <div>
                              <p className="font-semibold text-sm mb-1">Required State:</p>
                              <p className="text-sm bg-green-50 p-2 rounded border border-green-200">{finding.required_state}</p>
                            </div>
                          </div>
                          <div>
                            <p className="font-semibold text-sm mb-2">Actionable Steps:</p>
                            <ol className="list-decimal list-inside space-y-1">
                              {finding.actionable_steps?.map((step, i) => (
                                <li key={i} className="text-sm">{step}</li>
                              ))}
                            </ol>
                          </div>
                          {finding.affected_areas?.length > 0 && (
                            <div>
                              <p className="font-semibold text-sm mb-1">Affected Areas:</p>
                              <div className="flex flex-wrap gap-1">
                                {finding.affected_areas.map((area, i) => (
                                  <Badge key={i} variant="outline" className="text-xs">{area}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </AlertDescription>
              </Alert>
            )}

            {/* Minor Findings */}
            {auditResults.minor_findings?.length > 0 && (
              <Card className="border-yellow-300 bg-yellow-50">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-yellow-600" />
                    Minor Issues ({auditResults.minor_findings.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3">
                  <Accordion type="single" collapsible>
                    {auditResults.minor_findings.map((finding, idx) => (
                      <AccordionItem key={idx} value={`minor-${idx}`}>
                        <AccordionTrigger className="text-yellow-800">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{finding.category}</span>
                            <Badge variant="outline" className="text-xs">{finding.risk_level}</Badge>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-2 text-sm">
                          <p><strong>Issue:</strong> {finding.issue}</p>
                          <p><strong>Regulation:</strong> {finding.regulation}</p>
                          <div>
                            <strong>Steps to Resolve:</strong>
                            <ul className="list-disc list-inside mt-1">
                              {finding.actionable_steps?.map((step, i) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ul>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </CardContent>
              </Card>
            )}

            {/* Documentation Gaps */}
            {auditResults.documentation_gaps?.length > 0 && (
              <Card className="border-blue-200">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-600" />
                    Documentation Gaps ({auditResults.documentation_gaps.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-2">
                  {auditResults.documentation_gaps.map((gap, idx) => (
                    <div key={idx} className="flex items-start justify-between p-2 bg-blue-50 rounded">
                      <div className="flex-1">
                        <p className="font-medium text-sm">{gap.field}</p>
                        <p className="text-xs text-slate-600">{gap.impact}</p>
                      </div>
                      <Badge variant="outline" className={
                        gap.importance === 'Required' ? 'bg-red-100 text-red-800' :
                        gap.importance === 'Recommended' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-blue-100 text-blue-800'
                      }>
                        {gap.importance}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Trending Concerns */}
            {auditResults.trending_concerns?.length > 0 && (
              <Card className="border-orange-200 bg-orange-50">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-orange-600" />
                    Trending Concerns & Historical Patterns
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-3">
                  {auditResults.trending_concerns.map((concern, idx) => (
                    <div key={idx} className="bg-white p-3 rounded border border-orange-200">
                      <p className="font-medium text-sm text-orange-900 mb-1">{concern.concern}</p>
                      <p className="text-xs text-slate-600 mb-2">{concern.evidence}</p>
                      {concern.historical_context && (
                        <p className="text-xs text-orange-700 bg-orange-50 p-2 rounded mb-2 italic">
                          📊 Historical Context: {concern.historical_context}
                        </p>
                      )}
                      <div className="flex items-start gap-2 text-xs">
                        <ChevronRight className="w-3 h-3 text-orange-600 mt-0.5 flex-shrink-0" />
                        <p className="text-orange-800">{concern.recommendation}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Continuity Issues */}
            {auditResults.continuity_issues?.length > 0 && (
              <Card className="border-navy-200 bg-navy-50">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="w-4 h-4 text-navy-600" />
                    Continuity of Care Issues
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-3">
                  {auditResults.continuity_issues.map((issue, idx) => (
                    <div key={idx} className="bg-white p-3 rounded border border-navy-200">
                      <p className="font-medium text-sm text-navy-900 mb-2">{issue.issue}</p>
                      <div className="space-y-2 text-xs">
                        <div className="bg-red-50 p-2 rounded border border-red-200">
                          <p className="font-semibold text-red-800">Impact:</p>
                          <p className="text-red-700">{issue.impact}</p>
                        </div>
                        <div className="bg-blue-50 p-2 rounded border border-blue-200">
                          <p className="font-semibold text-blue-800">Previous Documentation:</p>
                          <p className="text-blue-700">{issue.previous_documentation}</p>
                        </div>
                        <div className="bg-yellow-50 p-2 rounded border border-yellow-200">
                          <p className="font-semibold text-yellow-800">Current Gap:</p>
                          <p className="text-yellow-700">{issue.current_gap}</p>
                        </div>
                        <div className="bg-green-50 p-2 rounded border border-green-200">
                          <p className="font-semibold text-green-800">Resolution:</p>
                          <p className="text-green-700">{issue.resolution}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Priority Actions */}
            {auditResults.priority_actions?.length > 0 && (
              <Card className="border-indigo-200 bg-indigo-50">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Clock className="w-4 h-4 text-indigo-600" />
                    Priority Actions
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-2">
                  {auditResults.priority_actions.map((action, idx) => (
                    <div key={idx} className="bg-white p-3 rounded border border-indigo-200">
                      <div className="flex items-start justify-between mb-2">
                        <p className="font-medium text-sm flex-1">{action.action}</p>
                        <Badge variant="outline" className="text-xs">{action.deadline}</Badge>
                      </div>
                      <p className="text-xs text-slate-600 mb-1">{action.rationale}</p>
                      <p className="text-xs text-indigo-700">Assigned to: {action.assigned_to}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Best Practices */}
            {auditResults.best_practices?.length > 0 && (
              <Card className="border-green-200">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-green-600" />
                    Best Practice Recommendations
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-2">
                  {auditResults.best_practices.map((practice, idx) => (
                    <div key={idx} className="bg-green-50 p-2 rounded">
                      <p className="font-medium text-sm text-green-900">{practice.area}</p>
                      <p className="text-xs text-slate-700 my-1">{practice.recommendation}</p>
                      <p className="text-xs text-green-700">{practice.impact}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Compliance Strengths */}
            {auditResults.compliance_strengths?.length > 0 && (
              <Card className="border-green-200 bg-green-50">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    Compliance Strengths ({auditResults.compliance_strengths.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3">
                  <div className="flex flex-wrap gap-2">
                    {auditResults.compliance_strengths.map((strength, idx) => (
                      <Badge key={idx} className="bg-green-100 text-green-800 border-green-300">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        {strength}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}