import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Lock,
  FileWarning,
  RefreshCw,
  Sparkles
} from "lucide-react";

export default function MandatoryComplianceGate({
  noteText,
  careType = "home_health",
  visitType = "routine_visit",
  diagnosis,
  vitalSigns,
  onCompliancePassed,
  onInsertFix
}) {
  const ai = useAICall();
  const [complianceResult, setComplianceResult] = useState(null);
  const [acknowledgedIssues, setAcknowledgedIssues] = useState([]);
  const [overrideReason, setOverrideReason] = useState("");
  const [isOverriding, setIsOverriding] = useState(false);

  const checkCompliance = async () => {
    if (!noteText || noteText.trim().length < 50) {
      setComplianceResult({
        passed: false,
        critical_issues: [{ 
          id: 'note_length',
          issue: 'Note is too short',
          requirement: 'Clinical notes must contain sufficient detail for Medicare compliance',
          fix: 'Please add more clinical detail to your note.'
        }],
        warnings: [],
        score: 0
      });
      return;
    }


    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a STRICT Medicare compliance auditor for ${careType === 'hospice' ? 'Hospice' : 'Home Health'} nursing documentation. Your job is to BLOCK non-compliant notes from being finalized.

VISIT TYPE: ${visitType}
DIAGNOSIS: ${diagnosis || 'Not specified'}
VITAL SIGNS PROVIDED: ${vitalSigns ? 'Yes' : 'No'}

CLINICAL NOTE TO AUDIT:
${noteText}

MANDATORY REQUIREMENTS - These MUST be present or the note FAILS:

${careType === 'home_health' ? `
HOME HEALTH MANDATORY ELEMENTS:
1. HOMEBOUND STATUS - Must explicitly state why patient is homebound (taxing effort, medical restriction, etc.)
2. SKILLED NEED - Must document why RN skill/judgment is required (not just medication setup)
3. VITAL SIGNS - Must include relevant vital signs with interpretation
4. PATIENT RESPONSE - Must document patient/caregiver response to teaching/interventions
5. PLAN FOR NEXT VISIT - Must include plan/goals for next visit
` : `
HOSPICE MANDATORY ELEMENTS:
1. DISEASE PROGRESSION - Evidence of terminal prognosis decline
2. SYMPTOM MANAGEMENT - Pain/symptom assessment with intervention
3. COMFORT MEASURES - Focus on quality of life, not curative treatment
4. PATIENT/FAMILY COPING - Emotional and spiritual support documented
5. GOALS OF CARE - Confirmation of comfort-focused care
`}

ADDITIONAL REQUIREMENTS FOR ${visitType.toUpperCase().replace('_', ' ')}:
${visitType === 'admission' ? '- Complete head-to-toe assessment\n- Medication reconciliation\n- Emergency contacts documented' : ''}
${visitType === 'recertification' ? '- Continued homebound status\n- Ongoing skilled need justification\n- Progress toward goals' : ''}
${visitType === 'discharge' ? '- Goals met or reason for discharge\n- Patient education on self-care\n- Follow-up instructions' : ''}

Analyze the note and identify:
1. CRITICAL ISSUES (note CANNOT be finalized until fixed)
2. WARNINGS (should fix but can proceed with acknowledgment)
3. Suggestions for improvement

Return JSON:
{
  "passed": false if any critical issues exist,
  "score": 0-100 compliance score,
  "critical_issues": [
    {
      "id": "unique_id",
      "issue": "what is missing/wrong",
      "requirement": "the specific Medicare requirement",
      "fix": "suggested text to add",
      "location": "where in note to add"
    }
  ],
  "warnings": [
    {
      "id": "unique_id", 
      "issue": "concern",
      "recommendation": "how to improve"
    }
  ],
  "compliant_elements": ["list of elements that ARE compliant"],
  "overall_assessment": "summary of compliance status"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            passed: { type: "boolean" },
            score: { type: "number" },
            critical_issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  issue: { type: "string" },
                  requirement: { type: "string" },
                  fix: { type: "string" },
                  location: { type: "string" }
                }
              }
            },
            warnings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  issue: { type: "string" },
                  recommendation: { type: "string" }
                }
              }
            },
            compliant_elements: { type: "array", items: { type: "string" } },
            overall_assessment: { type: "string" }
          }
        }
      });

      // Only treat an EXPLICIT passing result as a pass. A missing/false/failed
      // result keeps the gate blocked (we never call onCompliancePassed).
      const passed = result?.passed === true
        && (!Array.isArray(result?.critical_issues) || result.critical_issues.length === 0);
      setComplianceResult({ ...result, passed });

      if (passed) {
        onCompliancePassed && onCompliancePassed(true);
      }

    } catch (error) {
      console.error("Error checking compliance:", error);
      // The check could not be completed — do NOT pass. Surface a blocked state so
      // the note is not finalized on a silent failure.
      setComplianceResult({
        passed: false,
        score: 0,
        overall_assessment: 'Compliance check could not be completed. The note is blocked until the check succeeds or is explicitly overridden.',
        critical_issues: [],
        warnings: [],
      });
      toast.error('Compliance check failed to run. The note remains blocked.');
    }

  };

  const handleInsertFix = (fix) => {
    onInsertFix && onInsertFix(fix);
  };

  const toggleAcknowledge = (issueId) => {
    setAcknowledgedIssues(prev =>
      prev.includes(issueId)
        ? prev.filter(id => id !== issueId)
        : [...prev, issueId]
    );
  };

  const canOverride = () => {
    // Can only override if all warnings are acknowledged and there's a reason
    const allWarningsAcknowledged = complianceResult?.warnings?.every(w => 
      acknowledgedIssues.includes(w.id)
    );
    return allWarningsAcknowledged && overrideReason.length >= 20;
  };

  const handleOverride = async () => {
    if (!canOverride() || isOverriding) return;
    setIsOverriding(true);
    try {
      // Persist a durable audit record of the override BEFORE allowing the note
      // through. logSecurityEvent fires the SecurityLog write without awaiting
      // it, so it resolves even when the write fails — we must write the audit
      // row directly and await it so a SecurityLog/RLS/network failure throws
      // and the note stays blocked.
      const user = await base44.auth.me().catch(() => null);
      await base44.entities.SecurityLog.create({
        timestamp: new Date().toISOString(),
        user_email: user?.email || null,
        user_role: user?.role || null,
        action: 'COMPLIANCE_GATE_OVERRIDDEN',
        details: {
          care_type: careType,
          visit_type: visitType,
          diagnosis: diagnosis || null,
          compliance_score: complianceResult?.score ?? null,
          override_reason: overrideReason,
          acknowledged_warning_ids: acknowledgedIssues,
          warning_count: complianceResult?.warnings?.length || 0,
        },
        ip_address: 'client-side',
        user_agent: navigator.userAgent,
      });

      onCompliancePassed && onCompliancePassed(true, { overridden: true, reason: overrideReason });
    } catch (error) {
      console.error('Failed to record compliance override:', error);
      toast.error('Could not record the override. The note remains blocked until the override is logged.');
    } finally {
      setIsOverriding(false);
    }
  };

  const getScoreColor = (score) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <Card className="border-2 border-red-200">
      <CardHeader className="py-3 bg-gradient-to-r from-red-50 to-orange-50">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="w-4 h-4 text-red-600" />
          Mandatory Compliance Check
          {complianceResult?.passed && (
            <Badge className="bg-green-500 text-white ml-auto">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Passed
            </Badge>
          )}
          {complianceResult && !complianceResult.passed && (
            <Badge className="bg-red-500 text-white ml-auto">
              <XCircle className="w-3 h-3 mr-1" />
              Blocked
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {!complianceResult ? (
          <div className="text-center py-4">
            <Lock className="w-12 h-12 mx-auto mb-3 text-red-300" />
            <p className="text-sm text-slate-600 mb-3">
              Notes must pass compliance check before finalization
            </p>
            <Button
              onClick={checkCompliance}
              disabled={ai.loading || !noteText}
              className="bg-red-600 hover:bg-red-700"
            >
              {ai.loading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Checking Compliance...
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4 mr-2" />
                  Run Compliance Check
                </>
              )}
            </Button>
          </div>
        ) : (
          <>
            {/* Score Display */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Compliance Score:</span>
              <span className={`text-2xl font-bold ${getScoreColor(complianceResult.score)}`}>
                {complianceResult.score}%
              </span>
            </div>

            {/* Overall Assessment */}
            <Alert className={complianceResult.passed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}>
              {complianceResult.passed ? (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-600" />
              )}
              <AlertDescription className={complianceResult.passed ? 'text-green-900' : 'text-red-900'}>
                {complianceResult.overall_assessment}
              </AlertDescription>
            </Alert>

            {/* Critical Issues - MUST FIX */}
            {complianceResult.critical_issues?.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-red-700 flex items-center gap-1">
                  <XCircle className="w-4 h-4" />
                  Critical Issues (Must Fix):
                </p>
                {complianceResult.critical_issues.map((issue) => (
                  <div key={issue.id} className="p-3 bg-red-50 rounded-lg border border-red-200">
                    <p className="font-medium text-red-900 text-sm">{issue.issue}</p>
                    <p className="text-xs text-red-700 mt-1">
                      <strong>Requirement:</strong> {issue.requirement}
                    </p>
                    {issue.fix && (
                      <div className="mt-2 flex items-start gap-2">
                        <div className="flex-1 bg-white p-2 rounded text-xs text-slate-700 border">
                          <strong>Suggested Fix:</strong> {issue.fix}
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleInsertFix(issue.fix)}
                          className="bg-red-600 hover:bg-red-700 text-xs"
                        >
                          <Sparkles className="w-3 h-3 mr-1" />
                          Insert
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Warnings - Should Fix */}
            {complianceResult.warnings?.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-yellow-700 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" />
                  Warnings (Acknowledge to Continue):
                </p>
                {complianceResult.warnings.map((warning) => (
                  <div key={warning.id} className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        checked={acknowledgedIssues.includes(warning.id)}
                        onCheckedChange={() => toggleAcknowledge(warning.id)}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <p className="font-medium text-yellow-900 text-sm">{warning.issue}</p>
                        <p className="text-xs text-yellow-700 mt-1">{warning.recommendation}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Compliant Elements */}
            {complianceResult.compliant_elements?.length > 0 && (
              <div className="bg-green-50 p-3 rounded-lg">
                <p className="text-xs font-semibold text-green-800 mb-1">✓ Compliant Elements:</p>
                <div className="flex flex-wrap gap-1">
                  {complianceResult.compliant_elements.map((element, idx) => (
                    <Badge key={idx} className="bg-green-100 text-green-800 text-xs">
                      {element}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Override Section (only for warnings, not critical) */}
            {!complianceResult.passed && complianceResult.critical_issues?.length === 0 && (
              <div className="border-t pt-4 mt-4">
                <p className="text-sm font-medium text-slate-700 mb-2">
                  Override with Justification:
                </p>
                <Textarea
                  placeholder="Provide clinical justification for proceeding without fixing warnings (min 20 characters)..."
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  rows={2}
                  className="mb-2"
                />
                <Button
                  onClick={handleOverride}
                  disabled={!canOverride() || isOverriding}
                  variant="outline"
                  className="w-full"
                >
                  <FileWarning className="w-4 h-4 mr-2" />
                  {isOverriding
                    ? 'Recording override...'
                    : `Override & Continue (${acknowledgedIssues.length}/${complianceResult.warnings?.length || 0} acknowledged)`}
                </Button>
              </div>
            )}

            {/* Re-check Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={checkCompliance}
              disabled={ai.loading}
              className="w-full"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${ai.loading ? 'animate-spin' : ''}`} />
              Re-check Compliance
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}