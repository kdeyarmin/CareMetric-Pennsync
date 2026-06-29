import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  FileText,
  AlertTriangle,
  Brain,
  RefreshCw,
  Shield,
  ClipboardList,
  TrendingUp,
  Download
} from "lucide-react";
import { toast } from 'sonner';

export default function AIProactiveOASISAssistant({ patientId, autoAnalyze = false }) {
  const ai = useAICall();
  const [analysis, setAnalysis] = useState(null);
  const queryClient = useQueryClient();

  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: async () => {
      const patients = await base44.entities.Patient.filter({ id: patientId });
      return patients[0];
    },
    enabled: !!patientId
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['patientVisits', patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 20),
    enabled: !!patientId,
    initialData: []
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['patientIncidents', patientId],
    queryFn: () => base44.entities.Incident.filter({ patient_id: patientId }, '-incident_date', 10),
    enabled: !!patientId,
    initialData: []
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['patientCarePlans', patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId }),
    enabled: !!patientId,
    initialData: []
  });

  const { data: existingOASIS = [] } = useQuery({
    queryKey: ['patientOASIS', patientId],
    queryFn: () => base44.entities.OASISUpload.filter({ patient_id: patientId }, '-created_date'),
    enabled: !!patientId,
    initialData: []
  });

  const calculateAge = React.useCallback((dob) => {
    if (!dob) return null;
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }, []);

  const performOASISAnalysis = React.useCallback(async () => {
    if (!patient) return;

    try {
      const patientData = {
        demographics: {
          name: `${patient.first_name} ${patient.last_name}`,
          age: calculateAge(patient.date_of_birth),
          admission_date: patient.admission_date,
          admission_source: patient.admission_source,
          primary_diagnosis: patient.primary_diagnosis,
          secondary_diagnoses: patient.secondary_diagnoses,
          allergies: patient.allergies,
          medications: patient.current_medications
        },
        functional_status: patient.functional_status,
        baseline_vitals: patient.baseline_vitals,
        social_history: patient.social_history,
        advance_directives: patient.advance_directives,
        visits: visits.slice(0, 10).map(v => ({
          date: v.visit_date,
          type: v.visit_type,
          notes: v.nurse_notes,
          vital_signs: v.vital_signs
        })),
        incidents: incidents.map(i => ({
          type: i.incident_type,
          date: i.incident_date,
          severity: i.severity
        })),
        carePlans: carePlans.map(cp => ({
          problem: cp.problem,
          goal: cp.goal,
          status: cp.status
        })),
        existingOASIS: existingOASIS.length > 0
      };

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert OASIS documentation specialist with deep knowledge of CMS home health regulations and PDGM requirements.

**CRITICAL TASK:** Analyze this patient's data to identify OASIS documentation gaps and generate a preliminary OASIS assessment.

**Patient Data:**
${JSON.stringify(patientData, null, 2)}

**Your Analysis Must Include:**

1. **DOCUMENTATION COMPLETENESS SCORE (0-100)**
   - Assess how complete the current documentation is for OASIS requirements
   - Consider: functional assessments, ADL documentation, vital signs, medication management, wounds, falls, hospitalization risk

2. **CRITICAL GAPS IDENTIFIED**
   - List 5-10 specific OASIS items that are missing or inadequately documented
   - For each gap, provide:
     * OASIS item number (e.g., M1021, M1800)
     * Item description
     * Why it's critical for compliance and PDGM
     * Specific recommendation to address it

3. **COMPLIANCE RISK LEVEL**
   - low: Documentation is mostly complete
   - moderate: Some gaps but manageable
   - high: Significant gaps that could affect payment or compliance
   - critical: Severe gaps requiring immediate attention

4. **PRELIMINARY OASIS ASSESSMENTS**
   Generate preliminary values for key OASIS items based on available data:
   - M1021 (Primary Diagnosis)
   - M1023 (Other Diagnoses)
   - M1800 (Grooming)
   - M1810 (Current Ability to Dress Upper Body)
   - M1820 (Current Ability to Dress Lower Body)
   - M1830 (Bathing)
   - M1840 (Toilet Transferring)
   - M1850 (Transferring)
   - M1860 (Ambulation/Locomotion)
   - M1033 (Risk for Hospitalization)
   - M2102 (Types and Sources of Assistance)
   
   For each item provide:
   * Suggested value (with code)
   * Confidence level (high/medium/low)
   * Clinical rationale
   * Additional data needed (if confidence is not high)

5. **MONITORING FLAGS**
   Identify if this patient requires closer monitoring for:
   - Fall risk documentation
   - Medication management documentation
   - ADL decline tracking
   - Wound documentation
   - Pain assessment
   - Cognitive assessment

6. **PRIORITY ACTIONS**
   List 3-5 immediate actions the clinical team should take to complete OASIS documentation

7. **REGULATORY COMPLIANCE CONCERNS**
   Specific concerns about CMS compliance, documentation deficiencies, or audit risks

8. **ESTIMATED COMPLETION TIME**
   How many minutes of clinical documentation time needed to address gaps

Provide detailed, actionable recommendations that a home health nurse can immediately act upon.`,
        response_json_schema: {
          type: "object",
          properties: {
            completeness_score: { type: "number" },
            compliance_risk_level: { type: "string" },
            critical_gaps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  oasis_item: { type: "string" },
                  description: { type: "string" },
                  importance: { type: "string" },
                  recommendation: { type: "string" }
                }
              }
            },
            preliminary_assessments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  oasis_item: { type: "string" },
                  suggested_value: { type: "string" },
                  confidence: { type: "string" },
                  rationale: { type: "string" },
                  data_needed: { type: "string" }
                }
              }
            },
            monitoring_flags: {
              type: "array",
              items: { type: "string" }
            },
            priority_actions: {
              type: "array",
              items: { type: "string" }
            },
            regulatory_concerns: { type: "string" },
            estimated_completion_minutes: { type: "number" }
          }
        }
      });

      setAnalysis(result);

      // Create a compliance audit record if risk is high/critical. ComplianceAudit
      // requires visit_id, so only persist when the patient has a visit to attach
      // it to (otherwise the create would reject and surface a misleading error
      // while the analysis itself already rendered).
      if ((result.compliance_risk_level === 'high' || result.compliance_risk_level === 'critical') && visits[0]?.id) {
        await base44.entities.ComplianceAudit.create({
          patient_id: patientId,
          visit_id: visits[0].id,
          nurse_email: (await base44.auth.me()).email,
          audit_date: new Date().toISOString(),
          compliance_score: result.completeness_score,
          status: result.compliance_risk_level === 'critical' ? 'critical' : 'flagged',
          issues: (result.critical_gaps || []).map(gap => ({
            element: gap.oasis_item,
            severity: result.compliance_risk_level,
            problem: gap.description,
            suggestion: gap.recommendation
          })),
          audit_type: 'automated'
        });
      }

      queryClient.invalidateQueries({ queryKey: ['complianceAudits', patientId] });
    } catch (error) {
      console.error('Error performing OASIS analysis:', error);
      toast.error('Failed to perform OASIS analysis. Please try again.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [patient, visits, incidents, carePlans, existingOASIS, patientId, queryClient, calculateAge]);

  React.useEffect(() => {
    if (autoAnalyze && patient && !analysis && !ai.loading) {
      performOASISAnalysis();
    }
  }, [autoAnalyze, patient, analysis, ai.loading, performOASISAnalysis]);

  const getRiskColor = (level) => {
    switch (level) {
      case 'low': return 'bg-green-500';
      case 'moderate': return 'bg-yellow-500';
      case 'high': return 'bg-orange-500';
      case 'critical': return 'bg-red-500';
      default: return 'bg-slate-500';
    }
  };

  const getConfidenceColor = (confidence) => {
    switch (confidence?.toLowerCase()) {
      case 'high': return 'text-green-600';
      case 'medium': return 'text-yellow-600';
      case 'low': return 'text-red-600';
      default: return 'text-slate-600';
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-2 border-blue-300">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-blue-600" />
              AI OASIS Documentation Assistant
            </CardTitle>
            <Button
              onClick={performOASISAnalysis}
              disabled={ai.loading || !patient}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
            >
              {ai.loading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  {analysis ? 'Re-analyze' : 'Analyze OASIS'}
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {ai.loading && (
            <Alert className="bg-blue-50 border-blue-200">
              <Brain className="w-4 h-4 text-blue-600 animate-pulse" />
              <AlertDescription className="text-blue-900">
                AI is analyzing patient data for OASIS documentation gaps and generating preliminary assessments...
              </AlertDescription>
            </Alert>
          )}

          {!ai.loading && !analysis && (
            <Alert className="bg-blue-50 border-blue-200">
              <ClipboardList className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-900">
                Click "Analyze OASIS" to identify documentation gaps and generate preliminary OASIS assessments.
              </AlertDescription>
            </Alert>
          )}

          {analysis && (
            <div className="space-y-6">
              {/* Completeness Score */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-lg border-2 border-blue-200">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold text-slate-900">Documentation Completeness</h3>
                  <Badge className={`${getRiskColor(analysis.compliance_risk_level)} text-white text-lg px-4 py-2`}>
                    {(analysis.compliance_risk_level || '').toUpperCase()}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 mb-3">
                  <span className="text-4xl font-bold text-blue-600">{analysis.completeness_score}%</span>
                  <Progress value={analysis.completeness_score} className="flex-1" />
                </div>
                <p className="text-sm text-slate-600">
                  Estimated time to complete: <strong>{analysis.estimated_completion_minutes} minutes</strong>
                </p>
              </div>

              {/* Regulatory Concerns */}
              {analysis.regulatory_concerns && (
                <Alert className="bg-red-50 border-red-300">
                  <Shield className="w-4 h-4 text-red-600" />
                  <AlertDescription>
                    <p className="font-semibold text-red-900 mb-2">Regulatory Compliance Concerns</p>
                    <p className="text-sm text-red-800">{analysis.regulatory_concerns}</p>
                  </AlertDescription>
                </Alert>
              )}

              {/* Critical Gaps */}
              {analysis.critical_gaps?.length > 0 && (
                <Card className="border-2 border-orange-300">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-orange-600" />
                      Critical Documentation Gaps ({analysis.critical_gaps.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {analysis.critical_gaps.map((gap, i) => (
                      <div key={i} className="bg-orange-50 p-4 rounded-lg border border-orange-200">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-orange-600">{gap.oasis_item}</Badge>
                            <p className="font-semibold text-slate-900">{gap.description}</p>
                          </div>
                        </div>
                        <p className="text-sm text-slate-700 mb-2">
                          <strong>Importance:</strong> {gap.importance}
                        </p>
                        <div className="bg-white p-3 rounded border border-orange-200">
                          <p className="text-sm font-medium text-slate-900 mb-1">✓ Recommendation:</p>
                          <p className="text-sm text-slate-700">{gap.recommendation}</p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Priority Actions */}
              {analysis.priority_actions?.length > 0 && (
                <Card className="border-2 border-yellow-300 bg-yellow-50">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-yellow-600" />
                      Priority Actions
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {analysis.priority_actions.map((action, i) => (
                      <div key={i} className="flex items-start gap-2 bg-white p-3 rounded-lg border border-yellow-200">
                        <span className="font-bold text-yellow-600">{i + 1}.</span>
                        <p className="text-sm text-slate-900">{action}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Preliminary OASIS Assessments */}
              {analysis.preliminary_assessments?.length > 0 && (
                <Card className="border-2 border-green-300">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="w-5 h-5 text-green-600" />
                      Preliminary OASIS Assessments ({analysis.preliminary_assessments.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {analysis.preliminary_assessments.map((item, i) => (
                      <div key={i} className="bg-green-50 p-4 rounded-lg border border-green-200">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-green-600">{item.oasis_item}</Badge>
                            <Badge className={getConfidenceColor(item.confidence)} variant="outline">
                              {item.confidence} confidence
                            </Badge>
                          </div>
                        </div>
                        <div className="mb-2">
                          <p className="text-sm font-semibold text-slate-900">
                            Suggested Value: <span className="text-green-700">{item.suggested_value}</span>
                          </p>
                        </div>
                        <p className="text-sm text-slate-700 mb-2">
                          <strong>Rationale:</strong> {item.rationale}
                        </p>
                        {item.data_needed && (
                          <div className="bg-yellow-50 p-2 rounded border border-yellow-200">
                            <p className="text-xs text-slate-700">
                              <strong>Additional Data Needed:</strong> {item.data_needed}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Monitoring Flags */}
              {analysis.monitoring_flags?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Shield className="w-5 h-5 text-navy-600" />
                      Monitoring Flags
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {analysis.monitoring_flags.map((flag, i) => (
                        <Badge key={i} className="bg-navy-100 text-navy-800">
                          {flag}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Export Options */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(analysis, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `oasis-analysis-${patient.first_name}-${patient.last_name}-${new Date().toISOString().split('T')[0]}.json`;
                    a.click();
                  }}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export Analysis
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}