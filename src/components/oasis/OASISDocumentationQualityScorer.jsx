import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Award,
  FileCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  BookOpen,
  Target,
  Info,
  Lightbulb,
  Scale
} from "lucide-react";

const SCORING_CRITERIA = {
  completeness: {
    name: "Completeness",
    description: "All required OASIS items are documented with values",
    icon: FileCheck,
    color: "blue",
    weight: 0.30,
    subcriteria: [
      "All M-items have documented values",
      "Patient demographics are complete",
      "Clinical assessments are fully captured",
      "Functional status items are all scored",
      "Discharge planning elements present"
    ]
  },
  clarity: {
    name: "Clarity & Specificity",
    description: "Documentation is clear, specific, and measurable",
    icon: BookOpen,
    color: "purple",
    weight: 0.25,
    subcriteria: [
      "Objective measurements included",
      "Timeframes and frequencies documented",
      "Patient responses clearly described",
      "Terminology is precise and clinical",
      "Narratives support M-item scores"
    ]
  },
  compliance: {
    name: "CMS Compliance",
    description: "Adheres to CMS OASIS-E guidelines and regulations",
    icon: Scale,
    color: "green",
    weight: 0.25,
    subcriteria: [
      "Scoring follows CMS definitions",
      "Assessment timeframes met",
      "Skilled need is justified",
      "Homebound status documented",
      "M-item interdependencies consistent"
    ]
  },
  accuracy: {
    name: "Scoring Accuracy",
    description: "M-item scores match clinical narrative evidence",
    icon: Target,
    color: "orange",
    weight: 0.20,
    subcriteria: [
      "Functional scores match descriptions",
      "Clinical findings support diagnoses",
      "Risk assessments align with data",
      "No internal contradictions",
      "PDGM grouping is appropriate"
    ]
  }
};

