import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Brain, AlertTriangle, Target, TrendingUp, Loader2, Sparkles, ChevronDown, ChevronUp } from "lucide-react";

export default function AIPatientAnalyzer({ patient, visits, carePlans, incidents }) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    diagnoses: true,
    risks: true,
    recommendations: true
  });

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      // Prepare comprehensive patient data
      const recentVisits = visits.slice(0, 10);
      const activeCarePlans = carePlans.filter(cp => cp.status === 'active');
      const recentIncidents = incidents.slice(0, 5);

      const prompt = `Analyze this home health patient's comprehensive medical record and provide clinical insights:

PATIENT PROFILE:
- Name: ${patient.first_name} ${patient.last_name}
- Age: ${patient.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / 31557600000) : 'Unknown'}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Current Medications: ${patient.current_medications?.map(m => `${m.name} ${m.dosage}`).join(', ') || 'None documented'}
- Allergies: ${patient.allergies || 'NKDA'}

RECENT CLINICAL DATA:
- Total Visits (Last 30 days): ${recentVisits.length}
- Active Care Plans: ${activeCarePlans.length}
- Recent Incidents: ${recentIncidents.length}
${recentIncidents.length > 0 ? `- Incident Types: ${recentIncidents.map(i => i.incident_type).join(', ')}` : ''}

MEDICAL HISTORY:
${patient.past_medical_history?.length > 0 ? `- Past Conditions: ${patient.past_medical_history.join(', ')}` : ''}
${patient.past_hospitalizations?.length > 0 ? `- Previous Hospitalizations: ${patient.past_hospitalizations.length}` : ''}

FUNCTIONAL STATUS:
${patient.functional_status ? `
- Ambulation: ${patient.functional_status.ambulation || 'Not documented'}
- ADL Independence: ${patient.functional_status.adl_independence || 'Not documented'}
- Cognitive Status: ${patient.functional_status.cognitive_status || 'Not documented'}
- Fall Risk: ${patient.functional_status.fall_risk || 'Not documented'}
` : '- Not documented'}

Provide a comprehensive clinical analysis with:
1. **Potential Additional Diagnoses**: Based on symptoms, medications, and history, suggest diagnoses that may be undocumented
2. **Adverse Event Risk Predictions**: For each potential adverse event (falls, infections, hospital readmissions, medication errors, pressure ulcers, malnutrition), provide:
   - Probability score (0-100) based on patient's specific risk factors
   - Severity level
   - Detailed description of why this risk exists
   - Specific preventative interventions tailored to this patient
3. **Personalized Care Recommendations**: Evidence-based interventions tailored to this patient's specific situation
4. **Monitoring Priorities**: Key vital signs and symptoms to closely monitor
5. **Care Plan Suggestions**: Specific goals and interventions that should be added

Format as JSON with clear, actionable clinical insights.`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            potential_diagnoses: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  diagnosis: { type: "string" },
                  rationale: { type: "string" },
                  confidence: { type: "string", enum: ["High", "Moderate", "Low"] }
                }
              }
            },
            risk_factors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  adverse_event_type: { type: "string", enum: ["fall", "infection", "readmission", "medication_error", "pressure_ulcer", "malnutrition", "other"] },
                  risk_category: { type: "string" },
                  probability_score: { type: "number", minimum: 0, maximum: 100 },
                  severity: { type: "string", enum: ["Critical", "High", "Moderate", "Low"] },
                  description: { type: "string" },
                  preventative_interventions: {
                    type: "array",
                    items: { type: "string" }
                  }
                }
              }
            },
            care_recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  recommendation: { type: "string" },
                  priority: { type: "string", enum: ["High", "Medium", "Low"] },
                  expected_outcome: { type: "string" }
                }
              }
            },
            monitoring_priorities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  parameter: { type: "string" },
                  frequency: { type: "string" },
                  alert_criteria: { type: "string" }
                }
              }
            },
            suggested_care_plans: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  problem: { type: "string" },
                  goal: { type: "string" },
                  interventions: {
                    type: "array",
                    items: { type: "string" }
                  }
                }
              }
            }
          }
        }
      });

      setAnalysis(result);
    } catch (error) {
      console.error('Analysis error:', error);
      alert('Failed to generate analysis. Please try again.');
    }
    setIsAnalyzing(false);
  };

  const getSeverityColor = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'moderate': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getConfidenceColor = (confidence) => {
    switch (confidence?.toLowerCase()) {
      case 'high': return 'bg-green-500';
      case 'moderate': return 'bg-yellow-500';
      case 'low': return 'bg-gray-400';
      default: return 'bg-gray-300';
    }
  };

  return (
    <Card className="border-purple-200 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-100">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-purple-600" />
            AI Clinical Analysis
          </CardTitle>
          <Button
            onClick={runAnalysis}
            disabled={isAnalyzing}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Run Analysis
              </>
            )}
          </Button>
        </div>
        <p className="text-sm text-gray-600 mt-2">
          AI-powered analysis of patient history to identify potential diagnoses, risk factors, and personalized care recommendations
        </p>
      </CardHeader>
      <CardContent className="p-6">
        {!analysis && !isAnalyzing && (
          <div className="text-center py-12">
            <Brain className="w-16 h-16 text-purple-200 mx-auto mb-4" />
            <p className="text-gray-600 mb-2">Click "Run Analysis" to generate AI-powered clinical insights</p>
            <p className="text-sm text-gray-500">Analysis includes potential diagnoses, risk factors, and care recommendations</p>
          </div>
        )}

        {analysis && (
          <div className="space-y-6">
            {/* Potential Diagnoses Section */}
            {analysis.potential_diagnoses && analysis.potential_diagnoses.length > 0 && (
              <div>
                <button
                  onClick={() => toggleSection('diagnoses')}
                  className="w-full flex items-center justify-between p-3 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
                >
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <Target className="w-5 h-5 text-purple-600" />
                    Potential Additional Diagnoses ({analysis.potential_diagnoses.length})
                  </h3>
                  {expandedSections.diagnoses ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {expandedSections.diagnoses && (
                  <div className="mt-3 space-y-3">
                    {analysis.potential_diagnoses.map((dx, idx) => (
                      <Card key={idx} className="border-l-4 border-l-purple-500">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <h4 className="font-semibold text-gray-900">{dx.diagnosis}</h4>
                            <Badge className={getConfidenceColor(dx.confidence)}>
                              {dx.confidence} Confidence
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-700">{dx.rationale}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Risk Factors Section */}
            {analysis.risk_factors && analysis.risk_factors.length > 0 && (
              <div>
                <button
                  onClick={() => toggleSection('risks')}
                  className="w-full flex items-center justify-between p-3 bg-orange-50 rounded-lg hover:bg-orange-100 transition-colors"
                >
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-orange-600" />
                    Identified Risk Factors ({analysis.risk_factors.length})
                  </h3>
                  {expandedSections.risks ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {expandedSections.risks && (
                  <div className="mt-3 space-y-3">
                    {analysis.risk_factors.map((risk, idx) => (
                      <Alert key={idx} className={getSeverityColor(risk.severity)}>
                        <AlertTriangle className="w-4 h-4" />
                        <AlertDescription>
                          <div className="flex flex-col gap-2 mb-2">
                            <div className="flex items-center justify-between">
                              <p className="font-semibold text-base">
                                {risk.adverse_event_type ? risk.adverse_event_type.replace(/_/g, ' ').toUpperCase() : risk.risk_category}
                              </p>
                              <Badge variant="outline">{risk.severity} Risk</Badge>
                            </div>
                            {risk.probability_score !== undefined && (
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-gray-200 rounded-full h-3 overflow-hidden">
                                  <div 
                                    className={`h-full ${
                                      risk.probability_score >= 70 ? 'bg-red-500' :
                                      risk.probability_score >= 40 ? 'bg-orange-500' :
                                      'bg-yellow-500'
                                    }`}
                                    style={{ width: `${risk.probability_score}%` }}
                                  />
                                </div>
                                <span className="text-sm font-bold min-w-[60px]">{risk.probability_score}% risk</span>
                              </div>
                            )}
                            {risk.risk_category && risk.adverse_event_type && (
                              <p className="text-sm font-medium text-gray-700">{risk.risk_category}</p>
                            )}
                          </div>
                          <p className="text-sm mb-3">{risk.description}</p>
                          {((risk.preventative_interventions && risk.preventative_interventions.length > 0) || 
                            (risk.interventions && risk.interventions.length > 0)) && (
                            <div className="bg-white/50 p-3 rounded border border-current/20">
                              <p className="text-xs font-semibold mb-2 flex items-center gap-1">
                                <span className="text-green-600">✓</span> Preventative Interventions:
                              </p>
                              <ul className="text-xs space-y-1.5">
                                {(risk.preventative_interventions || risk.interventions).map((intervention, i) => (
                                  <li key={i} className="flex items-start gap-2">
                                    <span className="text-green-600 mt-0.5">•</span>
                                    <span>{intervention}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </AlertDescription>
                      </Alert>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Care Recommendations Section */}
            {analysis.care_recommendations && analysis.care_recommendations.length > 0 && (
              <div>
                <button
                  onClick={() => toggleSection('recommendations')}
                  className="w-full flex items-center justify-between p-3 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-blue-600" />
                    Personalized Care Recommendations ({analysis.care_recommendations.length})
                  </h3>
                  {expandedSections.recommendations ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {expandedSections.recommendations && (
                  <div className="mt-3 space-y-3">
                    {analysis.care_recommendations.map((rec, idx) => (
                      <Card key={idx} className="border-l-4 border-l-blue-500">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <h4 className="font-semibold text-gray-900 flex-1">{rec.recommendation}</h4>
                            <Badge className={
                              rec.priority === 'High' ? 'bg-red-500' :
                              rec.priority === 'Medium' ? 'bg-yellow-500' :
                              'bg-green-500'
                            }>
                              {rec.priority} Priority
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-600">
                            <span className="font-medium">Expected Outcome:</span> {rec.expected_outcome}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Monitoring Priorities */}
            {analysis.monitoring_priorities && analysis.monitoring_priorities.length > 0 && (
              <Card className="bg-green-50 border-green-200">
                <CardHeader>
                  <CardTitle className="text-base">Monitoring Priorities</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="max-h-64">
                    <div className="space-y-3">
                      {analysis.monitoring_priorities.map((monitor, idx) => (
                        <div key={idx} className="bg-white p-3 rounded-lg border border-green-200">
                          <p className="font-semibold text-gray-900">{monitor.parameter}</p>
                          <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
                            <div>
                              <p className="text-xs text-gray-500">Frequency</p>
                              <p className="text-gray-700">{monitor.frequency}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">Alert Criteria</p>
                              <p className="text-gray-700">{monitor.alert_criteria}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Suggested Care Plans */}
            {analysis.suggested_care_plans && analysis.suggested_care_plans.length > 0 && (
              <Card className="bg-indigo-50 border-indigo-200">
                <CardHeader>
                  <CardTitle className="text-base">Suggested Care Plans</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="max-h-64">
                    <div className="space-y-3">
                      {analysis.suggested_care_plans.map((plan, idx) => (
                        <div key={idx} className="bg-white p-3 rounded-lg border border-indigo-200">
                          <p className="font-semibold text-gray-900 mb-1">{plan.problem}</p>
                          <p className="text-sm text-gray-700 mb-2"><span className="font-medium">Goal:</span> {plan.goal}</p>
                          {plan.interventions && plan.interventions.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 mb-1">Interventions:</p>
                              <ul className="text-xs space-y-1">
                                {plan.interventions.map((intervention, i) => (
                                  <li key={i} className="text-gray-600">• {intervention}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}