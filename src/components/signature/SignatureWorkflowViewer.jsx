import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  FileText, 
  CheckCircle,
  Circle,
  Clock,
  AlertCircle,
  Send,
  Eye,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';

export default function SignatureWorkflowViewer({ patientId }) {
  const queryClient = useQueryClient();

  const { data: workflows, isLoading } = useQuery({
    queryKey: ['signature-workflows', patientId],
    queryFn: () => base44.entities.DocumentSignature.filter({ patient_id: patientId })
  });

  const { data: documents } = useQuery({
    queryKey: ['patient-documents', patientId],
    queryFn: () => base44.entities.PatientDocument.filter({ patient_id: patientId })
  });

  const sendReminderMutation = useMutation({
    mutationFn: async (workflowId) => {
      const workflow = workflows.find(w => w.id === workflowId);
      
      // Send reminders to unsigned signers
      for (const signer of workflow.signers) {
        if (!signer.signed_at && signer.email) {
          await base44.integrations.Core.SendEmail({
            to: signer.email,
            subject: `Reminder: Signature Required - ${workflow.document_type}`,
            body: `
              <p>Hello ${signer.signer_name},</p>
              <p>This is a reminder that your signature is still required for:</p>
              <p><strong>${workflow.document_type}</strong></p>
              <p>Please log in to CareMetric AI to complete the signature.</p>
              <p>This request expires on ${new Date(workflow.expiration_date).toLocaleDateString()}.</p>
            `
          });
        }
      }

      // Update reminder count
      await base44.entities.DocumentSignature.update(workflowId, {
        reminder_sent_count: (workflow.reminder_sent_count || 0) + 1,
        last_reminder_sent: new Date().toISOString()
      });

      return workflow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['signature-workflows']);
      toast.success('Reminders sent');
    },
    onError: (error) => {
      toast.error('Failed to send reminders: ' + error.message);
    }
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!workflows || workflows.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <FileText className="h-12 w-12 text-slate-400 mx-auto mb-3" />
          <p className="text-slate-600">No signature workflows</p>
        </CardContent>
      </Card>
    );
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'partial': return 'bg-blue-100 text-blue-800';
      case 'expired': return 'bg-red-100 text-red-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-slate-900">Signature Workflows</h2>
      
      {workflows.map(workflow => {
        const document = documents?.find(d => d.id === workflow.document_id);
        const totalSigners = workflow.signers?.length || 0;
        const signedCount = workflow.signers?.filter(s => s.signed_at).length || 0;
        const progress = totalSigners > 0 ? (signedCount / totalSigners) * 100 : 0;
        const isExpired = new Date(workflow.expiration_date) < new Date();

        return (
          <Card key={workflow.id}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-lg">{workflow.document_type}</h3>
                    <Badge className={getStatusColor(workflow.workflow_status)}>
                      {workflow.workflow_status}
                    </Badge>
                    {isExpired && (
                      <Badge className="bg-red-100 text-red-800">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        Expired
                      </Badge>
                    )}
                  </div>
                  {document && (
                    <p className="text-sm text-slate-600 mb-3">{document.document_name}</p>
                  )}
                  
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Signature Progress</span>
                      <span className="text-sm font-bold">{signedCount}/{totalSigners}</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>

                  {/* Signers */}
                  <div className="space-y-2">
                    {workflow.signers?.map((signer, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                        <div className="flex items-center gap-2">
                          {signer.signed_at ? (
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          ) : (
                            <Circle className="h-4 w-4 text-slate-400" />
                          )}
                          <div>
                            <p className="text-sm font-medium">{signer.signer_name}</p>
                            <p className="text-xs text-slate-600">{signer.signer_role}</p>
                          </div>
                        </div>
                        {signer.signed_at ? (
                          <Badge variant="outline" className="text-xs bg-green-50">
                            Signed {new Date(signer.signed_at).toLocaleDateString()}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            Pending
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Timeline */}
                  <div className="mt-4 text-xs text-slate-600">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3 w-3" />
                      <span>Created: {new Date(workflow.created_date).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <AlertCircle className="h-3 w-3" />
                      <span>Expires: {new Date(workflow.expiration_date).toLocaleDateString()}</span>
                    </div>
                    {workflow.completed_at && (
                      <div className="flex items-center gap-2 mt-1">
                        <CheckCircle className="h-3 w-3 text-green-600" />
                        <span>Completed: {new Date(workflow.completed_at).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  {workflow.workflow_status === 'pending' && !isExpired && (
                    <Button
                      size="sm"
                      onClick={() => sendReminderMutation.mutate(workflow.id)}
                      disabled={sendReminderMutation.isPending}
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Send Reminder
                    </Button>
                  )}
                  {workflow.document_url && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(workflow.document_url, '_blank')}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}