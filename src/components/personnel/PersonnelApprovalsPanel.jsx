import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { sendInAppNotification } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PersonnelStatusBadge from "@/components/personnel/PersonnelStatusBadge";

export default function PersonnelApprovalsPanel({ items = [], currentUser }) {
  const queryClient = useQueryClient();
  const [reasons, setReasons] = useState({});

  const decisionMutation = useMutation({
    mutationFn: async ({ item, status }) => {
      // On approval, supersede any prior approved credential of the same type for
      // this user (mirrors AdminCredentialApproval) — otherwise approving a renewal
      // leaves two simultaneously-active rows for the same license.
      if (status === 'approved') {
        const prior = await base44.entities.PersonnelCredential.filter({
          user_id: item.user_id,
          title: item.title,
          status: 'approved',
        }).catch(() => []);
        await Promise.all(
          (prior || [])
            .filter((old) => old.id !== item.id)
            .map((old) => base44.entities.PersonnelCredential.update(old.id, {
              status: 'expired',
              notes: (old.notes || '') + `\n[Superseded by renewal on ${new Date().toISOString().slice(0, 10)}]`,
            }))
        );
      }

      await base44.entities.PersonnelCredential.update(item.id, {
        status,
        approved_by: status === 'approved' ? currentUser.email : item.approved_by,
        approved_at: status === 'approved' ? new Date().toISOString() : item.approved_at,
        rejection_reason: status === 'rejected' ? reasons[item.id] || '' : '',
      });

      await sendInAppNotification({
        user_email: item.user_id,
        title: status === 'approved' ? 'Personnel file item approved' : 'Personnel file item needs correction',
        message: status === 'approved'
          ? `${item.title} was approved and remains active in your personnel file.`
          : `${item.title} was rejected. Please upload a corrected copy.`,
        type: 'info',
        priority: status === 'approved' ? 'medium' : 'high',
        action_url: '/PersonnelFile',
        action_label: 'Open personnel file',
        metadata: { personnel_credential_id: item.id }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["personnel-credentials"] });
    }
  });

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <div className="text-sm text-slate-500">No pending personnel file approvals.</div>
      ) : (
        items.map((item) => (
          <div key={item.id} className="rounded-2xl border p-4 bg-white space-y-3">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">{item.title}</h3>
                <p className="text-sm text-slate-500">{item.user_name} • {item.item_type} • expires {item.expiration_date ? new Date(`${item.expiration_date}T00:00:00`).toLocaleDateString() : '—'}</p>
                {item.uploaded_file_url && <a href={item.uploaded_file_url} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 underline">Open uploaded copy</a>}
              </div>
              <PersonnelStatusBadge status={item.status} />
            </div>
            <Input placeholder="Optional rejection reason" value={reasons[item.id] || ""} onChange={(e) => setReasons((prev) => ({ ...prev, [item.id]: e.target.value }))} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => decisionMutation.mutate({ item, status: 'approved' })}>Approve</Button>
              <Button variant="outline" className="text-red-600 border-red-200" onClick={() => decisionMutation.mutate({ item, status: 'rejected' })}>Reject</Button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}