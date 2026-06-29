import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Brain,
  Shield,
  Loader2,
  Save,
  TrendingUp
} from "lucide-react";
import { toast } from 'sonner';

export default function AIGroupAssignmentValidator({ 
  oasisData, 
  analysisResults, 
  pdgmData,
  patientId,
  autoValidate = true 
}) {
  const ai = useAICall();
  const [assignment, setAssignment] = useState(null);
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [manualClinicalGroup, setManualClinicalGroup] = useState('');
  const [manualFunctionalLevel, setManualFunctionalLevel] = useState('');

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin';

  const performValidation = useCallback(async () => {
    if (!oasisData || !pdgmData) return;

    try {
      const prompt = `You are a PDGM classification expert. Analyze this OASIS data and assign the patient to the correct PDGM Clinical Group and Functional Impairment Level.

OASIS DATA:
${JSON.stringify(oasisData, null, 2)}

PDGM ANALYSIS:
${JSON.stringify(pdgmData, null, 2)}

ANALYSIS RESULTS:
${JSON.stringify(analysisResults, null, 2)}

PDGM CLASSIFICATION RULES:

CLINICAL GROUPS (Primary diagnosis-based):
1. MS-Rehab (Musculoskeletal Rehabilitation) - M1021/M1023 codes Z47, Z96, M codes
2. Neuro-Rehab (Neurological Rehabilitation) - I60-I69, G codes  
3. Wound (Wounds/Pressure Ulcers) - L89, L97, I70.23, etc.
4. Behavioral Health - F codes (Mental/Behavioral)
5. Complex Nursing - Serious chronic conditions, J44 COPD, I50 Heart Failure
6. MMTA (Medication Management, Teaching, Assessment) - Simpler cases, E11 Diabetes

FUNCTIONAL IMPAIRMENT LEVELS (Based on M1800-M1860 scores):
- Low: 0-5 points
- Medium: 6-13 points  
- High: 14+ points

Functional scoring:
- M1800 Grooming (0-3)
- M1810 Dress Upper (0-3)
- M1820 Dress Lower (0-3)
- M1830 Bathing (0-6)
- M1840 Toilet Transfer (0-4)
- M1850 Transferring (0-5)
- M1860 Ambulation (0-6)

PROVIDE:
1. Correct PDGM Clinical Group with confidence score
2. Correct Functional Impairment Level with confidence score
3. Key OASIS items that drove each assignment
4. Any discrepancies with current assignment
5. Clinical reasoning for the assignments
6. Red flags or concerns requiring supervisor review`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            clinical_group_assignment: {
              type: "object",
              properties: {
                assigned_group: { 
                  type: "string", 
                  enum: ["MS-Rehab", "Neuro-Rehab", "Wound", "Behavioral Health", "Complex Nursing", "MMTA"] 
                },
                confidence_score: { type: "number", description: "0-100" },
                confidence_level: { type: "string", enum: ["high", "medium", "low"] },
                primary_diagnosis_code: { type: "string" },
                key_oasis_inputs: { type: "array", items: { type: "string" } },
                reasoning: { type: "string" },
                alternative_groups_considered: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      group: { type: "string" },
                      why_not_selected: { type: "string" }
                    }
                  }
                }
              }
            },
            functional_level_assignment: {
              type: "object",
              properties: {
                assigned_level: { type: "string", enum: ["low", "medium", "high"] },
                total_points: { type: "number" },
                confidence_score: { type: "number", description: "0-100" },
                confidence_level: { type: "string", enum: ["high", "medium", "low"] },
                key_functional_items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      m_item: { type: "string" },
                      score: { type: "number" },
                      contribution: { type: "string" }
                    }
                  }
                },
                reasoning: { type: "string" }
              }
            },
            discrepancies: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  current_value: { type: "string" },
                  recommended_value: { type: "string" },
                  severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  explanation: { type: "string" }
                }
              }
            },
            red_flags: { type: "array", items: { type: "string" } },
            requires_supervisor_review: { type: "boolean" },
            supervisor_review_reason: { type: "string" },
            overall_assignment_confidence: { type: "string", enum: ["very_high", "high", "moderate", "low"] },
            cms_compliance_notes: { type: "string" }
          }
        }
      });

      setAssignment(result);
    } catch (error) {
      console.error('Group assignment validation error:', error);
      setAssignment({ error: 'Failed to validate group assignment' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [oasisData, pdgmData, analysisResults]);

  useEffect(() => {
    if (autoValidate && oasisData && pdgmData && !assignment) {
      performValidation();
    }
  }, [oasisData, pdgmData, autoValidate, assignment, performValidation]);

  const saveOverrideMutation = useMutation({
    mutationFn: async (overrideData) => {
      return await base44.entities.OASISAudit.create({
        oasis_upload_id: oasisData.id,
        patient_id: patientId,
        reviewed_by: currentUser.email,
        reviewed_at: new Date().toISOString(),
        // 'manual_flag' is the valid flag_reason enum member for a human override;
        // the specific "group assignment override" semantics live in auditor_findings
        // below. (The literal 'group_assignment_override' is not in the enum and was
        // being silently dropped, leaving the audit row's flag_reason empty.)
        flag_reason: 'manual_flag',
        auditor_findings: JSON.stringify({
          original_clinical_group: pdgmData?.clinical_group,
          original_functional_level: pdgmData?.functional_level,
          overridden_clinical_group: overrideData.clinical_group,
          overridden_functional_level: overrideData.functional_level,
          override_reason: overrideData.reason,
          ai_recommendation: assignment
        }),
        status: 'reviewed',
        priority: 'medium'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasisAudits'] });
      setShowOverrideDialog(false);
      toast.success('Group assignment override saved successfully');
    },
  });

  const handleOverride = () => {
    if (!overrideReason.trim()) {
      toast.error('Please provide a reason for the override');
      return;
    }

    saveOverrideMutation.mutate({
      clinical_group: manualClinicalGroup,
      functional_level: manualFunctionalLevel,
      reason: overrideReason
    });
  };

  const openOverrideDialog = () => {
    setManualClinicalGroup(pdgmData?.clinical_group || assignment?.clinical_group_assignment?.assigned_group || '');
    setManualFunctionalLevel(pdgmData?.functional_level || assignment?.functional_level_assignment?.assigned_level || '');
    setShowOverrideDialog(true);
  };

  const getConfidenceColor = (level) => {
    switch (level) {
      case 'very_high':
      case 'high': return 'bg-green-600 text-white';
      case 'medium':
      case 'moderate': return 'bg-yellow-600 text-white';
      case 'low': return 'bg-red-600 text-white';
      default: return 'bg-slate-600 text-white';
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'border-red-600 bg-red-50';
      case 'high': return 'border-orange-500 bg-orange-50';
      case 'medium': return 'border-yellow-500 bg-yellow-50';
      case 'low': return 'border-blue-500 bg-blue-50';
      default: return 'border-slate-500 bg-slate-50';
    }
  };

  if (!oasisData || !pdgmData) return null;

  return (
    <Card className="border-2 border-indigo-400 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-indigo-50 to-navy-50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-indigo-600" />
            AI Group Assignment Validator
          </CardTitle>
          {assignment && !assignment.error && (
            <Badge className={getConfidenceColor(assignment.overall_assignment_confidence)} size="lg">
              {assignment.overall_assignment_confidence?.replace('_', ' ').toUpperCase()} CONFIDENCE
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        {ai.loading && (
          <div className="text-center py-12">
            <Loader2 className="w-16 h-16 animate-spin text-indigo-600 mx-auto mb-4" />
            <p className="text-indigo-700 font-medium">AI analyzing PDGM group assignments...</p>
          </div>
        )}

        {!ai.loading && !assignment && (
          <div className="text-center py-8">
            <Button onClick={performValidation} className="bg-indigo-600 hover:bg-indigo-700">
              <Brain className="w-4 h-4 mr-2" />
              Validate Group Assignments
            </Button>
          </div>
        )}

        {assignment?.error && (
          <Alert className="bg-red-50 border-red-200">
            <XCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">{assignment.error}</AlertDescription>
          </Alert>
        )}

        {assignment && !assignment.error && (
          <div className="space-y-6">
            {/* Supervisor Review Alert */}
            {assignment.requires_supervisor_review && (
              <Alert className="bg-yellow-100 border-yellow-500 border-2">
                <AlertTriangle className="w-5 h-5 text-yellow-700" />
                <AlertDescription>
                  <p className="font-semibold text-yellow-900 mb-2">⚠️ Supervisor Review Required</p>
                  <p className="text-sm text-yellow-800">{assignment.supervisor_review_reason}</p>
                </AlertDescription>
              </Alert>
            )}

            {/* Clinical Group Assignment */}
            <Card className="border-2 border-blue-400">
              <CardHeader className="bg-blue-50 pb-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-blue-600" />
                    Clinical Group Assignment
                  </span>
                  <Badge className={getConfidenceColor(assignment.clinical_group_assignment?.confidence_level)}>
                    {assignment.clinical_group_assignment?.confidence_score}% confident
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-slate-600">Current Assignment:</p>
                    <Badge variant="outline" className="text-base">
                      {pdgmData?.clinical_group || 'Not Set'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border-2 border-green-400">
                    <div>
                      <p className="text-sm text-green-700 mb-1">AI Recommended:</p>
                      <p className="text-2xl font-bold text-green-900">
                        {assignment.clinical_group_assignment?.assigned_group}
                      </p>
                      <p className="text-xs text-green-700 mt-1">
                        Primary Dx: {assignment.clinical_group_assignment?.primary_diagnosis_code}
                      </p>
                    </div>
                    {pdgmData?.clinical_group === assignment.clinical_group_assignment?.assigned_group ? (
                      <CheckCircle2 className="w-8 h-8 text-green-600" />
                    ) : (
                      <AlertTriangle className="w-8 h-8 text-yellow-600" />
                    )}
                  </div>
                </div>

                {/* Key OASIS Inputs */}
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 mb-3">
                  <p className="text-xs text-blue-700 font-semibold mb-2">Key OASIS Inputs Driving Assignment:</p>
                  <div className="space-y-1">
                    {assignment.clinical_group_assignment?.key_oasis_inputs?.map((input, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <Badge variant="outline" className="font-mono text-xs">{idx + 1}</Badge>
                        <p className="text-sm text-blue-800">{input}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Clinical Reasoning */}
                <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-200 mb-3">
                  <p className="text-xs text-indigo-700 font-semibold mb-2">Clinical Reasoning:</p>
                  <p className="text-sm text-indigo-900">{assignment.clinical_group_assignment?.reasoning}</p>
                </div>

                {/* Alternative Groups */}
                {assignment.clinical_group_assignment?.alternative_groups_considered?.length > 0 && (
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <p className="text-xs text-slate-700 font-semibold mb-2">Alternative Groups Considered:</p>
                    <div className="space-y-2">
                      {assignment.clinical_group_assignment.alternative_groups_considered.map((alt, idx) => (
                        <div key={idx} className="text-sm">
                          <Badge variant="outline" className="mb-1">{alt.group}</Badge>
                          <p className="text-xs text-slate-600 ml-2">→ {alt.why_not_selected}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Functional Level Assignment */}
            <Card className="border-2 border-navy-400">
              <CardHeader className="bg-navy-50 pb-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-navy-600" />
                    Functional Impairment Level
                  </span>
                  <Badge className={getConfidenceColor(assignment.functional_level_assignment?.confidence_level)}>
                    {assignment.functional_level_assignment?.confidence_score}% confident
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-slate-600">Current Assignment:</p>
                    <Badge variant="outline" className="text-base">
                      {pdgmData?.functional_level || 'Not Set'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-navy-50 rounded-lg border-2 border-navy-400">
                    <div>
                      <p className="text-sm text-navy-700 mb-1">AI Recommended:</p>
                      <p className="text-2xl font-bold text-navy-900 uppercase">
                        {assignment.functional_level_assignment?.assigned_level}
                      </p>
                      <p className="text-xs text-navy-700 mt-1">
                        Total Points: {assignment.functional_level_assignment?.total_points}
                      </p>
                    </div>
                    {pdgmData?.functional_level === assignment.functional_level_assignment?.assigned_level ? (
                      <CheckCircle2 className="w-8 h-8 text-green-600" />
                    ) : (
                      <AlertTriangle className="w-8 h-8 text-yellow-600" />
                    )}
                  </div>
                </div>

                {/* Functional Item Breakdown */}
                {assignment.functional_level_assignment?.key_functional_items?.length > 0 && (
                  <div className="bg-navy-50 p-3 rounded-lg border border-navy-200 mb-3">
                    <p className="text-xs text-navy-700 font-semibold mb-2">Functional Score Breakdown:</p>
                    <div className="space-y-2">
                      {assignment.functional_level_assignment.key_functional_items.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-white p-2 rounded border">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-xs">{item.m_item}</Badge>
                            <span className="text-sm text-slate-800">{item.contribution}</span>
                          </div>
                          <Badge className="bg-navy-600 text-white">{item.score} pts</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reasoning */}
                <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-200">
                  <p className="text-xs text-indigo-700 font-semibold mb-2">Reasoning:</p>
                  <p className="text-sm text-indigo-900">{assignment.functional_level_assignment?.reasoning}</p>
                </div>
              </CardContent>
            </Card>

            {/* Discrepancies */}
            {assignment.discrepancies?.length > 0 && (
              <Alert className="bg-orange-50 border-orange-400 border-2">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
                <AlertDescription>
                  <p className="font-semibold text-orange-900 mb-3">⚠️ Discrepancies Detected</p>
                  <div className="space-y-3">
                    {assignment.discrepancies.map((disc, idx) => (
                      <div key={idx} className={`p-3 rounded-lg border-2 ${getSeverityColor(disc.severity)}`}>
                        <div className="flex items-center justify-between mb-2">
                          <Badge className="bg-slate-800 text-white">{disc.type}</Badge>
                          <Badge className={
                            disc.severity === 'critical' ? 'bg-red-600 text-white' :
                            disc.severity === 'high' ? 'bg-orange-500 text-white' :
                            disc.severity === 'medium' ? 'bg-yellow-500 text-white' :
                            'bg-blue-500 text-white'
                          }>
                            {disc.severity}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mb-2 text-sm">
                          <div>
                            <p className="text-xs text-slate-600">Current:</p>
                            <p className="font-semibold">{disc.current_value}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600">Recommended:</p>
                            <p className="font-semibold text-green-700">{disc.recommended_value}</p>
                          </div>
                        </div>
                        <p className="text-sm text-slate-700">{disc.explanation}</p>
                      </div>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Red Flags */}
            {assignment.red_flags?.length > 0 && (
              <Alert className="bg-red-100 border-red-500 border-2">
                <XCircle className="w-5 h-5 text-red-700" />
                <AlertDescription>
                  <p className="font-semibold text-red-900 mb-3">🚩 Red Flags Requiring Attention</p>
                  <ul className="space-y-1">
                    {assignment.red_flags.map((flag, idx) => (
                      <li key={idx} className="text-sm text-red-800 flex items-start gap-2">
                        <span className="text-red-600">•</span>
                        {flag}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* CMS Compliance Notes */}
            {assignment.cms_compliance_notes && (
              <Alert className="bg-blue-50 border-blue-300">
                <CheckCircle2 className="w-5 h-5 text-blue-600" />
                <AlertDescription className="text-sm text-blue-900">
                  <strong>CMS Compliance:</strong> {assignment.cms_compliance_notes}
                </AlertDescription>
              </Alert>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4 border-t">
              <Button
                onClick={performValidation}
                disabled={ai.loading}
                variant="outline"
                className="flex-1"
              >
                {ai.loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Revalidating...</>
                ) : (
                  'Re-run Validation'
                )}
              </Button>
              
              {isAdmin && (
                <Button
                  onClick={openOverrideDialog}
                  variant="outline"
                  className="flex-1 border-orange-400 text-orange-700 hover:bg-orange-50"
                >
                  <Shield className="w-4 h-4 mr-2" />
                  Manual Override
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Override Dialog */}
        <Dialog open={showOverrideDialog} onOpenChange={setShowOverrideDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-orange-600" />
                Manual Group Assignment Override
              </DialogTitle>
            </DialogHeader>

            <Alert className="bg-yellow-50 border-yellow-400">
              <AlertTriangle className="w-4 h-4 text-yellow-600" />
              <AlertDescription className="text-yellow-900 text-sm">
                This override will be logged in the audit trail. Only use when clinically appropriate.
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              <div>
                <Label>Clinical Group</Label>
                <Select value={manualClinicalGroup} onValueChange={setManualClinicalGroup}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MS-Rehab">MS-Rehab (Musculoskeletal Rehabilitation)</SelectItem>
                    <SelectItem value="Neuro-Rehab">Neuro-Rehab (Neurological Rehabilitation)</SelectItem>
                    <SelectItem value="Wound">Wound (Wounds/Pressure Ulcers)</SelectItem>
                    <SelectItem value="Behavioral Health">Behavioral Health</SelectItem>
                    <SelectItem value="Complex Nursing">Complex Nursing</SelectItem>
                    <SelectItem value="MMTA">MMTA (Med Mgmt/Teaching/Assessment)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Functional Impairment Level</Label>
                <Select value={manualFunctionalLevel} onValueChange={setManualFunctionalLevel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low (0-5 points)</SelectItem>
                    <SelectItem value="medium">Medium (6-13 points)</SelectItem>
                    <SelectItem value="high">High (14+ points)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Override Reason (Required)</Label>
                <Textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Explain the clinical rationale for this override..."
                  rows={4}
                />
              </div>

              {assignment && (
                <Alert className="bg-blue-50 border-blue-200">
                  <AlertDescription className="text-sm text-blue-900">
                    <strong>AI Recommendation:</strong> {assignment.clinical_group_assignment?.assigned_group} / {assignment.functional_level_assignment?.assigned_level?.toUpperCase()} 
                    ({assignment.overall_assignment_confidence} confidence)
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowOverrideDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleOverride}
                disabled={saveOverrideMutation.isPending || !overrideReason.trim()}
                className="bg-orange-600 hover:bg-orange-700"
              >
                {saveOverrideMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                ) : (
                  <><Save className="w-4 h-4 mr-2" /> Save Override</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}