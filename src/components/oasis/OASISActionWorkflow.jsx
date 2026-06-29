import { useState } from "react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  FileCheck,
  ClipboardList,
  Loader2,
  ArrowRight,
  Trash2,
  Eye,
  Send,
  TrendingUp,
  Activity
} from "lucide-react";

export default function OASISActionWorkflow({ 
  analysisId, 
  analysisResults, 
  _pdgmData,
  _originalPayment,
  patientName,
  _scenarios = []
}) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("pending");
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [assignTo, setAssignTo] = useState("");

  // Fetch action items
  const { data: actionItems = [], isLoading } = useQuery({
    queryKey: ['oasis-actions', analysisId],
    queryFn: () => base44.entities.OASISActionItem.filter({ analysis_id: analysisId }),
    enabled: !!analysisId
  });

  // Fetch users for assignment
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list()
  });

  // Create action mutation
  const createActionMutation = useMutation({
    mutationFn: (actionData) => base44.entities.OASISActionItem.create(actionData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasis-actions', analysisId] });
    }
  });

  // Update action mutation
  const updateActionMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.OASISActionItem.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasis-actions', analysisId] });
      setShowReviewDialog(false);
      setSelectedAction(null);
      setReviewNotes("");
    }
  });

  // Delete action mutation
  const deleteActionMutation = useMutation({
    mutationFn: (id) => base44.entities.OASISActionItem.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasis-actions', analysisId] });
    }
  });

  // Create task mutation
  const createTaskMutation = useMutation({
    mutationFn: async (action) => {
      const task = await base44.entities.Task.create({
        title: `OASIS ${action.action_type}: ${action.oasis_item || action.category}`,
        description: `${action.rationale}\n\nCurrent: ${action.current_value}\nProposed: ${action.proposed_value}\n\nRevenue Impact: $${action.revenue_impact || 0}`,
        type: 'document',
        priority: action.severity === 'critical' ? 'high' : action.severity === 'high' ? 'high' : 'medium',
        status: 'pending',
        source: 'ai_generated',
        ai_reason: `Generated from OASIS analysis - ${action.source}`,
        assigned_to: action.assigned_to,
        due_timeframe: action.severity === 'critical' ? 'today' : '48_hours'
      });
      
      await base44.entities.OASISActionItem.update(action.id, {
        status: 'task_created',
        linked_task_id: task.id
      });
      
      return task;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasis-actions', analysisId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  });

  // Generate actions from analysis discrepancies
  const generateActionsFromAnalysis = async () => {
    if (!analysisResults) return;

    const actions = [];

    // From accuracy issues
    analysisResults.accuracy_issues?.forEach(issue => {
      actions.push({
        analysis_id: analysisId,
        patient_name: patientName,
        action_type: 'correction',
        category: getCategoryFromItem(issue.item),
        oasis_item: issue.item,
        current_value: issue.issue,
        proposed_value: issue.recommendation,
        rationale: issue.recommendation,
        severity: issue.severity,
        source: 'discrepancy',
        status: 'pending_review'
      });
    });

    // From revenue tips
    analysisResults.revenue_tips?.forEach(tip => {
      actions.push({
        analysis_id: analysisId,
        patient_name: patientName,
        action_type: 'optimization',
        category: getCategoryFromTip(tip.category),
        oasis_item: extractOasisItem(tip.specific_action),
        current_value: tip.current_documentation,
        proposed_value: tip.specific_action,
        rationale: tip.opportunity,
        revenue_impact: parseRevenueImpact(tip.estimated_revenue_impact),
        severity: tip.potential_impact,
        source: 'ai_recommendation',
        status: 'pending_review'
      });
    });

    // From validation issues
    analysisResults.validation_summary?.issues?.forEach(issue => {
      actions.push({
        analysis_id: analysisId,
        patient_name: patientName,
        action_type: 'verification',
        category: getCategoryFromItem(issue.item),
        oasis_item: issue.item,
        current_value: issue.description,
        proposed_value: issue.suggested_correction,
        rationale: issue.pdgm_impact || issue.description,
        severity: issue.severity === 'critical' ? 'critical' : 'high',
        source: 'discrepancy',
        status: 'pending_review'
      });
    });

    // Create all actions. Continue past individual failures so a mid-loop
    // error doesn't leave the UI stuck or silently drop the remaining actions.
    let createdCount = 0;
    let failedCount = 0;
    for (const action of actions) {
      try {
        await createActionMutation.mutateAsync(action);
        createdCount += 1;
      } catch (error) {
        failedCount += 1;
        console.error("Failed to create OASIS action item:", error);
      }
    }

    if (failedCount === 0) {
      if (createdCount > 0) {
        toast.success(`Created ${createdCount} action item(s).`);
      }
    } else if (createdCount > 0) {
      toast.error(`Created ${createdCount} action item(s), but ${failedCount} failed. Please retry.`);
    } else {
      toast.error("Failed to create action items. Please try again.");
    }
  };

  // Generate actions from selected scenarios
  const _generateActionsFromScenarios = async (selectedScenarios) => {
    for (const scenario of selectedScenarios) {
      for (const change of (scenario.changes_made || [])) {
        await createActionMutation.mutateAsync({
          analysis_id: analysisId,
          patient_name: patientName,
          action_type: 'correction',
          category: getCategoryFromField(change.field),
          oasis_item: (change.field || '').toUpperCase().replace('_', ''),
          current_value: change.original_value,
          proposed_value: change.new_value,
          rationale: `From scenario "${scenario.scenario_name}": Change ${change.field} to optimize PDGM payment`,
          revenue_impact: scenario.payment_difference / (scenario.changes_made?.length || 1),
          severity: Math.abs(scenario.payment_difference) > 500 ? 'high' : 'medium',
          source: 'what_if_scenario',
          scenario_name: scenario.scenario_name,
          original_pdgm_payment: scenario.original_payment,
          projected_pdgm_payment: scenario.scenario_payment,
          status: 'pending_review'
        });
      }
    }
  };

  // Helper functions
  const getCategoryFromItem = (item) => {
    if (!item) return 'documentation';
    const itemUpper = item.toUpperCase();
    if (itemUpper.includes('M18')) return 'functional_status';
    if (itemUpper.includes('M1000')) return 'admission_source';
    if (itemUpper.includes('M1021') || itemUpper.includes('M1023')) return 'diagnosis';
    if (itemUpper.includes('COMORBID')) return 'comorbidity';
    return 'documentation';
  };

  const getCategoryFromTip = (category) => {
    const map = {
      'Functional Status': 'functional_status',
      'Diagnosis': 'diagnosis',
      'Therapy': 'documentation',
      'Comorbidity': 'comorbidity',
      'Other': 'documentation'
    };
    return map[category] || 'documentation';
  };

  const getCategoryFromField = (field) => {
    if (field?.includes('m18')) return 'functional_status';
    if (field?.includes('admission')) return 'admission_source';
    if (field?.includes('episode') || field?.includes('timing')) return 'episode_timing';
    return 'documentation';
  };

  const extractOasisItem = (text) => {
    const match = text?.match(/M\d{4}/i);
    return match ? match[0].toUpperCase() : null;
  };

  const parseRevenueImpact = (text) => {
    if (!text) return 0;
    const match = text.match(/\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/);
    return match ? parseFloat(match[1].replace(/,/g, '')) : 0;
  };

  const handleReview = (action, decision) => {
    updateActionMutation.mutate({
      id: action.id,
      data: {
        status: decision,
        reviewed_by: 'current_user', // Would use actual user email
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes,
        assigned_to: assignTo || action.assigned_to
      }
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  };

  const getStatusBadge = (status) => {
    const styles = {
      pending_review: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      implemented: 'bg-blue-100 text-blue-800',
      task_created: 'bg-navy-100 text-navy-800'
    };
    return styles[status] || 'bg-slate-100 text-slate-800';
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

  const filteredActions = actionItems.filter(a => {
    if (activeTab === 'pending') return a.status === 'pending_review';
    if (activeTab === 'approved') return a.status === 'approved';
    if (activeTab === 'tasks') return a.status === 'task_created';
    if (activeTab === 'all') return true;
    return true;
  });

  const pendingCount = actionItems.filter(a => a.status === 'pending_review').length;
  const approvedCount = actionItems.filter(a => a.status === 'approved').length;
  const taskCount = actionItems.filter(a => a.status === 'task_created').length;
  const totalRevenueImpact = actionItems
    .filter(a => a.status === 'approved' || a.status === 'task_created')
    .reduce((sum, a) => sum + (a.revenue_impact || 0), 0);

  return (
    <Card className="border-2 border-blue-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-blue-50 to-navy-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-blue-600" />
            Action Workflow
          </div>
          <div className="flex items-center gap-2">
            {totalRevenueImpact > 0 && (
              <Badge className="bg-green-600 text-white">
                <DollarSign className="w-3 h-3 mr-1" />
                {formatCurrency(totalRevenueImpact)} potential
              </Badge>
            )}
            <Button 
              size="sm" 
              onClick={generateActionsFromAnalysis}
              disabled={createActionMutation.isPending || !analysisResults}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {createActionMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <Activity className="w-4 h-4 mr-1" />
              )}
              Generate Actions
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Stats Summary */}
        <div className="grid grid-cols-4 gap-3">
          <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200 text-center">
            <Clock className="w-5 h-5 text-yellow-600 mx-auto mb-1" />
            <p className="text-lg font-bold text-yellow-700">{pendingCount}</p>
            <p className="text-xs text-yellow-600">Pending Review</p>
          </div>
          <div className="p-3 bg-green-50 rounded-lg border border-green-200 text-center">
            <CheckCircle2 className="w-5 h-5 text-green-600 mx-auto mb-1" />
            <p className="text-lg font-bold text-green-700">{approvedCount}</p>
            <p className="text-xs text-green-600">Approved</p>
          </div>
          <div className="p-3 bg-navy-50 rounded-lg border border-navy-200 text-center">
            <FileCheck className="w-5 h-5 text-navy-600 mx-auto mb-1" />
            <p className="text-lg font-bold text-navy-700">{taskCount}</p>
            <p className="text-xs text-navy-600">Tasks Created</p>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-center">
            <TrendingUp className="w-5 h-5 text-blue-600 mx-auto mb-1" />
            <p className="text-lg font-bold text-blue-700">{formatCurrency(totalRevenueImpact)}</p>
            <p className="text-xs text-blue-600">Revenue Impact</p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="pending" className="text-xs">
              Pending ({pendingCount})
            </TabsTrigger>
            <TabsTrigger value="approved" className="text-xs">
              Approved ({approvedCount})
            </TabsTrigger>
            <TabsTrigger value="tasks" className="text-xs">
              Tasks ({taskCount})
            </TabsTrigger>
            <TabsTrigger value="all" className="text-xs">
              All ({actionItems.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-4">
            {isLoading ? (
              <div className="text-center py-8">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" />
              </div>
            ) : filteredActions.length === 0 ? (
              <Alert className="bg-slate-50">
                <AlertDescription>
                  No actions in this category. {activeTab === 'pending' && 'Click "Generate Actions" to analyze findings.'}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {filteredActions.map(action => (
                  <div 
                    key={action.id} 
                    className="p-4 bg-white rounded-lg border hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={getSeverityBadge(action.severity)}>
                          {action.severity}
                        </Badge>
                        <Badge variant="outline" className="capitalize">
                          {action.action_type}
                        </Badge>
                        {action.oasis_item && (
                          <Badge variant="outline" className="font-mono text-xs">
                            {action.oasis_item}
                          </Badge>
                        )}
                        <Badge className={getStatusBadge(action.status)}>
                          {action.status.replace('_', ' ')}
                        </Badge>
                      </div>
                      {action.revenue_impact > 0 && (
                        <Badge className="bg-green-100 text-green-800">
                          +{formatCurrency(action.revenue_impact)}
                        </Badge>
                      )}
                    </div>

                    <p className="text-sm text-slate-800 mb-2">{action.rationale}</p>

                    {(action.current_value || action.proposed_value) && (
                      <div className="flex items-center gap-2 text-xs mb-3 p-2 bg-slate-50 rounded">
                        <div className="flex-1">
                          <span className="text-slate-500">Current: </span>
                          <span className="text-red-700">{action.current_value || 'N/A'}</span>
                        </div>
                        <ArrowRight className="w-4 h-4 text-slate-400" />
                        <div className="flex-1">
                          <span className="text-slate-500">Proposed: </span>
                          <span className="text-green-700">{action.proposed_value || 'N/A'}</span>
                        </div>
                      </div>
                    )}

                    {action.scenario_name && (
                      <p className="text-xs text-navy-600 mb-2">
                        From scenario: {action.scenario_name}
                      </p>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t">
                      {action.status === 'pending_review' && (
                        <>
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => {
                              setSelectedAction(action);
                              setShowReviewDialog(true);
                            }}
                          >
                            <Eye className="w-4 h-4 mr-1" /> Review
                          </Button>
                          <Button 
                            size="sm" 
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() => handleReview(action, 'approved')}
                          >
                            <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline"
                            className="text-red-600"
                            onClick={() => handleReview(action, 'rejected')}
                          >
                            <XCircle className="w-4 h-4 mr-1" /> Reject
                          </Button>
                        </>
                      )}
                      {action.status === 'approved' && (
                        <Button 
                          size="sm" 
                          className="bg-navy-600 hover:bg-navy-700"
                          onClick={() => createTaskMutation.mutate(action)}
                          disabled={createTaskMutation.isPending}
                        >
                          {createTaskMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-1" />
                          ) : (
                            <Send className="w-4 h-4 mr-1" />
                          )}
                          Create Task
                        </Button>
                      )}
                      {action.linked_task_id && (
                        <Badge className="bg-navy-100 text-navy-800">
                          Task #{action.linked_task_id.slice(-6)}
                        </Badge>
                      )}
                      <Button 
                        size="sm" 
                        variant="ghost"
                        className="ml-auto text-red-500"
                        onClick={() => deleteActionMutation.mutate(action.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Review Dialog */}
        <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Review Action Item</DialogTitle>
            </DialogHeader>
            {selectedAction && (
              <div className="space-y-4 py-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={getSeverityBadge(selectedAction.severity)}>
                    {selectedAction.severity}
                  </Badge>
                  <Badge variant="outline" className="capitalize">
                    {selectedAction.action_type}
                  </Badge>
                  {selectedAction.oasis_item && (
                    <Badge variant="outline" className="font-mono">
                      {selectedAction.oasis_item}
                    </Badge>
                  )}
                </div>

                <div className="bg-slate-50 p-3 rounded-lg">
                  <p className="text-sm font-medium mb-2">Rationale</p>
                  <p className="text-sm text-slate-700">{selectedAction.rationale}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                    <p className="text-xs text-red-600 mb-1">Current Value</p>
                    <p className="text-sm text-red-800">{selectedAction.current_value || 'N/A'}</p>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                    <p className="text-xs text-green-600 mb-1">Proposed Value</p>
                    <p className="text-sm text-green-800">{selectedAction.proposed_value || 'N/A'}</p>
                  </div>
                </div>

                {selectedAction.revenue_impact > 0 && (
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-sm font-medium text-blue-800">
                      Estimated Revenue Impact: {formatCurrency(selectedAction.revenue_impact)}
                    </p>
                  </div>
                )}

                <div>
                  <label htmlFor="action-assign-to" className="text-sm font-medium mb-1 block">Assign To</label>
                  <Select value={assignTo} onValueChange={setAssignTo}>
                    <SelectTrigger id="action-assign-to">
                      <SelectValue placeholder="Select assignee..." />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map(user => (
                        <SelectItem key={user.id} value={user.email}>
                          {user.full_name || user.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label htmlFor="action-review-notes" className="text-sm font-medium mb-1 block">Review Notes</label>
                  <Textarea
                    id="action-review-notes"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Add notes about your decision..."
                    rows={3}
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowReviewDialog(false)}>
                Cancel
              </Button>
              <Button 
                variant="outline"
                className="text-red-600"
                onClick={() => handleReview(selectedAction, 'rejected')}
              >
                <XCircle className="w-4 h-4 mr-1" /> Reject
              </Button>
              <Button 
                className="bg-green-600 hover:bg-green-700"
                onClick={() => handleReview(selectedAction, 'approved')}
              >
                <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}