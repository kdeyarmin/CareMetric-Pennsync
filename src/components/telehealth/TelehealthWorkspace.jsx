import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { manageTelehealthSession } from "@/functions/manageTelehealthSession";
import { hostedAbsoluteUrl } from "@/lib/assetPath";
import { ROUTER_PATHS } from "@/routes";
import { useAuth } from "@/lib/AuthContext";
import SessionCard from "./SessionCard";
import NewSessionForm from "./NewSessionForm";
import TelehealthCall from "./TelehealthCall";
import SessionDocumentation from "./SessionDocumentation";
import { rememberJoinLink } from "./joinLinkAccess";
import { buildPatientJoinLink } from "./telehealthUtils";

// Shared staff telehealth UI: list, schedule, join, document, cancel.
export default function TelehealthWorkspace({ patientId, patientName }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ["telehealthSessions", patientId || "mine"];
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [live, setLive] = useState(null);
  const [documenting, setDocumenting] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: () => manageTelehealthSession({ action: "list", patient_id: patientId }),
  });
  const sessions = data?.sessions || [];
  const refresh = () => { qc.invalidateQueries({ queryKey: ["telehealthSessions"] }); qc.invalidateQueries({ queryKey: ["myUpcomingTelehealth"] }); };
  const update = async (session, patch) => { await manageTelehealthSession({ action: "update", session_id: session.id, data: patch }); refresh(); };

  const create = async (form) => {
    setSaving(true);
    const res = await manageTelehealthSession({ action: "create", ...form }).finally(() => setSaving(false));
    const link = buildPatientJoinLink(hostedAbsoluteUrl("/", { routerPaths: ROUTER_PATHS }), res.session.room_name, res.join_token);
    rememberJoinLink(res.session.room_name, link);
    await navigator.clipboard?.writeText(link).catch(() => {});
    toast.success("Visit scheduled — patient invite link copied.");
    setShowForm(false);
    refresh();
  };

  if (live) {
    return (
      <TelehealthCall role="provider" roomName={live.room_name} identity={user?.full_name || user?.email}
        onDisconnect={() => { setDocumenting(live); setLive(null); }} />
    );
  }

  if (documenting) {
    return (
      <SessionDocumentation initialData={documenting}
        onSave={async (doc) => { await update(documenting, { ...doc, status: "completed" }); toast.success("Visit documented"); setDocumenting(null); }} />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowForm((v) => !v)}><Plus className="w-4 h-4 mr-2" />New visit</Button>
      </div>
      {showForm && <NewSessionForm onCreate={create} saving={saving} patientId={patientId} defaultPatientName={patientName} />}
      {isLoading && <Loader2 className="w-6 h-6 animate-spin text-slate-400" />}
      {isError && <p className="text-sm text-amber-700">Couldn't load telehealth visits. Try refreshing.</p>}
      {!isLoading && !isError && sessions.length === 0 && <p className="text-sm text-slate-500">No telehealth visits yet.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sessions.map((s) => (
          <SessionCard key={s.id} session={s}
            onJoin={async () => { await update(s, { status: "active" }); setLive(s); }}
            onCancel={() => update(s, { status: "cancelled" })} />
        ))}
      </div>
    </div>
  );
}