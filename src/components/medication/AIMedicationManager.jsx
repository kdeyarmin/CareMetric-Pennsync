import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Pill,
  AlertTriangle,
  CheckCircle2,
  Info,
  Bell,
  FileText,
  Loader2,
  ShieldAlert,
  Clock,
  TrendingUp,
  Download
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export default function AIMedicationManager({ 
  patient,
  currentMedications = [],
  patientHistory = {},
  visitNotes = "",
  autoAnalyze = true 
}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [selectedTab, setSelectedTab] = useState("interactions");
  const [educationMaterial, setEducationMaterial] = useState(null);
  const [isGeneratingEducation, setIsGeneratingEducation] = useState(false);

  useEffect(() => {
    if (autoAnalyze && currentMedications.length > 0) {
      analyzeMedications();
    }
  }, [currentMedications, autoAnalyze]);

  const analyzeMedications = async () => {
    if (!currentMedications || currentMedications.length === 0) return;

    setIsAnalyzing(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical pharmacist AI performing comprehensive medication review for home health nursing.

PATIENT INFORMATION:
- Age: ${calculateAge(patient?.date_of_birth)} years
- Allergies: ${patient?.allergies || 'None documented'}
- Diagnoses: ${patient?.primary_diagnosis || 'Not specified'}${patient?.secondary_diagnoses?.length > 0 ? `, ${patient.secondary_diagnoses.join(', ')}` : ''}
- Past Medical History: ${patientHistory?.past_medical_history?.join(', ') || 'Not documented'}
- Renal Function: ${patientHistory?.renal_function || 'Unknown'}
- Hepatic Function: ${patientHistory?.hepatic_function || 'Unknown'}
- Cognitive Status: ${patient?.functional_status?.cognitive_status || 'Unknown'}

CURRENT MEDICATIONS:
${currentMedications.map(med => `• ${med.name} ${med.dosage || ''} ${med.route || ''} ${med.frequency || ''}`).join('\n')}

RECENT CLINICAL NOTES:
${visitNotes ? visitNotes.substring(0, 500) : 'No recent notes'}

PERFORM COMPREHENSIVE MEDICATION ANALYSIS:

1. **DRUG INTERACTIONS** (Critical Priority)
   - Identify all potential drug-drug interactions
   - Assess severity (critical, high, moderate, low)
   - Explain mechanism and clinical significance
   - Provide specific monitoring recommendations

2. **CONTRAINDICATIONS**
   - Check each medication against patient's conditions
   - Identify absolute and relative contraindications
   - Consider age-related contraindications (especially geriatric)
   - Flag medications on Beers Criteria if applicable

3. **MEDICATION ERRORS & DEVIATIONS**
   - Identify dosing errors (too high, too low)
   - Check for duplicate therapy
   - Identify missing essential medications
   - Flag inappropriate routes or frequencies
   - Check for therapeutic duplication

4. **ADHERENCE BARRIERS**
   - Complex dosing schedules
   - Cognitive impairment concerns
   - Physical limitations (swallowing, dexterity)
   - Cost/access issues
   - Drug burden (too many medications)

5. **RECONCILIATION NEEDS**
   - Identify medications that need clarification
   - Flag medications without clear indication
   - Suggest medications that may be missing

6. **NURSE ALERTS** (Immediate Action Items)
   - Critical safety issues requiring immediate attention
   - Medication administration concerns
   - Monitoring parameters needed
   - Patient/family education priorities

Return detailed, actionable clinical information. Be specific about what the nurse should do.`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_safety_score: {
              type: "number",
              description: "0-100, where 100 is safest"
            },
            critical_alerts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  alert_type: { 
                    type: "string",
                    enum: ["critical_interaction", "contraindication", "dosing_error", "missing_medication", "duplicate_therapy"]
                  },
                  medications_involved: {
                    type: "array",
                    items: { type: "string" }
                  },
                  description: { type: "string" },
                  clinical_significance: { type: "string" },
                  immediate_action: { type: "string" },
                  notify_physician: { type: "boolean" }
                }
              }
            },
            drug_interactions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  severity: {
                    type: "string",
                    enum: ["critical", "major", "moderate", "minor"]
                  },
                  drug1: { type: "string" },
                  drug2: { type: "string" },
                  interaction: { type: "string" },
                  mechanism: { type: "string" },
                  effects: { type: "string" },
                  management: { type: "string" },
                  monitoring: { type: "string" }
                }
              }
            },
            contraindications: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  medication: { type: "string" },
                  condition: { type: "string" },
                  type: {
                    type: "string",
                    enum: ["absolute", "relative", "caution"]
                  },
                  rationale: { type: "string" },
                  alternative_suggestions: {
                    type: "array",
                    items: { type: "string" }
                  }
                }
              }
            },
            adherence_concerns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  concern_type: { type: "string" },
                  description: { type: "string" },
                  suggested_interventions: {
                    type: "array",
                    items: { type: "string" }
                  }
                }
              }
            },
            reconciliation_issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  medication: { type: "string" },
                  issue: { type: "string" },
                  clarification_needed: { type: "string" }
                }
              }
            },
            positive_findings: {
              type: "array",
              items: { type: "string" },
              description: "Things done well with current medication regimen"
            }
          }
        }
      });

      setAnalysis(result);
    } catch (error) {
      console.error('Medication analysis error:', error);
    }
    setIsAnalyzing(false);
  };

  const generatePatientEducation = async () => {
    setIsGeneratingEducation(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate patient-friendly medication education materials for home health patient.

PATIENT: ${patient?.first_name} ${patient?.last_name}
AGE: ${calculateAge(patient?.date_of_birth)} years
MEDICATIONS:
${currentMedications.map(med => `• ${med.name} ${med.dosage || ''} - ${med.frequency || ''}`).join('\n')}

Create comprehensive but easy-to-understand education covering:

1. **Medication Guide** - For each medication:
   - What it's for (in simple terms)
   - How and when to take it
   - Important things to know
   - What to watch for (side effects)

2. **Daily Schedule** - Create a simple daily medication schedule organized by time of day

3. **Important Reminders**
   - What to do if you miss a dose
   - Foods/drinks to avoid
   - Activities to be careful with
   - When to call the doctor

4. **Questions to Ask Doctor** - Suggest 3-5 good questions the patient/family should ask

Use 5th-6th grade reading level. Be warm and encouraging. Focus on safety and clarity.`,
        response_json_schema: {
          type: "object",
          properties: {
            medication_guides: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  medication_name: { type: "string" },
                  what_its_for: { type: "string" },
                  how_to_take: { type: "string" },
                  important_tips: {
                    type: "array",
                    items: { type: "string" }
                  },
                  what_to_watch_for: {
                    type: "array",
                    items: { type: "string" }
                  }
                }
              }
            },
            daily_schedule: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  time: { type: "string" },
                  medications: {
                    type: "array",
                    items: { type: "string" }
                  },
                  instructions: { type: "string" }
                }
              }
            },
            important_reminders: {
              type: "array",
              items: { type: "string" }
            },
            questions_to_ask: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });

      setEducationMaterial(result);
    } catch (error) {
      console.error('Education generation error:', error);
    }
    setIsGeneratingEducation(false);
  };

  const getSeverityColor = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return 'border-red-400 bg-red-50';
      case 'major':
      case 'high':
        return 'border-orange-400 bg-orange-50';
      case 'moderate':
      case 'medium':
        return 'border-yellow-400 bg-yellow-50';
      default:
        return 'border-blue-400 bg-blue-50';
    }
  };

  const getSeverityBadge = (severity) => {
    const colors = {
      critical: 'bg-red-600',
      major: 'bg-orange-600',
      high: 'bg-orange-600',
      moderate: 'bg-yellow-600',
      medium: 'bg-yellow-600',
      minor: 'bg-blue-600',
      low: 'bg-blue-600'
    };
    return colors[severity?.toLowerCase()] || 'bg-gray-600';
  };

  if (!patient || currentMedications.length === 0) {
    return (
      <Card className="border-2 border-gray-300">
        <CardContent className="p-6 text-center text-gray-500">
          <Pill className="w-12 h-12 mx-auto mb-3 text-gray-400" />
          <p>No medications documented for analysis</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-purple-300 bg-gradient-to-br from-purple-50 to-pink-50">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pill className="w-5 h-5 text-purple-600" />
            AI Medication Management
            {analysis?.overall_safety_score !== undefined && (
              <Badge className={`${
                analysis.overall_safety_score >= 85 ? 'bg-green-600' :
                analysis.overall_safety_score >= 70 ? 'bg-yellow-600' : 'bg-red-600'
              } text-white`}>
                Safety Score: {analysis.overall_safety_score}
              </Badge>
            )}
          </div>
          {!isAnalyzing && !analysis && (
            <Button onClick={analyzeMedications} size="sm">
              Analyze Medications
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAnalyzing && (
          <Alert className="bg-white border-purple-300">
            <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
            <AlertDescription className="text-purple-900">
              Performing comprehensive medication analysis...
            </AlertDescription>
          </Alert>
        )}

        {analysis && (
          <>
            {/* Critical Alerts */}
            {analysis.critical_alerts?.length > 0 && (
              <Alert className="bg-red-50 border-red-400 border-2">
                <ShieldAlert className="w-5 h-5 text-red-600" />
                <AlertDescription>
                  <p className="font-bold text-red-900 mb-2">CRITICAL ALERTS - Immediate Action Required</p>
                  <div className="space-y-3">
                    {analysis.critical_alerts.map((alert, idx) => (
                      <Card key={idx} className="bg-white border-red-300">
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between mb-2">
                            <Badge className="bg-red-600 text-white">
                              {alert.alert_type.replace(/_/g, ' ').toUpperCase()}
                            </Badge>
                            {alert.notify_physician && (
                              <Badge variant="outline" className="text-red-700 border-red-300">
                                NOTIFY MD
                              </Badge>
                            )}
                          </div>
                          <p className="font-semibold text-sm text-gray-900 mb-1">
                            {alert.medications_involved?.join(' + ')}
                          </p>
                          <p className="text-sm text-gray-700 mb-2">{alert.description}</p>
                          <div className="bg-red-100 p-2 rounded text-xs">
                            <strong>Clinical Significance:</strong> {alert.clinical_significance}
                          </div>
                          <div className="bg-yellow-100 p-2 rounded text-xs mt-2">
                            <strong>Immediate Action:</strong> {alert.immediate_action}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <Tabs value={selectedTab} onValueChange={setSelectedTab}>
              <TabsList className="grid grid-cols-4 gap-1">
                <TabsTrigger value="interactions" className="text-xs">
                  Interactions
                  {analysis.drug_interactions?.length > 0 && (
                    <Badge className="ml-1 bg-red-600 text-white text-xs">{analysis.drug_interactions.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="contraindications" className="text-xs">
                  Contraindications
                  {analysis.contraindications?.length > 0 && (
                    <Badge className="ml-1 bg-orange-600 text-white text-xs">{analysis.contraindications.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="adherence" className="text-xs">Adherence</TabsTrigger>
                <TabsTrigger value="education" className="text-xs">Education</TabsTrigger>
              </TabsList>

              <TabsContent value="interactions" className="space-y-3">
                {analysis.drug_interactions?.length > 0 ? (
                  analysis.drug_interactions.map((interaction, idx) => (
                    <Card key={idx} className={`border-2 ${getSeverityColor(interaction.severity)}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <Badge className={`${getSeverityBadge(interaction.severity)} text-white`}>
                              {interaction.severity}
                            </Badge>
                          </div>
                        </div>
                        <p className="font-semibold text-gray-900 mb-2">
                          {interaction.drug1} + {interaction.drug2}
                        </p>
                        <div className="space-y-2 text-sm">
                          <div>
                            <strong className="text-gray-700">Interaction:</strong>
                            <p className="text-gray-600">{interaction.interaction}</p>
                          </div>
                          <div>
                            <strong className="text-gray-700">Mechanism:</strong>
                            <p className="text-gray-600">{interaction.mechanism}</p>
                          </div>
                          <div>
                            <strong className="text-gray-700">Clinical Effects:</strong>
                            <p className="text-gray-600">{interaction.effects}</p>
                          </div>
                          <div className="bg-white p-2 rounded border">
                            <strong className="text-green-700">Management:</strong>
                            <p className="text-gray-700 mt-1">{interaction.management}</p>
                          </div>
                          {interaction.monitoring && (
                            <div className="bg-blue-50 p-2 rounded border border-blue-200">
                              <strong className="text-blue-900">Monitoring:</strong>
                              <p className="text-blue-800 mt-1">{interaction.monitoring}</p>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                ) : (
                  <Alert className="bg-green-50 border-green-300">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <AlertDescription className="text-green-900">
                      No significant drug interactions detected
                    </AlertDescription>
                  </Alert>
                )}
              </TabsContent>

              <TabsContent value="contraindications" className="space-y-3">
                {analysis.contraindications?.length > 0 ? (
                  analysis.contraindications.map((contra, idx) => (
                    <Card key={idx} className="border-2 border-orange-300 bg-orange-50">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <Badge className={`${
                            contra.type === 'absolute' ? 'bg-red-600' :
                            contra.type === 'relative' ? 'bg-orange-600' : 'bg-yellow-600'
                          } text-white`}>
                            {contra.type} Contraindication
                          </Badge>
                        </div>
                        <p className="font-semibold text-gray-900 mb-1">{contra.medication}</p>
                        <p className="text-sm text-gray-700 mb-2">
                          <strong>Condition:</strong> {contra.condition}
                        </p>
                        <div className="bg-white p-2 rounded text-sm mb-2">
                          <strong>Rationale:</strong> {contra.rationale}
                        </div>
                        {contra.alternative_suggestions?.length > 0 && (
                          <div className="bg-green-50 p-2 rounded border border-green-200">
                            <strong className="text-green-900 text-sm">Alternative Options:</strong>
                            <ul className="mt-1 space-y-1">
                              {contra.alternative_suggestions.map((alt, i) => (
                                <li key={i} className="text-sm text-green-800">• {alt}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))
                ) : (
                  <Alert className="bg-green-50 border-green-300">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <AlertDescription className="text-green-900">
                      No contraindications identified based on documented conditions
                    </AlertDescription>
                  </Alert>
                )}

                {analysis.reconciliation_issues?.length > 0 && (
                  <Card className="bg-yellow-50 border-yellow-300">
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm text-yellow-900">Reconciliation Needed</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {analysis.reconciliation_issues.map((issue, idx) => (
                        <div key={idx} className="bg-white p-2 rounded border">
                          <p className="font-medium text-sm text-gray-900">{issue.medication}</p>
                          <p className="text-xs text-gray-600">{issue.issue}</p>
                          <p className="text-xs text-blue-700 mt-1">
                            <strong>Action:</strong> {issue.clarification_needed}
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="adherence" className="space-y-3">
                {analysis.adherence_concerns?.length > 0 ? (
                  analysis.adherence_concerns.map((concern, idx) => (
                    <Card key={idx} className="bg-white border-2 border-blue-300">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Bell className="w-4 h-4 text-blue-600" />
                          <Badge variant="outline">{concern.concern_type}</Badge>
                        </div>
                        <p className="text-sm text-gray-700 mb-3">{concern.description}</p>
                        <div className="bg-blue-50 p-3 rounded">
                          <strong className="text-blue-900 text-sm">Suggested Interventions:</strong>
                          <ul className="mt-2 space-y-1">
                            {concern.suggested_interventions?.map((intervention, i) => (
                              <li key={i} className="text-sm text-blue-800 flex items-start gap-2">
                                <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                {intervention}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                ) : (
                  <Alert className="bg-green-50 border-green-300">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <AlertDescription className="text-green-900">
                      No significant adherence barriers identified
                    </AlertDescription>
                  </Alert>
                )}
              </TabsContent>

              <TabsContent value="education" className="space-y-3">
                {!educationMaterial ? (
                  <Button
                    onClick={generatePatientEducation}
                    disabled={isGeneratingEducation}
                    className="w-full bg-purple-600 hover:bg-purple-700"
                  >
                    {isGeneratingEducation ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Generating Education Materials...
                      </>
                    ) : (
                      <>
                        <FileText className="w-4 h-4 mr-2" />
                        Generate Patient Education
                      </>
                    )}
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <Card className="bg-white">
                      <CardHeader className="py-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          Daily Medication Schedule
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {educationMaterial.daily_schedule?.map((slot, idx) => (
                          <div key={idx} className="p-3 bg-gray-50 rounded border">
                            <p className="font-semibold text-purple-900">{slot.time}</p>
                            <ul className="mt-1 space-y-1">
                              {slot.medications?.map((med, i) => (
                                <li key={i} className="text-sm text-gray-700">✓ {med}</li>
                              ))}
                            </ul>
                            {slot.instructions && (
                              <p className="text-xs text-gray-600 mt-1 italic">{slot.instructions}</p>
                            )}
                          </div>
                        ))}
                      </CardContent>
                    </Card>

                    <Card className="bg-white">
                      <CardHeader className="py-3">
                        <CardTitle className="text-sm">Medication Guides</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {educationMaterial.medication_guides?.map((guide, idx) => (
                          <div key={idx} className="p-3 bg-blue-50 rounded border border-blue-200">
                            <p className="font-bold text-blue-900">{guide.medication_name}</p>
                            <p className="text-sm text-gray-700 mt-1">
                              <strong>What it's for:</strong> {guide.what_its_for}
                            </p>
                            <p className="text-sm text-gray-700 mt-1">
                              <strong>How to take:</strong> {guide.how_to_take}
                            </p>
                            {guide.important_tips?.length > 0 && (
                              <div className="mt-2">
                                <strong className="text-sm text-blue-900">Important Tips:</strong>
                                <ul className="mt-1 space-y-1">
                                  {guide.important_tips.map((tip, i) => (
                                    <li key={i} className="text-xs text-blue-800">• {tip}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        ))}
                      </CardContent>
                    </Card>

                    <Alert className="bg-yellow-50 border-yellow-300">
                      <Info className="w-4 h-4 text-yellow-700" />
                      <AlertDescription>
                        <strong className="text-yellow-900">Important Reminders:</strong>
                        <ul className="mt-2 space-y-1">
                          {educationMaterial.important_reminders?.map((reminder, idx) => (
                            <li key={idx} className="text-sm text-yellow-800">• {reminder}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>

                    <Button
                      onClick={() => {
                        const content = JSON.stringify(educationMaterial, null, 2);
                        const blob = new Blob([content], { type: 'application/json' });
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `Medication_Education_${patient.last_name}.json`;
                        a.click();
                      }}
                      variant="outline"
                      className="w-full"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download Education Materials
                    </Button>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {/* Positive Findings */}
            {analysis.positive_findings?.length > 0 && (
              <Alert className="bg-green-50 border-green-300">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription>
                  <strong className="text-green-900">Positive Findings:</strong>
                  <ul className="mt-2 space-y-1">
                    {analysis.positive_findings.map((finding, idx) => (
                      <li key={idx} className="text-sm text-green-800">✓ {finding}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function calculateAge(dob) {
  if (!dob) return 'Unknown';
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}