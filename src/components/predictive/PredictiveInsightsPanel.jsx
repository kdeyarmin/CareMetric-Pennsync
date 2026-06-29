import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Brain,
  Sparkles,
  Loader2,
  RefreshCw,
  Lightbulb,
  AlertTriangle,
  TrendingUp,
  Users,
  CheckCircle2
} from "lucide-react";

export default function PredictiveInsightsPanel({ 
  patients = [], 
  oasisData = [], 
  visits = [],
  alerts = [],
  _selectedPatientId = ''
}) {
  const [insights, setInsights] = useState(null);
  const ai = useAICall();

  const generateInsights = async () => {

    // Build population summary
    const populationSummary = {
      totalPatients: patients.length,
      avgVisitsPerPatient: patients.length > 0 ? (visits.length / patients.length).toFixed(1) : 0,
      activeAlerts: alerts.length,
      recentOASIS: oasisData.length,
      diagnoses: {},
      functionalImpairment: { high: 0, moderate: 0, low: 0 }
    };

    patients.forEach(p => {
      if (p.primary_diagnosis) {
        populationSummary.diagnoses[p.primary_diagnosis] = (populationSummary.diagnoses[p.primary_diagnosis] || 0) + 1;
      }
    });

    oasisData.forEach(o => {
      const fs = o.pdgm_data?.functional_scores || {};
      const totalImpairment = (fs.m1860_ambulation || 0) + (fs.m1850_transferring || 0) + (fs.m1830_bathing || 0);
      if (totalImpairment >= 12) populationSummary.functionalImpairment.high++;
      else if (totalImpairment >= 6) populationSummary.functionalImpairment.moderate++;
      else populationSummary.functionalImpairment.low++;
    });

    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Analyze this home health agency's patient population and provide strategic predictive insights.

POPULATION SUMMARY:
- Total Active Patients: ${populationSummary.totalPatients}
- Average Visits per Patient: ${populationSummary.avgVisitsPerPatient}
- Active Alerts: ${populationSummary.activeAlerts}
- OASIS Assessments: ${populationSummary.recentOASIS}

TOP DIAGNOSES:
${Object.entries(populationSummary.diagnoses).sort((a,b) => b[1] - a[1]).slice(0,5).map(([dx, count]) => `- ${dx}: ${count} patients`).join('\n')}

FUNCTIONAL IMPAIRMENT DISTRIBUTION:
- High Impairment: ${populationSummary.functionalImpairment.high} patients
- Moderate Impairment: ${populationSummary.functionalImpairment.moderate} patients
- Low Impairment: ${populationSummary.functionalImpairment.low} patients

Provide comprehensive predictive insights including:
1. Population health trends and predictions
2. Resource allocation recommendations
3. Risk stratification insights
4. Quality improvement opportunities
5. Financial optimization suggestions`,
        response_json_schema: {
          type: "object",
          properties: {
            population_trends: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  trend: { type: "string" },
                  direction: { type: "string", enum: ["increasing", "stable", "decreasing"] },
                  impact: { type: "string" },
                  recommendation: { type: "string" }
                }
              }
            },
            risk_stratification: {
              type: "object",
              properties: {
                high_risk_percentage: { type: "number" },
                key_risk_drivers: { type: "array", items: { type: "string" } },
                intervention_priorities: { type: "array", items: { type: "string" } }
              }
            },
            resource_recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  current_state: { type: "string" },
                  recommended_action: { type: "string" },
                  expected_outcome: { type: "string" }
                }
              }
            },
            quality_opportunities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  opportunity: { type: "string" },
                  potential_impact: { type: "string" },
                  implementation: { type: "string" }
                }
              }
            },
            financial_insights: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  insight: { type: "string" },
                  estimated_impact: { type: "string" },
                  action: { type: "string" }
                }
              }
            },
            predictions_30day: {
              type: "array",
              items: { type: "string" }
            },
            executive_summary: { type: "string" }
          }
        }
      });

      setInsights(result);
    } catch (error) {
      console.error("Insights generation error:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }

  };

  const getDirectionIcon = (direction) => {
    if (direction === 'increasing') return <TrendingUp className="w-4 h-4 text-orange-600" />;
    if (direction === 'decreasing') return <TrendingUp className="w-4 h-4 text-green-600 rotate-180" />;
    return <span className="w-4 h-4 text-slate-500">→</span>;
  };

  return (
    <div className="space-y-6">
      {/* Generate Button */}
      <Card className="bg-gradient-to-r from-navy-50 to-indigo-50 border-navy-200">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Brain className="w-8 h-8 text-navy-600" />
              <div>
                <h3 className="font-semibold text-navy-900">AI Predictive Insights Engine</h3>
                <p className="text-sm text-navy-700">
                  Analyze {patients.length} patients, {oasisData.length} OASIS records, {visits.length} visits
                </p>
              </div>
            </div>
            <Button
              onClick={generateInsights}
              disabled={ai.loading}
              className="bg-navy-600 hover:bg-navy-700"
            >
              {ai.loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Insights...</>
              ) : insights ? (
                <><RefreshCw className="w-4 h-4 mr-2" /> Regenerate Insights</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Generate Insights</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {insights && (
        <>
          {/* Executive Summary */}
          <Alert className="bg-blue-50 border-blue-200">
            <Brain className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-800">
              <strong>Executive Summary:</strong> {insights.executive_summary}
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Population Trends */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-600" />
                  Population Trends
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {insights.population_trends?.map((trend, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 rounded-lg border">
                    <div className="flex items-center gap-2 mb-1">
                      {getDirectionIcon(trend.direction)}
                      <span className="font-medium text-sm">{trend.trend}</span>
                    </div>
                    <p className="text-xs text-slate-600 mb-1">{trend.impact}</p>
                    <p className="text-xs text-blue-700 bg-blue-50 p-1 rounded">
                      💡 {trend.recommendation}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Risk Stratification */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-600" />
                  Risk Stratification
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center p-4 bg-orange-50 rounded-lg mb-3">
                  <p className="text-3xl font-bold text-orange-700">
                    {insights.risk_stratification?.high_risk_percentage || 0}%
                  </p>
                  <p className="text-sm text-orange-600">High Risk Population</p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-700">Key Risk Drivers:</p>
                  {insights.risk_stratification?.key_risk_drivers?.map((driver, idx) => (
                    <Badge key={idx} variant="outline" className="mr-1 mb-1 text-xs">
                      {driver}
                    </Badge>
                  ))}
                </div>

                <div className="mt-3 space-y-1">
                  <p className="text-xs font-medium text-slate-700">Intervention Priorities:</p>
                  {insights.risk_stratification?.intervention_priorities?.slice(0, 3).map((priority, idx) => (
                    <p key={idx} className="text-xs text-slate-600">• {priority}</p>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Quality Opportunities */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-yellow-600" />
                  Quality Improvement Opportunities
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {insights.quality_opportunities?.slice(0, 4).map((opp, idx) => (
                  <div key={idx} className="p-2 bg-yellow-50 rounded border border-yellow-200">
                    <p className="text-sm font-medium text-yellow-800">{opp.opportunity}</p>
                    <p className="text-xs text-yellow-700">Impact: {opp.potential_impact}</p>
                    <p className="text-xs text-slate-600">{opp.implementation}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Financial Insights */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                  Financial Optimization
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {insights.financial_insights?.slice(0, 4).map((fin, idx) => (
                  <div key={idx} className="p-2 bg-green-50 rounded border border-green-200">
                    <p className="text-sm font-medium text-green-800">{fin.insight}</p>
                    <p className="text-xs text-green-700">Est. Impact: {fin.estimated_impact}</p>
                    <p className="text-xs text-slate-600">{fin.action}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* 30-Day Predictions */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-navy-600" />
                30-Day Predictions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {insights.predictions_30day?.map((prediction, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-2 bg-navy-50 rounded">
                    <CheckCircle2 className="w-4 h-4 text-navy-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-navy-800">{prediction}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Resource Recommendations */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-600" />
                Resource Allocation Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Area</TableHead>
                    <TableHead>Current State</TableHead>
                    <TableHead>Recommended Action</TableHead>
                    <TableHead>Expected Outcome</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {insights.resource_recommendations?.map((rec, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{rec.area}</TableCell>
                      <TableCell className="text-slate-600">{rec.current_state}</TableCell>
                      <TableCell className="text-navy-700">{rec.recommended_action}</TableCell>
                      <TableCell className="text-emerald-700">{rec.expected_outcome}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {!insights && !ai.loading && (
        <div className="text-center py-12 text-slate-500">
          <Brain className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p>Click "Generate Insights" to run AI analysis on your patient population</p>
        </div>
      )}
    </div>
  );
}