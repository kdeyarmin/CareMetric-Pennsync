import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FileDown,
  Loader2,
  CheckCircle2,
  Plus,
  Trash2
} from "lucide-react";
import { format } from "date-fns";
import AIAuditReportAssistant from "./AIAuditReportAssistant";

export default function OASISAuditReportGenerator({ audit, isOpen, onClose, currentUser }) {
  const ai = useAICall();
  const [reportGenerated, setReportGenerated] = useState(false);
  const [additionalFindings, setAdditionalFindings] = useState("");
  const [recommendations, setRecommendations] = useState([""]);
  const [corrections, setCorrections] = useState([]);
  const [includeSections, setIncludeSections] = useState({
    summary: true,
    scores: true,
    issues: true,
    rescoreOpps: true,
    recommendations: true,
    corrections: true
  });

  const queryClient = useQueryClient();

  const updateAuditMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.OASISAudit.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasisAudits'] });
    }
  });

  const addRecommendation = () => {
    setRecommendations([...recommendations, ""]);
  };

  const updateRecommendation = (index, value) => {
    const updated = [...recommendations];
    updated[index] = value;
    setRecommendations(updated);
  };

  const removeRecommendation = (index) => {
    setRecommendations(recommendations.filter((_, i) => i !== index));
  };

  const addCorrection = () => {
    setCorrections([...corrections, { item: "", original: "", corrected: "", rationale: "" }]);
  };

  const updateCorrection = (index, field, value) => {
    const updated = [...corrections];
    updated[index][field] = value;
    setCorrections(updated);
  };

  const removeCorrection = (index) => {
    setCorrections(corrections.filter((_, i) => i !== index));
  };

  const generateReport = async () => {

    try {
      // Build report content
      const reportData = {
        generated_date: new Date().toISOString(),
        auditor: currentUser?.full_name || currentUser?.email,
        patient_name: audit.patient_name,
        flag_reason: audit.flag_reason,
        scores: {
          overall: audit.overall_score,
          accuracy: audit.accuracy_score,
          compliance: audit.compliance_score,
          revenue: audit.revenue_score
        },
        estimated_revenue_impact: audit.estimated_revenue_impact,
        key_issues: audit.key_issues,
        rescore_opportunities: audit.rescore_opportunities,
        auditor_findings: audit.auditor_findings,
        additional_findings: additionalFindings,
        recommendations: recommendations.filter(r => r.trim()),
        corrections: corrections.filter(c => c.item && c.corrected)
      };

      // Generate PDF report using AI
      const reportContent = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Generate a professional OASIS audit report in markdown format based on this data:

${JSON.stringify(reportData, null, 2)}

Create a formal, professional audit report with the following sections (include only sections marked as true):
- Summary: ${includeSections.summary}
- Scores Analysis: ${includeSections.scores}
- Issues Identified: ${includeSections.issues}
- Rescore Opportunities: ${includeSections.rescoreOpps}
- Recommendations: ${includeSections.recommendations}
- Corrections Made: ${includeSections.corrections}

Format as a professional clinical audit report. Include:
1. Header with patient name, date, auditor name
2. Executive summary
3. Detailed findings with severity levels
4. Revenue impact analysis
5. Action items and recommendations
6. Signature line for auditor

Use proper markdown formatting with headers, bullet points, and tables where appropriate.`,
        response_json_schema: {
          type: "object",
          properties: {
            report_markdown: { type: "string" },
            executive_summary: { type: "string" },
            action_items: { type: "array", items: { type: "string" } }
          }
        }
      });

      // Update audit with report data
      await updateAuditMutation.mutateAsync({
        id: audit.id,
        data: {
          report_generated: true,
          auditor_findings: additionalFindings || audit.auditor_findings,
          auditor_recommendations: recommendations.filter(r => r.trim()),
          corrections_made: corrections.filter(c => c.item && c.corrected)
        }
      });

      // Create downloadable report
      const reportText = reportContent.report_markdown || generateFallbackReport(reportData);
      const blob = new Blob([reportText], { type: 'text/markdown' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `OASIS_Audit_Report_${audit.patient_name?.replace(/\s+/g, '_')}_${format(new Date(), 'yyyy-MM-dd')}.md`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      setReportGenerated(true);
    } catch (error) {
      console.error("Error generating report:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }

  };

  const generateFallbackReport = (data) => {
    return `# OASIS Audit Report

## Patient Information
- **Patient Name:** ${data.patient_name}
- **Audit Date:** ${format(new Date(data.generated_date), 'MMMM d, yyyy')}
- **Auditor:** ${data.auditor}
- **Flag Reason:** ${data.flag_reason?.replace(/_/g, ' ')}

## Scores Summary
| Metric | Score | Status |
|--------|-------|--------|
| Overall | ${data.scores.overall}% | ${data.scores.overall >= 70 ? '✓ Pass' : '✗ Needs Review'} |
| Accuracy | ${data.scores.accuracy}% | ${data.scores.accuracy >= 75 ? '✓ Pass' : '✗ Needs Review'} |
| Compliance | ${data.scores.compliance}% | ${data.scores.compliance >= 80 ? '✓ Pass' : '✗ Needs Review'} |

## Estimated Revenue Impact
**$${data.estimated_revenue_impact?.toLocaleString() || 0}** potential recovery

## Key Issues Identified
${data.key_issues?.map(issue => `
### ${issue.item || issue.category}
- **Severity:** ${issue.severity}
- **Issue:** ${issue.issue}
- **Recommendation:** ${issue.recommendation}
`).join('\n') || 'No issues identified.'}

## Rescore Opportunities
${data.rescore_opportunities?.map(opp => `
- **${opp.m_item}:** ${opp.current_score} → ${opp.recommended_score} (${opp.revenue_impact})
`).join('\n') || 'No rescore opportunities.'}

## Auditor Findings
${data.auditor_findings || data.additional_findings || 'No additional findings.'}

## Recommendations
${data.recommendations?.map((rec, i) => `${i + 1}. ${rec}`).join('\n') || 'No recommendations.'}

## Corrections Made
${data.corrections?.map(c => `
- **${c.item}:** ${c.original} → ${c.corrected}
  - Rationale: ${c.rationale}
`).join('\n') || 'No corrections documented.'}

---
**Auditor Signature:** ________________________

**Date:** ${format(new Date(), 'MMMM d, yyyy')}
`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate Audit Report</DialogTitle>
        </DialogHeader>

        {reportGenerated ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <p className="text-lg font-medium text-slate-800">Report Generated Successfully</p>
            <p className="text-sm text-slate-500 mt-2">The report has been downloaded to your device.</p>
            <Button onClick={onClose} className="mt-4">Close</Button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* AI Audit Report Assistant */}
            <AIAuditReportAssistant 
              audit={audit}
              onUpdateFindings={(findings) => setAdditionalFindings(findings)}
              onAddRecommendations={(recs) => setRecommendations(recs)}
            />

            {/* Include Sections */}
            <div>
              <Label className="text-sm font-medium">Include Sections</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {Object.entries(includeSections).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2">
                    <Checkbox
                      checked={value}
                      onCheckedChange={(checked) => 
                        setIncludeSections(prev => ({ ...prev, [key]: checked }))
                      }
                    />
                    <span className="text-sm capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Additional Findings */}
            <div>
              <Label>Additional Auditor Findings</Label>
              <Textarea
                value={additionalFindings}
                onChange={(e) => setAdditionalFindings(e.target.value)}
                placeholder="Enter any additional findings not captured by AI analysis..."
                className="mt-1"
              />
            </div>

            {/* Recommendations */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Recommendations</Label>
                <Button size="sm" variant="outline" onClick={addRecommendation}>
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </div>
              <div className="space-y-2">
                {recommendations.map((rec, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input
                      value={rec}
                      onChange={(e) => updateRecommendation(idx, e.target.value)}
                      placeholder={`Recommendation ${idx + 1}`}
                    />
                    {recommendations.length > 1 && (
                      <Button size="sm" variant="ghost" onClick={() => removeRecommendation(idx)}>
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Corrections Made */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Corrections Made</Label>
                <Button size="sm" variant="outline" onClick={addCorrection}>
                  <Plus className="w-3 h-3 mr-1" /> Add Correction
                </Button>
              </div>
              {corrections.length === 0 ? (
                <p className="text-sm text-slate-500">No corrections documented yet.</p>
              ) : (
                <div className="space-y-3">
                  {corrections.map((corr, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 rounded-lg border space-y-2">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline">Correction {idx + 1}</Badge>
                        <Button size="sm" variant="ghost" onClick={() => removeCorrection(idx)}>
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          value={corr.item}
                          onChange={(e) => updateCorrection(idx, 'item', e.target.value)}
                          placeholder="M-item (e.g., M1830)"
                        />
                        <Input
                          value={corr.original}
                          onChange={(e) => updateCorrection(idx, 'original', e.target.value)}
                          placeholder="Original value"
                        />
                        <Input
                          value={corr.corrected}
                          onChange={(e) => updateCorrection(idx, 'corrected', e.target.value)}
                          placeholder="Corrected value"
                        />
                        <Input
                          value={corr.rationale}
                          onChange={(e) => updateCorrection(idx, 'rationale', e.target.value)}
                          placeholder="Rationale"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Summary Preview */}
            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription className="text-blue-800 text-sm">
                <strong>Report Preview:</strong> {audit.patient_name} | 
                Overall: {audit.overall_score}% | 
                {audit.key_issues?.length || 0} issues | 
                ${audit.estimated_revenue_impact?.toLocaleString() || 0} revenue impact
              </AlertDescription>
            </Alert>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button 
                onClick={generateReport} 
                disabled={ai.loading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {ai.loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
                ) : (
                  <><FileDown className="w-4 h-4 mr-2" /> Generate & Download Report</>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}