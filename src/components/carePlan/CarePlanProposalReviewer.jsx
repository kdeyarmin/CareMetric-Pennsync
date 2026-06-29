import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2, XCircle, Brain,
  TrendingUp, FileText, Activity, ChevronDown, ChevronUp
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { createPageUrl } from "@/utils";

export default function CarePlanProposalReviewer({ patientId = null, compact = false }) {
  const [expandedProposals, setExpandedProposals] = useState({});
  const [reviewingProposal, setReviewingProposal] = useState(null);
  const [nurseNotes, setNurseNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: proposals = [], isLoading } = useQuery({
    queryKey: ['carePlanProposals', patientId, currentUser?.email],
    queryFn: async () => {
      const filters = { status: 'pending_review' };
      if (patientId) {
        filters.patient_id = patientId;
      } else if (currentUser?.email) {
        filters.assigned_nurse = currentUser.email;
      }
      return base44.entities.CarePlanProposal.filter(filters, '-created_date', 50);
    },
    initialData: [],
    enabled: !!currentUser?.email,
    refetchInterval: 60000,
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['proposalPatients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 200),
    initialData: [],
  });

  const approveProposalMutation = useMutation({
    mutationFn: async ({ proposalId, notes, implementNow }) => {
      const proposal = proposals.find(p => p.id === proposalId);
      if (!proposal) throw new Error('Proposal no longer available');

      // Apply the care-plan change FIRST so the proposal is only marked
      // 'implemented' once the plan write actually succeeds — otherwise a failed
      // create/update left a phantom 'implemented' proposal with no care plan.
      if (implementNow && proposal.care_plan_id) {
        const carePlan = await base44.entities.CarePlan.get(proposal.care_plan_id);

        const updatedInterventions = [
          ...(carePlan.interventions || []),
          ...(proposal.proposed_interventions || [])
        ];

        // CarePlan.goal is a single string, not an array — append the proposed goals
        // to the existing goal text instead of overwriting it with an array (which
        // rendered as "[object Object]"/junk downstream).
        const updatedGoal = [carePlan.goal, ...(proposal.proposed_goals || [])]
          .filter(Boolean)
          .join('; ');

        await base44.entities.CarePlan.update(proposal.care_plan_id, {
          interventions: updatedInterventions,
          goal: updatedGoal
        });
      } else if (implementNow && !proposal.care_plan_id) {
        // Create new care plan. CarePlan requires patient_id/problem/goal — the
        // 'problem' (clinical finding) was previously omitted, so the create
        // violated the schema contract; source it from the proposal's analysis.
        await base44.entities.CarePlan.create({
          patient_id: proposal.patient_id,
          problem: proposal.ai_analysis?.clinical_finding || 'AI-proposed care plan update',
          interventions: proposal.proposed_interventions,
          goal: (proposal.proposed_goals || []).join('; '),
          status: 'active',
          created_by: currentUser.email
        });
      }

      // Record the review decision on the proposal only after the plan write above.
      await base44.entities.CarePlanProposal.update(proposalId, {
        status: implementNow ? 'implemented' : 'approved',
        reviewed_by: currentUser.email,
        reviewed_date: new Date().toISOString(),
        nurse_notes: notes,
        implemented_date: implementNow ? new Date().toISOString() : null
      });

      return proposalId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carePlanProposals'] });
      queryClient.invalidateQueries({ queryKey: ['activeCarePlans'] });
      setReviewingProposal(null);
      setNurseNotes("");
    },
    onError: (error) => {
      console.error('Error approving care plan proposal:', error);
      toast.error("Failed to approve proposal. Please try again.");
      setReviewingProposal(null);
    },
  });

  const rejectProposalMutation = useMutation({
    mutationFn: async ({ proposalId, reason }) => {
      await base44.entities.CarePlanProposal.update(proposalId, {
        status: 'rejected',
        reviewed_by: currentUser.email,
        reviewed_date: new Date().toISOString(),
        rejection_reason: reason,
        nurse_notes: nurseNotes
      });
      return proposalId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carePlanProposals'] });
      setReviewingProposal(null);
      setNurseNotes("");
      setRejectionReason("");
    },
    onError: (error) => {
      console.error('Error rejecting care plan proposal:', error);
      toast.error("Failed to reject proposal. Please try again.");
      setReviewingProposal(null);
    },
  });

  const toggleExpanded = (id) => {
    setExpandedProposals(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getSeverityColor = (severity) => {
    switch(severity) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-600 text-white';
      case 'moderate': return 'bg-yellow-600 text-white';
      default: return 'bg-blue-600 text-white';
    }
  };

  const getPriorityColor = (priority) => {
    switch(priority) {
      case 'critical': return 'border-red-300 bg-red-50';
      case 'urgent': return 'border-orange-300 bg-orange-50';
      case 'elevated': return 'border-yellow-300 bg-yellow-50';
      default: return 'border-blue-300 bg-blue-50';
    }
  };

  const getPatientName = (patientId) => {
    const patient = patients.find(p => p.id === patientId);
    return patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown Patient';
  };

  const criticalCount = proposals.filter(p => p.priority === 'critical' || p.ai_analysis?.severity_level === 'critical').length;
  const urgentCount = proposals.filter(p => p.priority === 'urgent' || p.ai_analysis?.severity_level === 'high').length;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Activity className="w-12 h-12 text-slate-300 mx-auto mb-3 animate-pulse" />
          <p className="text-slate-600">Loading care plan proposals...</p>
        </CardContent>
      </Card>
    );
  }

  if (proposals.length === 0) {
    return compact ? null : (
      <Card>
        <CardContent className="p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
          <p className="text-slate-600">No pending care plan proposals</p>
          <p className="text-sm text-slate-500 mt-1">AI monitoring is active - proposals will appear here when clinical thresholds are met</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Brain className="w-6 h-6 text-navy-600" />
              AI Care Plan Proposals
            </h2>
            <p className="text-slate-600 text-sm mt-1">
              Review and approve AI-recommended care plan updates
            </p>
          </div>
          <div className="flex gap-2">
            {criticalCount > 0 && (
              <Badge className="bg-red-600 text-white px-3 py-1">
                {criticalCount} Critical
              </Badge>
            )}
            {urgentCount > 0 && (
              <Badge className="bg-orange-600 text-white px-3 py-1">
                {urgentCount} Urgent
              </Badge>
            )}
            <Badge className="bg-blue-600 text-white px-3 py-1">
              {proposals.length} Total
            </Badge>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {proposals.map((proposal) => {
          const isExpanded = expandedProposals[proposal.id];
          const isReviewing = reviewingProposal === proposal.id;

          return (
            <Card key={proposal.id} className={`border-2 ${getPriorityColor(proposal.priority)}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Link to={createPageUrl(`PatientDetails?id=${proposal.patient_id}`)}>
                        <h3 className="font-bold text-slate-900 hover:text-blue-600">
                          {getPatientName(proposal.patient_id)}
                        </h3>
                      </Link>
                      <Badge className={getSeverityColor(proposal.ai_analysis?.severity_level)}>
                        {proposal.ai_analysis?.severity_level?.toUpperCase()}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {proposal.proposal_type?.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-700 font-medium">
                      {proposal.ai_analysis?.clinical_finding}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Triggered by: {proposal.trigger_source} • 
                      Confidence: {proposal.ai_analysis?.confidence_score}% •
                      Expires: {new Date(proposal.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleExpanded(proposal.id)}
                  >
                    {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </Button>
                </div>
              </CardHeader>

              {isExpanded && (
                <CardContent className="space-y-4">
                  {/* AI Rationale */}
                  <div className="bg-navy-50 border border-navy-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-navy-900 mb-1">AI Analysis:</p>
                    <p className="text-sm text-navy-800">{proposal.ai_analysis?.rationale}</p>
                  </div>

                  {/* Trigger Data */}
                  {proposal.trigger_data && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <p className="text-xs font-semibold text-slate-900 mb-2">Clinical Evidence:</p>
                      {proposal.trigger_data.vitals && (
                        <div className="mb-2">
                          <p className="text-xs text-slate-600 font-medium">Recent Vitals:</p>
                          {proposal.trigger_data.vitals.slice(0, 3).map((v, idx) => (
                            <p key={idx} className="text-xs text-slate-700">
                              {v.date}: BP {v.bp_sys}/{v.bp_dia}, HR {v.hr}, O2 {v.o2}%
                            </p>
                          ))}
                        </div>
                      )}
                      {proposal.trigger_data.note_excerpts && (
                        <div>
                          <p className="text-xs text-slate-600 font-medium">Note Excerpts:</p>
                          {proposal.trigger_data.note_excerpts.map((note, idx) => (
                            <p key={idx} className="text-xs text-slate-700 italic">"{note}..."</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Proposed Interventions */}
                  <div>
                    <p className="text-sm font-semibold text-slate-900 mb-2">Proposed Interventions:</p>
                    <div className="space-y-2">
                      {proposal.proposed_interventions?.map((intervention, idx) => (
                        <div key={idx} className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                          <p className="text-sm font-medium text-blue-900">{intervention.description}</p>
                          <div className="flex gap-4 mt-1 text-xs text-blue-700">
                            <span>Frequency: {intervention.frequency}</span>
                            <span>Expected: {intervention.expected_outcome}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Proposed Goals */}
                  {proposal.proposed_goals && proposal.proposed_goals.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-slate-900 mb-2">Proposed Goals:</p>
                      <ul className="space-y-1">
                        {proposal.proposed_goals.map((goal, idx) => (
                          <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                            <TrendingUp className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                            {goal}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Evidence-Based Guidelines */}
                  {proposal.ai_analysis?.evidence_based_guidelines && proposal.ai_analysis.evidence_based_guidelines.length > 0 && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <p className="text-xs font-semibold text-green-900 mb-1">Clinical Guidelines:</p>
                      <ul className="space-y-1">
                        {proposal.ai_analysis.evidence_based_guidelines.map((guideline, idx) => (
                          <li key={idx} className="text-xs text-green-800">• {guideline}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Review Actions */}
                  {!isReviewing ? (
                    <div className="flex gap-2 pt-3 border-t">
                      <Button
                        onClick={() => setReviewingProposal(proposal.id)}
                        className="flex-1 bg-blue-600 hover:bg-blue-700"
                      >
                        <FileText className="w-4 h-4 mr-2" />
                        Review & Approve
                      </Button>
                      <Button
                        onClick={() => {
                          setReviewingProposal(proposal.id);
                          setRejectionReason("Not clinically indicated");
                        }}
                        variant="outline"
                        className="flex-1"
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3 pt-3 border-t">
                      <Textarea
                        placeholder="Add your clinical notes (optional)..."
                        value={nurseNotes}
                        onChange={(e) => setNurseNotes(e.target.value)}
                        rows={3}
                        className="text-sm"
                      />

                      {rejectionReason && (
                        <Textarea
                          placeholder="Reason for rejection..."
                          value={rejectionReason}
                          onChange={(e) => setRejectionReason(e.target.value)}
                          rows={2}
                          className="text-sm border-red-300"
                        />
                      )}

                      <div className="flex gap-2">
                        {!rejectionReason ? (
                          <>
                            <Button
                              onClick={() => approveProposalMutation.mutate({
                                proposalId: proposal.id,
                                notes: nurseNotes,
                                implementNow: true
                              })}
                              disabled={approveProposalMutation.isPending}
                              className="flex-1 bg-green-600 hover:bg-green-700 min-h-[44px]"
                            >
                              <CheckCircle2 className="w-4 h-4 mr-2" />
                              Approve & Implement Now
                            </Button>
                            <Button
                              onClick={() => approveProposalMutation.mutate({
                                proposalId: proposal.id,
                                notes: nurseNotes,
                                implementNow: false
                              })}
                              disabled={approveProposalMutation.isPending}
                              variant="outline"
                              className="flex-1 min-h-[44px]"
                            >
                              Approve for Later
                            </Button>
                          </>
                        ) : (
                          <Button
                            onClick={() => rejectProposalMutation.mutate({
                              proposalId: proposal.id,
                              reason: rejectionReason
                            })}
                            disabled={rejectProposalMutation.isPending || !rejectionReason.trim()}
                            className="flex-1 bg-red-600 hover:bg-red-700 min-h-[44px]"
                          >
                            <XCircle className="w-4 h-4 mr-2" />
                            Confirm Rejection
                          </Button>
                        )}
                        <Button
                          onClick={() => {
                            setReviewingProposal(null);
                            setNurseNotes("");
                            setRejectionReason("");
                          }}
                          variant="ghost"
                          className="min-h-[44px]"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}