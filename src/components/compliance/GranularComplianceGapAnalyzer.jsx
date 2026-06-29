import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  AlertTriangle, 
  Brain,
  FileText,
  CheckCircle2,
  Sparkles,
  ChevronDown,
  ChevronUp
} from "lucide-react";

export default function GranularComplianceGapAnalyzer({ 
  visits, 
  patients, 
  _carePlans, 
  complianceAudits,
  dateRange = 30 
}) {
  const [gapAnalysis, setGapAnalysis] = useState(null);
  const ai = useAICall();
  const [expandedGaps, setExpandedGaps] = useState({});

  const analyzeVisitTypeGaps = useCallback(() => {
    const gaps = {};
    const visitTypes = ['admission', 'recertification', 'routine_visit', 'discharge'];

    visitTypes.forEach(type => {
      const typeVisits = visits.filter(v => v.visit_type === type);
      const issues = [];
      // A single visit can fail several checks below, so count DISTINCT
      // incomplete visits for the rate — using issues.length let one visit
      // contribute multiple "incomplete" counts and drove completion_rate
      // negative (e.g. 2 visits with 3 issues each => 1 - 6/2 = -200%).
      const incompleteVisitIds = new Set();

      typeVisits.forEach(visit => {
        const before = issues.length;
        // Check for missing critical documentation elements
        if (!visit.nurse_notes || visit.nurse_notes.length < 100) {
          issues.push({ visit_id: visit.id, issue: 'Insufficient documentation', patient_id: visit.patient_id });
        }
        if (!visit.vital_signs || Object.keys(visit.vital_signs).length === 0) {
          issues.push({ visit_id: visit.id, issue: 'Missing vital signs', patient_id: visit.patient_id });
        }
        if (type === 'admission' && !visit.nurse_notes?.toLowerCase().includes('homebound')) {
          issues.push({ visit_id: visit.id, issue: 'Missing homebound status documentation', patient_id: visit.patient_id });
        }
        if (type === 'recertification' && !visit.nurse_notes?.toLowerCase().includes('progress')) {
          issues.push({ visit_id: visit.id, issue: 'Missing progress documentation', patient_id: visit.patient_id });
        }
        if (issues.length > before) incompleteVisitIds.add(visit.id);
      });

      if (issues.length > 0) {
        const incompleteCount = incompleteVisitIds.size;
        gaps[type] = {
          total_visits: typeVisits.length,
          incomplete_visits: incompleteCount,
          completion_rate: typeVisits.length > 0
            ? Math.round((1 - incompleteCount / typeVisits.length) * 100)
            : 100,
          issues: issues
        };
      }
    });

    return gaps;
  }, [visits]);

  const analyzeComplianceGaps = useCallback(async () => {
    try {
      // Analyze visit types and missing documentation
      const visitTypeGaps = analyzeVisitTypeGaps();

      // AI-driven recommendations
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a compliance analytics AI for home health agencies. Analyze these compliance gaps and provide actionable recommendations.

IDENTIFIED GAPS:

Visit Type Documentation Gaps:
${JSON.stringify(visitTypeGaps, null, 2)}

Recent Compliance Audit Trends:
${complianceAudits?.slice(0, 10).map(a => `- ${a.visit_id}: Score ${a.compliance_score}%, Status: ${a.status}, Issues: ${a.issues?.length || 0}`).join('\n') || 'No recent audits'}

Provide detailed analysis with:
1. Priority ranking (critical/high/medium/low) for each gap type
2. Root cause analysis - why are these gaps occurring?
3. Specific actionable recommendations to address each gap
4. Estimated time/effort to remediate
5. Recommended training topics for staff
6. System/workflow improvements needed`,
        response_json_schema: {
          type: "object",
          properties: {
            gap_priorities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  gap_type: { type: "string" },
                  priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  affected_count: { type: "number" },
                  root_cause: { type: "string" },
                  business_impact: { type: "string" }
                }
              }
            },
            actionable_recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  recommendation: { type: "string" },
                  gap_addressed: { type: "string" },
                  implementation_steps: { type: "array", items: { type: "string" } },
                  estimated_effort: { type: "string" },
                  expected_outcome: { type: "string" },
                  quick_win: { type: "boolean" }
                }
              }
            },
            training_recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  topic: { type: "string" },
                  target_audience: { type: "string" },
                  priority: { type: "string" },
                  delivery_method: { type: "string" }
                }
              }
            },
            workflow_improvements: { type: "array", items: { type: "string" } },
            compliance_risk_score: { type: "number" }
          }
        }
      });

      setGapAnalysis({
        visitTypeGaps,
        aiRecommendations: result
      });
    } catch (error) {
      console.error("Error analyzing compliance gaps:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [analyzeVisitTypeGaps, complianceAudits]);

  useEffect(() => {
    if (visits?.length > 0 && patients?.length > 0) {
      analyzeComplianceGaps();
    }
  }, [visits, patients, dateRange, analyzeComplianceGaps]);



  const toggleExpanded = (key) => {
    setExpandedGaps(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const getSeverityColor = (severity) => {
    const colors = {
      critical: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      low: 'bg-blue-100 text-blue-800 border-blue-300'
    };
    return colors[severity] || 'bg-slate-100 text-slate-800';
  };

  if (ai.loading) {
    return (
      <Card className="border-2 border-orange-200">
        <CardContent className="p-8 text-center">
          <Brain className="w-12 h-12 text-orange-600 mx-auto mb-4 animate-pulse" />
          <p className="text-slate-600">Analyzing compliance gaps across all documentation...</p>
        </CardContent>
      </Card>
    );
  }

  if (!gapAnalysis) return null;

  const { visitTypeGaps, aiRecommendations } = gapAnalysis;

  return (
    <div className="space-y-6">
      {/* AI Risk Score Summary */}
      {aiRecommendations?.compliance_risk_score && (
        <Alert className={`${
          aiRecommendations.compliance_risk_score >= 75 ? 'bg-red-50 border-red-300' :
          aiRecommendations.compliance_risk_score >= 50 ? 'bg-orange-50 border-orange-300' :
          'bg-yellow-50 border-yellow-300'
        }`}>
          <AlertTriangle className={`w-5 h-5 ${
            aiRecommendations.compliance_risk_score >= 75 ? 'text-red-600' :
            aiRecommendations.compliance_risk_score >= 50 ? 'text-orange-600' :
            'text-yellow-600'
          }`} />
          <AlertDescription>
            <p className="font-semibold mb-1">Overall Compliance Risk Score: {aiRecommendations.compliance_risk_score}/100</p>
            <p className="text-sm">
              {aiRecommendations.compliance_risk_score >= 75 ? 'Critical action needed - multiple high-priority gaps detected' :
               aiRecommendations.compliance_risk_score >= 50 ? 'Moderate risk - address gaps promptly' :
               'Low risk - maintain current practices with minor improvements'}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Visit Type Documentation Gaps */}
      <Card className="border-2 border-orange-200">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-orange-600" />
              Visit Type Documentation Gaps
            </div>
            <Badge variant="outline">{Object.keys(visitTypeGaps).length} types affected</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(visitTypeGaps).map(([type, data]) => (
            <div key={type} className="border rounded-lg p-4 bg-slate-50">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="font-semibold text-slate-900 capitalize">{type.replace(/_/g, ' ')}</h4>
                  <p className="text-sm text-slate-600">
                    {data.incomplete_visits} of {data.total_visits} visits incomplete ({data.completion_rate}% complete)
                  </p>
                </div>
                <Badge className={data.completion_rate < 75 ? 'bg-red-600 text-white' : 'bg-yellow-600 text-white'}>
                  {data.incomplete_visits} gaps
                </Badge>
              </div>
              
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between"
                onClick={() => toggleExpanded(`visit-${type}`)}
              >
                <span>View Details</span>
                {expandedGaps[`visit-${type}`] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>

              {expandedGaps[`visit-${type}`] && (
                <div className="mt-3 space-y-2">
                  {data.issues.slice(0, 5).map((issue, idx) => (
                    <div key={idx} className="text-sm bg-white p-2 rounded border">
                      <p className="text-slate-700">
                        <strong>Issue:</strong> {issue.issue}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">Visit ID: {issue.visit_id}</p>
                    </div>
                  ))}
                  {data.issues.length > 5 && (
                    <p className="text-xs text-slate-500 text-center">+ {data.issues.length - 5} more issues</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* AI-Driven Recommendations */}
      {aiRecommendations && (
        <Card className="border-2 border-navy-300 bg-gradient-to-br from-navy-50 to-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-6 h-6 text-navy-600" />
              AI-Driven Recommendations
              <Badge className="ml-2 bg-navy-600 text-white">
                <Sparkles className="w-3 h-3 mr-1" />
                Powered by AI
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Gap Priorities */}
            {aiRecommendations.gap_priorities?.length > 0 && (
              <div>
                <h3 className="font-semibold text-slate-900 mb-3">Priority Gap Analysis</h3>
                <div className="space-y-3">
                  {aiRecommendations.gap_priorities.map((gap, idx) => (
                    <div key={idx} className="bg-white p-3 rounded-lg border">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={getSeverityColor(gap.priority)}>{gap.priority}</Badge>
                            <p className="font-semibold text-slate-900">{gap.gap_type}</p>
                          </div>
                          <p className="text-sm text-slate-600 mb-2">{gap.root_cause}</p>
                          <p className="text-xs text-slate-500"><strong>Impact:</strong> {gap.business_impact}</p>
                        </div>
                        <Badge variant="outline">{gap.affected_count} affected</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actionable Recommendations */}
            {aiRecommendations.actionable_recommendations?.length > 0 && (
              <div>
                <h3 className="font-semibold text-slate-900 mb-3">Actionable Recommendations</h3>
                <div className="space-y-3">
                  {aiRecommendations.actionable_recommendations.map((rec, idx) => (
                    <div key={idx} className="bg-white p-4 rounded-lg border border-blue-200">
                      <div className="flex items-start justify-between mb-2">
                        <p className="font-semibold text-slate-900 flex-1">{rec.recommendation}</p>
                        {rec.quick_win && (
                          <Badge className="bg-green-600 text-white flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Quick Win
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 mb-2">
                        <strong>Addresses:</strong> {rec.gap_addressed}
                      </p>
                      <div className="bg-blue-50 p-2 rounded mb-2">
                        <p className="text-xs font-semibold text-blue-900 mb-1">Implementation Steps:</p>
                        <ol className="text-xs text-blue-800 space-y-1 list-decimal list-inside">
                          {rec.implementation_steps?.map((step, sIdx) => (
                            <li key={sIdx}>{step}</li>
                          ))}
                        </ol>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">
                          <strong>Effort:</strong> {rec.estimated_effort}
                        </span>
                        <span className="text-green-600">
                          <strong>Expected:</strong> {rec.expected_outcome}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Training Recommendations */}
            {aiRecommendations.training_recommendations?.length > 0 && (
              <div>
                <h3 className="font-semibold text-slate-900 mb-3">Recommended Training</h3>
                <div className="grid md:grid-cols-2 gap-3">
                  {aiRecommendations.training_recommendations.map((training, idx) => (
                    <div key={idx} className="bg-navy-50 p-3 rounded-lg border border-navy-200">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-semibold text-slate-900">{training.topic}</p>
                        <Badge className={getSeverityColor(training.priority)}>{training.priority}</Badge>
                      </div>
                      <p className="text-sm text-slate-600 mb-1">
                        <strong>For:</strong> {training.target_audience}
                      </p>
                      <p className="text-xs text-slate-500">
                        <strong>Delivery:</strong> {training.delivery_method}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Workflow Improvements */}
            {aiRecommendations.workflow_improvements?.length > 0 && (
              <div>
                <h3 className="font-semibold text-slate-900 mb-3">System & Workflow Improvements</h3>
                <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-200">
                  <ul className="space-y-2">
                    {aiRecommendations.workflow_improvements.map((improvement, idx) => (
                      <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-indigo-600 flex-shrink-0 mt-0.5" />
                        <span>{improvement}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}