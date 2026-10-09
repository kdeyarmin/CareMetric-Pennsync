import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import MessageAssistPanel from "@/components/messaging/MessageAssistPanel";
import { MESSAGE_PRIORITIES } from "@/components/messaging/NewThreadForm";

function sentAt(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : format(date, "MMM d, h:mm a");
}

/** One secure thread, oldest message first, with a reply box and AI help. */
export default function ThreadView({ thread, me, onReply, sending, agencyId }) {
  const [text, setText] = useState("");
  const [priority, setPriority] = useState("normal");
  const msgs = [...thread.messages].reverse();
  const patientId = thread.messages.find((m) => typeof m.patient_id === "string" && m.patient_id)?.patient_id || null;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{thread.subject}</h2>
      <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
        {msgs.map((m) => (
          <li key={m.id} className={`rounded-lg p-3 text-sm ${m.sender_user_id === me ? "bg-navy-50 ml-8" : "bg-slate-100 mr-8"}`}>
            <div className="mb-1 text-xs text-slate-500">
              {m.sender_name} · {sentAt(m.created_date)}
              {m.priority === "urgent" && <span className="ml-2 font-semibold text-red-700">Urgent</span>}
              {m.priority === "high" && <span className="ml-2 font-semibold text-amber-700">High</span>}
            </div>
            <p className="whitespace-pre-wrap">{m.message_text}</p>
          </li>
        ))}
      </ul>
      {agencyId && (
        <MessageAssistPanel agencyId={agencyId} threadId={thread.id} patientId={patientId} draft={text} />
      )}
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const sent = await onReply(text, priority);
          if (sent !== false) {
            setText("");
            setPriority("normal");
          }
        }}
      >
        <Label htmlFor={`thread-reply-${thread.id}`}>Reply</Label>
        <Textarea id={`thread-reply-${thread.id}`} value={text} onChange={(e) => setText(e.target.value)} required rows={3} maxLength={20000} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor={`thread-reply-priority-${thread.id}`}>Priority</Label>
            <select
              id={`thread-reply-priority-${thread.id}`}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {MESSAGE_PRIORITIES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={sending}>{sending ? "Sending..." : "Reply"}</Button>
        </div>
      </form>
    </div>
  );
}
