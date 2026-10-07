import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";

export default function ThreadView({ thread, me, onReply, sending }) {
  const [text, setText] = useState("");
  const msgs = [...thread.messages].reverse();
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-lg font-semibold">{thread.subject}</h3>
      <div className="space-y-2 max-h-[50vh] overflow-y-auto">
        {msgs.map((m) => (
          <div key={m.id} className={`rounded-lg p-3 text-sm ${m.sender_user_id === me ? "bg-navy-50 ml-8" : "bg-slate-100 mr-8"}`}>
            <div className="mb-1 text-xs text-slate-500">{m.sender_name} · {format(new Date(m.created_date), "MMM d, h:mm a")}</div>
            <p className="whitespace-pre-wrap">{m.message_text}</p>
          </div>
        ))}
      </div>
      <form
        className="space-y-2"
        onSubmit={async (e) => { e.preventDefault(); await onReply(text); setText(""); }}
      >
        <Textarea placeholder="Write a reply" value={text} onChange={(e) => setText(e.target.value)} required rows={3} />
        <Button type="submit" disabled={sending}>{sending ? "Sending..." : "Reply"}</Button>
      </form>
    </div>
  );
}