import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowUp, AlertTriangle, RotateCw, FileText } from "lucide-react";
import { format, isSameDay } from "date-fns";
import { toast } from "sonner";
import { formatPhoneDisplay } from "@/components/voice/phoneUtils";
import { smsSegments } from "@/components/messaging/smsUtils";
import { getQuickReplies } from "@/components/messaging/smsQuickReplies";
import { getTemplates, renderTemplate, buildTemplateContext } from "@/components/messaging/smsTemplates";
import ScheduleSendDialog from "@/components/messaging/ScheduleSendDialog";
import PhoneTopBar from "@/components/phone/PhoneTopBar";
import ContactAvatar from "@/components/phone/ContactAvatar";

/** A faint day divider between message groups, like a real texting app. */
function DayDivider({ date }) {
  return (
    <div className="my-3 flex justify-center">
      <span className="rounded-full bg-slate-200/80 px-3 py-0.5 text-[11px] font-medium text-slate-500">
        {format(date, "EEEE, MMM d")}
      </span>
    </div>
  );
}

/**
 * SmsThreadView — one SMS conversation rendered as a full phone screen: a back
 * nav bar, iMessage-style chat bubbles (outbound blue on the right, inbound gray
 * on the left, with day dividers), and a pinned compose bar that sends through
 * the nurse's work number via the sendSms function.
 */
