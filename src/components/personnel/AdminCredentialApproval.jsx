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
import { formatLocalDate } from "@/lib/dateLocal";
import { isAdminLike } from "@/lib/superAdmin";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PATIENT_HISTORY_ROWS } from '@/lib/queryLimits';
import { isSafeExternalUrl } from "@/components/utils/security";

// Guarded date formatter: date-only ISO strings must use local calendar parsing
// (parseISO treats YYYY-MM-DD as UTC midnight and can shift the displayed day).
const fmtDate = (value) => formatLocalDate(value, { month: 'short', day: 'numeric', year: 'numeric' }) || "—";

export default function AdminCredentialApproval() {
  const [selectedCredential, setSelectedCredential] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: pendingCredentials = [] } = useQuery({
    queryKey: ['pendingCredentials'],
    queryFn: () => base44.entities.PersonnelCredential.filter({ status: 'pending_approval' }, undefined, PATIENT_HISTORY_ROWS),
    initialData: [],
  });

  // Approval/rejection goes through the admin-gated reviewPersonnelCredential
  // backend function (which supersedes old approved copies and notifies the
  // employee) — the entity's write RLS is admin-only and the decision fields
  // are stamped server-side.
  const approveMutation = useMutation({
    mutationFn: async (credential) => {
      const res = await base44.functions.invoke('reviewPersonnelCredential', {
        credential_id: credential.id,
        action: 'approve',
      });
      const data = res?.data ?? res;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("Credential approved and employee notified");
    },
    onError: (err) => {
      toast.error(err?.message || "Failed to approve credential");
    },
    // Refresh regardless of outcome so a partial/mail failure never masks an
    // already-written approval by leaving the item looking still-pending.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingCredentials'] });
      queryClient.invalidateQueries({ queryKey: ['userCredentials'] });
      queryClient.invalidateQueries({ queryKey: ['personnel-credentials'] });
      queryClient.invalidateQueries({ queryKey: ['allPersonnelCredentials'] });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ credential, reason }) => {
      const res = await base44.functions.invoke('reviewPersonnelCredential', {
        credential_id: credential.id,
        action: 'reject',
        rejection_reason: reason,
      });
      const data = res?.data ?? res;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingCredentials'] });
      queryClient.invalidateQueries({ queryKey: ['userCredentials'] });
      queryClient.invalidateQueries({ queryKey: ['personnel-credentials'] });
      queryClient.invalidateQueries({ queryKey: ['allPersonnelCredentials'] });
      setShowRejectDialog(false);
      setRejectionReason("");
      setSelectedCredential(null);
      toast.success("Credential rejected and employee notified");
    },
    onError: (err) => {
      toast.error(err?.message || "Failed to reject credential");
    }
  });

  const handleApprove = async (credential) => {
    if (await confirm({ title: "Approve credential?", description: `Approve ${credential.title} for ${credential.user_name}?`, confirmText: "Approve" })) {
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

  // Match the hosting page's Approvals-tab gate (isAgencyAdmin): any admin-like
  // account, not only role === 'admin'. NOTE: the PersonnelCredential RLS read
  // rule still only recognizes role 'admin', so agency_admin/super_admin accounts
  // whose role is 'user' will see an empty list until the read is moved behind a
  // backend function / the RLS policy is widened.
  if (!isAdminLike(currentUser)) {
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
                  {cred.uploaded_file_url && isSafeExternalUrl(cred.uploaded_file_url) && (
                    <a
                      href={cred.uploaded_file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 hover:underline"
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