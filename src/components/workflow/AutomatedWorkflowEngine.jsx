import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Workflow, 
  Play, 
  CheckCircle,
  Clock,
  AlertCircle,
  Loader2
} from 'lucide-react';

export default function AutomatedWorkflowEngine({ entityType, entityId, triggerEvent }) {
  const queryClient = useQueryClient();

  const { data: workflows } = useQuery({
    queryKey: ['workflows', entityType, triggerEvent],
    queryFn: async () => {
      const definitions = await base44.entities.WorkflowDefinition.filter({
        entity_type: entityType,
        trigger_event: triggerEvent,
        is_active: true
      });
      return definitions;
    }
  });

  const executeWorkflowMutation = useMutation({
    mutationFn: async (workflowId) => {
      const workflow = workflows.find(w => w.id === workflowId);
      
      // Create execution record
      const execution = await base44.entities.WorkflowExecution.create({
        workflow_id: workflowId,
        entity_type: entityType,
        entity_id: entityId,
        status: 'running',
        started_at: new Date().toISOString()
      });

      // Execute workflow steps
      try {
        const steps = workflow.steps || [];
        const results = [];

        for (const step of steps) {
          let stepResult;
          
          switch (step.action_type) {
            case 'create_task':
              stepResult = await base44.entities.Task.create({
                ...step.action_config,
                patient_id: entityId
              });
              break;
            
            case 'send_notification':
              stepResult = await base44.integrations.Core.SendEmail({
                to: step.action_config.recipient,
                subject: step.action_config.subject,
                body: step.action_config.body
              });
              break;
            
            case 'update_entity':
              stepResult = await base44.entities[step.action_config.entity].update(
                entityId,
                step.action_config.data
              );
              break;
            
            default:
              stepResult = { skipped: true };
          }

          results.push({
            step: step.step_name,
            status: 'completed',
            result: stepResult
          });
        }

        // Update execution as completed
        await base44.entities.WorkflowExecution.update(execution.id, {
          status: 'completed',
          completed_at: new Date().toISOString(),
          results
        });

        return execution;
      } catch (error) {
        // Mark as failed
        await base44.entities.WorkflowExecution.update(execution.id, {
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error.message
        });
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['workflow-executions']);
    }
  });

  if (!workflows || workflows.length === 0) return null;

  return (
    <Card className="border-2 border-purple-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Workflow className="h-5 w-5 text-purple-600" />
          Automated Workflows ({workflows.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {workflows.map(workflow => (
            <div key={workflow.id} className="flex items-center justify-between p-3 bg-purple-50 border border-purple-200 rounded-lg">
              <div className="flex-1">
                <p className="font-medium text-sm">{workflow.workflow_name}</p>
                <p className="text-xs text-slate-600">{workflow.description}</p>
                <Badge variant="outline" className="mt-2 text-xs">
                  {workflow.steps?.length || 0} steps
                </Badge>
              </div>
              <Button
                size="sm"
                onClick={() => executeWorkflowMutation.mutate(workflow.id)}
                disabled={executeWorkflowMutation.isPending}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {executeWorkflowMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run
                  </>
                )}
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}