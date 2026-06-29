import { useState } from "react";
// Standard component AI-call hook (shared timeout/retry + managed loading/error).
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  User,
  Activity,
  Brain,
  Loader2,
  RefreshCw,
  CheckCircle2,
  TrendingUp,
  TrendingDown
} from "lucide-react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer
} from "recharts";

export default function PatientRiskScorecard({ patient, oasisData = [], visits = [] }) {
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const ai = useAICall();

  if (!patient) return null;

  const latestOASIS = oasisData[0];
  const fs = latestOASIS?.pdgm_data?.functional_scores || {};

  // Calculate risk dimensions
  const riskDimensions = [
    { 
      subject: 'Rehospitalization', 
      value: latestOASIS?.pdgm_data?.admission_source === 'institutional' ? 75 : 30,
      fullMark: 100 
    },
    { 
      subject: 'Fall Risk', 
      value: Math.min(100, ((fs.m1860_ambulation || 0) + (fs.m1850_transferring || 0)) * 12),
      fullMark: 100 
    },
    { 
      subject: 'Functional Decline', 
      value: Math.min(100, ((fs.m1830_bathing || 0) + (fs.m1860_ambulation || 0)) * 10),
      fullMark: 100 
    },
    { 
      subject: 'Care Complexity', 
      value: Math.min(100, (latestOASIS?.pdgm_data?.comorbidities?.length || 0) * 15),
      fullMark: 100 
    },
    { 
      subject: 'ADL Dependency', 
      value: Math.min(100, ((fs.m1810_dress_upper || 0) + (fs.m1820_dress_lower || 0) + (fs.m1800_grooming || 0)) * 12),
      fullMark: 100 
    }
  ];

  const overallRisk = Math.round(riskDimensions.reduce((s, d) => s + d.value, 0) / riskDimensions.length);

  const runAIAnalysis = async () => {
    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Provide a comprehensive risk analysis for this home health patient.

PATIENT: ${patient.first_name} ${patient.last_name}
DOB: ${patient.date_of_birth}
PRIMARY DIAGNOSIS: ${patient.primary_diagnosis}
SECONDARY: ${patient.secondary_diagnoses?.join(', ') || 'None'}
STATUS: ${patient.status}

OASIS DATA:
${latestOASIS ? JSON.stringify(latestOASIS.pdgm_data, null, 2) : 'No OASIS data'}

VISIT HISTORY: ${visits.length} visits recorded

Analyze all risk factors and provide:
1. Overall risk assessment
2. Specific risk areas with scores
3. Protective factors
4. 30-day outlook
5. Personalized recommendations`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_risk_score: { type: "number" },
            risk_level: { type: "string", enum: ["low", "moderate", "high", "critical"] },
            risk_areas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  score: { type: "number" },
                  trend: { type: "string", enum: ["improving", "stable", "worsening"] },
                  details: { type: "string" }
                }
              }
            },
            protective_factors: { type: "array", items: { type: "string" } },
            outlook_30day: { type: "string" },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: { type: "string" },
                  priority: { type: "string" },
                  rationale: { type: "string" }
                }
              }
            },
            confidence: { type: "number" },
            summary: { type: "string" }
          }
        }
      });
      setAiAnalysis(result);
    } catch (error) {
      console.error("Analysis error:", error);
      toast.error("Couldn't complete the risk analysis. Please try again.");
    }
  };

  const getRiskColor = (score) => {
    if (score >= 70) return 'text-red-600';
    if (score >= 40) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getTrendIcon = (trend) => {
    if (trend === 'improving') return <TrendingDown className="w-3 h-3 text-green-600" />;
    if (trend === 'worsening') return <TrendingUp className="w-3 h-3 text-red-600" />;
    return <Activity className="w-3 h-3 text-slate-500" />;
  };

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="pb-2 bg-gradient-to-r from-navy-50 to-indigo-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-navy-600" />
            {patient.first_name} {patient.last_name} - Risk Scorecard
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={runAIAnalysis}
            disabled={ai.loading}
          >
            {ai.loading ? (
              <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Analyzing...</>
            ) : aiAnalysis ? (
              <><RefreshCw className="w-4 h-4 mr-1" /> Refresh</>
            ) : (
              <><Brain className="w-4 h-4 mr-1" /> AI Analysis</>
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Radar Chart */}
          <div>
            <div className="text-center mb-2">
              <p className={`text-4xl font-bold ${getRiskColor(overallRisk)}`}>{overallRisk}</p>
              <p className="text-sm text-slate-600">Overall Risk Score</p>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <RadarChart data={riskDimensions}>
                <PolarGrid />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
                <Radar dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.4} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Risk Details */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Risk Dimensions</p>
            {riskDimensions.map((dim) => (
              <div key={dim.subject} className="flex items-center gap-3">
                <span className="text-xs text-slate-600 w-28">{dim.subject}</span>
                <div className="flex-1">
                  <Progress value={dim.value} className="h-2" />
                </div>
                <Badge className={`text-xs ${
                  dim.value >= 70 ? 'bg-red-100 text-red-800' :
                  dim.value >= 40 ? 'bg-yellow-100 text-yellow-800' :
                  'bg-green-100 text-green-800'
                }`}>
                  {dim.value}%
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {/* AI Analysis Results */}
        {aiAnalysis && (
          <div className="mt-6 pt-4 border-t space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">AI Risk Analysis</p>
              <Badge variant="outline">Confidence: {aiAnalysis.confidence}%</Badge>
            </div>

            <p className="text-sm text-slate-700">{aiAnalysis.summary}</p>

            {/* Risk Areas */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {aiAnalysis.risk_areas?.slice(0, 4).map((area, idx) => (
                <div key={idx} className="p-2 bg-slate-50 rounded-lg border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getTrendIcon(area.trend)}
                    <span className="text-sm">{area.area}</span>
                  </div>
                  <Badge className={`text-xs ${
                    area.score >= 70 ? 'bg-red-100 text-red-800' :
                    area.score >= 40 ? 'bg-yellow-100 text-yellow-800' :
                    'bg-green-100 text-green-800'
                  }`}>
                    {area.score}%
                  </Badge>
                </div>
              ))}
            </div>

            {/* 30-day outlook */}
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-sm font-medium text-blue-800">30-Day Outlook</p>
              <p className="text-sm text-blue-700">{aiAnalysis.outlook_30day}</p>
            </div>

            {/* Recommendations */}
            {aiAnalysis.recommendations?.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">Recommendations</p>
                <div className="space-y-2">
                  {aiAnalysis.recommendations.slice(0, 3).map((rec, idx) => (
                    <div key={idx} className="p-2 bg-green-50 rounded border border-green-200 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-green-800">{rec.action}</p>
                        <p className="text-xs text-green-600">{rec.rationale}</p>
                      </div>
                    </div>
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