export default function SmsThreadView({
  thread,
  otherPartyLabel,
  otherPartyNumber,
  patientId,
  patient,
  currentUser,
  optedOut,
  onSent,
  onBack,
}) {
  const [draft, setDraft] = useState("");
  const [resendingId, setResendingId] = useState(null);
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);

  const sendMutation = useMutation({
    mutationFn: (body) =>
      base44.functions.invoke("sendSms", { to_number: otherPartyNumber, body, patient_id: patientId || undefined }),
    onSuccess: () => {
      setDraft("");
      toast.success("Message sent");
      onSent?.();
    },
    onError: (err) => {
      toast.error(err?.message || "Failed to send message");
    },
  });

  // Resend a previously failed outbound message (re-sends the same body; the
  // backend creates a fresh SmsMessage row, so the original failure stays in
  // the thread as a record).
  const resendMutation = useMutation({
    mutationFn: (body) =>
      base44.functions.invoke("sendSms", { to_number: otherPartyNumber, body, patient_id: patientId || undefined }),
    onSuccess: () => {
      toast.success("Message resent");
      onSent?.();
    },
    onError: (err) => toast.error(err?.message || "Failed to resend message"),
    onSettled: () => setResendingId(null),
  });
  const handleResend = (msg) => {
    // Guard against concurrent resends: only one outbound request at a time,
    // regardless of which failed bubble was tapped (each bubble's own spinner
    // is still driven by resendingId).
    if (resendMutation.isPending || sendMutation.isPending) return;
    setResendingId(msg.id);
    resendMutation.mutate(msg.body);
  };

  const { data: settingsArr = [] } = useQuery({
    queryKey: ["agency-settings"],
    queryFn: () => base44.entities.AgencySettings.list("-created_date", 1),
    staleTime: 5 * 60 * 1000,
    initialData: [],
  });
  const quickReplies = getQuickReplies(settingsArr[0]);
  const templates = getTemplates(settingsArr[0]);
  const templateContext = buildTemplateContext({ patient, user: currentUser, settings: settingsArr[0] });
  const applyTemplate = (body) => setDraft(renderTemplate(body, templateContext));

  // Keep the latest message in view as the thread loads or grows.
  const lastId = thread?.messages?.[thread.messages.length - 1]?.id;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lastId, thread?.threadId]);

  if (!thread) return null;

  const handleSend = () => {
    if (!draft.trim()) return;
    sendMutation.mutate(draft.trim());
  };

  const insertReply = (text) =>
    setDraft((d) => (d.trim() ? `${d.replace(/\s*$/, "")} ${text}` : text));

  const meta = smsSegments(draft);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <PhoneTopBar
        onBack={onBack}
        backLabel="Messages"
        title={otherPartyLabel}
        subtitle={formatPhoneDisplay(otherPartyNumber)}
        avatar={<ContactAvatar name={patient ? otherPartyLabel : null} number={otherPartyNumber} size="sm" className="mb-0.5" />}
      />

      {/* Bubbles */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {thread.messages.map((msg, i) => {
          const outbound = msg.direction === "outbound";
          const failed = msg.status === "failed";
          const date = new Date(msg.created_date);
          const prev = thread.messages[i - 1];
          const showDay = !prev || !isSameDay(new Date(prev.created_date), date);
          return (
            <div key={msg.id}>
              {showDay && <DayDivider date={date} />}
              <div className={`flex flex-col ${outbound ? "items-end" : "items-start"} mb-1.5`}>
                <div
                  className={`max-w-[80%] whitespace-pre-wrap break-words px-3.5 py-2 text-[15px] leading-snug shadow-sm ${
                    failed
                      ? "rounded-2xl rounded-br-md border border-red-200 bg-red-50 text-red-900"
                      : outbound
                        ? "rounded-2xl rounded-br-md bg-blue-500 text-white"
                        : "rounded-2xl rounded-bl-md bg-white text-slate-900 ring-1 ring-slate-200"
                  }`}
                >
                  {msg.body}
                </div>
                <div className={`mt-0.5 flex items-center gap-1.5 px-1 text-[10px] text-slate-400 ${outbound ? "flex-row-reverse" : ""}`}>
                  <span>{format(date, "h:mm a")}</span>
                  {outbound && failed && <span className="font-medium text-red-500">Not delivered</span>}
                  {outbound && !failed && msg.status && (
                    <span className="capitalize">{msg.status.replace(/_/g, " ")}</span>
                  )}
                </div>
                {outbound && failed && !optedOut && (
                  <button
                    type="button"
                    onClick={() => handleResend(msg)}
                    disabled={resendMutation.isPending || sendMutation.isPending}
                    className="mt-0.5 flex items-center gap-1 px-1 text-[11px] font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                    title={msg.failure_reason || "Resend"}
                  >
                    <RotateCw className={`h-3 w-3 ${resendMutation.isPending && resendingId === msg.id ? "animate-spin" : ""}`} />
                    Resend
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Compose / opted-out notice */}
      {optedOut ? (
        <div className="flex-shrink-0 border-t border-slate-200 bg-white p-3">
          <Alert className="border-red-200 bg-red-50">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-sm text-red-900">
              This patient opted out of texts (replied STOP). You can't text them until they reply START.
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <div className="flex-shrink-0 border-t border-slate-200 bg-white">
          {/* Quick replies + templates strip */}
          {(quickReplies.length > 0 || templates.length > 0) && (
            <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {templates.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex flex-shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      <FileText className="h-3.5 w-3.5" /> Templates
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-w-xs">
                    {templates.map((t, i) => (
                      <DropdownMenuItem key={i} onSelect={() => applyTemplate(t.body)} className="flex-col items-start">
                        <span className="text-xs font-medium">{t.label}</span>
                        <span className="line-clamp-2 text-[11px] text-slate-500">{renderTemplate(t.body, templateContext)}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {quickReplies.map((q, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => insertReply(q.text)}
                  title={q.text}
                  className="flex-shrink-0 whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50"
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}

          {/* Input pill + send */}
          <div className="flex items-end gap-2 px-2.5 pb-2.5 pt-1">
            <ScheduleSendDialog
              compact
              toNumber={otherPartyNumber}
              patientId={patientId}
              body={draft}
              disabled={!draft.trim() || sendMutation.isPending}
              onScheduled={() => setDraft("")}
            />
            <div className="flex flex-1 items-center rounded-3xl border border-slate-300 bg-white px-3">
              <textarea
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Text message — avoid PHI"
                aria-label="Message text"
                className="max-h-28 w-full resize-none border-0 bg-transparent py-2 text-[15px] placeholder:text-slate-400 focus:outline-none focus:ring-0"
              />
            </div>
            <Button
              type="button"
              size="icon"
              onClick={handleSend}
              disabled={!draft.trim() || sendMutation.isPending}
              aria-label="Send text"
              className="h-9 w-9 flex-shrink-0 rounded-full bg-blue-500 hover:bg-blue-600 disabled:bg-slate-300"
            >
              <ArrowUp className="h-5 w-5" />
            </Button>
          </div>
          {meta.chars > 0 && (
            <p className={`px-4 pb-1.5 text-right text-[10px] ${meta.segments > 1 ? "text-amber-600" : "text-slate-400"}`}>
              {meta.chars} chars · {meta.segments} SMS{meta.segments > 1 ? ` (${meta.encoding})` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
