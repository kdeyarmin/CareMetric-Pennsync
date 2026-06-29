import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Sparkles,
  FileText,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  Scale
} from "lucide-react";

export default function AIAuditReportAssistant({ audit, onUpdateFindings, onAddRecommendations }) {
  const ai = useAICall();
  const [aiFindings, setAiFindings] = useState(null);
  const [copied, setCopied] = useState(false);

  const generateAuditFindings = async () => {
    if (!audit) return;

    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert home health OASIS auditor. Generate comprehensive audit findings and recommendations for this flagged OASIS document.

AUDIT DATA:
- Patient: ${audit.patient_name}
- Flag Reason: ${audit.flag_reason}
- Scores: Overall ${audit.overall_score}%, Accuracy ${audit.accuracy_score}%, Compliance ${audit.compliance_score}%
- Estimated Revenue Impact: $${audit.estimated_revenue_impact || 0}

KEY ISSUES:
${JSON.stringify(audit.key_issues, null, 2)}

RESCORE OPPORTUNITIES:
${JSON.stringify(audit.rescore_opportunities, null, 2)}

Generate:
1. Professional audit findings summary
2. Specific documentation deficiencies with citations
3. Corrective action recommendations
4. Staff education needs
5. Process improvement suggestions

Return JSON:
{
  "executive_summary": "Brief summary for leadership",
  "findings_narrative": "Detailed professional audit findings suitable for official report",
  "documentation_deficiencies": [
    {
      "area": "Specific area",
      "deficiency": "What's wrong",
      "cms_citation": "Relevant CMS guidance",
      "correction_needed": "What needs to be corrected"
    }
  ],
  "corrective_actions": [
    {
      "action": "Specific action",
      "responsible_party": "Who should do this",
      "deadline": "When (immediate, 7 days, 30 days)",
      "expected_outcome": "What this will achieve"
    }
  ],
  "staff_education_needs": ["Training topic 1", "Training topic 2"],
  "process_improvements": [
    {
      "current_process": "What's happening now",
      "recommended_change": "What should change",
      "expected_benefit": "Why this helps"
    }
  ],
  "risk_mitigation": "Steps to prevent future occurrences",
  "follow_up_audit_recommendation": "When to re-audit"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            executive_summary: { type: "string" },
            findings_narrative: { type: "string" },
            documentation_deficiencies: { type: "array", items: { type: "object" } },
            corrective_actions: { type: "array", items: { type: "object" } },
            staff_education_needs: { type: "array", items: { type: "string" } },
            process_improvements: { type: "array", items: { type: "object" } },
            risk_mitigation: { type: "string" },
            follow_up_audit_recommendation: { type: "string" }
          }
        }
      });

      setAiFindings(result);
    } catch (error) {
      console.error("Error generating audit findings:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUseFindings = () => {
    if (aiFindings?.findings_narrative && onUpdateFindings) {
      onUpdateFindings(aiFindings.findings_narrative);
    }
    if (aiFindings?.corrective_actions && onAddRecommendations) {
      const recs = aiFindings.corrective_actions.map(a => a.action);
      onAddRecommendations(recs);
    }
  };

  return (
    <Card className="border-2 border-indigo-200">
      <CardHeader className="pb-2 bg-gradient-to-r from-indigo-50 to-navy-50">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-600" />
          AI Audit Report Assistant
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-3 space-y-3">
        {!aiFindings ? (
          <div className="text-center py-4">
            <p className="text-sm text-slate-600 mb-3">
              Generate AI-powered audit findings and recommendations
            </p>
            <Button onClick={generateAuditFindings} disabled={ai.loading}>
              {ai.loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Generate Findings</>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Executive Summary */}
            <div className="bg-blue-50 p-2 rounded border border-blue-200">
              <p className="text-xs font-semibold text-blue-700 mb-1">Executive Summary</p>
              <p className="text-sm text-blue-900">{aiFindings.executive_summary}</p>
            </div>

            {/* Findings Narrative */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs font-semibold">Audit Findings</Label>
                <Button 
                  size="sm" 
                  variant="ghost" 
                  onClick={() => handleCopy(aiFindings.findings_narrative)}
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                </Button>
              </div>
              <div className="bg-slate-50 p-2 rounded border text-sm max-h-32 overflow-y-auto">
                {aiFindings.findings_narrative}
              </div>
            </div>

            {/* Corrective Actions */}
            {aiFindings.corrective_actions?.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-1">Corrective Actions</p>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {aiFindings.corrective_actions.slice(0, 3).map((action, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs bg-green-50 p-1 rounded">
                      <Badge className="bg-green-600 text-white text-[10px]">{action.deadline}</Badge>
                      <span className="text-green-800">{action.action}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Staff Education */}
            {aiFindings.staff_education_needs?.length > 0 && (
              <div className="bg-amber-50 p-2 rounded border border-amber-200">
                <p className="text-xs font-semibold text-amber-700 mb-1">Staff Education Needs</p>
                <div className="flex flex-wrap gap-1">
                  {aiFindings.staff_education_needs.map((need, idx) => (
                    <Badge key={idx} variant="outline" className="text-[10px]">{need}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Follow-up */}
            <p className="text-xs text-slate-600 italic">
              <Scale className="w-3 h-3 inline mr-1" />
              {aiFindings.follow_up_audit_recommendation}
            </p>

            <div className="flex gap-2">
              <Button 
                size="sm" 
                onClick={handleUseFindings}
                className="flex-1"
              >
                <FileText className="w-3 h-3 mr-1" /> Use These Findings
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={generateAuditFindings}
              >
                <RefreshCw className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}