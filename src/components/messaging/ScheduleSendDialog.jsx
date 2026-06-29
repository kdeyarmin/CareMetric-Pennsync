import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { validateScheduleTime } from "@/components/messaging/scheduledSms";

/** ISO -> value for <input type="datetime-local"> (local time). */
function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * ScheduleSendDialog — a "Schedule" button that queues the current draft to send
 * later via the scheduleSms function. Validates the time client-side before
 * calling the backend (which re-validates and re-checks consent at send time).
 */
export default function ScheduleSendDialog({ toNumber, patientId, body, templateLabel, disabled, onScheduled, compact }) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState("");

  const schedule = useMutation({
    mutationFn: (payload) => base44.functions.invoke("scheduleSms", payload),
    onSuccess: () => {
      setOpen(false);
      setWhen("");
      toast.success("Message scheduled");
      onScheduled?.();
    },
    onError: (err) => toast.error(err?.message || "Failed to schedule message"),
  });

  const openDialog = () => {
    // Default to one hour out for convenience.
    setWhen(toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
    setOpen(true);
  };

  const confirm = () => {
    if (!body || !body.trim()) {
      toast.error("Type a message first.");
      return;
    }
    const check = validateScheduleTime(when ? new Date(when) : null);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    schedule.mutate({
      to_number: toNumber,
      body: body.trim(),
      patient_id: patientId || undefined,
      send_at: check.iso,
      template_label: templateLabel || undefined,
    });
  };

  return (
    <>
      {compact ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={openDialog}
          title="Schedule send"
          aria-label="Schedule send"
          className="h-9 w-9 flex-shrink-0 rounded-full text-slate-500 hover:bg-slate-100"
        >
          <CalendarClock className="h-5 w-5" />
        </Button>
      ) : (
        <Button type="button" variant="outline" disabled={disabled} onClick={openDialog}>
          <CalendarClock className="w-4 h-4 mr-2" />
          Schedule
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule this text</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              It will send automatically from your work number at the time you choose. Consent is re-checked
              when it sends. You can cancel it any time before then from the Scheduled tab.
            </p>
            <div>
              <Label htmlFor="schedule-when" className="text-sm font-medium">Send at</Label>
              <Input
                id="schedule-when"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="mt-1"
              />
            </div>
            {body && (
              <div className="p-2 rounded bg-slate-50 border border-slate-200">
                <p className="text-[11px] text-slate-500 mb-0.5">Preview</p>
                <p className="text-sm text-slate-800 whitespace-pre-wrap line-clamp-4">{body}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="bg-blue-600 hover:bg-blue-700" disabled={schedule.isPending} onClick={confirm}>
              <CalendarClock className="w-4 h-4 mr-2" />
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
