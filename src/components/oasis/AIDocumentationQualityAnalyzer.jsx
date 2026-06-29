import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  FileEdit,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  BookOpen,
  Target,
  PenTool,
  Loader2,
  Brain,
  AlertCircle,
  Copy,
  DollarSign,
  Shield,
  FileText,
  Stethoscope,
  Activity,
  ChevronRight
} from "lucide-react";

// Example narratives for common clinical scenarios
const EXAMPLE_NARRATIVES = {
  functional_bathing: {
    scenario: "Patient requires moderate assistance with bathing (M1830 = 3)",
    weak: "Patient needs help with bathing.",
    strong: "Patient requires hands-on assistance from caregiver to safely transfer into shower stall and maintain balance while seated on shower chair. Patient can wash upper body independently but requires caregiver to wash lower extremities and back due to limited trunk rotation and inability to safely reach below knees without loss of balance. Cognitive impairment results in sequencing difficulties - patient forgets steps in bathing routine and requires verbal cueing throughout. Skin integrity assessment completed during bathing with no new areas of breakdown noted.",
    keyElements: ["Specific assistance type", "Safety concerns documented", "What patient CAN do independently", "Reason for limitation", "Clinical observations"]
  },
  functional_ambulation: {
    scenario: "Patient ambulates with rolling walker requiring supervision (M1860 = 2)",
    weak: "Patient uses walker to walk.",
    strong: "Patient ambulates with rolling walker on level surfaces for distances up to 50 feet before requiring seated rest due to dyspnea and fatigue. Gait is shuffling with decreased step height, presenting fall risk. Requires standby assistance for safety due to impaired balance and tendency to forget to use walker brake. Patient ambulated from bedroom to kitchen (approximately 30 feet) during visit with one verbal cue to maintain upright posture. O2 saturation dropped from 96% to 91% with ambulation, recovering to 94% after 2 minutes rest.",
    keyElements: ["Distance capability", "Equipment used", "Safety rationale", "Specific observations", "Objective measurements"]
  },
  functional_transfer: {
    scenario: "Patient needs minimal assistance with transfers (M1850 = 2)",
    weak: "Patient can transfer with a little help.",
    strong: "Patient requires minimal physical assistance (steadying hand at elbow) and verbal cueing to complete bed-to-chair transfers. Patient is able to bear full weight on bilateral lower extremities but demonstrates poor trunk control when moving from sitting to standing. Transfer takes approximately 45 seconds with one attempt. Patient reports right hip pain (4/10) immediately after transfer which subsides within 2 minutes. Hospital bed with side rails and bedside commode positioned to optimize transfer safety.",
    keyElements: ["Level of assistance quantified", "Weight-bearing status", "Time required", "Pain assessment", "Equipment/environment"]
  },
  diagnosis_chf: {
    scenario: "CHF exacerbation requiring skilled nursing",
    weak: "Patient has CHF and needs monitoring.",
    strong: "Patient with Class III CHF (EF 35%) presents with 4lb weight gain over past 3 days, 2+ bilateral pedal edema, and increased dyspnea with minimal exertion. Lungs with bibasilar crackles extending to mid-lung fields bilaterally. Patient reports sleeping in recliner for past 2 nights due to orthopnea. Current medications include Lasix 40mg BID, Lisinopril 10mg daily, Carvedilol 6.25mg BID. Skilled nursing required for assessment of cardiopulmonary status, medication management, patient education on daily weights, sodium restriction, and recognition of worsening symptoms. MD notified of findings - verbal order received to increase Lasix to 60mg BID x 3 days with follow-up weight check.",
    keyElements: ["Objective clinical findings", "Baseline comparison", "Medication list", "Skilled intervention rationale", "MD communication documented"]
  },
  diagnosis_diabetes: {
    scenario: "Diabetes management with wound care",
    weak: "Diabetic patient with foot wound.",
    strong: "Patient with Type 2 DM (A1c 9.2% per 10/15 labs) presents with 2cm x 1.5cm x 0.3cm wound to right plantar surface, Wagner Grade 2. Wound bed 80% granulation, 20% slough, moderate serous drainage. Periwound skin intact, no signs of infection. Pedal pulses 1+ bilaterally, capillary refill 4 seconds. Current blood glucose log shows fasting range 180-240mg/dL. Patient demonstrates difficulty reaching foot for daily inspection due to obesity (BMI 38) and limited hip flexion. Skilled nursing required for wound assessment, debridement as indicated, dressing changes, and diabetes education including glucose monitoring technique, medication adherence, and signs of wound complications. Patient instructed on importance of offloading and daily foot inspection using mirror.",
    keyElements: ["Wound measurements", "Wound bed description", "Vascular assessment", "Glycemic control data", "Patient limitations", "Education provided"]
  },
  homebound_status: {
    scenario: "Documenting homebound status",
    weak: "Patient is homebound due to illness.",
    strong: "Patient meets homebound criteria due to: (1) Severe dyspnea with exertion - requires supplemental O2 at 3L/min continuously and desaturates to 85% with minimal activity; (2) Requires maximum assistance of one person plus rolling walker for all ambulation due to generalized weakness (4/5 strength bilateral lower extremities) following recent hospitalization for pneumonia; (3) Leaving home requires considerable and taxing effort as evidenced by patient's reported need to rest for 2+ hours after any outing. Patient leaves home only for medical appointments (1-2x monthly) with transport assistance from family member. Normal inability to leave home verified.",
    keyElements: ["Specific qualifying criteria", "Objective measurements", "Effort required documented", "Frequency of leaving home", "Type of assistance needed"]
  }
};

