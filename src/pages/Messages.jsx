import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Plus } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import LoadingState from "@/components/ui/LoadingState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import NewThreadForm from "@/components/messaging/NewThreadForm";
import ThreadView from "@/components/messaging/ThreadView";

export default function Messages() {
  const { tenantContext } = useAuth();
  const agencyId = tenantContext?.agency_id;
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [composing, setComposing] = useState(false);
  const [sending, setSending] = useState(false);

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
    try {
      await base44.functions.invoke("sendMessage", { agency_id: agencyId, client_request_id: crypto.randomUUID(), ...payload });
      await qc.invalidateQueries({ queryKey: ["myMessages", agencyId] });
      setComposing(false);
      toast.success("Message sent");
    } catch (e) {
      toast.error(e?.response?.data?.error || "Message could not be sent");
    } finally {
      setSending(false);
    }
  };

  const openThread = (t) => {
    setSelected(t.id);
    setComposing(false);
    t.messages
      .filter((m) => !m.read_by_user_ids?.includes(data.me))
      .forEach((m) => base44.functions.invoke("markMessageRead", { agency_id: agencyId, id: m.id }).catch(() => {}));
  };

  const current = threads.find((t) => t.id === selected);

  return (
    <PageContainer>
      <PageHeader icon={Mail} eyebrow="Communication" title="Messages" description="Secure messages with your agency team." favoritePage="Messages" />
      {isLoading ? <LoadingState /> : error ? (
        <p className="text-red-700">Messages could not be loaded. Please try again.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="md:col-span-1">
            <CardContent className="p-3 space-y-2">
              <Button className="w-full" onClick={() => { setComposing(true); setSelected(null); }}>
                <Plus className="h-4 w-4 mr-1" /> New message
              </Button>
              {threads.length === 0 && <p className="text-sm text-slate-500 p-2">No messages yet.</p>}
              {threads.map((t) => {
                const unread = t.messages.some((m) => !m.read_by_user_ids?.includes(data.me));
                return (
                  <button key={t.id} onClick={() => openThread(t)} className={`w-full text-left rounded-lg p-2 hover:bg-slate-100 ${selected === t.id ? "bg-slate-100" : ""}`}>
                    <div className={`text-sm ${unread ? "font-bold" : "font-medium"}`}>{t.subject}</div>
                    <div className="text-xs text-slate-500 truncate">{t.messages[0].sender_name}: {t.messages[0].message_text}</div>
                  </button>
                );
              })}
            </CardContent>
          </Card>
          <Card className="md:col-span-2">
            <CardContent className="p-4">
              {composing ? (
                <NewThreadForm directory={data?.directory || []} onSend={send} sending={sending} />
              ) : current ? (
                <ThreadView key={current.id} thread={current} me={data.me} sending={sending} onReply={(text) => send({ thread_id: current.id, message_text: text })} />
              ) : (
                <p className="text-sm text-slate-500">Select a conversation or start a new message.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}