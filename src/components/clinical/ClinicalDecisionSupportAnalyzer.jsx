import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { 
  Brain, Loader2, AlertTriangle, TrendingUp, Users, Pill, 
  CheckCircle2, AlertCircle, Copy, Download, Lightbulb, Target 
} from "lucide-react";
import jsPDF from "jspdf";
import { format } from "date-fns";

export default function ClinicalDecisionSupportAnalyzer({ patientId, documentAnalysis }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [patient, setPatient] = useState(null);
  const [includeFlags, setIncludeFlags] = useState({
    diagnoses: true,
    treatments: true,
    referrals: true,
    interactions: true
  });

  const analyzeClinicalData = async () => {
    if (!patientId) {
      toast.error('Please select a patient first');
      return;
    }

    setLoading(true);
    try {
      // Fetch comprehensive patient data
      const patientData = await base44.entities.Patient.get(patientId);
      setPatient(patientData);

      const carePlans = await base44.entities.CarePlan.filter({ 
        patient_id: patientId, 
        status: 'active' 
      });
      const recentVisits = await base44.entities.Visit.filter({ 
        patient_id: patientId 
      }).then(visits => visits.slice(0, 3));
      const incidents = await base44.entities.Incident.filter({ 
        patient_id: patientId 
      }).then(inc => inc.slice(0, 5));
      const alerts = await base44.entities.PatientAlert.filter({ 
        patient_id: patientId, 
        status: 'active' 
      });

      // Build comprehensive clinical context
      const medicationsList = (patientData.current_medications || [])
        .map(m => `${m.name || m} ${m.dosage ? '(' + m.dosage + ')' : ''} - ${m.frequency || 'as prescribed'}`)
        .join('\n');

      const clinicalContext = `
PATIENT PROFILE:
Name: ${patientData.first_name} ${patientData.last_name}
DOB: ${patientData.date_of_birth || 'N/A'}
Care Type: ${patientData.care_type || 'N/A'}
Status: ${patientData.status || 'N/A'}

PRIMARY DIAGNOSIS:
${patientData.primary_diagnosis || 'Not documented'}

SECONDARY DIAGNOSES:
${patientData.secondary_diagnoses?.length ? patientData.secondary_diagnoses.join('\n') : 'None'}

CURRENT MEDICATIONS:
${medicationsList || 'No medications documented'}

ALLERGIES & CONTRAINDICATIONS:
${patientData.allergies || 'No known allergies'}

BASELINE VITAL SIGNS:
${patientData.baseline_vitals ? `
  BP: ${patientData.baseline_vitals.blood_pressure_systolic}/${patientData.baseline_vitals.blood_pressure_diastolic}
  HR: ${patientData.baseline_vitals.heart_rate}
  RR: ${patientData.baseline_vitals.respiratory_rate}
  O2 Sat: ${patientData.baseline_vitals.oxygen_saturation}%
  Weight: ${patientData.baseline_vitals.weight} kg
  BMI: ${patientData.baseline_vitals.bmi}
` : 'Not documented'}

FUNCTIONAL STATUS:
${patientData.functional_status ? JSON.stringify(patientData.functional_status, null, 2) : 'Not documented'}

ACTIVE CARE PLANS (${carePlans.length}):
${carePlans.slice(0, 3).map(cp => `- ${cp.problem}: ${cp.goal}`).join('\n') || 'None'}

RECENT VISITS (${recentVisits.length}):
${recentVisits.map(v => `- ${v.visit_date} (${v.visit_type})`).join('\n') || 'None'}

RECENT INCIDENTS (${incidents.length}):
${incidents.slice(0, 3).map(i => `- ${i.incident_type}: ${i.severity}`).join('\n') || 'None'}

ACTIVE ALERTS:
${alerts.length ? alerts.map(a => `- [${a.severity}] ${a.title}`).join('\n') : 'No active alerts'}

${documentAnalysis?.analysis_summary ? `
DOCUMENT ANALYSIS SUMMARY:
${documentAnalysis.analysis_summary}

EXTRACTED DATA:
${JSON.stringify(documentAnalysis.full_analysis, null, 2)}
` : ''}
`;

      const prompt = `You are an advanced clinical decision support AI for a home health agency. Analyze the following patient record and provide evidence-based clinical recommendations.

${clinicalContext}

Provide comprehensive clinical decision support including:

1. DIFFERENTIAL DIAGNOSES
   - List 3-5 potential diagnoses based on documented conditions and recent findings
   - Rank by likelihood
   - Include brief clinical reasoning for each

2. EVIDENCE-BASED TREATMENT PROTOCOLS
   - Recommend specific treatment protocols aligned with current diagnoses
   - Include medication class recommendations (avoid specific dosing without clinical review)
   - Highlight any gaps in current treatment plan
   - Reference relevant clinical guidelines

3. SPECIALIST REFERRAL RECOMMENDATIONS
   - Identify when specialist consultation would be beneficial
   - Specify specialty and urgency level (routine/urgent)
   - Provide clinical justification

4. DRUG INTERACTION & CONTRAINDICATION ANALYSIS
   - Analyze current medication list for potential interactions
   - Identify contraindications with diagnosed conditions
   - Flag medications that may worsen existing conditions
   - Prioritize by severity (critical/major/moderate/minor)

5. CLINICAL RISK ASSESSMENT
   - Identify highest risk factors
   - Assess readmission risk
   - Flag fall/safety risks

Provide structured, actionable recommendations suitable for RN/LPN review and physician consultation.`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            differential_diagnoses: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  diagnosis: { type: "string" },
                  likelihood: { type: "string", enum: ["high", "moderate", "low"] },
                  reasoning: { type: "string" },
                  supporting_findings: { type: "array", items: { type: "string" } }
                }
              }
            },
            treatment_protocols: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  condition: { type: "string" },
                  protocol_name: { type: "string" },
                  recommendations: { type: "array", items: { type: "string" } },
                  gaps_identified: { type: "array", items: { type: "string" } },
                  guideline_reference: { type: "string" }
                }
              }
            },
            specialist_referrals: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  specialty: { type: "string" },
                  urgency: { type: "string", enum: ["routine", "soon", "urgent"] },
                  clinical_justification: { type: "string" },
                  recommended_timing: { type: "string" }
                }
              }
            },
            drug_interactions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  severity: { type: "string", enum: ["critical", "major", "moderate", "minor"] },
                  interaction_type: { type: "string" },
                  drugs_involved: { type: "array", items: { type: "string" } },
                  clinical_significance: { type: "string" },
                  recommended_action: { type: "string" }
                }
              }
            },
            clinical_risks: {
              type: "object",
              properties: {
                highest_risks: { type: "array", items: { type: "string" } },
                readmission_risk: { type: "string" },
                fall_safety_risk: { type: "string" },
                medication_adherence_concerns: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      });

      setAnalysis({
        ...result,
        analyzed_at: new Date().toISOString(),
        patient_name: `${patientData.first_name} ${patientData.last_name}`
      });

      toast.success('Clinical analysis completed');
    } catch (error) {
      console.error('Analysis error:', error);
      toast.error('Failed to complete analysis: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
      case 'urgent':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'major':
      case 'soon':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'moderate':
      case 'routine':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      default:
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical':
      case 'major':
      case 'urgent':
        return <AlertTriangle className="w-4 h-4" />;
      default:
        return <Lightbulb className="w-4 h-4" />;
    }
  };

  const downloadPDF = () => {
    if (!analysis) return;

    const doc = new jsPDF();
    let y = 20;
    const margin = 15;
    const pageWidth = 210;
    const contentWidth = pageWidth - margin * 2;

    // Header
    doc.setFillColor(59, 130, 246);
    doc.rect(0, 0, pageWidth, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.text('Clinical Decision Support Analysis', margin, 15);
    doc.setFontSize(10);
    doc.text(`${analysis.patient_name} | ${format(new Date(analysis.analyzed_at), 'MMM d, yyyy')}`, margin, 28);

    doc.setTextColor(0, 0, 0);
    y = 45;

    // Differential Diagnoses
    if (analysis.differential_diagnoses?.length) {
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.text('Differential Diagnoses', margin, y);
      y += 8;

      analysis.differential_diagnoses.forEach((dx, idx) => {
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text(`${idx + 1}. ${dx.diagnosis}`, margin, y);
        y += 5;

        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.text(`Likelihood: ${dx.likelihood.toUpperCase()}`, margin + 5, y);
        y += 4;
        doc.text(`Reasoning: ${dx.reasoning.substring(0, 80)}...`, margin + 5, y);
        y += 6;
      });
      y += 4;
    }

    // Treatment Protocols
    if (analysis.treatment_protocols?.length) {
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.text('Treatment Protocols', margin, y);
      y += 8;

      analysis.treatment_protocols.slice(0, 3).forEach((tp) => {
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text(`${tp.condition}`, margin, y);
        y += 5;

        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        tp.recommendations.slice(0, 2).forEach(rec => {
          const lines = doc.splitTextToSize(`• ${rec}`, contentWidth - 10);
          lines.forEach(line => {
            doc.text(line, margin + 5, y);
            y += 4;
          });
        });
        y += 2;
      });
      y += 4;
    }

    // Drug Interactions (if any critical/major)
    const criticalInteractions = analysis.drug_interactions?.filter(di => 
      ['critical', 'major'].includes(di.severity)
    );
    if (criticalInteractions?.length) {
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.text('⚠ Drug Interactions', margin, y);
      y += 8;

      criticalInteractions.forEach((di) => {
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text(`[${di.severity.toUpperCase()}] ${di.interaction_type}`, margin, y);
        y += 4;
        doc.setFont(undefined, 'normal');
        doc.text(`Drugs: ${di.drugs_involved.join(', ')}`, margin + 5, y);
        y += 4;
      });
    }

    doc.save(`cds-analysis-${analysis.patient_name.replace(/\s/g, '-')}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    toast.success('PDF downloaded');
  };

  return (
    <Card className="border-2 border-purple-200 dark:border-purple-800">
      <CardHeader className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950 dark:to-indigo-950">
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-600" />
          Clinical Decision Support Analyzer
        </CardTitle>
        <CardDescription>
          AI-powered analysis with evidence-based recommendations
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        {!analysis ? (
          <>
            {/* Analysis Options */}
            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3 block">
                  Analysis Modules
                </label>
                <div className="space-y-2">
                  {Object.entries(includeFlags).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800">
                      <Checkbox
                        id={`flag-${key}`}
                        checked={value}
                        onCheckedChange={(checked) => setIncludeFlags({
                          ...includeFlags,
                          [key]: checked
                        })}
                      />
                      <label htmlFor={`flag-${key}`} className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer flex-1">
                        {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <Alert className="bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800">
                <Lightbulb className="h-4 w-4" />
                <AlertDescription>
                  This tool provides AI-generated clinical recommendations that must be reviewed by a qualified healthcare provider before implementation.
                </AlertDescription>
              </Alert>
            </div>

            <Button
              onClick={analyzeClinicalData}
              disabled={loading || !patientId}
              className="w-full bg-purple-600 hover:bg-purple-700"
            >
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {loading ? 'Analyzing Patient Record...' : 'Start Clinical Analysis'}
            </Button>
          </>
        ) : (
          <>
            {/* Analysis Results */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">{analysis.patient_name}</h3>
                <p className="text-xs text-slate-500">Analyzed {format(new Date(analysis.analyzed_at), 'MMM d, yyyy HH:mm')}</p>
              </div>
              <Button
                onClick={downloadPDF}
                variant="outline"
                size="sm"
                className="gap-1"
              >
                <Download className="w-4 h-4" />
                PDF
              </Button>
            </div>

            {/* Differential Diagnoses */}
            {analysis.differential_diagnoses?.length > 0 && includeFlags.diagnoses && (
              <div className="space-y-3">
                <h4 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-purple-600" />
                  Differential Diagnoses
                </h4>
                <div className="space-y-2">
                  {analysis.differential_diagnoses.map((dx, idx) => (
                    <Card key={idx} className="bg-slate-50 dark:bg-slate-900">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-slate-100">{dx.diagnosis}</p>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{dx.reasoning}</p>
                          </div>
                          <Badge className={getSeverityColor(dx.likelihood)}>
                            {dx.likelihood}
                          </Badge>
                        </div>
                        {dx.supporting_findings?.length > 0 && (
                          <div className="mt-3 space-y-1">
                            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Supporting Findings:</p>
                            <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                              {dx.supporting_findings.map((finding, idx) => (
                                <li key={idx}>• {finding}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Treatment Protocols */}
            {analysis.treatment_protocols?.length > 0 && includeFlags.treatments && (
              <div className="space-y-3">
                <h4 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Target className="w-4 h-4 text-green-600" />
                  Evidence-Based Treatment Protocols
                </h4>
                <div className="space-y-3">
                  {analysis.treatment_protocols.map((tp, idx) => (
                    <Card key={idx} className="bg-slate-50 dark:bg-slate-900">
                      <CardContent className="p-4">
                        <p className="font-semibold text-slate-900 dark:text-slate-100 mb-2">{tp.condition}</p>
                        <p className="text-sm text-slate-700 dark:text-slate-300 mb-3">{tp.protocol_name}</p>
                        
                        <div className="space-y-2 mb-3">
                          <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Recommendations:</p>
                          <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                            {tp.recommendations?.slice(0, 3).map((rec, idx) => (
                              <li key={idx} className="flex gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                                {rec}
                              </li>
                            ))}
                          </ul>
                        </div>

                        {tp.gaps_identified?.length > 0 && (
                          <div className="bg-yellow-50 dark:bg-yellow-950 p-2 rounded text-xs">
                            <p className="font-medium text-yellow-900 dark:text-yellow-100 mb-1">Gaps Identified:</p>
                            <ul className="text-yellow-800 dark:text-yellow-200 space-y-1">
                              {tp.gaps_identified.map((gap, idx) => (
                                <li key={idx}>• {gap}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {tp.guideline_reference && (
                          <p className="text-xs text-slate-500 mt-2">📖 {tp.guideline_reference}</p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Specialist Referrals */}
            {analysis.specialist_referrals?.length > 0 && includeFlags.referrals && (
              <div className="space-y-3">
                <h4 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-600" />
                  Specialist Referral Recommendations
                </h4>
                <div className="space-y-2">
                  {analysis.specialist_referrals.map((ref, idx) => (
                    <div key={idx} className={`p-3 rounded-lg border-l-4 ${
                      ref.urgency === 'urgent' 
                        ? 'border-l-red-600 bg-red-50 dark:bg-red-950' 
                        : ref.urgency === 'soon'
                        ? 'border-l-orange-600 bg-orange-50 dark:bg-orange-950'
                        : 'border-l-blue-600 bg-blue-50 dark:bg-blue-950'
                    }`}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{ref.specialty}</p>
                          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{ref.clinical_justification}</p>
                        </div>
                        <Badge className={getSeverityColor(ref.urgency)}>
                          {ref.urgency}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500">⏱️ {ref.recommended_timing}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Drug Interactions */}
            {analysis.drug_interactions?.length > 0 && includeFlags.interactions && (
              <div className="space-y-3">
                <h4 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Pill className="w-4 h-4 text-red-600" />
                  Drug Interactions & Contraindications
                </h4>
                <div className="space-y-2">
                  {analysis.drug_interactions.map((di, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border-l-4 ${
                        di.severity === 'critical'
                          ? 'border-l-red-600 bg-red-50 dark:bg-red-950'
                          : di.severity === 'major'
                          ? 'border-l-orange-600 bg-orange-50 dark:bg-orange-950'
                          : 'border-l-yellow-600 bg-yellow-50 dark:bg-yellow-950'
                      }`}
                    >
                      <div className="flex items-start gap-2 mb-2">
                        {getSeverityIcon(di.severity)}
                        <div className="flex-1">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{di.interaction_type}</p>
                          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{di.drugs_involved.join(' + ')}</p>
                        </div>
                        <Badge className={getSeverityColor(di.severity)}>
                          {di.severity}
                        </Badge>
                      </div>
                      <div className="bg-white dark:bg-slate-800 p-2 rounded text-sm space-y-2">
                        <p><span className="font-medium">Clinical Significance:</span> {di.clinical_significance}</p>
                        <p><span className="font-medium">Recommended Action:</span> {di.recommended_action}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clinical Risks */}
            {analysis.clinical_risks && (
              <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-4 rounded-lg space-y-3">
                <h4 className="font-semibold text-red-900 dark:text-red-100 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Clinical Risk Assessment
                </h4>
                {analysis.clinical_risks.highest_risks?.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">Highest Risks:</p>
                    <ul className="text-sm text-red-700 dark:text-red-300 space-y-1">
                      {analysis.clinical_risks.highest_risks.map((risk, idx) => (
                        <li key={idx}>• {risk}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  {analysis.clinical_risks.readmission_risk && (
                    <div className="bg-white dark:bg-slate-800 p-2 rounded">
                      <p className="font-medium text-slate-900 dark:text-slate-100">Readmission Risk</p>
                      <p className="text-slate-600 dark:text-slate-400">{analysis.clinical_risks.readmission_risk}</p>
                    </div>
                  )}
                  {analysis.clinical_risks.fall_safety_risk && (
                    <div className="bg-white dark:bg-slate-800 p-2 rounded">
                      <p className="font-medium text-slate-900 dark:text-slate-100">Fall/Safety Risk</p>
                      <p className="text-slate-600 dark:text-slate-400">{analysis.clinical_risks.fall_safety_risk}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(JSON.stringify(analysis, null, 2))}>
                <Copy className="w-4 h-4 mr-2" />
                Copy
              </Button>
              <Button onClick={() => setAnalysis(null)} variant="ghost" size="sm" className="ml-auto">
                New Analysis
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}