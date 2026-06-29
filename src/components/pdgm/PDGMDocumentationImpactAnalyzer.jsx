import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DollarSign,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Lightbulb,
  ArrowRight,
  Calculator,
  Loader2
} from "lucide-react";
import { debounce } from "@/lib/debounce";

export default function PDGMDocumentationImpactAnalyzer({
  noteContent,
  patientData,
  diagnosis,
  vitalSigns,
  carePlans = [],
  onApplySuggestion,
  _onWarningsDetected
}) {
  const [analysis, setAnalysis] = useState(null);
  const ai = useAICall();
  const [showOptimizations, setShowOptimizations] = useState(true);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin';

  const analyzeImpact = useMemo(() => debounce(async () => {
    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a Medicare home health PDGM reimbursement optimization expert. Analyze this clinical documentation for PDGM case-mix impact.

CURRENT DOCUMENTATION:
${noteContent}

PATIENT CONTEXT:
- Primary Diagnosis: ${diagnosis || patientData?.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patientData?.secondary_diagnoses?.join(', ') || 'None'}
- Vital Signs: ${JSON.stringify(vitalSigns || {}, null, 2)}
- Care Plans: ${carePlans.map(cp => cp.problem).join(', ') || 'None'}

PDGM ANALYSIS FRAMEWORK:
Analyze the documentation's impact on the 5 PDGM payment adjustment categories:

1. ADMISSION SOURCE & TIMING (Low-Community vs Institutional)
2. CLINICAL GROUPING (derived from primary diagnosis ICD-10)
3. FUNCTIONAL IMPAIRMENT LEVEL (based on OASIS mobility, ADL items)
4. COMORBIDITY ADJUSTMENT (secondary diagnoses that qualify)
5. THERAPY NEED (PT/OT/ST visits)

For each category, provide:
- Current status based on documentation
- Payment impact (Low/Medium/High adjustment)
- Missing documentation elements
- Optimization opportunities
- Specific text to add to documentation
- Estimated payment increase if implemented

Also identify:
- Underdocumented functional limitations
- Missing comorbidities that could be supported
- Potential for higher case-mix score
- Compliance risks vs optimization opportunities

Return JSON with detailed analysis and actionable recommendations.

{
  "current_pdgm_assessment": {
    "admission_source": "community" | "institutional",
    "clinical_group": "string (e.g., MMTA-Diabetes)",
    "functional_level": "low" | "medium" | "high",
    "comorbidity_level": "none" | "low" | "medium" | "high",
    "estimated_case_mix_score": number (0.5 - 3.0),
    "estimated_payment_range": "$X - $Y"
  },
  "functional_impairment_analysis": {
    "documented_impairments": ["list of functional issues found"],
    "missing_impairments": ["potential issues not documented"],
    "current_score_impact": "low" | "medium" | "high",
    "optimization_opportunities": [
      {
        "area": "Mobility/ADL/IADL",
        "current_documentation": "what's currently stated",
        "suggested_enhancement": "specific text to add",
        "compliance_aligned": true | false,
        "payment_impact": "$X increase in case-mix",
        "oasis_items_affected": ["M1800", "M1850", etc]
      }
    ]
  },
  "comorbidity_analysis": {
    "documented_comorbidities": ["list"],
    "qualifying_for_adjustment": ["which ones count for PDGM"],
    "potential_additions": [
      {
        "comorbidity": "condition name",
        "evidence_in_note": "where it's implied",
        "icd10_code": "suggested code",
        "documentation_addition": "text to add",
        "payment_impact": "$X",
        "requires_physician_confirmation": true | false
      }
    ]
  },
  "clinical_pathway_optimization": [
    {
      "current_pathway": "current clinical group",
      "alternative_pathway": "potentially better group",
      "documentation_changes_needed": ["specific additions"],
      "payment_difference": "$X",
      "clinical_appropriateness": "high" | "medium" | "low",
      "recommendation": "pursue or not"
    }
  ],
  "therapy_need_analysis": {
    "current_documentation": "what's stated about therapy",
    "therapy_disciplines_supported": ["PT", "OT", "ST"],
    "suggested_justifications": [
      {
        "discipline": "PT/OT/ST",
        "justification_text": "clinical rationale to add",
        "visits_supported": number,
        "payment_impact": "$X"
      }
    ]
  },
  "overall_optimization_strategy": {
    "current_estimated_payment": "$X",
    "optimized_estimated_payment": "$Y",
    "total_potential_increase": "$Z",
    "priority_actions": [
      {
        "action": "specific change to make",
        "category": "functional/comorbidity/therapy/clinical",
        "effort": "low" | "medium" | "high",
        "impact": "low" | "medium" | "high",
        "text_to_add": "exact documentation to insert",
        "compliance_risk": "none" | "low" | "medium" | "high"
      }
    ]
  },
  "compliance_warnings": [
    {
      "warning": "potential issue",
      "severity": "low" | "medium" | "high",
      "explanation": "why this matters"
    }
  ],
  "summary": "Overall assessment and recommendation"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            current_pdgm_assessment: { type: "object" },
            functional_impairment_analysis: { type: "object" },
            comorbidity_analysis: { type: "object" },
            clinical_pathway_optimization: { type: "array", items: { type: "object" } },
            therapy_need_analysis: { type: "object" },
            overall_optimization_strategy: { type: "object" },
            compliance_warnings: { type: "array", items: { type: "object" } },
            summary: { type: "string" }
          }
        }
      });

      setAnalysis(result);
    } catch (error) {
      console.error("Error analyzing PDGM impact:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, 2000), [noteContent, diagnosis, patientData, vitalSigns, carePlans]);

  useEffect(() => {
    if (noteContent && noteContent.length > 100) {
      analyzeImpact();
    }
    return () => analyzeImpact.cancel();
  }, [noteContent, diagnosis, analyzeImpact]);

  const handleApplyOptimization = (action) => {
    if (onApplySuggestion && action.text_to_add) {
      onApplySuggestion(action.text_to_add);
    }
  };

  if (!isAdmin) {
    return null; // Hide financial data from non-admins
  }

  if (!noteContent || noteContent.length < 100) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="p-4 text-center text-sm">
          <Calculator className="w-8 h-8 text-green-600 mx-auto mb-2" />
          <p className="text-slate-600">Start documenting to enable PDGM impact analysis</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-green-200 bg-gradient-to-b from-green-50 to-white">
      <CardHeader className="py-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-green-600" />
            <span>PDGM Payment Optimization</span>
            {ai.loading && <Loader2 className="w-3 h-3 animate-spin" />}
          </div>
          {analysis && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowOptimizations(!showOptimizations)}
              className="h-6 text-xs"
            >
              {showOptimizations ? 'Hide' : 'Show'}
            </Button>
          )}
        </CardTitle>
      </CardHeader>

      {showOptimizations && (
        <CardContent className="p-3 space-y-3 max-h-[600px] overflow-y-auto">
          {ai.loading && !analysis ? (
            <div className="text-center py-6">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-green-600 mb-2" />
              <p className="text-xs text-slate-500">Analyzing PDGM impact...</p>
            </div>
          ) : analysis ? (
            <>
              {/* Current Assessment */}
              <div className="bg-gradient-to-r from-blue-100 to-indigo-100 p-3 rounded-lg border border-blue-200">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-blue-900">Current PDGM Assessment</p>
                  <Badge className="bg-blue-600 text-white">
                    Score: {analysis.current_pdgm_assessment?.estimated_case_mix_score?.toFixed(2)}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-blue-700">Clinical Group:</span>
                    <p className="font-medium text-blue-900">{analysis.current_pdgm_assessment?.clinical_group}</p>
                  </div>
                  <div>
                    <span className="text-blue-700">Functional Level:</span>
                    <p className="font-medium text-blue-900 capitalize">{analysis.current_pdgm_assessment?.functional_level}</p>
                  </div>
                  <div>
                    <span className="text-blue-700">Comorbidity:</span>
                    <p className="font-medium text-blue-900 capitalize">{analysis.current_pdgm_assessment?.comorbidity_level}</p>
                  </div>
                  <div>
                    <span className="text-blue-700">Est. Payment:</span>
                    <p className="font-medium text-blue-900">{analysis.current_pdgm_assessment?.estimated_payment_range}</p>
                  </div>
                </div>
              </div>

              {/* Optimization Opportunity */}
              {analysis.overall_optimization_strategy && (
                <Alert className="bg-gradient-to-r from-green-100 to-emerald-100 border-green-300">
                  <TrendingUp className="w-4 h-4 text-green-700" />
                  <AlertDescription className="text-xs text-green-900">
                    <strong>Optimization Potential:</strong> 
                    {' '}{analysis.overall_optimization_strategy.current_estimated_payment} 
                    {' '}→{' '}
                    <strong className="text-green-700">{analysis.overall_optimization_strategy.optimized_estimated_payment}</strong>
                    {' '}(+{analysis.overall_optimization_strategy.total_potential_increase})
                  </AlertDescription>
                </Alert>
              )}

              {/* Priority Actions */}
              {analysis.overall_optimization_strategy?.priority_actions?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    <Lightbulb className="w-3 h-3 text-yellow-600" />
                    Priority Optimization Actions
                  </p>
                  {analysis.overall_optimization_strategy.priority_actions.slice(0, 5).map((action, idx) => (
                    <div key={idx} className={`p-2 rounded border ${
                      action.impact === 'high' ? 'bg-green-50 border-green-300' :
                      action.impact === 'medium' ? 'bg-yellow-50 border-yellow-300' :
                      'bg-blue-50 border-blue-300'
                    }`}>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-xs font-medium text-slate-900">{action.action}</p>
                        <div className="flex gap-1 flex-shrink-0">
                          <Badge className={`text-[10px] py-0 ${
                            action.impact === 'high' ? 'bg-green-600 text-white' :
                            action.impact === 'medium' ? 'bg-yellow-600 text-white' :
                            'bg-blue-600 text-white'
                          }`}>
                            {action.impact} impact
                          </Badge>
                          {action.compliance_risk !== 'none' && (
                            <Badge className="text-[10px] py-0 bg-orange-100 text-orange-800">
                              {action.compliance_risk} risk
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] mb-1">
                        {action.category}
                      </Badge>
                      {action.text_to_add && (
                        <div className="bg-white p-2 rounded border mt-1">
                          <p className="text-[10px] text-slate-700 italic mb-1">
                            "{action.text_to_add.substring(0, 150)}..."
                          </p>
                          <Button
                            size="sm"
                            className="h-5 text-[10px] mt-1 bg-green-600 hover:bg-green-700"
                            onClick={() => handleApplyOptimization(action)}
                          >
                            <ArrowRight className="w-2 h-2 mr-1" /> Apply to Note
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Functional Impairment Opportunities */}
              {analysis.functional_impairment_analysis?.optimization_opportunities?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-700">Functional Impairment Opportunities</p>
                  {analysis.functional_impairment_analysis.optimization_opportunities.map((opp, idx) => (
                    <div key={idx} className="bg-navy-50 p-2 rounded border border-navy-200">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-medium text-navy-900">{opp.area}</p>
                        <Badge className="text-[10px] bg-navy-600 text-white">
                          {opp.payment_impact}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-slate-600 mb-1">
                        OASIS: {opp.oasis_items_affected?.join(', ')}
                      </p>
                      <div className="bg-white p-1.5 rounded text-[10px] text-slate-700">
                        <strong>Add:</strong> {opp.suggested_enhancement}
                      </div>
                      {opp.compliance_aligned && (
                        <Badge className="text-[10px] mt-1 bg-green-100 text-green-800">
                          <CheckCircle2 className="w-2 h-2 mr-1" /> Compliance-aligned
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Comorbidity Additions */}
              {analysis.comorbidity_analysis?.potential_additions?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-700">Comorbidity Documentation Opportunities</p>
                  {analysis.comorbidity_analysis.potential_additions.map((comorb, idx) => (
                    <div key={idx} className="bg-orange-50 p-2 rounded border border-orange-200">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-medium text-orange-900">{comorb.comorbidity}</p>
                        <Badge className="text-[10px] bg-orange-600 text-white">
                          {comorb.payment_impact}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-slate-600 mb-1">
                        ICD-10: {comorb.icd10_code}
                      </p>
                      <div className="bg-white p-1.5 rounded text-[10px]">
                        <strong>Evidence:</strong> {comorb.evidence_in_note}
                      </div>
                      {comorb.requires_physician_confirmation && (
                        <Badge className="text-[10px] mt-1 bg-yellow-100 text-yellow-800">
                          <AlertCircle className="w-2 h-2 mr-1" /> Requires MD confirmation
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Compliance Warnings */}
              {analysis.compliance_warnings?.length > 0 && (
                <Alert className="bg-red-50 border-red-300">
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <AlertDescription className="text-xs text-red-900">
                    <strong>Compliance Considerations:</strong>
                    <ul className="list-disc list-inside mt-1 space-y-1">
                      {analysis.compliance_warnings.map((warning, idx) => (
                        <li key={idx}>{warning.warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Summary */}
              {analysis.summary && (
                <div className="bg-gradient-to-r from-indigo-50 to-navy-50 p-3 rounded border border-indigo-200">
                  <p className="text-xs text-indigo-900">{analysis.summary}</p>
                </div>
              )}
            </>
          ) : (
            <Button size="sm" onClick={analyzeImpact} className="w-full">
              <Calculator className="w-4 h-4 mr-2" />
              Analyze PDGM Impact
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}