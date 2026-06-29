import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { configNotReadyMessage } from "@/lib/aiFeatureError";
import { distributePolicyAcknowledgment } from "@/functions/distributePolicyAcknowledgment";
import { policyAcknowledgment } from "@/functions/policyAcknowledgment";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileCheck2, Loader2, Download, ClipboardList } from "lucide-react";
import AssignmentWizard from "@/components/training/AssignmentWizard";
import AccessDeniedState from "@/components/ui/AccessDeniedState";
import { toast } from "sonner";

export default function PolicyAcknowledgmentManager() {
  const queryClient = useQueryClient();
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [distributing, setDistributing] = useState(false);
  const [result, setResult] = useState(null);

  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const isAdminUser = currentUser?.role === "admin" || currentUser?.account_type === "agency_admin" || currentUser?.account_type === "super_admin";

  const { data: users = [] } = useQuery({ queryKey: ["policy-users"], queryFn: () => base44.entities.User.list("-created_date", 500), initialData: [], enabled: isAdminUser });
  const { data: policies = [] } = useQuery({ queryKey: ["policy-library"], queryFn: () => base44.entities.PolicyLibrary.list("-created_date", 200), initialData: [], enabled: isAdminUser });
  // Read org-wide acknowledgments through the service-role `list` action so
  // account_type admins (agency_admin/super_admin) see all rows, not just their
  // own (the entity read RLS follows the codebase `role: admin` convention).
  const { data: acks = [] } = useQuery({
    queryKey: ["policy-acks"],
    queryFn: async () => {
      const res = await policyAcknowledgment({ action: "list" });
      return (res?.data || res)?.acknowledgments || [];
    },
    initialData: [],
    enabled: isAdminUser,
  });

  const activePolicies = useMemo(() => policies.filter((p) => p.status !== "archived"), [policies]);
  const selectedPolicy = activePolicies.find((p) => p.id === selectedPolicyId);

  // Per-policy roll-up of the current version's acknowledgments.
  const policyStats = useMemo(() => {
    const byPolicy = {};
    for (const policy of policies) {
      const version = policy.version || "1";
      const rows = acks.filter((a) => a.policy_id === policy.id && a.policy_version === version);
      const acknowledged = rows.filter((a) => a.acknowledged).length;
      const overdue = rows.filter((a) => !a.acknowledged && a.due_date && new Date(a.due_date) < new Date()).length;
      byPolicy[policy.id] = { total: rows.length, acknowledged, overdue, version, rows };
    }
    return byPolicy;
  }, [policies, acks]);

  const distribute = async (payload) => {
    if (!selectedPolicyId) {
      toast.error("Select a policy first");
      return;
    }
    setDistributing(true);
    setResult(null);
    try {
      const res = await distributePolicyAcknowledgment({
        policyId: selectedPolicyId,
        dueDate: dueDate || null,
        userEmails: payload?.userEmails || [],
        filters: payload?.filters || {},
      });
      setResult(res?.data || res);
      queryClient.invalidateQueries({ queryKey: ["policy-acks"] });
    } catch (error) {
      setResult({ error: configNotReadyMessage(error) || error?.message || "Failed to distribute policy." });
    } finally {
      setDistributing(false);
    }
  };

  const exportCSV = (policy) => {
    const stats = policyStats[policy.id];
    if (!stats || stats.rows.length === 0) {
      toast.error("No acknowledgments to export yet");
      return;
    }
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Staff", "Email", "Version", "Status", "Signed Name", "Acknowledged At", "Due Date"];
    const lines = stats.rows.map((r) =>
      [r.user_name || "", r.user_id || "", r.policy_version || "", r.acknowledged ? "Acknowledged" : (r.due_date && new Date(r.due_date) < new Date() ? "Overdue" : "Pending"), r.signed_name || "", r.acknowledged_at ? new Date(r.acknowledged_at).toISOString() : "", r.due_date || ""].map(escape).join(",")
    );
    const csv = [`Policy Acknowledgment — ${policy.title} (v${stats.version})`, header.map(escape).join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Policy_Ack_${(policy.policy_number || policy.title).replace(/\s+/g, "_")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (currentUser && !isAdminUser) {
    return <AccessDeniedState description="Policy distribution is available to Agency Admin and Super Admin users only." />;
  }

  return (
    <div className="space-y-6">
      <Card className="border-blue-200 bg-blue-50/40">
        <CardContent className="p-5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0">
            <FileCheck2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Policy Distribution &amp; Acknowledgment</h2>
            <p className="text-sm text-slate-600">
              Distribute a policy to a cohort and require each staff member to read and sign off. Bumping a policy&apos;s version and re-distributing requests a fresh acknowledgment while preserving the prior sign-off history.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Distribute a policy</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select value={selectedPolicyId} onValueChange={setSelectedPolicyId}>
              <SelectTrigger><SelectValue placeholder="Select policy" /></SelectTrigger>
              <SelectContent>
                {activePolicies.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.title}{p.version ? ` (v${p.version})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          {selectedPolicy && (
            <p className="text-sm text-slate-500">
              {selectedPolicy.policy_number ? `${selectedPolicy.policy_number} · ` : ""}Version {selectedPolicy.version || "1"}
              {selectedPolicy.doc_url ? <> · <a className="text-blue-600 underline" href={selectedPolicy.doc_url} target="_blank" rel="noopener noreferrer">Document</a></> : null}
            </p>
          )}
          {result && !result.error && (
            <p className="text-sm text-emerald-700">Distributed to {result.distributed || 0} staff (version {result.policy_version}).</p>
          )}
          {result?.error && <p className="text-sm text-red-600">{result.error}</p>}
          <AssignmentWizard users={users} onAssign={distribute} />
          {distributing && <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Distributing…</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="w-5 h-5 text-blue-600" />Acknowledgment status</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {policies.length === 0 ? (
            <p className="text-center text-slate-500 py-8">No policies in the library yet.</p>
          ) : (
            policies.map((policy) => {
              const stats = policyStats[policy.id] || { total: 0, acknowledged: 0, overdue: 0, version: policy.version || "1" };
              const pct = stats.total > 0 ? Math.round((stats.acknowledged / stats.total) * 100) : 0;
              return (
                <div key={policy.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-xl border p-4">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{policy.title}</p>
                    <p className="text-xs text-slate-500">v{stats.version} · {stats.acknowledged}/{stats.total} acknowledged{stats.overdue ? ` · ${stats.overdue} overdue` : ""}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-40 bg-slate-200 rounded-full h-2.5 overflow-hidden">
                      <div className="bg-blue-600 h-full rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <Badge variant="outline" className="w-14 justify-center">{pct}%</Badge>
                    <Button size="sm" variant="outline" onClick={() => exportCSV(policy)} disabled={stats.total === 0}>
                      <Download className="w-4 h-4 mr-1" />CSV
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
