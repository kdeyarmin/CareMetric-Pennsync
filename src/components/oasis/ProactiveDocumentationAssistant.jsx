import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Plus,
  Edit3,
  Loader2,
  ChevronDown,
  ChevronUp,
  DollarSign,
  TrendingUp,
  Shield,
  Target
} from "lucide-react";

export default function ProactiveDocumentationAssistant({
  oasisData,
  clinicalNotes,
  patientData,
  autoAnalyze = true,
  onApplySuggestion
}) {
  const ai = useAICall();
  const [gaps, setGaps] = useState(null);
  const [expandedGap, setExpandedGap] = useState(null);
  const [editingNarrative, setEditingNarrative] = useState({});
  const [appliedSuggestions, setAppliedSuggestions] = useState(new Set());

  const analyzeDocumentation = useCallback(async () => {
    if (!oasisData) return;

    try {
      const prompt = `You are a Medicare documentation expert. Analyze OASIS data and clinical notes to identify documentation gaps that could impact reimbursement, quality scores, or compliance.

OASIS DATA:
${JSON.stringify(oasisData, null, 2)}

CLINICAL NOTES:
${clinicalNotes || 'No clinical notes provided'}

PATIENT CONTEXT:
${JSON.stringify(patientData || {}, null, 2)}

IDENTIFY DOCUMENTATION GAPS IN THESE AREAS:

1. HOMEBOUND STATUS JUSTIFICATION
- Check if homebound status is clearly documented
- Look for taxing effort, medical contraindication, or assistance needed
- Identify missing specific details about why patient cannot leave home

2. SKILLED NEED JUSTIFICATION
- Verify skilled nursing/therapy services are clearly justified
- Check for complexity, teaching needs, observation requirements
- Identify gaps in explaining WHY skill is needed (not just WHAT is done)

3. FUNCTIONAL STATUS SUPPORT
- Review if M-item scores match clinical narrative
- Check for specific examples supporting functional limitations
- Identify contradictions between scores and descriptions

4. SAFETY CONCERNS & RISK FACTORS
- Look for fall risk documentation
- Check medication management complexity
- Verify environmental hazards are documented

5. QUALITY MEASURE DOCUMENTATION
- Check baseline data for improvement measures
- Verify pain assessment completeness
- Look for influenza/pneumococcal vaccination status

6. CARE COORDINATION
- Check physician communication documentation
- Verify caregiver education is documented
- Look for interdisciplinary team coordination notes

7. PROGRESS & GOALS
- Verify measurable goals are documented
- Check progress toward goals is described
- Look for realistic discharge planning

8. COMORBIDITY SUPPORT
- Check if comorbidities have supporting clinical details
- Verify active management of conditions
- Look for gaps in comorbidity impact on care

For EACH gap found, provide:
- Specific M-item or area affected
- Why the gap matters (revenue/quality/compliance impact)
- Current state (what's missing or weak)
- Suggested narrative addition (exact text ready to copy)
- Where to add it (specific location guidance)
- Priority level
- Estimated revenue/quality impact`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            total_gaps_found: { type: "number" },
            overall_documentation_score: { type: "number" },
            summary: { type: "string" },
            gaps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  m_item_affected: { type: "string" },
                  gap_title: { type: "string" },
                  severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  current_state: { type: "string" },
                  why_it_matters: { type: "string" },
                  revenue_impact: { type: "string" },
                  quality_impact: { type: "string" },
                  compliance_risk: { type: "string" },
                  suggested_narrative: { type: "string" },
                  where_to_add: { type: "string" },
                  example_scenarios: { type: "array", items: { type: "string" } },
                  keywords_to_include: { type: "array", items: { type: "string" } },
                  documentation_tips: { type: "array", items: { type: "string" } },
                  cms_requirement: { type: "string" }
                }
              }
            },
            quick_wins: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  action: { type: "string" },
                  impact: { type: "string" }
                }
              }
            }
          }
        }
      });

      setGaps(result);
    } catch (error) {
      console.error('Documentation analysis error:', error);
      toast.error("The AI request didn't complete. Please try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [oasisData, clinicalNotes, patientData]);

  useEffect(() => {
    if (autoAnalyze && oasisData && clinicalNotes) {
      analyzeDocumentation();
    }
  }, [oasisData, clinicalNotes, autoAnalyze, analyzeDocumentation]);

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical': return <AlertTriangle className="w-4 h-4 text-red-600" />;
      case 'high': return <AlertTriangle className="w-4 h-4 text-orange-600" />;
      case 'medium': return <Target className="w-4 h-4 text-yellow-600" />;
      case 'low': return <CheckCircle2 className="w-4 h-4 text-blue-600" />;
      default: return null;
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const handleEditNarrative = (gapIndex, text) => {
    setEditingNarrative(prev => ({ ...prev, [gapIndex]: text }));
  };

  const handleApplySuggestion = (gap, gapIndex) => {
    const narrativeToApply = editingNarrative[gapIndex] || gap.suggested_narrative;
    
    if (onApplySuggestion) {
      onApplySuggestion({
        m_item: gap.m_item_affected,
        location: gap.where_to_add,
        narrative: narrativeToApply,
        gap_title: gap.gap_title
      });
    }

    setAppliedSuggestions(prev => new Set([...prev, gapIndex]));
    setEditingNarrative(prev => {
      const updated = { ...prev };
      delete updated[gapIndex];
      return updated;
    });
  };

  const getScoreColor = (score) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 75) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <Card className="border-2 border-navy-300 bg-gradient-to-br from-navy-50 to-gold-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-navy-600" />
            AI Documentation Assistant
            {ai.loading && <Loader2 className="w-4 h-4 animate-spin text-navy-500" />}
          </CardTitle>
          {!gaps && !ai.loading && (
            <Button onClick={analyzeDocumentation} className="bg-navy-600 hover:bg-navy-700">
              <Sparkles className="w-4 h-4 mr-2" />
              Analyze Documentation
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {ai.loading && (
          <div className="text-center py-12">
            <Loader2 className="w-12 h-12 animate-spin text-navy-600 mx-auto mb-4" />
            <p className="text-navy-700 font-medium">AI analyzing documentation for gaps...</p>
            <p className="text-sm text-slate-600 mt-2">Checking reimbursement, quality, and compliance areas</p>
          </div>
        )}

        {gaps && (
          <div className="space-y-4">
            {/* Summary Card */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white p-3 rounded-lg border-2 border-navy-300 text-center">
                <p className="text-xs text-slate-600 mb-1">Documentation Score</p>
                <p className={`text-3xl font-bold ${getScoreColor(gaps.overall_documentation_score)}`}>
                  {gaps.overall_documentation_score}%
                </p>
              </div>
              <div className="bg-white p-3 rounded-lg border-2 border-orange-300 text-center">
                <p className="text-xs text-slate-600 mb-1">Gaps Found</p>
                <p className="text-3xl font-bold text-orange-600">{gaps.total_gaps_found}</p>
              </div>
              <div className="bg-white p-3 rounded-lg border-2 border-green-300 text-center">
                <p className="text-xs text-slate-600 mb-1">Applied</p>
                <p className="text-3xl font-bold text-green-600">{appliedSuggestions.size}</p>
              </div>
            </div>

            {/* Summary */}
            <Alert className="bg-navy-100 border-navy-300">
              <AlertDescription className="text-navy-900">{gaps.summary}</AlertDescription>
            </Alert>

            {/* Quick Wins */}
            {gaps.quick_wins?.length > 0 && (
              <div className="bg-green-50 p-4 rounded-lg border-2 border-green-300">
                <h3 className="font-semibold text-green-900 mb-2 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Quick Wins - High Impact, Easy Fixes
                </h3>
                <div className="space-y-2">
                  {gaps.quick_wins.map((win, idx) => (
                    <div key={idx} className="bg-white p-3 rounded border border-green-200">
                      <p className="font-semibold text-sm text-green-900">{win.title}</p>
                      <p className="text-sm text-slate-700 mt-1">{win.action}</p>
                      <Badge className="mt-2 bg-green-600 text-white text-xs">{win.impact}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Documentation Gaps */}
            <div className="space-y-3">
              <h3 className="font-semibold text-navy-900">Documentation Gaps & AI Suggestions</h3>
              {gaps.gaps?.map((gap, idx) => (
                <div
                  key={idx}
                  className={`bg-white rounded-lg border-2 ${
                    appliedSuggestions.has(idx) ? 'border-green-400 bg-green-50' : 'border-navy-200'
                  } overflow-hidden`}
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-start gap-2 flex-1">
                        {getSeverityIcon(gap.severity)}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold text-slate-900">{gap.gap_title}</h4>
                            <Badge className={getSeverityColor(gap.severity)}>
                              {gap.severity}
                            </Badge>
                            {appliedSuggestions.has(idx) && (
                              <Badge className="bg-green-600 text-white">
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Applied
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            <Badge variant="outline" className="text-xs">{gap.category}</Badge>
                            {gap.m_item_affected && (
                              <span className="font-mono bg-slate-100 px-2 py-0.5 rounded">
                                {gap.m_item_affected}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedGap(expandedGap === idx ? null : idx)}
                      >
                        {expandedGap === idx ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </Button>
                    </div>

                    {/* Current State */}
                    <div className="bg-red-50 p-2 rounded border border-red-200 mb-2 text-xs">
                      <p className="text-red-900">
                        <strong>Current State:</strong> {gap.current_state}
                      </p>
                    </div>

                    {/* Impact Summary */}
                    <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
                      {gap.revenue_impact && (
                        <div className="bg-green-50 p-2 rounded border border-green-200">
                          <p className="text-green-600 font-medium flex items-center gap-1">
                            <DollarSign className="w-3 h-3" /> Revenue
                          </p>
                          <p className="text-green-800">{gap.revenue_impact}</p>
                        </div>
                      )}
                      {gap.quality_impact && (
                        <div className="bg-blue-50 p-2 rounded border border-blue-200">
                          <p className="text-blue-600 font-medium flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" /> Quality
                          </p>
                          <p className="text-blue-800">{gap.quality_impact}</p>
                        </div>
                      )}
                      {gap.compliance_risk && (
                        <div className="bg-orange-50 p-2 rounded border border-orange-200">
                          <p className="text-orange-600 font-medium flex items-center gap-1">
                            <Shield className="w-3 h-3" /> Compliance
                          </p>
                          <p className="text-orange-800">{gap.compliance_risk}</p>
                        </div>
                      )}
                    </div>

                    {/* Suggested Narrative */}
                    <div className="bg-gradient-to-r from-navy-50 to-indigo-50 p-3 rounded-lg border-2 border-navy-300 mb-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-navy-900 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          AI-Generated Narrative
                        </p>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(gap.suggested_narrative)}
                            className="h-7 px-2"
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditNarrative(idx, gap.suggested_narrative)}
                            className="h-7 px-2"
                          >
                            <Edit3 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>

                      {editingNarrative[idx] !== undefined ? (
                        <Textarea
                          value={editingNarrative[idx]}
                          onChange={(e) => handleEditNarrative(idx, e.target.value)}
                          className="text-sm mb-2 min-h-[100px]"
                        />
                      ) : (
                        <p className="text-sm text-slate-800 italic bg-white p-3 rounded border">
                          "{gap.suggested_narrative}"
                        </p>
                      )}

                      <div className="flex items-center justify-between mt-2">
                        <p className="text-xs text-navy-600">
                          <strong>Add to:</strong> {gap.where_to_add}
                        </p>
                        <Button
                          onClick={() => handleApplySuggestion(gap, idx)}
                          disabled={appliedSuggestions.has(idx)}
                          size="sm"
                          className="bg-navy-600 hover:bg-navy-700"
                        >
                          {appliedSuggestions.has(idx) ? (
                            <><CheckCircle2 className="w-3 h-3 mr-2" /> Applied</>
                          ) : (
                            <><Plus className="w-3 h-3 mr-2" /> Apply to OASIS</>
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {expandedGap === idx && (
                      <div className="space-y-2 pt-2 border-t">
                        <div className="bg-yellow-50 p-2 rounded border border-yellow-200 text-xs">
                          <p className="font-semibold text-yellow-900 mb-1">Why This Matters</p>
                          <p className="text-yellow-800">{gap.why_it_matters}</p>
                        </div>

                        {gap.cms_requirement && (
                          <div className="bg-indigo-50 p-2 rounded border border-indigo-200 text-xs">
                            <p className="font-semibold text-indigo-900 mb-1">CMS Requirement</p>
                            <p className="text-indigo-800">{gap.cms_requirement}</p>
                          </div>
                        )}

                        {gap.keywords_to_include?.length > 0 && (
                          <div className="bg-blue-50 p-2 rounded border border-blue-200">
                            <p className="text-xs font-semibold text-blue-900 mb-1">Keywords to Include</p>
                            <div className="flex flex-wrap gap-1">
                              {gap.keywords_to_include.map((keyword, i) => (
                                <Badge key={i} variant="outline" className="text-xs">
                                  {keyword}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {gap.example_scenarios?.length > 0 && (
                          <div className="bg-green-50 p-2 rounded border border-green-200">
                            <p className="text-xs font-semibold text-green-900 mb-1">Example Scenarios</p>
                            <ul className="text-xs text-green-800 space-y-1">
                              {gap.example_scenarios.map((scenario, i) => (
                                <li key={i}>• {scenario}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {gap.documentation_tips?.length > 0 && (
                          <div className="bg-navy-50 p-2 rounded border border-navy-200">
                            <p className="text-xs font-semibold text-navy-900 mb-1">Documentation Tips</p>
                            <ul className="text-xs text-navy-800 space-y-1">
                              {gap.documentation_tips.map((tip, i) => (
                                <li key={i}>✓ {tip}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Re-analyze Button */}
            <Button
              onClick={analyzeDocumentation}
              variant="outline"
              size="sm"
              disabled={ai.loading}
              className="w-full"
            >
              {ai.loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Re-analyzing...</>
              ) : (
                'Re-analyze Documentation'
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}