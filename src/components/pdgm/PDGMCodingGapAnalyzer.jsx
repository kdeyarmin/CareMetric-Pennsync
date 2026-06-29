import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Plus,
  DollarSign,
  FileText,
  Lightbulb,
  Copy,
  ChevronDown,
  ChevronUp
} from "lucide-react";

export default function PDGMCodingGapAnalyzer({ patient, visits = [], carePlans = [], onCodeSuggestion }) {
  const ai = useAICall();
  const [analysis, setAnalysis] = useState(null);
  const [expandedGaps, setExpandedGaps] = useState([]);
  const [copiedCode, setCopiedCode] = useState(null);

  const analyzecodingGaps = async () => {

    try {
      // Gather all documentation
      const recentVisits = visits.slice(0, 10);
      const visitNotes = recentVisits.map(v => ({
        date: v.visit_date,
        type: v.visit_type,
        notes: v.nurse_notes || '',
        vitals: v.vital_signs || {}
      }));

      const prompt = `You are a certified medical coder specializing in home health PDGM. Analyze this patient's documentation to identify coding gaps and suggest ICD-10 codes that may be missing or incorrectly coded.

PATIENT INFORMATION:
- Primary Diagnosis: ${patient?.primary_diagnosis || 'Not documented'}
- Secondary Diagnoses: ${patient?.secondary_diagnoses?.join(', ') || 'None documented'}
- Status: ${patient?.status || 'Unknown'}

RECENT VISIT DOCUMENTATION:
${JSON.stringify(visitNotes, null, 2)}

ACTIVE CARE PLANS:
${carePlans.map(cp => `- Problem: ${cp.problem}, Goal: ${cp.goal}`).join('\n') || 'None'}

ANALYSIS INSTRUCTIONS:
1. Identify conditions mentioned in documentation but not coded
2. Find symptoms that suggest underlying conditions needing codes
3. Identify comorbidities that affect PDGM case-mix
4. Look for HCC (Hierarchical Condition Category) opportunities
5. Check for specificity improvements (4th/5th digit codes)

Return JSON:
{
  "coding_gaps": [
    {
      "gap_type": "missing_diagnosis|underspecified|comorbidity_opportunity|hcc_opportunity",
      "evidence": "exact quote or reference from documentation",
      "current_code": "existing ICD-10 if applicable or null",
      "suggested_codes": [
        {
          "code": "ICD-10-CM code",
          "description": "Full description",
          "specificity": "high|medium",
          "pdgm_impact": "clinical_group|comorbidity_adjustment|both|none",
          "estimated_revenue_impact": "$X per episode"
        }
      ],
      "clinical_rationale": "Why this code is supported",
      "documentation_needed": "Additional documentation required if any",
      "priority": "high|medium|low"
    }
  ],
  "current_coding_assessment": {
    "primary_diagnosis_appropriate": true|false,
    "primary_diagnosis_feedback": "feedback on current primary dx",
    "comorbidity_capture_rate": "estimated percentage",
    "hcc_optimization_score": 0-100
  },
  "pdgm_optimization_summary": {
    "current_clinical_group": "estimated group",
    "potential_clinical_group": "with optimized coding",
    "current_comorbidity_tier": "none|low|high",
    "potential_comorbidity_tier": "with optimized coding",
    "estimated_revenue_opportunity": "$X per episode"
  },
  "top_recommendations": ["prioritized list of 3-5 actions"]
}`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            coding_gaps: { type: "array", items: { type: "object" } },
            current_coding_assessment: { type: "object" },
            pdgm_optimization_summary: { type: "object" },
            top_recommendations: { type: "array", items: { type: "string" } }
          }
        }
      });

      setAnalysis(result);
    } catch (error) {
      console.error("Coding gap analysis error:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }

  };

  const toggleGap = (index) => {
    setExpandedGaps(prev => 
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const getGapTypeColor = (type) => {
    const colors = {
      missing_diagnosis: "bg-red-100 text-red-800",
      underspecified: "bg-yellow-100 text-yellow-800",
      comorbidity_opportunity: "bg-blue-100 text-blue-800",
      hcc_opportunity: "bg-navy-100 text-navy-800"
    };
    return colors[type] || "bg-slate-100 text-slate-800";
  };

  const getPriorityColor = (priority) => {
    const colors = {
      high: "bg-red-500",
      medium: "bg-yellow-500",
      low: "bg-blue-500"
    };
    return colors[priority] || "bg-slate-500";
  };

  return (
    <Card className="border-2 border-amber-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-amber-50 to-orange-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-amber-600" />
            AI Coding Gap Analyzer
          </div>
          <Button
            onClick={analyzecodingGaps}
            disabled={ai.loading || !patient}
            size="sm"
            className="bg-amber-600 hover:bg-amber-700"
          >
            {ai.loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
            ) : (
              <><Search className="w-4 h-4 mr-2" /> Analyze Coding</>
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {!analysis && !ai.loading && (
          <Alert className="bg-amber-50 border-amber-200">
            <Lightbulb className="w-4 h-4 text-amber-600" />
            <AlertDescription className="text-amber-800 text-sm">
              Analyze patient documentation to identify missing ICD-10 codes and PDGM optimization opportunities.
            </AlertDescription>
          </Alert>
        )}

        {analysis && (
          <>
            {/* PDGM Optimization Summary */}
            {analysis.pdgm_optimization_summary && (
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-4 rounded-lg border border-green-200">
                <h4 className="font-semibold text-green-900 mb-3 flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  Revenue Optimization Potential
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-white p-2 rounded border">
                    <p className="text-xs text-slate-500">Clinical Group</p>
                    <p className="font-medium">
                      {analysis.pdgm_optimization_summary.current_clinical_group}
                      {analysis.pdgm_optimization_summary.potential_clinical_group !== analysis.pdgm_optimization_summary.current_clinical_group && (
                        <span className="text-green-600"> → {analysis.pdgm_optimization_summary.potential_clinical_group}</span>
                      )}
                    </p>
                  </div>
                  <div className="bg-white p-2 rounded border">
                    <p className="text-xs text-slate-500">Comorbidity Tier</p>
                    <p className="font-medium capitalize">
                      {analysis.pdgm_optimization_summary.current_comorbidity_tier}
                      {analysis.pdgm_optimization_summary.potential_comorbidity_tier !== analysis.pdgm_optimization_summary.current_comorbidity_tier && (
                        <span className="text-green-600"> → {analysis.pdgm_optimization_summary.potential_comorbidity_tier}</span>
                      )}
                    </p>
                  </div>
                </div>
                {analysis.pdgm_optimization_summary.estimated_revenue_opportunity && (
                  <div className="mt-3 p-2 bg-green-100 rounded border border-green-300 text-center">
                    <p className="text-xs text-green-700">Estimated Revenue Opportunity</p>
                    <p className="text-xl font-bold text-green-800">
                      {analysis.pdgm_optimization_summary.estimated_revenue_opportunity}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Current Coding Assessment */}
            {analysis.current_coding_assessment && (
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                <h4 className="font-semibold text-blue-900 mb-2 text-sm">Current Coding Assessment</h4>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    {analysis.current_coding_assessment.primary_diagnosis_appropriate ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-yellow-600" />
                    )}
                    <span>{analysis.current_coding_assessment.primary_diagnosis_feedback}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Comorbidity Capture Rate:</span>
                    <Badge variant="outline">{analysis.current_coding_assessment.comorbidity_capture_rate}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">HCC Optimization Score:</span>
                    <Badge className={analysis.current_coding_assessment.hcc_optimization_score >= 70 ? "bg-green-500" : "bg-yellow-500"}>
                      {analysis.current_coding_assessment.hcc_optimization_score}%
                    </Badge>
                  </div>
                </div>
              </div>
            )}

            {/* Coding Gaps */}
            {analysis.coding_gaps?.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Identified Coding Gaps ({analysis.coding_gaps.length})
                </h4>
                <ScrollArea className="h-64">
                  <div className="space-y-2 pr-2">
                    {analysis.coding_gaps.map((gap, idx) => (
                      <div key={idx} className="border rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleGap(idx)}
                          className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${getPriorityColor(gap.priority)}`} />
                            <Badge className={getGapTypeColor(gap.gap_type)}>
                              {gap.gap_type?.replace(/_/g, ' ')}
                            </Badge>
                            <span className="text-sm font-medium truncate max-w-xs">
                              {gap.suggested_codes?.[0]?.description || 'View details'}
                            </span>
                          </div>
                          {expandedGaps.includes(idx) ? (
                            <ChevronUp className="w-4 h-4 text-slate-500" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-500" />
                          )}
                        </button>
                        
                        {expandedGaps.includes(idx) && (
                          <div className="p-3 bg-white space-y-3 text-sm">
                            {/* Evidence */}
                            <div className="bg-yellow-50 p-2 rounded border border-yellow-200">
                              <p className="text-xs text-yellow-700 font-medium mb-1">Documentation Evidence:</p>
                              <p className="text-yellow-900 italic">"{gap.evidence}"</p>
                            </div>

                            {/* Suggested Codes */}
                            <div>
                              <p className="text-xs text-slate-500 font-medium mb-2">Suggested ICD-10 Codes:</p>
                              <div className="space-y-2">
                                {gap.suggested_codes?.map((code, cIdx) => (
                                  <div key={cIdx} className="flex items-start justify-between p-2 bg-green-50 rounded border border-green-200">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <code className="font-mono font-bold text-green-800">{code.code}</code>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 px-2"
                                          onClick={() => copyCode(code.code)}
                                        >
                                          {copiedCode === code.code ? (
                                            <CheckCircle2 className="w-3 h-3 text-green-600" />
                                          ) : (
                                            <Copy className="w-3 h-3" />
                                          )}
                                        </Button>
                                      </div>
                                      <p className="text-xs text-slate-700">{code.description}</p>
                                      <div className="flex gap-2 mt-1">
                                        <Badge variant="outline" className="text-xs py-0">
                                          PDGM: {code.pdgm_impact}
                                        </Badge>
                                        {code.estimated_revenue_impact && (
                                          <Badge className="bg-green-600 text-xs py-0">
                                            {code.estimated_revenue_impact}
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                    {onCodeSuggestion && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="ml-2"
                                        onClick={() => onCodeSuggestion(code)}
                                      >
                                        <Plus className="w-3 h-3 mr-1" /> Add
                                      </Button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Clinical Rationale */}
                            <div className="bg-blue-50 p-2 rounded border border-blue-200">
                              <p className="text-xs text-blue-700 font-medium mb-1">Clinical Rationale:</p>
                              <p className="text-blue-900 text-xs">{gap.clinical_rationale}</p>
                            </div>

                            {/* Documentation Needed */}
                            {gap.documentation_needed && (
                              <div className="bg-orange-50 p-2 rounded border border-orange-200">
                                <p className="text-xs text-orange-700 font-medium mb-1">Documentation Needed:</p>
                                <p className="text-orange-900 text-xs">{gap.documentation_needed}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Top Recommendations */}
            {analysis.top_recommendations?.length > 0 && (
              <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-200">
                <h4 className="font-semibold text-indigo-900 mb-2 text-sm">Priority Actions</h4>
                <ol className="space-y-1">
                  {analysis.top_recommendations.map((rec, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-indigo-800">
                      <span className="bg-indigo-600 text-white rounded-full w-4 h-4 flex items-center justify-center flex-shrink-0 text-xs">
                        {idx + 1}
                      </span>
                      {rec}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}