import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap, Loader2, GraduationCap, UserPlus, AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";

export default function NextBestActionSuggestions({ 
  enhancedNote, 
  patientContext, 
  visitType,
  patientId,
  currentUser 
}) {
  const [suggestions, setSuggestions] = useState(null);
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  const generateSuggestions = async () => {
    setLoading(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical decision support system. Based on the following clinical documentation and patient context, suggest the NEXT BEST ACTIONS the healthcare provider should take.

CLINICAL NOTE:
${enhancedNote}

${patientContext ? `PATIENT CONTEXT:
- Name: ${patientContext.patient_name}
- Primary Diagnosis: ${patientContext.primary_diagnosis}
- Active Care Plans: ${patientContext.active_care_plans?.length || 0}
- Recent Medications: ${patientContext.current_medications?.map(m => m.name).join(', ') || 'None'}
` : ''}

Analyze the note and suggest 3-5 specific next actions. Consider:
- Clinical risks that need monitoring
- Follow-up appointments needed
- Patient education opportunities
- Care coordination needs
- Training gaps for the provider
- Referrals that may be appropriate

Return JSON with this structure:
{
  "actions": [
    {
      "action_type": "risk_alert|training|referral|follow_up|education|coordination",
      "title": "Brief action title",
      "description": "Detailed description",
      "priority": "critical|high|medium|low",
      "reason": "Why this action is recommended",
      "timeframe": "immediate|24_hours|this_week|next_visit"
    }
  ]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action_type: { type: "string" },
                  title: { type: "string" },
                  description: { type: "string" },
                  priority: { type: "string" },
                  reason: { type: "string" },
                  timeframe: { type: "string" }
                }
              }
            }
          }
        }
      });

      setSuggestions(response.actions || []);
    } catch (error) {
      console.error('Error generating NBA suggestions:', error);
      toast.error("Failed to generate action suggestions");
    } finally {
      setLoading(false);
    }
  };

  const executeAction = async (action) => {
    try {
      if (action.action_type === 'training') {
        // Find relevant training modules
        const modules = await base44.entities.TrainingModule.filter({
          category: 'clinical',
          is_active: true
        });
        
        toast.success('Suggested training modules available in Training Hub');
      } else if (action.action_type === 'referral') {
        // Create referral record
        await base44.entities.Referral.create({
          patient_id: patientId,
          referral_type: 'specialist',
          reason: action.reason,
          urgency: action.priority,
          requested_by: currentUser?.email,
          status: 'pending'
        });
        toast.success('Referral request created');
      } else {
        // Create a task for other action types
        const dueDate = (() => {
          const today = new Date();
          switch (action.timeframe) {
            case 'immediate': return today.toISOString().split('T')[0];
            case '24_hours':
              today.setDate(today.getDate() + 1);
              return today.toISOString().split('T')[0];
            case 'this_week':
              today.setDate(today.getDate() + 7);
              return today.toISOString().split('T')[0];
            default: return null;
          }
        })();

        await base44.entities.Task.create({
          title: action.title,
          description: action.description,
          priority: action.priority,
          type: action.action_type,
          due_date: dueDate,
          patient_id: patientId,
          assigned_to: currentUser?.email,
          source: 'ai_generated',
          ai_reason: action.reason,
          status: 'pending'
        });
        
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        toast.success('Action added to your task list');
      }
    } catch (error) {
      console.error('Error executing action:', error);
      toast.error('Failed to execute action');
    }
  };

  const getActionIcon = (type) => {
    switch (type) {
      case 'training': return GraduationCap;
      case 'referral': return UserPlus;
      case 'risk_alert': return AlertTriangle;
      default: return CheckCircle2;
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical': return 'bg-red-600';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      default: return 'bg-blue-500';
    }
  };

  return (
    <Card className="border-indigo-300 bg-indigo-50 dark:bg-indigo-950">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-indigo-600" />
            Next Best Actions
          </span>
          {!suggestions && (
            <Button
              onClick={generateSuggestions}
              disabled={loading}
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Generate Suggestions
                </>
              )}
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {suggestions && suggestions.length > 0 ? (
          <div className="space-y-3">
            {suggestions.map((action, idx) => {
              const Icon = getActionIcon(action.action_type);
              return (
                <div
                  key={idx}
                  className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-indigo-200 dark:border-indigo-800"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Icon className="w-4 h-4 text-indigo-600" />
                        <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                          {action.title}
                        </h4>
                        <Badge className={getPriorityColor(action.priority)}>
                          {action.priority}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {action.timeframe?.replace('_', ' ')}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                        {action.description}
                      </p>
                      <div className="bg-blue-50 dark:bg-blue-900/30 p-2 rounded text-xs text-blue-800 dark:text-blue-200">
                        <strong>Why:</strong> {action.reason}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => executeAction(action)}
                      className="bg-indigo-600 hover:bg-indigo-700 flex-shrink-0"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-slate-500 dark:text-slate-400 text-sm">
            <Zap className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>Click "Generate Suggestions" to get AI-powered next best actions</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}