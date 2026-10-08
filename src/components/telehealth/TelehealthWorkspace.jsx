import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, Plus } from "lucide-react";
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

function brokerError(error, fallback) {
  const message = error?.response?.data?.error || error?.data?.error;
  return typeof message === "string" && message ? message : fallback;
}

/**
 * Shared staff telehealth UI: list, schedule, join, document, cancel.
 *
 * Every call names the caller's agency; manageTelehealthSession authorizes it
 * against the caller's exact membership there. Outcomes are shown inline
 * because production replaces toast text with a generic line.
 */
export default function TelehealthWorkspace({ patientId, patientName }) {
  const { user, tenantContext } = useAuth();
  const agencyId = tenantContext?.agency_id || null;
  const qc = useQueryClient();
  const key = ["telehealthSessions", agencyId, patientId || "mine"];
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [live, setLive] = useState(null);
  const [documenting, setDocumenting] = useState(null);
  const [notice, setNotice] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: key,
    queryFn: () => manageTelehealthSession({ action: "list", agency_id: agencyId, patient_id: patientId || undefined }),
    enabled: !!agencyId,
  });
  const sessions = data?.sessions || [];
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["telehealthSessions"] });
    qc.invalidateQueries({ queryKey: ["myUpcomingTelehealth"] });
  };
  const update = async (session, patch) => {
    await manageTelehealthSession({ action: "update", agency_id: agencyId, session_id: session.id, data: patch });
    refresh();
  };

  const create = async (form) => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await manageTelehealthSession({ action: "create", agency_id: agencyId, ...form });
      const link = buildPatientJoinLink(hostedAbsoluteUrl("/", { routerPaths: ROUTER_PATHS }), res.session.room_name, res.join_token);
      rememberJoinLink(res.session.room_name, link);
      let copied = false;
      try {
        await navigator.clipboard?.writeText(link);
        copied = Boolean(navigator.clipboard);
      } catch {
        copied = false;
      }
      setNotice({
        tone: "success",
        text: copied
          ? "Visit scheduled. The patient's invite link is copied to your clipboard."
          : "Visit scheduled. Use Copy Link on the visit to share the patient's invite.",
      });
      setShowForm(false);
      refresh();
    } catch (e) {
      setNotice({ tone: "error", text: brokerError(e, "The visit could not be scheduled. Please try again.") });
    } finally {
      setSaving(false);
    }
  };

  const act = async (fn, failure) => {
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice({ tone: "error", text: brokerError(e, failure) });
    }
  };

  if (!agencyId) {
    return (
      <p className="text-sm text-slate-600">
        Telehealth visits open inside an agency workspace. Your account has no active agency membership yet;
        an administrator can grant one in User Management.
      </p>
    );
  }

  if (live) {
    return (
      <TelehealthCall role="provider" roomName={live.room_name} identity={user?.full_name || user?.email}
        onDisconnect={() => { setDocumenting(live); setLive(null); }} />
    );
  }

  if (documenting) {
    return (
      <SessionDocumentation initialData={documenting}
        onSave={(doc) => act(async () => {
          await update(documenting, { ...doc, status: "completed" });
          setNotice({ tone: "success", text: "Visit documented." });
          setDocumenting(null);
        }, "The visit documentation could not be saved. Please try again.")} />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowForm((v) => !v)}><Plus className="w-4 h-4 mr-2" />New visit</Button>
      </div>
      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`rounded-lg border px-3 py-2 text-sm ${notice.tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
        >
          {notice.text}
        </p>
      )}
      {showForm && <NewSessionForm onCreate={create} saving={saving} patientId={patientId} defaultPatientName={patientName} />}
      {isLoading && <Loader2 className="w-6 h-6 animate-spin text-slate-400" aria-label="Loading telehealth visits" />}
      {isError && <p role="alert" className="text-sm text-amber-700">{brokerError(error, "Couldn't load telehealth visits. Try refreshing.")}</p>}
      {!isLoading && !isError && sessions.length === 0 && <p className="text-sm text-slate-500">No telehealth visits yet.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sessions.map((s) => (
          <SessionCard key={s.id} session={s}
            onJoin={() => act(async () => { await update(s, { status: "active" }); setLive(s); }, "The visit could not be started. Please try again.")}
            onCancel={() => act(() => update(s, { status: "cancelled" }), "The visit could not be cancelled. Please try again.")} />
        ))}
      </div>
    </div>
  );
}
