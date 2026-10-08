import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Plus } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useScopedPatients } from "@/hooks/useScopedPatients";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import LoadingState from "@/components/ui/LoadingState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import NewThreadForm from "@/components/messaging/NewThreadForm";
import ThreadView from "@/components/messaging/ThreadView";

/**
 * Secure staff messages inside the caller's agency.
 *
 * Every read and write goes through the v2 brokers (listMyMessages,
 * sendMessage, markMessageRead), which check the caller's exact active
 * AgencyMembership on each request. The page never reads Message rows itself.
 * Released by the owner on 2026-10-08. An urgent message is announced to its
 * recipients through notifyUrgentMessage, which only the sender may call and
 * which notifies each recipient once however often it is retried. The AI
 * summary and suggestion helpers live in MessageAssistPanel.
 *
 * Outcomes are shown inline because production replaces toast text with a
 * generic line (src/lib/tenantSonner.js), which would hide why a send failed.
 */

function brokerError(error, fallback) {
  const message = error?.response?.data?.error || error?.data?.error;
  return typeof message === "string" && message ? message : fallback;
}

export default function Messages() {
  const { tenantContext } = useAuth();
  const agencyId = tenantContext?.agency_id || null;
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [composing, setComposing] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);

  // The optional "about patient" list is the caller's own authorized roster;
  // a role without roster access simply composes without it.
  const patientQuery = useScopedPatients({
    purpose: "roster",
    status: "active",
    sort: "first_name",
    limit: 2000,
    enabled: !!agencyId,
  });
  const patients = patientQuery.isSuccess && Array.isArray(patientQuery.data) ? patientQuery.data : [];

  const { data, isLoading, error } = useQuery({
    queryKey: ["myMessages", agencyId],
    queryFn: async () => (await base44.functions.invoke("listMyMessages", { agency_id: agencyId })).data,
    enabled: !!agencyId,
    refetchInterval: 30000,
  });

  const threads = useMemo(() => {
    const map = new Map();
    for (const m of data?.messages || []) {
      if (!map.has(m.thread_id)) map.set(m.thread_id, { id: m.thread_id, subject: m.thread_subject, messages: [] });
      map.get(m.thread_id).messages.push(m);
    }
    return [...map.values()];
  }, [data]);

  const send = async (payload) => {
    setSending(true);
    setNotice(null);
    let sent;
    try {
      sent = await base44.functions.invoke("sendMessage", { agency_id: agencyId, client_request_id: crypto.randomUUID(), ...payload });
    } catch (e) {
      setNotice({ tone: "error", text: brokerError(e, "The message could not be sent. Please try again.") });
      setSending(false);
      return false;
    }
    try {
      await qc.invalidateQueries({ queryKey: ["myMessages", agencyId] });
      setComposing(false);
      const messageId = sent?.data?.message?.id;
      if (payload.priority === "urgent" && typeof messageId === "string" && messageId) {
        try {
          const { data: urgent } = await base44.functions.invoke("notifyUrgentMessage", {
            agency_id: agencyId,
            message_id: messageId,
          });
          const count = Number(urgent?.notified);
          setNotice({
            tone: "success",
            text: Number.isFinite(count)
              ? `Urgent message sent. ${count} recipient${count === 1 ? "" : "s"} notified.`
              : "Urgent message sent and recipients notified.",
          });
        } catch (e) {
          setNotice({
            tone: "error",
            text: `Message sent, but recipients could not be alerted: ${brokerError(e, "please tell them directly.")}`,
          });
        }
      } else {
        setNotice({ tone: "success", text: "Message sent." });
      }
      return true;
    } catch {
      // The send itself succeeded; only the refresh failed.
      setNotice({ tone: "success", text: "Message sent. Refresh to see it in the thread list." });
      return true;
    } finally {
      setSending(false);
    }
  };

  const openThread = (t) => {
    setSelected(t.id);
    setComposing(false);
    setNotice(null);
    t.messages
      .filter((m) => !m.read_by_user_ids?.includes(data.me))
      .forEach((m) => {
        base44.functions.invoke("markMessageRead", { agency_id: agencyId, id: m.id })
          .then(() => qc.invalidateQueries({ queryKey: ["myMessages", agencyId] }))
          .catch(() => {});
      });
  };

  const current = threads.find((t) => t.id === selected);

  let body;
  if (!agencyId) {
    body = (
      <p className="text-sm text-slate-600">
        Messages open inside an agency workspace. Your account has no active agency membership yet;
        an administrator can grant one in User Management.
      </p>
    );
  } else if (isLoading) {
    body = <LoadingState />;
  } else if (error) {
    body = <p role="alert" className="text-red-700">{brokerError(error, "Messages could not be loaded. Please try again.")}</p>;
  } else {
    body = (
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardContent className="p-3 space-y-2">
            <Button className="w-full" onClick={() => { setComposing(true); setSelected(null); setNotice(null); }}>
              <Plus className="h-4 w-4 mr-1" /> New message
            </Button>
            {threads.length === 0 && <p className="text-sm text-slate-500 p-2">No messages yet.</p>}
            {threads.map((t) => {
              const unread = t.messages.some((m) => !m.read_by_user_ids?.includes(data.me));
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openThread(t)}
                  className={`w-full text-left rounded-lg p-2 hover:bg-slate-100 ${selected === t.id ? "bg-slate-100" : ""}`}
                >
                  <div className={`text-sm ${unread ? "font-bold" : "font-medium"}`}>
                    {t.subject}
                    {unread && <span className="sr-only"> (unread)</span>}
                  </div>
                  <div className="text-xs text-slate-500 truncate">{t.messages[0].sender_name}: {t.messages[0].message_text}</div>
                </button>
              );
            })}
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardContent className="p-4 space-y-3">
            {notice && (
              <p
                role={notice.tone === "error" ? "alert" : "status"}
                className={`rounded-lg border px-3 py-2 text-sm ${notice.tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
              >
                {notice.text}
              </p>
            )}
            {composing ? (
              <NewThreadForm directory={data?.directory || []} patients={patients} onSend={send} sending={sending} />
            ) : current ? (
              <ThreadView
                key={current.id}
                thread={current}
                me={data.me}
                agencyId={agencyId}
                sending={sending}
                onReply={(text, priority) => send({ thread_id: current.id, message_text: text, priority: priority || "normal" })}
              />
            ) : (
              <p className="text-sm text-slate-500">Select a conversation or start a new message.</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader icon={Mail} eyebrow="Communication" title="Messages" description="Secure messages with your agency team." favoritePage="Messages" />
      {body}
    </PageContainer>
  );
}
