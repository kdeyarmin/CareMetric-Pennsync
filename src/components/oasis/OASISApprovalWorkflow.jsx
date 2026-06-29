import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { logOASISAction, AuditActions } from "../utils/auditLogger";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle2,
  XCircle,
  Shield,
  User
} from "lucide-react";
import { toast } from 'sonner';

export default function OASISApprovalWorkflow({ pendingItems = [], onApprove }) {
  const queryClient = useQueryClient();
  const [selectedItem, setSelectedItem] = useState(null);
  const [approvalNotes, setApprovalNotes] = useState("");

  const approveMutation = useMutation({
    mutationFn: async ({ oasisId, patientId, action, notes }) => {
      const oasis = await base44.entities.OASISUpload.filter({ id: oasisId });
      if (!oasis[0]) throw new Error("OASIS record not found");
      
      const updatedData = { ...oasis[0].extracted_data };
      const currentUser = await base44.auth.me();
      
      // Update all reviewed items with supervisor approval
      const reviewedItems = [];
      Object.keys(updatedData).forEach(key => {
        if (updatedData[key]?.reviewed && !updatedData[key]?.supervisor_approved) {
          updatedData[key] = {
            ...updatedData[key],
            supervisor_approved: action === 'approve',
            supervisor_rejected: action === 'reject',
            approved_by: currentUser.email,
            approval_date: new Date().toISOString(),
            approval_notes: notes
          };
          reviewedItems.push(key);
        }
      });

      // Log supervisor action
      await logOASISAction({
        action: action === 'approve' ? AuditActions.OASIS_SUPERVISOR_APPROVED : AuditActions.OASIS_SUPERVISOR_REJECTED,
        patientId,
        oasisId,
        itemNumber: reviewedItems.join(', '),
        notes,
        reviewedBy: currentUser.email,
      });

      return base44.entities.OASISUpload.update(oasisId, {
        extracted_data: updatedData,
        supervisor_review_status: action === 'approve' ? 'approved' : 'rejected',
        supervisor_reviewed_by: currentUser.email,
        supervisor_reviewed_at: new Date().toISOString()
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['oasisRecords'] });
      onApprove?.(variables.patientId);
      setSelectedItem(null);
      setApprovalNotes("");
    },
    onError: (error) => {
      toast.error(`Couldn't record the review: ${error?.message || 'please try again.'}`);
    },
  });

  const handleApprove = (item) => {
    approveMutation.mutate({
      oasisId: item.oasis.id,
      patientId: item.patientId,
      action: 'approve',
      notes: approvalNotes
    });
  };

  const handleReject = (item) => {
    if (!approvalNotes) {
      toast.error("Please provide rejection notes");
      return;
    }
    approveMutation.mutate({
      oasisId: item.oasis.id,
      patientId: item.patientId,
      action: 'reject',
      notes: approvalNotes
    });
  };

  if (pendingItems.length === 0) {
    return (
      <Alert className="bg-green-50 border-green-200">
        <CheckCircle2 className="w-4 h-4 text-green-600" />
        <AlertDescription className="text-sm text-green-800">
          No OASIS submissions pending supervisor approval.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Alert className="bg-navy-50 border-navy-200">
        <Shield className="w-4 h-4 text-navy-600" />
        <AlertDescription className="text-sm text-navy-800">
          <strong>Supervisor Review Queue:</strong> Review and approve nurse-completed OASIS reviews before final submission.
        </AlertDescription>
      </Alert>

      {pendingItems.map((item) => (
        <Card key={item.patientId} className="border-2 border-navy-200">
          <CardHeader className="py-4 bg-gradient-to-r from-navy-50 to-blue-50">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">
                  {item.patient?.first_name} {item.patient?.last_name}
                </CardTitle>
                <div className="flex items-center gap-2 mt-2">
                  <Badge className="bg-blue-100 text-blue-800">
                    {item.approvedCount} approved
                  </Badge>
                  <Badge className="bg-red-100 text-red-800">
                    {item.rejectedCount} rejected
                  </Badge>
                  <Badge className="bg-yellow-100 text-yellow-800">
                    {item.pendingCount} pending
                  </Badge>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => setSelectedItem(selectedItem?.patientId === item.patientId ? null : item)}
              >
                {selectedItem?.patientId === item.patientId ? 'Collapse' : 'Review Details'}
              </Button>
            </div>
          </CardHeader>

          {selectedItem?.patientId === item.patientId && (
            <CardContent className="p-6 space-y-4">
              {/* Approved Items */}
              {item.aiSuggestions
                .filter(([_k, d]) => d.approved)
                .map(([itemNumber, data]) => (
                  <div key={itemNumber} className="bg-green-50 p-4 rounded-lg border border-green-200">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <Badge variant="outline" className="mb-2">{itemNumber}</Badge>
                        <p className="text-sm">
                          <strong>Value:</strong> {data.value} {data.label && `(${data.label})`}
                        </p>
                        <p className="text-xs text-slate-600 mt-1">
                          <User className="w-3 h-3 inline mr-1" />
                          Approved by {data.reviewed_by} on {new Date(data.reviewed_at).toLocaleDateString()}
                        </p>
                        {data.review_notes && (
                          <p className="text-xs text-slate-700 mt-2 italic">Notes: {data.review_notes}</p>
                        )}
                      </div>
                      <Badge className="bg-green-600 text-white">Approved</Badge>
                    </div>
                  </div>
                ))}

              {/* Rejected Items */}
              {item.aiSuggestions
                .filter(([_k, d]) => d.rejected)
                .map(([itemNumber, data]) => (
                  <div key={itemNumber} className="bg-red-50 p-4 rounded-lg border border-red-200">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <Badge variant="outline" className="mb-2">{itemNumber}</Badge>
                        <p className="text-sm">
                          <strong>Original AI Suggestion:</strong> {data.value}
                        </p>
                        <p className="text-xs text-slate-600 mt-1">
                          <User className="w-3 h-3 inline mr-1" />
                          Rejected by {data.reviewed_by} on {new Date(data.reviewed_at).toLocaleDateString()}
                        </p>
                        {data.rejection_reason && (
                          <p className="text-xs text-red-700 mt-2 italic">Reason: {data.rejection_reason}</p>
                        )}
                      </div>
                      <Badge className="bg-red-600 text-white">Rejected</Badge>
                    </div>
                  </div>
                ))}

              {/* Supervisor Actions */}
              <div className="border-t pt-4 space-y-3">
                <Textarea
                  placeholder="Add supervisor approval notes (optional for approval, required for rejection)..."
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  className="h-24"
                />
                <div className="flex gap-3">
                  <Button
                    onClick={() => handleApprove(item)}
                    disabled={approveMutation.isPending}
                    className="flex-1 bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Approve All for Submission
                  </Button>
                  <Button
                    onClick={() => handleReject(item)}
                    disabled={approveMutation.isPending || !approvalNotes}
                    variant="outline"
                    className="flex-1 border-red-300 text-red-600 hover:bg-red-50"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Reject & Return to Nurse
                  </Button>
                </div>
              </div>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}