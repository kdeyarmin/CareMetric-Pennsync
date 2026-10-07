import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

export default function NewThreadForm({ directory, onSend, sending }) {
  const [to, setTo] = useState([]);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const toggle = (id) => setTo((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => { e.preventDefault(); onSend({ recipient_user_ids: to, subject, message_text: text }); }}
    >
      <div className="max-h-40 overflow-y-auto rounded-lg border p-2 space-y-1">
        {directory.length === 0 && <p className="text-sm text-slate-500">No other staff in this agency.</p>}
        {directory.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={to.includes(p.id)} onCheckedChange={() => toggle(p.id)} />
            {p.name} <span className="text-xs text-slate-400">{p.role?.replaceAll("_", " ")}</span>
          </label>
        ))}
      </div>
      <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
      <Textarea placeholder="Message" value={text} onChange={(e) => setText(e.target.value)} required rows={4} />
      <Button type="submit" disabled={sending || to.length === 0}>{sending ? "Sending..." : "Send"}</Button>
    </form>
  );
}