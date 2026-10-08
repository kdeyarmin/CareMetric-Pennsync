import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";

function sentAt(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : format(date, "MMM d, h:mm a");
}

/** One secure thread, oldest message first, with a reply box. */
export default function ThreadView({ thread, me, onReply, sending }) {
  const [text, setText] = useState("");
  const msgs = [...thread.messages].reverse();
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{thread.subject}</h2>
      <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
        {msgs.map((m) => (
          <li key={m.id} className={`rounded-lg p-3 text-sm ${m.sender_user_id === me ? "bg-navy-50 ml-8" : "bg-slate-100 mr-8"}`}>
            <div className="mb-1 text-xs text-slate-500">{m.sender_name} · {sentAt(m.created_date)}</div>
            <p className="whitespace-pre-wrap">{m.message_text}</p>
          </li>
        ))}
      </ul>
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const sent = await onReply(text);
          if (sent !== false) setText("");
        }}
      >
        <Label htmlFor={`thread-reply-${thread.id}`}>Reply</Label>
        <Textarea id={`thread-reply-${thread.id}`} value={text} onChange={(e) => setText(e.target.value)} required rows={3} maxLength={20000} />
        <Button type="submit" disabled={sending}>{sending ? "Sending..." : "Reply"}</Button>
      </form>
    </div>
  );
}
