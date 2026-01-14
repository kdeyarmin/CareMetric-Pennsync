import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, AlertTriangle, CheckCircle, ChevronDown, ChevronUp, ExternalLink, FileText, Clock } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { formatEastern } from "@/components/utils/timezone";

export default function RegulationChangeAlerts({ providerEmail, providerType }) {
  const [expandedAlerts, setExpandedAlerts] = useState({});
  const queryClient = useQueryClient();

  // Fetch recent regulation updates
  const { data: updates = [], isLoading } = useQuery({
    queryKey: ['regulationUpdates', providerEmail],
    queryFn: async () => {
      const allUpdates = await base44.entities.RegulatoryUpdate.filter({}, '-effective_date', 50);
      
      // Filter to show only updates from last 90 days or future
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      
      return allUpdates.filter(update => {
        const effectiveDate = new Date(update.effective_date);
        return effectiveDate >= ninetyDaysAgo;
      });
    }
  });

  // Fetch action items for current provider
  const { data: actionItems = [] } = useQuery({
    queryKey: ['regulationActionItems', providerEmail],
    queryFn: async () => {
      return await base44.entities.RegulatoryUpdate.filter({
        assigned_providers: { $contains: providerEmail },
        status: { $ne: 'completed' }
      });
    },
    enabled: !!providerEmail
  });

  const acknowledgeUpdateMutation = useMutation({
    mutationFn: async (updateId) => {
      const update = await base44.entities.RegulatoryUpdate.filter({ id: updateId }).then(u => u[0]);
      const acknowledgedBy = update.acknowledged_by || [];
      
      if (!acknowledgedBy.includes(providerEmail)) {
        acknowledgedBy.push(providerEmail);
      }

      return await base44.entities.RegulatoryUpdate.update(updateId, {
        acknowledged_by: acknowledgedBy
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulationUpdates'] });
      toast.success('Update acknowledged');
    }
  });

  const completeActionMutation = useMutation({
    mutationFn: async ({ updateId, actionIndex }) => {
      const update = await base44.entities.RegulatoryUpdate.filter({ id: updateId }).then(u => u[0]);
      const completedActions = update.completed_actions || {};
      
      if (!completedActions[providerEmail]) {
        completedActions[providerEmail] = [];
      }
      
      if (!completedActions[providerEmail].includes(actionIndex)) {
        completedActions[providerEmail].push(actionIndex);
      }

      return await base44.entities.RegulatoryUpdate.update(updateId, {
        completed_actions: completedActions
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulationUpdates'] });
      queryClient.invalidateQueries({ queryKey: ['regulationActionItems'] });
      toast.success('Action completed');
    }
  });

  const toggleExpanded = (updateId) => {
    setExpandedAlerts(prev => ({
      ...prev,
      [updateId]: !prev[updateId]
    }));
  };

  const isAcknowledged = (update) => {
    return update.acknowledged_by?.includes(providerEmail);
  };

  const getCompletedActions = (update) => {
    return update.completed_actions?.[providerEmail] || [];
  };

  const isActionCompleted = (update, actionIndex) => {
    return getCompletedActions(update).includes(actionIndex);
  };

  const getUrgencyColor = (urgency) => {
    if (urgency === 'critical') return 'bg-red-100 text-red-800 border-red-200';
    if (urgency === 'high') return 'bg-orange-100 text-orange-800 border-orange-200';
    if (urgency === 'medium') return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    return 'bg-blue-100 text-blue-800 border-blue-200';
  };

  const getStatusColor = (update) => {
    const effectiveDate = new Date(update.effective_date);
    const today = new Date();
    const daysUntil = Math.ceil((effectiveDate - today) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) return 'text-red-600';
    if (daysUntil <= 7) return 'text-orange-600';
    if (daysUntil <= 30) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getDaysUntilEffective = (update) => {
    const effectiveDate = new Date(update.effective_date);
    const today = new Date();
    const daysUntil = Math.ceil((effectiveDate - today) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) return `Effective ${Math.abs(daysUntil)} days ago`;
    if (daysUntil === 0) return 'Effective today';
    if (daysUntil === 1) return 'Effective tomorrow';
    return `Effective in ${daysUntil} days`;
  };

  const getProgressPercentage = (update) => {
    if (!update.action_items?.length) return 100;
    const completed = getCompletedActions(update).length;
    return Math.round((completed / update.action_items.length) * 100);
  };

  // Get unacknowledged critical/high priority updates
  const urgentUpdates = updates.filter(u => 
    !isAcknowledged(u) && 
    (u.urgency === 'critical' || u.urgency === 'high')
  );

  if (isLoading) {
    return (
      <Card className="border-amber-200">
        <CardContent className="p-6 text-center text-gray-500">
          Loading regulation updates...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-amber-50 to-orange-50">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-600" />
            Regulation Change Alerts
          </span>
          {urgentUpdates.length > 0 && (
            <Badge className="bg-red-100 text-red-800 border-red-200">
              {urgentUpdates.length} Urgent
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        {updates.length === 0 ? (
          <div className="text-center py-6">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
            <p className="text-sm text-gray-600">All caught up! No new regulation updates.</p>
          </div>
        ) : (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-2 pb-3 border-b">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{updates.length}</div>
                <div className="text-xs text-gray-600">Total Updates</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">{urgentUpdates.length}</div>
                <div className="text-xs text-gray-600">Need Action</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {updates.filter(u => isAcknowledged(u)).length}
                </div>
                <div className="text-xs text-gray-600">Acknowledged</div>
              </div>
            </div>

            {/* Updates List */}
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {updates.map(update => (
                <div key={update.id} className="border rounded-lg overflow-hidden">
                  {/* Update Header */}
                  <div 
                    className={`p-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                      !isAcknowledged(update) ? 'bg-amber-50' : 'bg-white'
                    }`}
                    onClick={() => toggleExpanded(update.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={getUrgencyColor(update.urgency)}>
                            {update.urgency?.toUpperCase()}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {update.regulation_source}
                          </Badge>
                          {!isAcknowledged(update) && (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">
                              New
                            </Badge>
                          )}
                        </div>
                        <h4 className="text-sm font-semibold text-gray-900 mb-1">
                          {update.title}
                        </h4>
                        <div className="flex items-center gap-3 text-xs text-gray-600">
                          <span className={`flex items-center gap-1 font-medium ${getStatusColor(update)}`}>
                            <Clock className="w-3 h-3" />
                            {getDaysUntilEffective(update)}
                          </span>
                          <span>
                            {formatEastern(new Date(update.effective_date), 'MMM d, yyyy')}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {update.action_items?.length > 0 && (
                          <div className="text-xs text-right">
                            <div className="font-semibold text-gray-900">
                              {getCompletedActions(update).length}/{update.action_items.length}
                            </div>
                            <div className="text-gray-600">Actions</div>
                          </div>
                        )}
                        {expandedAlerts[update.id] ? (
                          <ChevronUp className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {expandedAlerts[update.id] && (
                    <div className="p-3 bg-gray-50 border-t space-y-3">
                      {/* Summary */}
                      <div>
                        <p className="text-sm text-gray-700">{update.summary}</p>
                      </div>

                      {/* Impact */}
                      {update.impact && (
                        <Alert className="border-blue-200 bg-blue-50">
                          <AlertTriangle className="w-4 h-4 text-blue-600" />
                          <AlertDescription className="text-blue-900 text-xs">
                            <strong>Impact:</strong> {update.impact}
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* Action Items */}
                      {update.action_items && update.action_items.length > 0 && (
                        <div className="space-y-2">
                          <h5 className="text-xs font-semibold text-gray-700">Required Actions:</h5>
                          <div className="space-y-2">
                            {update.action_items.map((action, idx) => (
                              <div 
                                key={idx}
                                className={`p-2 rounded border text-xs ${
                                  isActionCompleted(update, idx)
                                    ? 'bg-green-50 border-green-200'
                                    : 'bg-white border-gray-200'
                                }`}
                              >
                                <div className="flex items-start gap-2">
                                  <button
                                    onClick={() => completeActionMutation.mutate({ 
                                      updateId: update.id, 
                                      actionIndex: idx 
                                    })}
                                    className="mt-0.5 flex-shrink-0"
                                  >
                                    {isActionCompleted(update, idx) ? (
                                      <CheckCircle className="w-4 h-4 text-green-600" />
                                    ) : (
                                      <div className="w-4 h-4 rounded-full border-2 border-gray-300 hover:border-blue-500" />
                                    )}
                                  </button>
                                  <div className="flex-1">
                                    <p className={`font-medium ${
                                      isActionCompleted(update, idx) 
                                        ? 'text-green-900 line-through' 
                                        : 'text-gray-900'
                                    }`}>
                                      {action.title}
                                    </p>
                                    <p className="text-gray-600 mt-1">{action.description}</p>
                                    {action.steps && (
                                      <ol className="mt-2 space-y-1 text-gray-700 list-decimal list-inside">
                                        {action.steps.map((step, stepIdx) => (
                                          <li key={stepIdx} className="text-xs">{step}</li>
                                        ))}
                                      </ol>
                                    )}
                                    {action.documentation_template && (
                                      <div className="mt-2 p-2 bg-gray-100 rounded text-xs">
                                        <strong>Template:</strong> {action.documentation_template}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Reference Link */}
                      {update.reference_url && (
                        <a
                          href={update.reference_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View Official Documentation
                        </a>
                      )}

                      {/* Acknowledge Button */}
                      {!isAcknowledged(update) && (
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            acknowledgeUpdateMutation.mutate(update.id);
                          }}
                          size="sm"
                          className="w-full bg-amber-600 hover:bg-amber-700"
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Acknowledge & Mark as Read
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <p className="text-xs text-gray-500 pt-2 border-t">
          Regulation updates are monitored automatically. Complete all action items before effective dates.
        </p>
      </CardContent>
    </Card>
  );
}