import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  TrendingDown,
  AlertTriangle,
  Activity,
  Heart,
  Thermometer,
  Droplets,
  Wind,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Clock,
  Target
} from "lucide-react";

export default function PatientDeteriorationPredictor({
  patient,
  visits = [],
  currentVitals,
  autoPredict = false,
  compact = false
}) {
  const [isPredicting, setIsPredicting] = useState(false);
  const [prediction, setPrediction] = useState(null);
  const [isExpanded, setIsExpanded] = useState(!compact);

  useEffect(() => {
    if (autoPredict && patient && visits.length > 0) {
      predictDeterioration();
    }
  }, [autoPredict, patient?.id]);

  const predictDeterioration = async () => {
    if (!patient) return;

    setIsPredicting(true);
    try {
      // Get baseline vitals from patient
      const baseline = patient.baseline_vitals || {};
      
      // Get vital signs history from visits
      const vitalHistory = visits
        .filter(v => v.vital_signs && Object.keys(v.vital_signs).length > 0)
        .slice(0, 10)
        .map(v => ({
          date: v.visit_date,
          vitals: v.vital_signs,
          nurse_notes: v.nurse_notes?.substring(0, 200)
        }));

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical AI predicting patient deterioration risk based on vital signs trends and clinical data.

PATIENT PROFILE:
- Name: ${patient.first_name} ${patient.last_name}
- Age: ${calculateAge(patient.date_of_birth)}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Medications: ${patient.current_medications?.map(m => m.name).join(', ') || 'None'}
- Care Type: ${patient.care_type === 'hospice' ? 'Hospice' : 'Home Health'}

BASELINE VITALS:
${Object.entries(baseline).map(([k, v]) => `- ${formatVitalName(k)}: ${v}`).join('\n') || 'No baseline established'}

CURRENT VITALS:
${currentVitals ? Object.entries(currentVitals).map(([k, v]) => `- ${formatVitalName(k)}: ${v}`).join('\n') : 'Not recorded'}

VITAL SIGNS HISTORY (Last 10 visits):
${vitalHistory.map((vh, i) => `
Visit ${i+1} (${vh.date}):
${Object.entries(vh.vitals).map(([k, v]) => `  ${formatVitalName(k)}: ${v}`).join('\n')}
${vh.nurse_notes ? `  Notes: ${vh.nurse_notes}` : ''}
`).join('\n') || 'No history available'}

FUNCTIONAL STATUS:
- Ambulation: ${patient.functional_status?.ambulation || 'Unknown'}
- ADL Independence: ${patient.functional_status?.adl_independence || 'Unknown'}
- Fall Risk: ${patient.functional_status?.fall_risk || 'Unknown'}
- Cognitive Status: ${patient.functional_status?.cognitive_status || 'Unknown'}

ANALYZE AND PREDICT:
1. Calculate overall deterioration risk (0-100 score)
2. Identify specific vital signs showing concerning trends
3. Detect early warning signs in the data
4. Predict timeframe for potential deterioration
5. Recommend immediate and preventive interventions
6. Identify factors requiring urgent clinical attention

Consider:
- Vital sign trends over time (worsening patterns)
- Deviation from patient's baseline (not just normal ranges)
- Cumulative risk from multiple factors
- Disease-specific risk factors
- Medication effects
- Age and functional status impact

Return comprehensive prediction:`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_risk_score: { type: "number" },
            risk_level: { type: "string", enum: ["critical", "high", "moderate", "low"] },
            risk_category: { type: "string" },
            predicted_timeframe: { type: "string" },
            confidence: { type: "number" },
            vital_trends: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  vital_sign: { type: "string" },
                  trend: { type: "string", enum: ["worsening", "stable", "improving"] },
                  current_value: { type: "string" },
                  baseline_value: { type: "string" },
                  deviation_percentage: { type: "number" },
                  concern_level: { type: "string" },
                  clinical_significance: { type: "string" }
                }
              }
            },
            early_warning_signs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sign: { type: "string" },
                  severity: { type: "string" },
                  observed_in: { type: "string" },
                  clinical_implication: { type: "string" }
                }
              }
            },
            risk_factors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  factor: { type: "string" },
                  contribution: { type: "string" },
                  modifiable: { type: "boolean" }
                }
              }
            },
            immediate_interventions: {
              type: "array",
              items: { type: "string" }
            },
            monitoring_plan: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  parameter: { type: "string" },
                  frequency: { type: "string" },
                  alert_threshold: { type: "string" }
                }
              }
            },
            preventive_measures: {
              type: "array",
              items: { type: "string" }
            },
            escalation_criteria: {
              type: "array",
              items: { type: "string" }
            },
            summary: { type: "string" },
            key_concerns: { type: "array", items: { type: "string" } }
          }
        }
      });

      setPrediction(result);
    } catch (error) {
      console.error('Deterioration prediction error:', error);
      alert('Failed to predict deterioration risk. Please try again.');
    }
    setIsPredicting(false);
  };

  const getRiskColor = (level) => {
    const colors = {
      critical: { bg: 'bg-red-500', text: 'text-red-900', border: 'border-red-300', light: 'bg-red-50' },
      high: { bg: 'bg-orange-500', text: 'text-orange-900', border: 'border-orange-300', light: 'bg-orange-50' },
      moderate: { bg: 'bg-yellow-500', text: 'text-yellow-900', border: 'border-yellow-300', light: 'bg-yellow-50' },
      low: { bg: 'bg-green-500', text: 'text-green-900', border: 'border-green-300', light: 'bg-green-50' }
    };
    return colors[level] || colors.low;
  };

  const getTrendIcon = (trend) => {
    if (trend === 'worsening') return <TrendingDown className="w-4 h-4 text-red-600" />;
    if (trend === 'improving') return <Activity className="w-4 h-4 text-green-600" />;
    return <Activity className="w-4 h-4 text-gray-400" />;
  };

  const getVitalIcon = (vitalName) => {
    const lower = vitalName.toLowerCase();
    if (lower.includes('heart') || lower.includes('pulse')) return Heart;
    if (lower.includes('temp')) return Thermometer;
    if (lower.includes('pressure')) return Droplets;
    if (lower.includes('respiratory') || lower.includes('breath')) return Wind;
    return Activity;
  };

  if (!patient) return null;

  const colors = prediction ? getRiskColor(prediction.risk_level) : null;

  return (
    <Card className={`border-2 ${colors ? colors.border : 'border-blue-300'}`}>
      <CardHeader className={`${colors ? colors.light : 'bg-gradient-to-r from-blue-50 to-indigo-50'} pb-3`}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingDown className={`w-5 h-5 ${colors ? colors.text : 'text-blue-600'}`} />
            AI Deterioration Risk Predictor
            {prediction && (
              <Badge className={`ml-2 ${colors.bg} text-white`}>
                {prediction.risk_level.toUpperCase()} RISK
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={predictDeterioration}
              disabled={isPredicting}
            >
              {isPredicting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
            {!compact && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-4 space-y-4">
          {isPredicting && (
            <div className="text-center py-8">
              <Loader2 className="w-10 h-10 text-blue-600 animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-600">Analyzing vital trends and predicting risks...</p>
            </div>
          )}

          {!isPredicting && !prediction && (
            <div className="text-center py-6">
              <Alert className="mb-4">
                <AlertDescription className="text-sm">
                  AI will analyze vital sign trends, baseline comparisons, and clinical data to predict deterioration risk
                </AlertDescription>
              </Alert>
              <Button
                onClick={predictDeterioration}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Activity className="w-4 h-4 mr-2" />
                Predict Deterioration Risk
              </Button>
            </div>
          )}

          {prediction && (
            <div className="space-y-4">
              {/* Risk Score */}
              <div className={`p-4 rounded-lg border-2 ${colors.border} ${colors.light}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Overall Risk Score</span>
                  <Badge variant="outline" className="text-xs">
                    {prediction.confidence}% confidence
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  <Progress value={prediction.overall_risk_score} className="flex-1" />
                  <span className="text-2xl font-bold">{prediction.overall_risk_score}%</span>
                </div>
                <p className="text-xs text-gray-600 mt-2">
                  {prediction.risk_category} • Predicted timeframe: {prediction.predicted_timeframe}
                </p>
              </div>

              {/* Summary */}
              {prediction.summary && (
                <Alert className={`${colors.light} ${colors.border}`}>
                  <AlertTriangle className={`w-4 h-4 ${colors.text}`} />
                  <AlertDescription className={`text-sm ${colors.text}`}>
                    {prediction.summary}
                  </AlertDescription>
                </Alert>
              )}

              {/* Key Concerns */}
              {prediction.key_concerns?.length > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm font-semibold text-red-900 mb-2">🚨 Key Concerns:</p>
                  <ul className="text-sm text-red-800 space-y-1">
                    {prediction.key_concerns.map((concern, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{concern}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Vital Trends */}
              {prediction.vital_trends?.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">Vital Signs Analysis:</p>
                  <div className="space-y-2">
                    {prediction.vital_trends.map((vt, idx) => {
                      const VitalIcon = getVitalIcon(vt.vital_sign);
                      return (
                        <div key={idx} className={`p-3 rounded-lg border ${
                          vt.concern_level === 'high' ? 'bg-red-50 border-red-200' :
                          vt.concern_level === 'moderate' ? 'bg-yellow-50 border-yellow-200' :
                          'bg-white border-gray-200'
                        }`}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <VitalIcon className="w-4 h-4" />
                              <span className="font-medium text-sm">{vt.vital_sign}</span>
                              {getTrendIcon(vt.trend)}
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {vt.deviation_percentage > 0 ? '+' : ''}{vt.deviation_percentage}%
                            </Badge>
                          </div>
                          <div className="text-xs text-gray-600 space-y-1">
                            <div className="flex justify-between">
                              <span>Current: {vt.current_value}</span>
                              <span>Baseline: {vt.baseline_value}</span>
                            </div>
                            <p className="text-gray-700 italic">{vt.clinical_significance}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Early Warning Signs */}
              {prediction.early_warning_signs?.length > 0 && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <p className="text-sm font-semibold text-orange-900 mb-2">⚠️ Early Warning Signs:</p>
                  <div className="space-y-2">
                    {prediction.early_warning_signs.map((sign, idx) => (
                      <div key={idx} className="text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium text-orange-900">{sign.sign}</span>
                          <Badge className={
                            sign.severity === 'critical' ? 'bg-red-500 text-white' :
                            sign.severity === 'high' ? 'bg-orange-500 text-white' :
                            'bg-yellow-500 text-black'
                          }>{sign.severity}</Badge>
                        </div>
                        <p className="text-xs text-orange-800 mt-1">{sign.clinical_implication}</p>
                        <p className="text-xs text-gray-600">Observed: {sign.observed_in}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Immediate Interventions */}
              {prediction.immediate_interventions?.length > 0 && (
                <div className="p-3 bg-red-50 border-2 border-red-300 rounded-lg">
                  <p className="text-sm font-semibold text-red-900 mb-2 flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    Immediate Interventions Required:
                  </p>
                  <ul className="text-sm text-red-800 space-y-1">
                    {prediction.immediate_interventions.map((intervention, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-red-600 font-bold mt-0.5">→</span>
                        <span>{intervention}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Risk Factors */}
              {prediction.risk_factors?.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">Contributing Risk Factors:</p>
                  <div className="grid grid-cols-1 gap-2">
                    {prediction.risk_factors.map((rf, idx) => (
                      <div key={idx} className="p-2 bg-gray-50 rounded border">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{rf.factor}</span>
                          {rf.modifiable && (
                            <Badge className="bg-blue-500 text-white text-xs">Modifiable</Badge>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 mt-1">{rf.contribution}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Monitoring Plan */}
              {prediction.monitoring_plan?.length > 0 && (
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <p className="text-sm font-semibold text-purple-900 mb-2 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Monitoring Plan:
                  </p>
                  <div className="space-y-2">
                    {prediction.monitoring_plan.map((mp, idx) => (
                      <div key={idx} className="text-sm bg-white p-2 rounded">
                        <div className="font-medium text-purple-900">{mp.parameter}</div>
                        <div className="text-xs text-gray-600 flex justify-between">
                          <span>Frequency: {mp.frequency}</span>
                          <span>Alert if: {mp.alert_threshold}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Preventive Measures */}
              {prediction.preventive_measures?.length > 0 && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm font-semibold text-green-900 mb-2">Preventive Measures:</p>
                  <ul className="text-sm text-green-800 space-y-1">
                    {prediction.preventive_measures.map((measure, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-green-600">✓</span>
                        <span>{measure}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Escalation Criteria */}
              {prediction.escalation_criteria?.length > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm font-semibold text-red-900 mb-2">🚨 Escalate to Physician If:</p>
                  <ul className="text-sm text-red-800 space-y-1">
                    {prediction.escalation_criteria.map((criteria, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                        <span>{criteria}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
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

function formatVitalName(key) {
  return key
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}