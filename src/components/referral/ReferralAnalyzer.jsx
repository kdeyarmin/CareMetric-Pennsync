import { useState, useEffect, useCallback, useRef } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  MapPin,
  User,
  Calendar,
  XCircle,
  AlertCircle,
  TrendingUp,
  Brain
} from "lucide-react";
import { toast } from 'sonner';

export default function ReferralAnalyzer({ referralData, onAnalysisComplete }) {
  const [analysis, setAnalysis] = useState(null);
  const ai = useAICall();
  const [analysisError, setAnalysisError] = useState(false);

  // Hold the completion callback in a ref so an inline (per-render) parent
  // callback doesn't change analyzeReferral's identity and re-fire the effect —
  // which otherwise produced an infinite loop of (billed) LLM calls.
  const onAnalysisCompleteRef = useRef(onAnalysisComplete);
  useEffect(() => {
    onAnalysisCompleteRef.current = onAnalysisComplete;
  }, [onAnalysisComplete]);

  const analyzeReferral = useCallback(async () => {
    if (!referralData) return;

    setAnalysisError(false);
    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert home health intake coordinator. Analyze this patient referral and provide:

1. MISSING INFORMATION ANALYSIS:
   - Identify all required fields that are missing or incomplete
   - Flag critical missing information (e.g., physician orders, diagnosis, contact info)
   - List nice-to-have information that would improve care planning

2. URGENCY SCORING (0-100 scale):
   - Clinical urgency based on diagnosis, recent hospitalization, symptoms
   - Administrative urgency based on requested start date, insurance requirements
   - Overall urgency score and priority level (STAT/High/Medium/Low)
   - Reasoning for the urgency rating

3. SCHEDULING RECOMMENDATIONS:
   - Ideal timeframe for first visit (e.g., within 24 hours, within 3 days)
   - Suggested visit frequency based on diagnosis and orders
   - Special scheduling considerations (e.g., needs wound care specialist, interpreter needed)
   - Estimated visit duration for first assessment

4. RISK FLAGS:
   - Clinical risks (fall risk, cognitive impairment, multiple comorbidities)
   - Social risks (lives alone, no caregiver support, language barrier)
   - Safety concerns (home environment, compliance issues)

5. NURSE SKILL REQUIREMENTS:
   - Required certifications or specializations
   - Experience level needed
   - Special skills (e.g., PICC line care, ventilator management)

Referral Data: ${JSON.stringify(referralData)}`,
        response_json_schema: {
          type: "object",
          properties: {
            missing_information: {
              type: "object",
              properties: {
                critical_missing: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      field_name: { type: "string" },
                      why_critical: { type: "string" },
                      how_to_obtain: { type: "string" }
                    }
                  }
                },
                recommended_missing: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      field_name: { type: "string" },
                      why_helpful: { type: "string" }
                    }
                  }
                },
                data_completeness_score: { type: "number" }
              }
            },
            urgency_analysis: {
              type: "object",
              properties: {
                clinical_urgency_score: { type: "number" },
                administrative_urgency_score: { type: "number" },
                overall_urgency_score: { type: "number" },
                priority_level: { type: "string", enum: ["STAT", "High", "Medium", "Low"] },
                urgency_factors: { type: "array", items: { type: "string" } },
                reasoning: { type: "string" }
              }
            },
            scheduling_recommendations: {
              type: "object",
              properties: {
                ideal_first_visit_timeframe: { type: "string" },
                recommended_visit_frequency: { type: "string" },
                estimated_visit_duration_minutes: { type: "number" },
                preferred_time_of_day: { type: "string" },
                special_considerations: { type: "array", items: { type: "string" } },
                location_notes: { type: "string" }
              }
            },
            risk_flags: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk_type: { type: "string" },
                  severity: { type: "string", enum: ["High", "Medium", "Low"] },
                  description: { type: "string" },
                  mitigation_strategy: { type: "string" }
                }
              }
            },
            nurse_requirements: {
              type: "object",
              properties: {
                required_certifications: { type: "array", items: { type: "string" } },
                experience_level: { type: "string", enum: ["Entry", "Intermediate", "Advanced", "Expert"] },
                special_skills: { type: "array", items: { type: "string" } },
                language_requirements: { type: "array", items: { type: "string" } }
              }
            },
            suggested_nurses: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  reasoning: { type: "string" },
                  availability_notes: { type: "string" }
                }
              }
            }
          }
        }
      });

      setAnalysis(result);
      if (onAnalysisCompleteRef.current) {
        onAnalysisCompleteRef.current(result);
      }
    } catch (error) {
      console.error('Error analyzing referral:', error);
      setAnalysisError(true);
      toast.error('Failed to analyze referral. Please try again.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [referralData]);

  useEffect(() => {
    if (referralData) {
      analyzeReferral();
    }
  }, [referralData, analyzeReferral]);

  if (!analysis) {
    if (analysisError) {
      return (
        <Card className="border-2 border-red-300">
          <CardContent className="p-8 text-center">
            <XCircle className="h-10 w-10 text-red-500 mx-auto mb-3" />
            <p className="text-slate-700 mb-4">Couldn't analyze this referral.</p>
            <button
              type="button"
              onClick={analyzeReferral}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700"
            >
              Retry analysis
            </button>
          </CardContent>
        </Card>
      );
    }
    return (
      <Card className="border-2 border-blue-300">
        <CardContent className="p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-slate-600">Analyzing referral with AI...</p>
        </CardContent>
      </Card>
    );
  }

  const getPriorityColor = (level) => {
    switch (level) {
      case "STAT": return "bg-red-600 text-white";
      case "High": return "bg-orange-500 text-white";
      case "Medium": return "bg-yellow-500 text-white";
      case "Low": return "bg-green-500 text-white";
      default: return "bg-slate-500 text-white";
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case "High": return "border-red-500 bg-red-50";
      case "Medium": return "border-yellow-500 bg-yellow-50";
      case "Low": return "border-blue-500 bg-blue-50";
      default: return "border-slate-500 bg-slate-50";
    }
  };

  return (
    <div className="space-y-4">
      {/* Urgency Header */}
      <Alert className={`border-2 ${analysis.urgency_analysis?.priority_level === 'STAT' || analysis.urgency_analysis?.priority_level === 'High' ? 'bg-red-50 border-red-300' : 'bg-blue-50 border-blue-300'}`}>
        <TrendingUp className="w-5 h-5" />
        <AlertDescription>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-lg mb-1">
                Referral Priority: <Badge className={getPriorityColor(analysis.urgency_analysis?.priority_level)}>
                  {analysis.urgency_analysis?.priority_level}
                </Badge>
              </p>
              <p className="text-sm">Urgency Score: {analysis.urgency_analysis?.overall_urgency_score}/100</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-600">Clinical: {analysis.urgency_analysis?.clinical_urgency_score}</p>
              <p className="text-xs text-slate-600">Administrative: {analysis.urgency_analysis?.administrative_urgency_score}</p>
            </div>
          </div>
        </AlertDescription>
      </Alert>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Missing Information */}
        <Card className="border-2 border-orange-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="w-5 h-5 text-orange-600" />
              Missing Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium">Data Completeness</p>
              <Badge className="bg-blue-600">{analysis.missing_information?.data_completeness_score}%</Badge>
            </div>

            {analysis.missing_information?.critical_missing?.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-red-900 flex items-center gap-1">
                  <XCircle className="w-4 h-4" /> Critical Missing ({analysis.missing_information?.critical_missing.length})
                </p>
                {analysis.missing_information?.critical_missing.map((item, idx) => (
                  <div key={idx} className="bg-red-50 p-2 rounded border border-red-200 text-xs">
                    <p className="font-semibold text-red-900">{item.field_name}</p>
                    <p className="text-slate-700">{item.why_critical}</p>
                    <p className="text-slate-600 mt-1"><strong>How to obtain:</strong> {item.how_to_obtain}</p>
                  </div>
                ))}
              </div>
            )}

            {analysis.missing_information?.recommended_missing?.length > 0 && (
              <div className="space-y-2 mt-3">
                <p className="text-xs font-semibold text-yellow-900 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" /> Recommended ({analysis.missing_information?.recommended_missing.length})
                </p>
                {analysis.missing_information?.recommended_missing.map((item, idx) => (
                  <div key={idx} className="bg-yellow-50 p-2 rounded border border-yellow-200 text-xs">
                    <p className="font-semibold text-yellow-900">{item.field_name}</p>
                    <p className="text-slate-700">{item.why_helpful}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Scheduling Recommendations */}
        <Card className="border-2 border-green-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="w-5 h-5 text-green-600" />
              Scheduling Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-green-50 p-3 rounded border border-green-200">
              <p className="text-xs font-semibold text-green-900 mb-2">⏰ First Visit Timeframe</p>
              <p className="text-sm font-bold text-slate-900">{analysis.scheduling_recommendations?.ideal_first_visit_timeframe}</p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-blue-50 p-2 rounded border border-blue-200">
                <p className="font-semibold text-blue-900">Frequency</p>
                <p className="text-slate-900">{analysis.scheduling_recommendations?.recommended_visit_frequency}</p>
              </div>
              <div className="bg-navy-50 p-2 rounded border border-navy-200">
                <p className="font-semibold text-navy-900">Duration</p>
                <p className="text-slate-900">{analysis.scheduling_recommendations?.estimated_visit_duration_minutes} min</p>
              </div>
            </div>

            {analysis.scheduling_recommendations?.preferred_time_of_day && (
              <div className="bg-indigo-50 p-2 rounded border border-indigo-200 text-xs">
                <p className="font-semibold text-indigo-900">Preferred Time</p>
                <p className="text-slate-900">{analysis.scheduling_recommendations?.preferred_time_of_day}</p>
              </div>
            )}

            {analysis.scheduling_recommendations?.location_notes && (
              <div className="bg-slate-50 p-2 rounded border border-slate-200 text-xs">
                <p className="font-semibold text-slate-900 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Location Notes
                </p>
                <p className="text-slate-700">{analysis.scheduling_recommendations?.location_notes}</p>
              </div>
            )}

            {analysis.scheduling_recommendations?.special_considerations?.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-900">Special Considerations:</p>
                {analysis.scheduling_recommendations?.special_considerations.map((item, idx) => (
                  <p key={idx} className="text-xs text-slate-700">• {item}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Risk Flags */}
      {analysis.risk_flags?.length > 0 && (
        <Card className="border-2 border-red-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Risk Flags ({analysis.risk_flags?.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-3">
              {analysis.risk_flags?.map((risk, idx) => (
                <div key={idx} className={`p-3 rounded-lg border-2 ${getSeverityColor(risk.severity)}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-semibold text-sm">{risk.risk_type}</p>
                    <Badge className={`${risk.severity === 'High' ? 'bg-red-600' : risk.severity === 'Medium' ? 'bg-yellow-600' : 'bg-blue-600'}`}>
                      {risk.severity}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-700 mb-2">{risk.description}</p>
                  <div className="bg-white p-2 rounded border text-xs">
                    <p className="font-semibold text-slate-900">Mitigation:</p>
                    <p className="text-slate-700">{risk.mitigation_strategy}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Nurse Requirements */}
      <Card className="border-2 border-navy-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="w-5 h-5 text-navy-600" />
            Nurse Requirements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900 mb-2">Experience Level Required:</p>
              <Badge className="bg-navy-600 text-white">{analysis.nurse_requirements?.experience_level}</Badge>
            </div>

            {analysis.nurse_requirements?.required_certifications?.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-slate-900 mb-2">Required Certifications:</p>
                <div className="flex flex-wrap gap-1">
                  {analysis.nurse_requirements?.required_certifications.map((cert, idx) => (
                    <Badge key={idx} variant="outline">{cert}</Badge>
                  ))}
                </div>
              </div>
            )}

            {analysis.nurse_requirements?.special_skills?.length > 0 && (
              <div className="md:col-span-2">
                <p className="text-sm font-semibold text-slate-900 mb-2">Special Skills:</p>
                <div className="flex flex-wrap gap-1">
                  {analysis.nurse_requirements?.special_skills.map((skill, idx) => (
                    <Badge key={idx} className="bg-blue-100 text-blue-800">{skill}</Badge>
                  ))}
                </div>
              </div>
            )}

            {analysis.nurse_requirements?.language_requirements?.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-slate-900 mb-2">Language Requirements:</p>
                <div className="flex flex-wrap gap-1">
                  {analysis.nurse_requirements?.language_requirements.map((lang, idx) => (
                    <Badge key={idx} className="bg-green-100 text-green-800">{lang}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Urgency Reasoning */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="w-5 h-5 text-blue-600" />
            AI Urgency Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="bg-blue-50 p-3 rounded border border-blue-200">
            <p className="text-sm text-slate-900">{analysis.urgency_analysis?.reasoning}</p>
          </div>

          {analysis.urgency_analysis?.urgency_factors?.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-900 mb-2">Key Urgency Factors:</p>
              <ul className="space-y-1">
                {analysis.urgency_analysis?.urgency_factors.map((factor, idx) => (
                  <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">•</span>
                    <span>{factor}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}