import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  XCircle,
  FileText,
  ExternalLink,
  Clock,
  User,
  Award
} from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";

// Guarded date formatter: format(parseISO(undefined)) throws a RangeError, which
// would white-screen the whole approvals card if any credential has a null date.
const fmtDate = (value) => {
  if (!value) return "—";
  try { return format(parseISO(value), "MMM d, yyyy"); } catch { return "—"; }
};

export default function AdminCredentialApproval() {
  const [selectedCredential, setSelectedCredential] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: pendingCredentials = [] } = useQuery({
    queryKey: ['pendingCredentials'],
    queryFn: () => base44.entities.PersonnelCredential.filter({ status: 'pending_approval' }),
    initialData: [],
  });

  const approveMutation = useMutation({
    mutationFn: async (credential) => {
      // Mark old credential as expired if it exists
      const oldCredentials = await base44.entities.PersonnelCredential.filter({
        user_id: credential.user_id,
        title: credential.title,
        status: 'approved'
      });

      if (oldCredentials.length > 0) {
        await Promise.all(
          oldCredentials.map(old =>
            base44.entities.PersonnelCredential.update(old.id, {
              status: 'expired',
              notes: (old.notes || '') + `\n[Superseded by renewal on ${format(new Date(), 'yyyy-MM-dd')}]`
            })
          )
        );
      }

      // Approve new credential
      await base44.entities.PersonnelCredential.update(credential.id, {
        status: 'approved',
        approved_by: currentUser?.email,
        approved_at: new Date().toISOString()
      });

      // Notify employee
      await base44.integrations.Core.SendEmail({
        to: credential.user_id,
        subject: `✅ Credential Approved - ${credential.title}`,
        body: `Dear ${credential.user_name},

Your credential renewal has been approved:

Credential: ${credential.title}
Type: ${credential.item_type}
New Expiration: ${fmtDate(credential.expiration_date)}
Approved By: ${currentUser?.full_name}

Your personnel file has been updated. You can view your current credentials in the Personnel File section.

Thank you,
Credential Management System`
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingCredentials'] });
      queryClient.invalidateQueries({ queryKey: ['userCredentials'] });
      toast.success("Credential approved and employee notified");
    },
    onError: () => {
      toast.error("Failed to approve credential");
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ credential, reason }) => {
      await base44.entities.PersonnelCredential.update(credential.id, {
        status: 'rejected',
        rejection_reason: reason,
        approved_by: currentUser?.email,
        approved_at: new Date().toISOString()
      });

      // Notify employee
      await base44.integrations.Core.SendEmail({
        to: credential.user_id,
        subject: `❌ Credential Renewal Requires Revision - ${credential.title}`,
        body: `Dear ${credential.user_name},

Your credential renewal submission requires revision:

Credential: ${credential.title}
Type: ${credential.item_type}

Reason for rejection:
${reason}

Please re-upload a corrected document in your Personnel File.

If you have questions, please contact your supervisor.

Thank you,
Credential Management System`
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingCredentials'] });
      setShowRejectDialog(false);
      setRejectionReason("");
      setSelectedCredential(null);
      toast.success("Credential rejected and employee notified");
    },
    onError: () => {
      toast.error("Failed to reject credential");
    }
  });

  const handleApprove = (credential) => {
    if (window.confirm(`Approve ${credential.title} for ${credential.user_name}?`)) {
      approveMutation.mutate(credential);
    }
  };

  const handleReject = (e) => {
    e.preventDefault();
    rejectMutation.mutate({
      credential: selectedCredential,
      reason: rejectionReason
    });
  };

  if (currentUser?.role !== 'admin') {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-orange-600" />
          Pending Credential Approvals ({pendingCredentials.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {pendingCredentials.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-green-500" />
            <p>No pending approvals</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingCredentials.map(cred => (
              <div key={cred.id} className="border rounded-lg p-4 bg-blue-50">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <User className="w-4 h-4 text-slate-600" />
                      <h4 className="font-semibold text-slate-900">{cred.user_name}</h4>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <Award className="w-4 h-4 text-indigo-600" />
                      <p className="text-sm font-medium text-slate-700">{cred.title}</p>
                    </div>
                    <p className="text-sm text-slate-600">
                      {cred.issuing_organization} • {cred.item_type}
                    </p>
                    <div className="mt-2 text-sm">
                      <p className="text-slate-600">
                        New Expiration: <span className="font-medium">{fmtDate(cred.expiration_date)}</span>
                      </p>
                      <p className="text-slate-600">
                        Submitted: {fmtDate(cred.created_date)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mb-3">
                  {cred.uploaded_file_url && (
                    <a
                      href={cred.uploaded_file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700"
                    >
                      <FileText className="w-4 h-4" />
                      View Document
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleApprove(cred)}
                    disabled={approveMutation.isPending}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Approve
                  </Button>
                  <Dialog open={showRejectDialog && selectedCredential?.id === cred.id} onOpenChange={(open) => {
                    setShowRejectDialog(open);
                    if (!open) {
                      setSelectedCredential(null);
                      setRejectionReason("");
                    }
                  }}>
                    <DialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => setSelectedCredential(cred)}
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        Reject
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Reject Credential Renewal</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleReject} className="space-y-4">
                        <div>
                          <Label>Reason for Rejection *</Label>
                          <Textarea
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="Explain why this credential is being rejected..."
                            rows={4}
                            required
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setShowRejectDialog(false);
                              setRejectionReason("");
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            disabled={rejectMutation.isPending}
                            className="bg-red-600 hover:bg-red-700"
                          >
                            Submit Rejection
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}