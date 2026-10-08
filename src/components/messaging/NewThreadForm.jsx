import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

/** Compose a new secure thread to colleagues in the caller's agency. */
export default function NewThreadForm({ directory, onSend, sending }) {
  const [to, setTo] = useState([]);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const toggle = (id) => setTo((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSend({ recipient_user_ids: to, subject, message_text: text });
      }}
    >
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-slate-700">To</legend>
        <div className="max-h-40 overflow-y-auto rounded-lg border p-2 space-y-1">
          {directory.length === 0 && <p className="text-sm text-slate-500">No other staff in this agency yet.</p>}
          {directory.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={to.includes(p.id)} onCheckedChange={() => toggle(p.id)} />
              {p.name} <span className="text-xs text-slate-400">{p.role?.replaceAll("_", " ")}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor="new-thread-subject">Subject</Label>
        <Input id="new-thread-subject" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={300} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="new-thread-message">Message</Label>
        <Textarea id="new-thread-message" value={text} onChange={(e) => setText(e.target.value)} required rows={4} maxLength={20000} />
      </div>
      <Button type="submit" disabled={sending || to.length === 0}>{sending ? "Sending..." : "Send"}</Button>
    </form>
  );
}