export default function AIDocumentationQualityAnalyzer({ analysisResults, pdgmData }) {
  const ai = useAICall();
  const [qualityAnalysis, setQualityAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("analysis");
  const [copiedExample, setCopiedExample] = useState(null);

  const runQualityAnalysis = useCallback(async () => {
    if (!analysisResults) return;

    setError(null);

    try {
      // Build context from analysis results
      const narrativeContext = {
        primary_diagnosis: pdgmData?.primary_diagnosis || analysisResults.pdgm_data?.primary_diagnosis,
        comorbidities: pdgmData?.comorbidities || analysisResults.pdgm_data?.comorbidities || [],
        functional_scores: pdgmData?.functional_scores || analysisResults.pdgm_data?.functional_scores || {},
        accuracy_issues: analysisResults.accuracy_issues || [],
        documentation_improvements: analysisResults.documentation_improvements || [],
        validation_issues: analysisResults.validation_summary?.issues || [],
        revenue_tips: analysisResults.revenue_tips || [],
        overall_score: analysisResults.overall_score,
        accuracy_score: analysisResults.accuracy_score,
        compliance_score: analysisResults.compliance_score
      };

      const response = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert OASIS documentation reviewer and home health compliance specialist. Analyze the following OASIS assessment data for documentation quality, focusing on narrative clarity, completeness, and consistency with coded data.

OASIS DATA CONTEXT:
${JSON.stringify(narrativeContext, null, 2)}

Perform a comprehensive documentation quality analysis:

1. NARRATIVE ANALYSIS: For each functional score (M1800-M1860), analyze whether the supporting narrative:
   - Provides specific, measurable descriptions
   - Explains WHY the patient needs the level of assistance scored
   - Includes safety concerns and clinical rationale
   - Is consistent with the numeric score assigned

2. DIAGNOSIS-NARRATIVE ALIGNMENT: Check if narratives support:
   - The primary diagnosis and its manifestations
   - Comorbidities and their impact on function
   - Skilled care necessity

3. DOCUMENTATION GAPS: Identify missing elements that could:
   - Lead to claim denials
   - Trigger audit findings
   - Reduce PDGM payment
   - Create compliance risk

4. IMPROVEMENT SUGGESTIONS: Provide specific, actionable suggestions for each gap

Return JSON:
{
  "overall_quality_score": 0-100,
  "clarity_score": 0-100,
  "completeness_score": 0-100,
  "consistency_score": 0-100,
  "summary": "Brief overall assessment",
  "narrative_analysis": [
    {
      "oasis_item": "M1800-M1860 item code",
      "current_score": "numeric score",
      "narrative_quality": "strong/adequate/weak/missing",
      "clarity_rating": 1-5,
      "issues": ["list of specific issues"],
      "improvement_suggestion": "specific suggestion",
      "example_narrative": "example of strong supporting narrative for this score level",
      "risk_level": "high/medium/low"
    }
  ],
  "diagnosis_alignment": [
    {
      "diagnosis": "diagnosis name",
      "documentation_support": "strong/adequate/weak",
      "gaps": ["missing documentation elements"],
      "suggestion": "how to improve",
      "skilled_need_supported": true/false
    }
  ],
  "documentation_gaps": [
    {
      "gap_type": "narrative/specificity/consistency/completeness",
      "area": "affected area",
      "description": "what is missing",
      "risk": "payment/audit/compliance",
      "severity": "critical/high/medium/low",
      "fix": "specific action to address"
    }
  ],
  "payment_risk_factors": [
    {
      "factor": "risk description",
      "potential_impact": "$X per episode or percentage",
      "documentation_needed": "what to document"
    }
  ],
  "audit_vulnerabilities": [
    {
      "vulnerability": "description",
      "common_auditor_focus": "why auditors look for this",
      "protective_documentation": "what to include"
    }
  ],
  "top_priorities": ["list of 3-5 most critical improvements needed"]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_quality_score: { type: "number" },
            clarity_score: { type: "number" },
            completeness_score: { type: "number" },
            consistency_score: { type: "number" },
            summary: { type: "string" },
            narrative_analysis: { type: "array", items: { type: "object" } },
            diagnosis_alignment: { type: "array", items: { type: "object" } },
            documentation_gaps: { type: "array", items: { type: "object" } },
            payment_risk_factors: { type: "array", items: { type: "object" } },
            audit_vulnerabilities: { type: "array", items: { type: "object" } },
            top_priorities: { type: "array", items: { type: "string" } }
          }
        }
      });

      setQualityAnalysis(response);
    } catch (err) {
      console.error("Quality analysis error:", err);
      setError("Failed to analyze documentation quality. Please try again.");
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [analysisResults, pdgmData]);

  // Auto-analyze when results are available
  useEffect(() => {
    if (analysisResults && !qualityAnalysis && !ai.loading) {
      runQualityAnalysis();
    }
  }, [analysisResults, qualityAnalysis, ai.loading, runQualityAnalysis]);

  const copyToClipboard = (text, exampleKey) => {
    navigator.clipboard.writeText(text);
    setCopiedExample(exampleKey);
    setTimeout(() => setCopiedExample(null), 2000);
  };

  const getScoreColor = (score) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBg = (score) => {
    if (score >= 80) return "bg-green-100 border-green-300";
    if (score >= 60) return "bg-yellow-100 border-yellow-300";
    return "bg-red-100 border-red-300";
  };

  const getSeverityBadge = (severity) => {
    const styles = {
      critical: 'bg-red-600 text-white',
      high: 'bg-red-100 text-red-800',
      medium: 'bg-yellow-100 text-yellow-800',
      low: 'bg-blue-100 text-blue-800'
    };
    return styles[severity] || 'bg-slate-100 text-slate-800';
  };

  const getQualityBadge = (quality) => {
    const styles = {
      strong: 'bg-green-100 text-green-800',
      adequate: 'bg-blue-100 text-blue-800',
      weak: 'bg-yellow-100 text-yellow-800',
      missing: 'bg-red-100 text-red-800'
    };
    return styles[quality] || 'bg-slate-100 text-slate-800';
  };

  if (!analysisResults) return null;

  return (
    <Card className="border-2 border-indigo-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-indigo-50 to-navy-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-600" />
            AI Documentation Quality Analyzer
          </div>
          {qualityAnalysis && (
            <Badge className={`${getScoreBg(qualityAnalysis.overall_quality_score)}`}>
              Quality: {qualityAnalysis.overall_quality_score}%
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {ai.loading ? (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto mb-3" />
            <p className="text-sm text-slate-600">Analyzing documentation quality...</p>
            <p className="text-xs text-slate-400 mt-1">Checking narratives, consistency, and compliance</p>
          </div>
        ) : !qualityAnalysis ? (
          <div className="text-center py-6">
            <Button onClick={runQualityAnalysis} className="bg-indigo-600 hover:bg-indigo-700">
              <Brain className="w-4 h-4 mr-2" /> Analyze Documentation Quality
            </Button>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="analysis" className="text-xs">
                <FileEdit className="w-3 h-3 mr-1" /> Analysis
              </TabsTrigger>
              <TabsTrigger value="gaps" className="text-xs">
                <AlertTriangle className="w-3 h-3 mr-1" /> Gaps
              </TabsTrigger>
              <TabsTrigger value="risks" className="text-xs">
                <Shield className="w-3 h-3 mr-1" /> Risks
              </TabsTrigger>
              <TabsTrigger value="examples" className="text-xs">
                <BookOpen className="w-3 h-3 mr-1" /> Examples
              </TabsTrigger>
            </TabsList>

            {/* Analysis Tab */}
            <TabsContent value="analysis" className="mt-4 space-y-4">
              {/* Score Overview */}
              <div className="grid grid-cols-4 gap-3">
                <div className={`p-3 rounded-lg border-2 text-center ${getScoreBg(qualityAnalysis.overall_quality_score)}`}>
                  <p className="text-xs text-slate-600 mb-1">Overall</p>
                  <p className={`text-2xl font-bold ${getScoreColor(qualityAnalysis.overall_quality_score)}`}>
                    {qualityAnalysis.overall_quality_score}%
                  </p>
                </div>
                <div className={`p-3 rounded-lg border-2 text-center ${getScoreBg(qualityAnalysis.clarity_score)}`}>
                  <p className="text-xs text-slate-600 mb-1">Clarity</p>
                  <p className={`text-2xl font-bold ${getScoreColor(qualityAnalysis.clarity_score)}`}>
                    {qualityAnalysis.clarity_score}%
                  </p>
                </div>
                <div className={`p-3 rounded-lg border-2 text-center ${getScoreBg(qualityAnalysis.completeness_score)}`}>
                  <p className="text-xs text-slate-600 mb-1">Complete</p>
                  <p className={`text-2xl font-bold ${getScoreColor(qualityAnalysis.completeness_score)}`}>
                    {qualityAnalysis.completeness_score}%
                  </p>
                </div>
                <div className={`p-3 rounded-lg border-2 text-center ${getScoreBg(qualityAnalysis.consistency_score)}`}>
                  <p className="text-xs text-slate-600 mb-1">Consistency</p>
                  <p className={`text-2xl font-bold ${getScoreColor(qualityAnalysis.consistency_score)}`}>
                    {qualityAnalysis.consistency_score}%
                  </p>
                </div>
              </div>

              {/* Summary */}
              <Alert className="bg-indigo-50 border-indigo-200">
                <Brain className="w-4 h-4 text-indigo-600" />
                <AlertDescription className="text-indigo-800 text-sm">
                  {qualityAnalysis.summary}
                </AlertDescription>
              </Alert>

              {/* Top Priorities */}
              {qualityAnalysis.top_priorities?.length > 0 && (
                <div className="bg-gradient-to-r from-red-50 to-orange-50 p-4 rounded-lg border border-red-200">
                  <p className="text-sm font-semibold text-red-900 mb-3 flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    Top Priorities
                  </p>
                  <ol className="space-y-2">
                    {qualityAnalysis.top_priorities.map((priority, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-red-800">
                        <span className="bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">
                          {idx + 1}
                        </span>
                        {priority}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Narrative Analysis */}
              {qualityAnalysis.narrative_analysis?.length > 0 && (
                <Accordion type="single" collapsible>
                  <AccordionItem value="narratives" className="border rounded-lg">
                    <AccordionTrigger className="px-4 hover:no-underline">
                      <div className="flex items-center gap-2">
                        <PenTool className="w-4 h-4 text-blue-600" />
                        <span>Narrative Quality by Item ({qualityAnalysis.narrative_analysis.length})</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <div className="space-y-3">
                        {qualityAnalysis.narrative_analysis.map((item, idx) => (
                          <div key={idx} className="p-3 bg-slate-50 rounded-lg border">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="font-mono">{item.oasis_item}</Badge>
                                <span className="text-xs text-slate-500">Score: {item.current_score}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge className={getQualityBadge(item.narrative_quality)}>
                                  {item.narrative_quality}
                                </Badge>
                                {item.risk_level && (
                                  <Badge className={getSeverityBadge(item.risk_level)}>
                                    {item.risk_level} risk
                                  </Badge>
                                )}
                              </div>
                            </div>
                            
                            {item.issues?.length > 0 && (
                              <div className="mb-2">
                                <p className="text-xs text-slate-500 mb-1">Issues:</p>
                                <ul className="text-xs text-slate-700 list-disc list-inside">
                                  {item.issues.map((issue, i) => (
                                    <li key={i}>{issue}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {item.improvement_suggestion && (
                              <div className="p-2 bg-green-50 rounded border border-green-200 mb-2">
                                <p className="text-xs font-medium text-green-800 flex items-center gap-1">
                                  <Lightbulb className="w-3 h-3" /> Improvement:
                                </p>
                                <p className="text-xs text-green-700">{item.improvement_suggestion}</p>
                              </div>
                            )}

                            {item.example_narrative && (
                              <div className="p-2 bg-blue-50 rounded border border-blue-200">
                                <p className="text-xs font-medium text-blue-800 flex items-center gap-1">
                                  <FileText className="w-3 h-3" /> Example Narrative:
                                </p>
                                <p className="text-xs text-blue-700 italic">{item.example_narrative}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}

              {/* Diagnosis Alignment */}
              {qualityAnalysis.diagnosis_alignment?.length > 0 && (
                <Accordion type="single" collapsible>
                  <AccordionItem value="diagnosis" className="border rounded-lg">
                    <AccordionTrigger className="px-4 hover:no-underline">
                      <div className="flex items-center gap-2">
                        <Stethoscope className="w-4 h-4 text-navy-600" />
                        <span>Diagnosis-Narrative Alignment ({qualityAnalysis.diagnosis_alignment.length})</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <div className="space-y-3">
                        {qualityAnalysis.diagnosis_alignment.map((item, idx) => (
                          <div key={idx} className="p-3 bg-slate-50 rounded-lg border">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium">{item.diagnosis}</span>
                              <div className="flex items-center gap-2">
                                <Badge className={getQualityBadge(item.documentation_support)}>
                                  {item.documentation_support}
                                </Badge>
                                {item.skilled_need_supported !== undefined && (
                                  <Badge className={item.skilled_need_supported ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                                    {item.skilled_need_supported ? 'Skilled Need ✓' : 'Skilled Need ?'}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            
                            {item.gaps?.length > 0 && (
                              <div className="mb-2">
                                <p className="text-xs text-red-600 font-medium">Missing Elements:</p>
                                <ul className="text-xs text-red-700 list-disc list-inside">
                                  {item.gaps.map((gap, i) => (
                                    <li key={i}>{gap}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {item.suggestion && (
                              <div className="p-2 bg-green-50 rounded border border-green-200">
                                <p className="text-xs text-green-700">
                                  <span className="font-medium">Suggestion:</span> {item.suggestion}
                                </p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
            </TabsContent>

            {/* Gaps Tab */}
            <TabsContent value="gaps" className="mt-4 space-y-3">
              {qualityAnalysis.documentation_gaps?.length > 0 ? (
                qualityAnalysis.documentation_gaps.map((gap, idx) => (
                  <div key={idx} className="p-4 bg-white rounded-lg border hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="capitalize">{gap.gap_type}</Badge>
                        <span className="text-sm font-medium">{gap.area}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={getSeverityBadge(gap.severity)}>{gap.severity}</Badge>
                        <Badge variant="outline" className="text-xs">
                          {gap.risk} risk
                        </Badge>
                      </div>
                    </div>
                    <p className="text-sm text-slate-700 mb-3">{gap.description}</p>
                    <div className="p-2 bg-green-50 rounded border border-green-200">
                      <p className="text-xs font-medium text-green-800 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> How to Fix:
                      </p>
                      <p className="text-xs text-green-700">{gap.fix}</p>
                    </div>
                  </div>
                ))
              ) : (
                <Alert className="bg-green-50 border-green-200">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <AlertDescription className="text-green-800">
                    No significant documentation gaps identified.
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>

            {/* Risks Tab */}
            <TabsContent value="risks" className="mt-4 space-y-4">
              {/* Payment Risk Factors */}
              {qualityAnalysis.payment_risk_factors?.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-green-600" />
                    Payment Risk Factors
                  </p>
                  {qualityAnalysis.payment_risk_factors.map((risk, idx) => (
                    <div key={idx} className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                      <div className="flex items-start justify-between mb-2">
                        <span className="text-sm font-medium text-yellow-900">{risk.factor}</span>
                        <Badge className="bg-yellow-200 text-yellow-800">{risk.potential_impact}</Badge>
                      </div>
                      <p className="text-xs text-yellow-800">
                        <span className="font-medium">Document:</span> {risk.documentation_needed}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Audit Vulnerabilities */}
              {qualityAnalysis.audit_vulnerabilities?.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-red-600" />
                    Audit Vulnerabilities
                  </p>
                  {qualityAnalysis.audit_vulnerabilities.map((vuln, idx) => (
                    <div key={idx} className="p-3 bg-red-50 rounded-lg border border-red-200">
                      <p className="text-sm font-medium text-red-900 mb-2">{vuln.vulnerability}</p>
                      <div className="space-y-2 text-xs">
                        <p className="text-red-700">
                          <span className="font-medium">Auditors look for:</span> {vuln.common_auditor_focus}
                        </p>
                        <div className="p-2 bg-white rounded border border-red-100">
                          <p className="font-medium text-green-800">Protective Documentation:</p>
                          <p className="text-green-700">{vuln.protective_documentation}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(!qualityAnalysis.payment_risk_factors?.length && !qualityAnalysis.audit_vulnerabilities?.length) && (
                <Alert className="bg-green-50 border-green-200">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <AlertDescription className="text-green-800">
                    No significant payment or audit risks identified.
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>

            {/* Examples Tab */}
            <TabsContent value="examples" className="mt-4 space-y-4">
              <Alert className="bg-blue-50 border-blue-200">
                <BookOpen className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-800 text-sm">
                  Reference these example narratives to improve your documentation quality. Strong narratives support accurate scoring and reduce audit risk.
                </AlertDescription>
              </Alert>

              <Accordion type="single" collapsible className="space-y-2">
                {Object.entries(EXAMPLE_NARRATIVES).map(([key, example]) => (
                  <AccordionItem key={key} value={key} className="border rounded-lg">
                    <AccordionTrigger className="px-4 hover:no-underline">
                      <div className="flex items-center gap-2 text-left">
                        <Activity className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                        <span className="text-sm">{example.scenario}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <div className="space-y-4">
                        {/* Weak Example */}
                        <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold text-red-800">❌ Weak Narrative</p>
                          </div>
                          <p className="text-sm text-red-700 italic">"{example.weak}"</p>
                        </div>

                        {/* Strong Example */}
                        <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold text-green-800">✓ Strong Narrative</p>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs"
                              onClick={() => copyToClipboard(example.strong, key)}
                            >
                              {copiedExample === key ? (
                                <><CheckCircle2 className="w-3 h-3 mr-1" /> Copied</>
                              ) : (
                                <><Copy className="w-3 h-3 mr-1" /> Copy</>
                              )}
                            </Button>
                          </div>
                          <p className="text-sm text-green-700">{example.strong}</p>
                        </div>

                        {/* Key Elements */}
                        <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                          <p className="text-xs font-semibold text-blue-800 mb-2">Key Elements Included:</p>
                          <div className="flex flex-wrap gap-1">
                            {example.keyElements.map((element, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs bg-white">
                                <ChevronRight className="w-3 h-3 mr-1" />
                                {element}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </TabsContent>
          </Tabs>
        )}

        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        {/* Re-analyze Button */}
        {qualityAnalysis && (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={runQualityAnalysis}
            disabled={ai.loading}
            className="w-full"
          >
            {ai.loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Brain className="w-4 h-4 mr-1" />}
            Re-analyze Documentation Quality
          </Button>
        )}
      </CardContent>
    </Card>
  );
}