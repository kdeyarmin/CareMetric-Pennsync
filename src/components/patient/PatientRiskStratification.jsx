import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  Activity,
  Heart,
  Brain,
  Shield,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Home,
  Stethoscope,
  Footprints,
  Pill,
  ThermometerSun,
  Info
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function PatientRiskStratification({
  patient,
  visits = [],
  carePlans = [],
  incidents = [],
  compact = false,
  onRiskCalculated,
  autoCalculate = true
}) {
  const [riskData, setRiskData] = useState(null);
  const ai = useAICall();
  const [isExpanded, setIsExpanded] = useState(!compact);
  const [lastCalculated, setLastCalculated] = useState(null);

  const calculateAge = useCallback((dob) => {
    if (!dob) return 'Unknown';
    const today = new Date();
    const birthDate = new Date(dob);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
  }, []);

  const calculateRisk = useCallback(async () => {
    if (!patient) return;

    try {
      // Gather comprehensive patient data
      const recentVisits = visits.slice(0, 10);
      const activeCarePlans = carePlans.filter(cp => cp.status === 'active');
      const recentIncidents = incidents.slice(0, 5);

      // Extract vital trends
      const vitalTrends = recentVisits
        .filter(v => v.vital_signs)
        .map(v => ({
          date: v.visit_date,
          vitals: v.vital_signs
        }));

      // Build comprehensive prompt for risk analysis
      const prompt = `You are an advanced clinical risk stratification AI for home health care. Analyze this patient's complete profile to predict risk levels for key adverse events.

PATIENT PROFILE:
- Name: ${patient.first_name} ${patient.last_name}
- Age: ${calculateAge(patient.date_of_birth)}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Allergies: ${patient.allergies || 'NKDA'}
- Status: ${patient.status}

VISIT HISTORY (Last ${recentVisits.length} visits):
${recentVisits.map(v => `- ${v.visit_date}: ${v.visit_type} - ${v.nurse_notes?.substring(0, 200) || 'No notes'}`).join('\n')}

VITAL SIGN TRENDS:
${vitalTrends.length > 0 ? vitalTrends.map(v => `${v.date}: BP ${v.vitals?.blood_pressure_systolic || v.vitals?.bp || '?'}/${v.vitals?.blood_pressure_diastolic || '?'}, HR ${v.vitals?.heart_rate || v.vitals?.hr || '?'}, O2 ${v.vitals?.oxygen_saturation || v.vitals?.o2 || '?'}%`).join('\n') : 'No vital data available'}

ACTIVE CARE PLANS (${activeCarePlans.length}):
${activeCarePlans.map(cp => `- ${cp.problem}: ${cp.goal} (Status: ${cp.status})`).join('\n') || 'None'}

INCIDENT HISTORY (${recentIncidents.length} recent):
${recentIncidents.map(i => `- ${i.incident_date}: ${i.incident_type} - Severity: ${i.severity}`).join('\n') || 'No incidents'}

---

Analyze this patient and calculate risk scores for:
1. HOSPITAL READMISSION (30-day risk)
2. FALLS
3. CONDITION EXACERBATION (based on primary diagnosis)
4. MEDICATION NON-ADHERENCE
5. INFECTION RISK
6. FUNCTIONAL DECLINE

For each risk category, provide:
- Risk score (0-100)
- Risk level (critical/high/moderate/low)
- Key contributing factors
- Trend (increasing/stable/decreasing)
- Specific recommendations

Also provide:
- Overall composite risk score
- Priority interventions
- Recommended monitoring frequency

Return JSON:
{
  "overall_risk": {
    "score": 0-100,
    "level": "critical" | "high" | "moderate" | "low",
    "summary": "One sentence overall risk summary"
  },
  "risk_categories": [
    {
      "category": "hospital_readmission",
      "display_name": "Hospital Readmission",
      "score": 0-100,
      "level": "critical" | "high" | "moderate" | "low",
      "trend": "increasing" | "stable" | "decreasing",
      "contributing_factors": ["factor 1", "factor 2"],
      "primary_driver": "Main reason for this risk level",
      "recommendation": "Specific intervention recommendation"
    }
  ],
  "priority_interventions": [
    {
      "intervention": "What to do",
      "urgency": "immediate" | "this_week" | "ongoing",
      "rationale": "Why this is important"
    }
  ],
  "monitoring_recommendation": {
    "frequency": "daily" | "twice_weekly" | "weekly" | "biweekly",
    "focus_areas": ["area 1", "area 2"],
    "escalation_triggers": ["trigger 1", "trigger 2"]
  },
  "predictive_insights": [
    {
      "insight": "Predictive observation",
      "confidence": "high" | "medium" | "low",
      "timeframe": "When this might occur"
    }
  ]
}`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            overall_risk: { type: "object" },
            risk_categories: { type: "array", items: { type: "object" } },
            priority_interventions: { type: "array", items: { type: "object" } },
            monitoring_recommendation: { type: "object" },
            predictive_insights: { type: "array", items: { type: "object" } }
          }
        }
      });

      setRiskData(result);
      setLastCalculated(new Date());
      
      if (onRiskCalculated) {
        onRiskCalculated(result);
      }
    } catch (error) {
      console.error("Error calculating risk:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [patient, visits, carePlans, incidents, onRiskCalculated, calculateAge]);

  useEffect(() => {
    if (autoCalculate && patient && !riskData) {
      calculateRisk();
    }
  }, [patient?.id, autoCalculate, patient, riskData, calculateRisk]);

  const getRiskColor = (level) => {
    const colors = {
      critical: 'bg-red-600 text-white',
      high: 'bg-orange-500 text-white',
      moderate: 'bg-yellow-500 text-white',
      low: 'bg-green-500 text-white'
    };
    return colors[level] || 'bg-slate-500 text-white';
  };

  const getRiskBorderColor = (level) => {
    const colors = {
      critical: 'border-red-500',
      high: 'border-orange-400',
      moderate: 'border-yellow-400',
      low: 'border-green-400'
    };
    return colors[level] || 'border-slate-400';
  };

  const getRiskBgColor = (level) => {
    const colors = {
      critical: 'bg-red-50',
      high: 'bg-orange-50',
      moderate: 'bg-yellow-50',
      low: 'bg-green-50'
    };
    return colors[level] || 'bg-slate-50';
  };

  const _getProgressColor = (level) => {
    const colors = {
      critical: 'bg-red-600',
      high: 'bg-orange-500',
      moderate: 'bg-yellow-500',
      low: 'bg-green-500'
    };
    return colors[level] || 'bg-slate-500';
  };

  const getTrendIcon = (trend) => {
    switch (trend) {
      case 'increasing': return <TrendingUp className="w-3 h-3 text-red-600" />;
      case 'decreasing': return <TrendingDown className="w-3 h-3 text-green-600" />;
      default: return <Minus className="w-3 h-3 text-slate-500" />;
    }
  };

  const getCategoryIcon = (category) => {
    const icons = {
      hospital_readmission: Home,
      falls: Footprints,
      condition_exacerbation: Activity,
      medication_non_adherence: Pill,
      infection_risk: ThermometerSun,
      functional_decline: Heart
    };
    const Icon = icons[category] || Stethoscope;
    return <Icon className="w-4 h-4" />;
  };

  if (!patient) return null;

  // Compact view for embedding in other components
  if (compact && riskData) {
    return (
      <div className={`p-3 rounded-lg border-2 ${getRiskBorderColor(riskData.overall_risk?.level)} ${getRiskBgColor(riskData.overall_risk?.level)}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            <span className="font-semibold text-sm">Risk Score</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={getRiskColor(riskData.overall_risk?.level)}>
              {riskData.overall_risk?.score}/100 - {riskData.overall_risk?.level}
            </Badge>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="w-4 h-4 text-slate-400" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">{riskData.overall_risk?.summary}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        <Progress 
          value={riskData.overall_risk?.score} 
          className="h-2 mt-2"
        />
        <div className="flex flex-wrap gap-1 mt-2">
          {riskData.risk_categories?.slice(0, 3).map((cat, idx) => (
            <Badge 
              key={idx} 
              variant="outline" 
              className={`text-xs ${cat.level === 'high' || cat.level === 'critical' ? 'border-red-300 text-red-700' : ''}`}
            >
              {cat.display_name}: {cat.score}
            </Badge>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Card className={`border-2 ${riskData ? getRiskBorderColor(riskData.overall_risk?.level) : 'border-slate-200'}`}>
      <CardHeader 
        className={`py-3 cursor-pointer ${riskData ? getRiskBgColor(riskData.overall_risk?.level) : 'bg-slate-50'}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-600" />
            <span className="font-semibold">AI Risk Stratification</span>
            {riskData && (
              <Badge className={getRiskColor(riskData.overall_risk?.level)}>
                {riskData.overall_risk?.score}/100 - {riskData.overall_risk?.level}
              </Badge>
            )}
            {ai.loading && <Loader2 className="w-4 h-4 animate-spin" />}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => { e.stopPropagation(); calculateRisk(); }}
              disabled={ai.loading}
              className="h-7 px-2"
            >
              <RefreshCw className={`w-3 h-3 ${ai.loading ? 'animate-spin' : ''}`} />
            </Button>
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </CardTitle>
      </CardHeader>

      {isExpanded && (
        <CardContent className="p-4">
          {!riskData && !ai.loading && (
            <div className="text-center py-6">
              <Brain className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500 mb-3">Analyze patient history to calculate risk scores</p>
              <Button onClick={calculateRisk} className="bg-indigo-600 hover:bg-indigo-700">
                <Shield className="w-4 h-4 mr-2" />
                Calculate Risk Scores
              </Button>
            </div>
          )}

          {ai.loading && !riskData && (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mb-3" />
              <p className="text-sm text-slate-600">Analyzing patient history...</p>
            </div>
          )}

          {riskData && (
            <div className="space-y-4">
              {/* Overall Risk Summary */}
              <Alert className={`${getRiskBgColor(riskData.overall_risk?.level)} border-2 ${getRiskBorderColor(riskData.overall_risk?.level)}`}>
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription className="text-sm">
                  <strong>Overall Assessment:</strong> {riskData.overall_risk?.summary}
                </AlertDescription>
              </Alert>

              {/* Risk Categories Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {riskData.risk_categories?.map((cat, idx) => (
                  <div 
                    key={idx} 
                    className={`p-3 rounded-lg border ${getRiskBorderColor(cat.level)} ${getRiskBgColor(cat.level)}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        {getCategoryIcon(cat.category)}
                        <span className="text-xs font-medium">{cat.display_name}</span>
                      </div>
                      {getTrendIcon(cat.trend)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold">{cat.score}</span>
                      <Badge className={`${getRiskColor(cat.level)} text-xs`}>{cat.level}</Badge>
                    </div>
                    <Progress value={cat.score} className="h-1.5 mt-2" />
                    <p className="text-xs text-slate-600 mt-2 line-clamp-2">{cat.primary_driver}</p>
                  </div>
                ))}
              </div>

              {/* Priority Interventions */}
              {riskData.priority_interventions?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4 text-orange-500" />
                    Priority Interventions
                  </h4>
                  <div className="space-y-2">
                    {riskData.priority_interventions.map((int, idx) => (
                      <div key={idx} className="flex items-start gap-2 p-2 bg-orange-50 rounded-lg border border-orange-200">
                        <Badge 
                          variant="outline" 
                          className={`text-xs flex-shrink-0 ${
                            int.urgency === 'immediate' ? 'border-red-400 text-red-700' :
                            int.urgency === 'this_week' ? 'border-orange-400 text-orange-700' :
                            'border-blue-400 text-blue-700'
                          }`}
                        >
                          {int.urgency}
                        </Badge>
                        <div>
                          <p className="text-sm font-medium">{int.intervention}</p>
                          <p className="text-xs text-slate-600">{int.rationale}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Monitoring Recommendations */}
              {riskData.monitoring_recommendation && (
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <h4 className="text-sm font-semibold text-blue-800 mb-2">Monitoring Recommendation</h4>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className="bg-blue-600">Visit {riskData.monitoring_recommendation.frequency}</Badge>
                  </div>
                  <p className="text-xs text-slate-700 mb-1">
                    <strong>Focus:</strong> {riskData.monitoring_recommendation.focus_areas?.join(', ')}
                  </p>
                  <p className="text-xs text-red-700">
                    <strong>Escalate if:</strong> {riskData.monitoring_recommendation.escalation_triggers?.join(', ')}
                  </p>
                </div>
              )}

              {/* Predictive Insights */}
              {riskData.predictive_insights?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1">
                    <Brain className="w-4 h-4 text-navy-500" />
                    Predictive Insights
                  </h4>
                  <div className="space-y-1">
                    {riskData.predictive_insights.map((insight, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs p-2 bg-navy-50 rounded border border-navy-200">
                        <Badge variant="outline" className="text-xs flex-shrink-0">{insight.confidence}</Badge>
                        <div>
                          <span>{insight.insight}</span>
                          <span className="text-slate-500 ml-1">({insight.timeframe})</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Last Calculated */}
              {lastCalculated && (
                <p className="text-xs text-slate-400 text-center">
                  Last calculated: {lastCalculated.toLocaleTimeString()}
                </p>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}