export default function OASISDocumentationQualityScorer({ analysisResults, pdgmData, onQualityScoreComplete }) {
  const ai = useAICall();
  const [qualityScore, setQualityScore] = useState(null);
  const [error, setError] = useState(null);

  const runQualityScoring = async () => {
    if (!analysisResults) return;

    setError(null);

    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert OASIS-E documentation quality auditor. Analyze this OASIS assessment and score its documentation quality across 4 criteria.

OASIS ANALYSIS DATA:
${JSON.stringify({
  overall_score: analysisResults.overall_score,
  accuracy_score: analysisResults.accuracy_score,
  compliance_score: analysisResults.compliance_score,
  pdgm_data: pdgmData,
  accuracy_issues: analysisResults.accuracy_issues?.slice(0, 10),
  compliance_concerns: analysisResults.compliance_concerns?.slice(0, 10),
  documentation_improvements: analysisResults.documentation_improvements?.slice(0, 10),
  validation_summary: analysisResults.validation_summary,
  extracted_items: analysisResults.extracted_items
}, null, 2)}

SCORING CRITERIA (score each 0-100):

1. COMPLETENESS (30% weight): Are all required OASIS items documented?
   - All M-items have documented values
   - Patient demographics complete
   - Clinical assessments fully captured
   - Functional status items all scored
   - Discharge planning elements present

2. CLARITY & SPECIFICITY (25% weight): Is documentation clear and measurable?
   - Objective measurements included
   - Timeframes and frequencies documented
   - Patient responses clearly described
   - Terminology is precise and clinical
   - Narratives support M-item scores

3. CMS COMPLIANCE (25% weight): Does it follow CMS OASIS-E guidelines?
   - Scoring follows CMS definitions
   - Assessment timeframes met
   - Skilled need is justified
   - Homebound status documented
   - M-item interdependencies consistent

4. SCORING ACCURACY (20% weight): Do scores match clinical evidence?
   - Functional scores match descriptions
   - Clinical findings support diagnoses
   - Risk assessments align with data
   - No internal contradictions
   - PDGM grouping is appropriate

For each criterion, provide:
- Score (0-100)
- Subcriteria scores (array of 5 scores, 0-100 each)
- Key findings (what was done well)
- Critical gaps (what needs improvement)
- Specific recommendations with exact documentation text to add

Also identify:
- Top 3 areas needing SIGNIFICANT improvement (priority fixes)
- Overall quality grade (A/B/C/D/F)
- Estimated audit risk level based on documentation quality

Return JSON:
{
  "overall_quality_score": 0-100,
  "overall_grade": "A/B/C/D/F",
  "audit_risk_level": "low/medium/high/critical",
  "audit_risk_explanation": "why this risk level",
  "criteria_scores": {
    "completeness": {
      "score": 0-100,
      "subcriteria_scores": [0-100, 0-100, 0-100, 0-100, 0-100],
      "findings": ["list of positive findings"],
      "gaps": ["list of gaps found"],
      "recommendations": [{"issue": "specific issue", "fix": "exact text or action to add", "impact": "high/medium/low"}]
    },
    "clarity": { same structure },
    "compliance": { same structure },
    "accuracy": { same structure }
  },
  "priority_improvements": [
    {
      "area": "area name",
      "severity": "critical/high/medium",
      "current_state": "what's wrong",
      "required_action": "what to do",
      "example_text": "exact documentation text to add",
      "cms_reference": "relevant CMS guideline"
    }
  ],
  "strengths": ["top 3 documentation strengths"],
  "summary": "2-3 sentence overall assessment"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_quality_score: { type: "number" },
            overall_grade: { type: "string" },
            audit_risk_level: { type: "string" },
            audit_risk_explanation: { type: "string" },
            criteria_scores: { type: "object" },
            priority_improvements: { type: "array", items: { type: "object" } },
            strengths: { type: "array", items: { type: "string" } },
            summary: { type: "string" }
          }
        }
      });

      setQualityScore(result);
      
      // Notify parent of quality score completion
      if (onQualityScoreComplete) {
        onQualityScoreComplete(result);
      }
    } catch (err) {
      console.error("Quality scoring error:", err);
      setError("Failed to analyze documentation quality. Please try again.");
    }

  };

  const getGradeColor = (grade) => {
    const colors = {
      'A': 'bg-green-500',
      'B': 'bg-blue-500',
      'C': 'bg-yellow-500',
      'D': 'bg-orange-500',
      'F': 'bg-red-500'
    };
    return colors[grade] || 'bg-slate-500';
  };

  const getScoreColor = (score) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    if (score >= 40) return 'text-orange-600';
    return 'text-red-600';
  };

  const getScoreBg = (score) => {
    if (score >= 80) return 'bg-green-100 border-green-300';
    if (score >= 60) return 'bg-yellow-100 border-yellow-300';
    if (score >= 40) return 'bg-orange-100 border-orange-300';
    return 'bg-red-100 border-red-300';
  };

  const getRiskBadge = (level) => {
    const styles = {
      low: 'bg-green-100 text-green-800',
      medium: 'bg-yellow-100 text-yellow-800',
      high: 'bg-orange-100 text-orange-800',
      critical: 'bg-red-100 text-red-800'
    };
    return styles[level] || styles.medium;
  };

  const getCriteriaColor = (color) => {
    const colors = {
      blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', progress: 'bg-blue-500' },
      purple: { bg: 'bg-navy-50', border: 'border-navy-200', text: 'text-navy-700', progress: 'bg-navy-500' },
      green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', progress: 'bg-green-500' },
      orange: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', progress: 'bg-orange-500' }
    };
    return colors[color] || colors.blue;
  };

  if (!analysisResults) return null;

  return (
    <Card className="border-2 border-indigo-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-indigo-50 to-navy-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-indigo-600" />
            AI Documentation Quality Scorer
          </div>
          {qualityScore && (
            <div className="flex items-center gap-2">
              <Badge className={getRiskBadge(qualityScore.audit_risk_level)}>
                {qualityScore.audit_risk_level} audit risk
              </Badge>
              <div className={`w-10 h-10 rounded-full ${getGradeColor(qualityScore.overall_grade)} flex items-center justify-center text-white font-bold text-lg`}>
                {qualityScore.overall_grade}
              </div>
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {!qualityScore ? (
          <>
            <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-indigo-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-indigo-900">AI-Powered Quality Analysis</p>
                  <p className="text-xs text-indigo-700 mt-1">
                    Evaluates your OASIS documentation across 4 key criteria: Completeness, Clarity, 
                    CMS Compliance, and Scoring Accuracy. Provides specific recommendations for improvement.
                  </p>
                </div>
              </div>
            </div>

            {/* Scoring Criteria Preview */}
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(SCORING_CRITERIA).map(([key, criteria]) => {
                const Icon = criteria.icon;
                const colors = getCriteriaColor(criteria.color);
                return (
                  <div key={key} className={`p-3 rounded-lg border ${colors.bg} ${colors.border}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`w-4 h-4 ${colors.text}`} />
                      <span className={`text-sm font-medium ${colors.text}`}>{criteria.name}</span>
                      <Badge variant="outline" className="text-xs ml-auto">{criteria.weight * 100}%</Badge>
                    </div>
                    <p className="text-xs text-slate-600">{criteria.description}</p>
                  </div>
                );
              })}
            </div>

            <Button
              onClick={runQualityScoring}
              disabled={ai.loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              {ai.loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing Documentation Quality...</>
              ) : (
                <><Award className="w-4 h-4 mr-2" /> Score Documentation Quality</>
              )}
            </Button>
          </>
        ) : (
          <>
            {/* Overall Score Display */}
            <div className={`p-4 rounded-lg border-2 ${getScoreBg(qualityScore.overall_quality_score)}`}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs text-slate-600">Overall Documentation Quality</p>
                  <p className={`text-3xl font-bold ${getScoreColor(qualityScore.overall_quality_score)}`}>
                    {qualityScore.overall_quality_score}%
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Audit Risk</p>
                  <Badge className={`${getRiskBadge(qualityScore.audit_risk_level)} text-sm`}>
                    {qualityScore.audit_risk_level?.toUpperCase()}
                  </Badge>
                </div>
              </div>
              <Progress value={qualityScore.overall_quality_score} className="h-3" />
              <p className="text-xs text-slate-600 mt-2">{qualityScore.audit_risk_explanation}</p>
            </div>

            {/* Summary */}
            <div className="bg-slate-50 p-3 rounded-lg border">
              <p className="text-sm text-slate-800">{qualityScore.summary}</p>
            </div>

            {/* Criteria Breakdown */}
            <Accordion type="multiple" className="space-y-2">
              {Object.entries(SCORING_CRITERIA).map(([key, criteria]) => {
                const scoreData = qualityScore.criteria_scores?.[key];
                if (!scoreData) return null;

                const Icon = criteria.icon;
                const colors = getCriteriaColor(criteria.color);

                return (
                  <AccordionItem key={key} value={key} className="border rounded-lg overflow-hidden">
                    <AccordionTrigger className={`px-4 py-3 hover:no-underline ${colors.bg}`}>
                      <div className="flex items-center justify-between w-full pr-4">
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${colors.text}`} />
                          <span className={`font-medium ${colors.text}`}>{criteria.name}</span>
                          <Badge variant="outline" className="text-xs">{criteria.weight * 100}% weight</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-lg font-bold ${getScoreColor(scoreData.score)}`}>
                            {scoreData.score}%
                          </span>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4 pt-2">
                      {/* Subcriteria Scores */}
                      <div className="space-y-2 mb-4">
                        <p className="text-xs font-semibold text-slate-500 uppercase">Subcriteria Scores</p>
                        {criteria.subcriteria.map((sub, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm">
                            <span className="text-slate-700">{sub}</span>
                            <div className="flex items-center gap-2">
                              <Progress 
                                value={scoreData.subcriteria_scores?.[idx] || 0} 
                                className="w-20 h-2" 
                              />
                              <span className={`font-medium w-10 text-right ${getScoreColor(scoreData.subcriteria_scores?.[idx] || 0)}`}>
                                {scoreData.subcriteria_scores?.[idx] || 0}%
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Findings */}
                      {scoreData.findings?.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-green-700 mb-1 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Positive Findings
                          </p>
                          <ul className="text-xs text-slate-700 space-y-1">
                            {scoreData.findings.map((f, i) => (
                              <li key={i} className="flex items-start gap-1">
                                <span className="text-green-500">✓</span> {f}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Gaps */}
                      {scoreData.gaps?.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-red-700 mb-1 flex items-center gap-1">
                            <XCircle className="w-3 h-3" /> Gaps Identified
                          </p>
                          <ul className="text-xs text-slate-700 space-y-1">
                            {scoreData.gaps.map((g, i) => (
                              <li key={i} className="flex items-start gap-1">
                                <span className="text-red-500">✗</span> {g}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Recommendations */}
                      {scoreData.recommendations?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-blue-700 mb-1 flex items-center gap-1">
                            <Lightbulb className="w-3 h-3" /> Recommendations
                          </p>
                          <div className="space-y-2">
                            {scoreData.recommendations.map((rec, i) => (
                              <div key={i} className="bg-blue-50 p-2 rounded border border-blue-200 text-xs">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="font-medium text-blue-900">{rec.issue}</span>
                                  <Badge className={rec.impact === 'high' ? 'bg-red-100 text-red-700' : rec.impact === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}>
                                    {rec.impact} impact
                                  </Badge>
                                </div>
                                <p className="text-blue-800 bg-white p-1.5 rounded border mt-1 italic">
                                  "{rec.fix}"
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>

            {/* Priority Improvements */}
            {qualityScore.priority_improvements?.length > 0 && (
              <div className="bg-red-50 p-4 rounded-lg border-2 border-red-200">
                <h3 className="font-semibold text-red-900 mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Priority Improvements Required
                </h3>
                <div className="space-y-3">
                  {qualityScore.priority_improvements.map((imp, idx) => (
                    <div key={idx} className="bg-white p-3 rounded-lg border border-red-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-red-900">{imp.area}</span>
                        <Badge className={imp.severity === 'critical' ? 'bg-red-600 text-white' : imp.severity === 'high' ? 'bg-orange-500 text-white' : 'bg-yellow-500 text-white'}>
                          {imp.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-700 mb-2">{imp.current_state}</p>
                      <div className="bg-green-50 p-2 rounded border border-green-200 mb-2">
                        <p className="text-xs font-medium text-green-800">Required Action:</p>
                        <p className="text-sm text-green-900">{imp.required_action}</p>
                      </div>
                      {imp.example_text && (
                        <div className="bg-blue-50 p-2 rounded border border-blue-200 mb-2">
                          <p className="text-xs font-medium text-blue-800">Example Documentation:</p>
                          <p className="text-sm text-blue-900 italic">"{imp.example_text}"</p>
                        </div>
                      )}
                      {imp.cms_reference && (
                        <p className="text-xs text-slate-500">CMS Reference: {imp.cms_reference}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Strengths */}
            {qualityScore.strengths?.length > 0 && (
              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <h3 className="font-semibold text-green-900 mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Documentation Strengths
                </h3>
                <ul className="space-y-1">
                  {qualityScore.strengths.map((s, i) => (
                    <li key={i} className="text-sm text-green-800 flex items-center gap-2">
                      <span className="text-green-600">★</span> {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Re-score Button */}
            <Button
              onClick={() => setQualityScore(null)}
              variant="outline"
              size="sm"
              className="w-full"
            >
              Run New Quality Assessment
            </Button>
          </>
        )}

        {error && (
          <div className="bg-red-50 p-3 rounded-lg border border-red-200 text-sm text-red-800">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}