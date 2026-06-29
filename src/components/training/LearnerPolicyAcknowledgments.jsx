import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FileCheck2, ExternalLink, CheckCircle2, Loader2 } from "lucide-react";
import { policyAcknowledgment } from "@/functions/policyAcknowledgment";
import { toast } from "sonner";

// Learner-facing policy sign-off. Lists the user's PolicyAcknowledgment rows;
// pending ones require reading the document, typing their name, and confirming.
export default function LearnerPolicyAcknowledgments() {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState({}); // ackId -> { name, confirmed }
  const [busyId, setBusyId] = useState(null);

  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const email = currentUser?.email;

  const { data: acks = [], isLoading } = useQuery({
    queryKey: ["my-policy-acks", email],
    queryFn: () => base44.entities.PolicyAcknowledgment.filter({ user_id: email }, "-created_date", 200),
    enabled: !!email,
    initialData: [],
  });

  const pending = useMemo(() => acks.filter((a) => !a.acknowledged), [acks]);
  const completed = useMemo(() => acks.filter((a) => a.acknowledged), [acks]);

  const setDraft = (id, patch) => setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const acknowledge = async (ack) => {
    const draft = drafts[ack.id] || {};
    const signedName = (draft.name || "").trim();
    if (!draft.confirmed || !signedName) {
      toast.error("Confirm you have read the policy and type your name");
      return;
    }
    setBusyId(ack.id);
    try {
      // Sign off through the service-role function — the acknowledgment is an
      // audit record, so learners cannot write the row directly (write RLS is
      // admin-only). The server validates ownership and stamps the transition.
      await policyAcknowledgment({ action: "acknowledge", acknowledgment_id: ack.id, signed_name: signedName });
      toast.success("Policy acknowledged");
      queryClient.invalidateQueries({ queryKey: ["my-policy-acks", email] });
    } catch (err) {
      toast.error("Failed to record acknowledgment");
      console.error(err);
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;
  }

  if (acks.length === 0) {
    return <Card><CardContent className="py-12 text-center text-slate-500">You have no policies to acknowledge right now.</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      {pending.map((ack) => {
        const draft = drafts[ack.id] || {};
        const overdue = ack.due_date && new Date(ack.due_date) < new Date();
        return (
          <Card key={ack.id} className={overdue ? "border-red-200" : "border-blue-200"}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileCheck2 className="w-5 h-5 text-blue-600" />
                  {ack.policy_title}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">v{ack.policy_version}</Badge>
                  {ack.due_date && <Badge className={overdue ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800"}>Due {new Date(ack.due_date).toLocaleDateString()}</Badge>}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {ack.doc_url ? (
                <a href={ack.doc_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-blue-600 underline text-sm">
                  <ExternalLink className="w-4 h-4" />Open policy document
                </a>
              ) : (
                <p className="text-sm text-slate-500">Review the current policy as communicated by your agency.</p>
              )}
              <label htmlFor={`ack-read-${ack.id}`} className="flex items-start gap-3 text-sm text-slate-700">
                <Checkbox id={`ack-read-${ack.id}`} checked={!!draft.confirmed} onCheckedChange={(v) => setDraft(ack.id, { confirmed: !!v })} />
                <span>I have read and understand this policy and agree to comply with it.</span>
              </label>
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                <Input placeholder="Type your full name to sign" value={draft.name || ""} onChange={(e) => setDraft(ack.id, { name: e.target.value })} className="sm:max-w-xs" />
                <Button onClick={() => acknowledge(ack)} disabled={busyId === ack.id}>
                  {busyId === ack.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                  Acknowledge
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {completed.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Acknowledged policies</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {completed.map((ack) => (
              <div key={ack.id} className="flex items-center justify-between gap-3 rounded-xl border p-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 truncate">{ack.policy_title}</p>
                  <p className="text-xs text-slate-500">v{ack.policy_version} · signed {ack.signed_name ? `as ${ack.signed_name}` : ""} {ack.acknowledged_at ? `on ${new Date(ack.acknowledged_at).toLocaleDateString()}` : ""}</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-800"><CheckCircle2 className="w-3 h-3 mr-1" />Acknowledged</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
