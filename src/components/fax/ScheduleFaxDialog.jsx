import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from "@/components/ui/dialog";
import { Clock, Loader2, CalendarIcon } from "lucide-react";
import { toast } from "sonner";

export default function ScheduleFaxDialog({ open, onOpenChange, recipientName, recipientFax, documents, coverData, userEmail, fromFaxNumber }) {
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [scheduling, setScheduling] = useState(false);

  const handleSchedule = async () => {
    if (!scheduledDate || !scheduledTime) {
      toast.error("Please select a date and time");
      return;
    }
    if (!recipientFax) {
      toast.error("No recipient fax number");
      return;
    }
    if (documents.length === 0) {
      toast.error("No documents to send");
      return;
    }

    setScheduling(true);
    const scheduledAt = new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString();
    const mediaUrls = documents.map(d => d.url);

    await base44.entities.FaxHistory.create({
      user_email: userEmail,
      recipient_name: recipientName || '',
      recipient_fax_number: recipientFax,
      subject: coverData?.subject || '',
      cover_sheet_message: coverData?.message || '',
      document_urls: mediaUrls,
      page_count: mediaUrls.length,
      status: 'scheduled',
      scheduled_send_at: scheduledAt,
      priority: 'normal'
    });

    setScheduling(false);
    toast.success(`Fax scheduled for ${scheduledDate} at ${scheduledTime}`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-purple-600" />
            Schedule Fax
          </DialogTitle>
          <DialogDescription>
            Schedule this fax to be sent at a later time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-sm font-medium">{recipientName || "Unknown"}</p>
            <p className="text-xs text-slate-500">{recipientFax}</p>
            <p className="text-xs text-slate-400 mt-1">{documents.length} document{documents.length !== 1 ? "s" : ""}</p>
          </div>

          <div>
            <Label className="text-xs">Date</Label>
            <Input
              type="date"
              value={scheduledDate}
              onChange={e => setScheduledDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="h-9 text-sm"
            />
          </div>

          <div>
            <Label className="text-xs">Time</Label>
            <Input
              type="time"
              value={scheduledTime}
              onChange={e => setScheduledTime(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          <Button onClick={handleSchedule} disabled={scheduling || !scheduledDate} className="w-full gap-2">
            {scheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarIcon className="w-4 h-4" />}
            {scheduling ? "Scheduling..." : "Schedule Fax"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}