import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Brain, AlertTriangle, TrendingUp, FileText, Loader2, Sparkles, Heart, Activity } from "lucide-react";
import { getPrompt, trackPromptUsage } from "../utils/aiPrompts";

export default function AIComprehensivePatientAnalysis({ patient, visits = [], carePlans = [], incidents = [] }) {
  const [analysis, setAnalysis] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const generateAnalysis = async () => {
    setIsAnalyzing(true);
    const startTime = Date.now();
    
    try {
      // Compile all patient data
      const comprehensiveData = {
        demographics: {
          name: `${patient.first_name} ${patient.last_name}`,
          dob: patient.date_of_birth,
          primary_diagnosis: patient.primary_diagnosis,
          secondary_diagnoses: patient.secondary_diagnoses
        },
        chronic_conditions: patient.chronic_conditions || [],
        past_surgeries: patient.past_surgeries || [],
        family_history: patient.family_medical_history || {},
        social_determinants: patient.social_determinants || {},
        medications: patient.current_medications || [],
        allergies: patient.allergies,
        functional_status: patient.functional_status,
        recent_visits: visits.slice(0, 10).map(v => ({
          date: v.visit_date,
          type: v.visit_type,
          notes: v.nurse_notes,
          vital_signs: v.vital_signs
        })),
        care_plans: carePlans.map(cp => ({
          problem: cp.problem,
          goal: cp.goal,
          status: cp.status
        })),
        recent_incidents: incidents.slice(0, 5).map(i => ({
          type: i.incident_type,
          severity: i.severity,
          details: i.details
        })),
        active_alerts: patient.active_alerts || []
      };

      // Get prompt from centralized configuration
      const { prompt, schema, version } = getPrompt('COMPREHENSIVE_PATIENT_ANALYSIS', comprehensiveData);

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: false,
        response_json_schema: schema
      });

      setAnalysis(response);
      
      // Track prompt usage for analytics
      const responseTime = Date.now() - startTime;
      trackPromptUsage('COMPREHENSIVE_PATIENT_ANALYSIS', version, true, responseTime);
    } catch (error) {
      console.error('Error generating analysis:', error);
      alert('Failed to generate analysis. Please try again.');
      
      const responseTime = Date.now() - startTime;
      trackPromptUsage('COMPREHENSIVE_PATIENT_ANALYSIS', 'unknown', false, responseTime);
    }
    setIsAnalyzing(false);
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'moderate': return 'bg-yellow-500 text-white';
      default: return 'bg-blue-500 text-white';
    }
  };

  const getImpactColor = (impact) => {
    switch (impact) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'moderate': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-blue-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  return (
    <Card className="border-2 border-blue-300">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardTitle className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-blue-600" />
            AI Comprehensive Analysis
          </div>
          <Button
            onClick={generateAnalysis}
            disabled={isAnalyzing}
            className="bg-blue-600 hover:bg-blue-700"
            size="sm"
          >
            {isAnalyzing ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-2" /> Generate Analysis</>
            )}
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-6">
        {!analysis && !isAnalyzing && (
          <div className="text-center py-8">
            <Brain className="w-16 h-16 text-blue-300 mx-auto mb-4" />
            <p className="text-gray-600 mb-4">
              AI will analyze patient's comprehensive medical history, family history, social determinants, and recent visit notes to identify risks and provide recommendations.
            </p>
          </div>
        )}

        {analysis && (
          <div className="space-y-6">
            {/* Clinical Summary */}
            <Alert className="bg-blue-50 border-blue-200">
              <FileText className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-900">
                <p className="font-semibold mb-2">Clinical Summary</p>
                <p className="text-sm">{analysis.clinical_summary}</p>
              </AlertDescription>
            </Alert>

            {/* Key Health Risks */}
            {analysis.key_health_risks?.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  Key Health Risks
                </h3>
                <div className="space-y-3">
                  {analysis.key_health_risks.map((risk, idx) => (
                    <Card key={idx} className="border-l-4 border-l-red-500">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h4 className="font-semibold text-gray-900 flex-1">{risk.risk}</h4>
                          <Badge className={getSeverityColor(risk.severity)}>
                            {risk.severity}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-700">{risk.rationale}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Social Risk Factors */}
            {analysis.social_risk_factors?.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-orange-600" />
                  Social Risk Factors
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {analysis.social_risk_factors.map((factor, idx) => (
                    <Alert key={idx} className={getImpactColor(factor.impact)}>
                      <AlertDescription>
                        <p className="font-semibold text-sm mb-1">{factor.factor}</p>
                        <p className="text-xs">{factor.description}</p>
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {analysis.recommendations?.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                  Actionable Recommendations
                </h3>
                <div className="space-y-3">
                  {analysis.recommendations.map((rec, idx) => (
                    <Card key={idx} className="border-l-4 border-l-green-500">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h4 className="font-semibold text-gray-900 flex-1">{rec.action}</h4>
                          <Badge className={getPriorityColor(rec.priority)}>
                            {rec.priority}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-700">{rec.rationale}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}