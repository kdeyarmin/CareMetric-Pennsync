import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  AlertTriangle, 
  CheckCircle2, 
  FileText, 
  Shield, 
  DollarSign,
  Eye,
  Sparkles,
  Copy,
  XCircle,
  AlertCircle
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { toast } from 'sonner';

export default function RealTimeDocumentationReviewer({ 
  noteContent, 
  noteType = "soap", // soap, admission, discharge, etc.
  patientData,
  _onApplySuggestion,
  autoAnalyze = false
}) {
  const ai = useAICall();
  const [analysis, setAnalysis] = useState(null);
  const [_complianceScore, setComplianceScore] = useState(0);

  const analyzeDocumentation = useCallback(async () => {
    if (!noteContent || noteContent.length < 50) {
      toast.error("Please provide sufficient note content for analysis");
      return;
    }


    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert Medicare compliance auditor and clinical documentation specialist with 20+ years of experience reviewing home health nursing documentation.

Analyze the following nursing note for completeness, accuracy, Medicare/OASIS compliance, and PDGM optimization:

NOTE TYPE: ${noteType}
PATIENT DATA: ${JSON.stringify(patientData || {}, null, 2)}

NOTE CONTENT:
${noteContent}

Provide a comprehensive analysis with the following:

**COMPLIANCE ISSUES (Critical - must be addressed):**
Identify Medicare compliance gaps:
- Missing homebound justification or weak documentation
- Insufficient skilled need documentation
- Missing vital signs or assessment data
- Vague or non-specific language
- Missing safety assessments
- Inadequate pain documentation
- Missing medication reconciliation
Each issue should include:
- severity: "critical", "high", or "medium"
- section: which part of note (e.g., "Objective", "Assessment")
- issue: clear description of the problem
- suggestion: specific fix with example language
- why_it_matters: compliance/reimbursement impact

**COMPLETENESS GAPS:**
Missing elements that strengthen documentation:
- Vital signs trends or comparisons to baseline
- Specific functional measurements (distance ambulated, assistance level)
- Patient/caregiver response to teaching
- Medication adherence assessment
- Fall risk assessment details
- Wound measurements if applicable
Each gap should include:
- category: "assessment", "intervention", "education", "safety"
- missing_element: what's missing
- suggested_addition: specific content to add
- impact: how it improves documentation

**CLARITY & SPECIFICITY IMPROVEMENTS:**
Vague statements that need detail:
- Identify phrases like "appears to be", "seems", "doing well"
- Non-specific measurements ("some", "a little", "moderate")
- Missing objective data
Each improvement should include:
- vague_statement: the unclear phrase
- location_hint: where it appears in note
- improved_version: specific, measurable alternative
- why_better: why this is clearer

**PDGM OPTIMIZATION:**
Opportunities to improve case mix/reimbursement:
- Comorbidities that should be documented more clearly
- Functional limitations needing detailed documentation
- Skilled interventions to emphasize
- Clinical complexity indicators to highlight
Each opportunity should include:
- area: "diagnosis", "functional", "comorbidity", "clinical_complexity"
- current_documentation: what's currently stated
- enhanced_documentation: improved version
- pdgm_impact: how it affects case mix/reimbursement

**OASIS ALIGNMENT:**
Note elements that support or conflict with OASIS coding:
- Functional status consistency
- ADL documentation alignment
- Cognitive status documentation
- Safety/fall risk alignment
Each alignment check should include:
- oasis_item: relevant OASIS item (e.g., M1860, M1400)
- note_statement: what the note says
- alignment_status: "supports", "conflicts", "unclear"
- recommendation: how to improve alignment

**OVERALL SCORES:**
- compliance_score: 0-100 (100 = fully compliant)
- completeness_score: 0-100
- clarity_score: 0-100
- pdgm_optimization_score: 0-100

**QUICK WINS:**
3-5 highest priority changes that will make the biggest impact:
- priority: 1-5 (1 = most important)
- quick_fix: specific actionable change
- impact: what it improves

**POSITIVE ELEMENTS:**
What's documented well (to reinforce good practices):
- strength: what's done well
- example: specific phrase from note

Be thorough, specific, and actionable. Provide actual example text for suggestions.`,
        response_json_schema: {
          type: "object",
          properties: {
            compliance_issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  severity: { type: "string" },
                  section: { type: "string" },
                  issue: { type: "string" },
                  suggestion: { type: "string" },
                  why_it_matters: { type: "string" }
                }
              }
            },
            completeness_gaps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  missing_element: { type: "string" },
                  suggested_addition: { type: "string" },
                  impact: { type: "string" }
                }
              }
            },
            clarity_improvements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  vague_statement: { type: "string" },
                  location_hint: { type: "string" },
                  improved_version: { type: "string" },
                  why_better: { type: "string" }
                }
              }
            },
            pdgm_optimization: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  current_documentation: { type: "string" },
                  enhanced_documentation: { type: "string" },
                  pdgm_impact: { type: "string" }
                }
              }
            },
            oasis_alignment: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  oasis_item: { type: "string" },
                  note_statement: { type: "string" },
                  alignment_status: { type: "string" },
                  recommendation: { type: "string" }
                }
              }
            },
            scores: {
              type: "object",
              properties: {
                compliance_score: { type: "number" },
                completeness_score: { type: "number" },
                clarity_score: { type: "number" },
                pdgm_optimization_score: { type: "number" }
              }
            },
            quick_wins: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  priority: { type: "number" },
                  quick_fix: { type: "string" },
                  impact: { type: "string" }
                }
              }
            },
            positive_elements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  strength: { type: "string" },
                  example: { type: "string" }
                }
              }
            }
          }
        }
      });

      setAnalysis(result);
      setComplianceScore(result.scores?.compliance_score || 0);
    } catch (error) {
      console.error('Error analyzing documentation:', error);
      toast.error('Failed to analyze documentation. Please try again.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [noteContent, noteType, patientData]);

  useEffect(() => {
    if (autoAnalyze && noteContent && noteContent.length > 50) {
      const debounceTimer = setTimeout(() => {
        analyzeDocumentation();
      }, 2000);
      return () => clearTimeout(debounceTimer);
    }
  }, [noteContent, autoAnalyze, analyzeDocumentation]);

  const getSeverityColor = (severity) => {
    const colors = {
      critical: "bg-red-100 text-red-800 border-red-300",
      high: "bg-orange-100 text-orange-800 border-orange-300",
      medium: "bg-yellow-100 text-yellow-800 border-yellow-300"
    };
    return colors[severity] || colors.medium;
  };

  const getScoreColor = (score) => {
    if (score >= 90) return "text-green-600";
    if (score >= 75) return "text-blue-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const copySuggestion = (text) => {
    navigator.clipboard.writeText(text);
  };

  if (ai.loading) {
    return (
      <Card className="border-2 border-blue-300">
        <CardContent className="p-6 text-center">
          <Sparkles className="w-8 h-8 text-blue-600 mx-auto mb-3 animate-pulse" />
          <p className="text-sm font-medium text-slate-700">Analyzing documentation...</p>
          <p className="text-xs text-slate-500 mt-1">Checking compliance, completeness, and clarity</p>
        </CardContent>
      </Card>
    );
  }

  if (!analysis) {
    return (
      <Card className="border-2 border-blue-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-blue-600" />
            Real-Time Documentation Review
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600 mb-4">
            Get instant AI-powered analysis of your documentation for compliance, completeness, and PDGM optimization.
          </p>
          <Button onClick={analyzeDocumentation} className="bg-blue-600 hover:bg-blue-700">
            <Sparkles className="w-4 h-4 mr-2" />
            Analyze Documentation
          </Button>
        </CardContent>
      </Card>
    );
  }

  const scores = analysis.scores || {};
  // Default each sub-score to 0 — if the AI omits one, the bare sum/avg renders
  // "NaN%". (These fields aren't required in the LLM schema.)
  const avgScore = Math.round(
    ((scores.compliance_score || 0) + (scores.completeness_score || 0) +
     (scores.clarity_score || 0) + (scores.pdgm_optimization_score || 0)) / 4
  );

  return (
    <div className="space-y-4">
      {/* Overall Score Card */}
      <Card className="border-2 border-blue-300">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-blue-600" />
              Documentation Quality Analysis
            </CardTitle>
            <Badge className={`text-lg px-3 py-1 ${avgScore >= 85 ? 'bg-green-100 text-green-800' : avgScore >= 70 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
              {avgScore}%
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <p className="text-xs text-slate-600 mb-1">Compliance</p>
              <div className="flex items-center gap-2">
                <Progress value={scores.compliance_score} className="flex-1" />
                <span className={`text-sm font-bold ${getScoreColor(scores.compliance_score)}`}>
                  {scores.compliance_score}%
                </span>
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-600 mb-1">Completeness</p>
              <div className="flex items-center gap-2">
                <Progress value={scores.completeness_score} className="flex-1" />
                <span className={`text-sm font-bold ${getScoreColor(scores.completeness_score)}`}>
                  {scores.completeness_score}%
                </span>
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-600 mb-1">Clarity</p>
              <div className="flex items-center gap-2">
                <Progress value={scores.clarity_score} className="flex-1" />
                <span className={`text-sm font-bold ${getScoreColor(scores.clarity_score)}`}>
                  {scores.clarity_score}%
                </span>
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-600 mb-1">PDGM</p>
              <div className="flex items-center gap-2">
                <Progress value={scores.pdgm_optimization_score} className="flex-1" />
                <span className={`text-sm font-bold ${getScoreColor(scores.pdgm_optimization_score)}`}>
                  {scores.pdgm_optimization_score}%
                </span>
              </div>
            </div>
          </div>

          <Button size="sm" variant="outline" onClick={analyzeDocumentation}>
            <Sparkles className="w-4 h-4 mr-1" />
            Re-analyze
          </Button>
        </CardContent>
      </Card>

      {/* Quick Wins */}
      {analysis.quick_wins?.length > 0 && (
        <Card className="border-2 border-navy-300 bg-navy-50">
          <CardHeader>
            <CardTitle className="text-navy-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              Quick Wins - Highest Impact Changes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {analysis.quick_wins.slice(0, 5).map((win, index) => (
                <div key={index} className="bg-white p-3 rounded-lg border border-navy-200">
                  <div className="flex items-start gap-2">
                    <Badge className="bg-navy-600 text-white">{win.priority}</Badge>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-900">{win.quick_fix}</p>
                      <p className="text-xs text-slate-600 mt-1">{win.impact}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Compliance Issues */}
      {analysis.compliance_issues?.length > 0 && (
        <Card className="border-2 border-red-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-900">
              <Shield className="w-5 h-5" />
              Compliance Issues ({analysis.compliance_issues.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="space-y-2">
              {analysis.compliance_issues.map((issue, index) => (
                <AccordionItem key={index} value={`compliance-${index}`} className="border rounded-lg">
                  <AccordionTrigger className="px-3 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <Badge className={getSeverityColor(issue.severity)}>
                        {issue.severity}
                      </Badge>
                      <span className="font-medium text-sm text-left">{issue.section}: {issue.issue}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3">
                    <div className="space-y-3">
                      <Alert className="bg-red-50 border-red-200">
                        <AlertTriangle className="w-4 h-4 text-red-600" />
                        <AlertDescription className="text-sm text-red-900">
                          {issue.why_it_matters}
                        </AlertDescription>
                      </Alert>
                      <div className="bg-green-50 p-3 rounded border border-green-200">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-xs font-semibold text-green-900">Suggested Fix:</p>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => copySuggestion(issue.suggestion)}
                            className="h-6 px-2"
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                        <p className="text-sm text-slate-900">{issue.suggestion}</p>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {/* Completeness Gaps */}
      {analysis.completeness_gaps?.length > 0 && (
        <Card className="border-2 border-orange-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-900">
              <FileText className="w-5 h-5" />
              Completeness Gaps ({analysis.completeness_gaps.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="space-y-2">
              {analysis.completeness_gaps.map((gap, index) => (
                <AccordionItem key={index} value={`gap-${index}`} className="border rounded-lg">
                  <AccordionTrigger className="px-3 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-orange-50 text-orange-800 border-orange-300">
                        {gap.category}
                      </Badge>
                      <span className="font-medium text-sm text-left">{gap.missing_element}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3">
                    <div className="space-y-2">
                      <div className="bg-blue-50 p-3 rounded border border-blue-200">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-xs font-semibold text-blue-900">Add This:</p>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => copySuggestion(gap.suggested_addition)}
                            className="h-6 px-2"
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                        <p className="text-sm text-slate-900">{gap.suggested_addition}</p>
                      </div>
                      <p className="text-xs text-slate-600 italic">{gap.impact}</p>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {/* Clarity Improvements */}
      {analysis.clarity_improvements?.length > 0 && (
        <Card className="border-2 border-yellow-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-900">
              <AlertCircle className="w-5 h-5" />
              Clarity & Specificity ({analysis.clarity_improvements.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {analysis.clarity_improvements.map((item, index) => (
                <div key={index} className="bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs font-semibold text-yellow-900 mb-1">Vague:</p>
                      <p className="text-sm text-slate-700 line-through">"{item.vague_statement}"</p>
                      <p className="text-xs text-slate-500 mt-1">{item.location_hint}</p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-semibold text-green-900">Better:</p>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => copySuggestion(item.improved_version)}
                          className="h-6 px-2"
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                      <p className="text-sm text-slate-900 font-medium">"{item.improved_version}"</p>
                      <p className="text-xs text-slate-600 mt-1 italic">{item.why_better}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* PDGM Optimization */}
      {analysis.pdgm_optimization?.length > 0 && (
        <Card className="border-2 border-green-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-900">
              <DollarSign className="w-5 h-5" />
              PDGM Optimization ({analysis.pdgm_optimization.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="space-y-2">
              {analysis.pdgm_optimization.map((item, index) => (
                <AccordionItem key={index} value={`pdgm-${index}`} className="border rounded-lg">
                  <AccordionTrigger className="px-3 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-green-100 text-green-800 border-green-300">
                        {item.area}
                      </Badge>
                      <span className="font-medium text-sm text-left">Enhancement Opportunity</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3">
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-slate-700 mb-1">Current:</p>
                        <p className="text-sm text-slate-600 bg-slate-50 p-2 rounded">{item.current_documentation}</p>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-semibold text-green-900">Enhanced:</p>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => copySuggestion(item.enhanced_documentation)}
                            className="h-6 px-2"
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                        <p className="text-sm text-slate-900 bg-green-50 p-2 rounded border border-green-200">
                          {item.enhanced_documentation}
                        </p>
                      </div>
                      <Alert className="bg-blue-50 border-blue-200">
                        <DollarSign className="w-4 h-4 text-blue-600" />
                        <AlertDescription className="text-xs text-blue-900">
                          {item.pdgm_impact}
                        </AlertDescription>
                      </Alert>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {/* OASIS Alignment */}
      {analysis.oasis_alignment?.length > 0 && (
        <Card className="border-2 border-indigo-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-indigo-900">
              <CheckCircle2 className="w-5 h-5" />
              OASIS Alignment ({analysis.oasis_alignment.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {analysis.oasis_alignment.map((item, index) => (
                <div key={index} className="p-3 rounded-lg border" style={{
                  backgroundColor: item.alignment_status === 'supports' ? '#f0fdf4' : item.alignment_status === 'conflicts' ? '#fef2f2' : '#fffbeb',
                  borderColor: item.alignment_status === 'supports' ? '#86efac' : item.alignment_status === 'conflicts' ? '#fca5a5' : '#fde047'
                }}>
                  <div className="flex items-start gap-2">
                    {item.alignment_status === 'supports' ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                    ) : item.alignment_status === 'conflicts' ? (
                      <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">{item.oasis_item}</Badge>
                        <Badge className={
                          item.alignment_status === 'supports' ? 'bg-green-100 text-green-800' :
                          item.alignment_status === 'conflicts' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }>
                          {item.alignment_status}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-700 mb-1">"{item.note_statement}"</p>
                      <p className="text-xs text-slate-600 italic">{item.recommendation}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Positive Elements */}
      {analysis.positive_elements?.length > 0 && (
        <Card className="border-2 border-emerald-300 bg-emerald-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-900">
              <CheckCircle2 className="w-5 h-5" />
              Well-Documented Elements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {analysis.positive_elements.map((item, index) => (
                <div key={index} className="bg-white p-3 rounded border border-emerald-200">
                  <p className="text-sm font-medium text-slate-900 mb-1">✓ {item.strength}</p>
                  <p className="text-xs text-slate-600 italic">"{item.example}"</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}