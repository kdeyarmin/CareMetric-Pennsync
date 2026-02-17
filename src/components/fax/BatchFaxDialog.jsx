import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from "@/components/ui/dialog";
import { Users, Plus, X, Loader2, Send, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function BatchFaxDialog({ open, onOpenChange, documents, coverData, fromFaxNumber }) {
  const [recipients, setRecipients] = useState([{ name: "", number: "" }]);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState(null);

  const addRecipient = () => {
    setRecipients([...recipients, { name: "", number: "" }]);
  };

  const removeRecipient = (idx) => {
    setRecipients(recipients.filter((_, i) => i !== idx));
  };

  const updateRecipient = (idx, field, value) => {
    const updated = [...recipients];
    updated[idx][field] = value;
    setRecipients(updated);
  };

  const validRecipients = recipients.filter(r => r.number.trim());

  const handleSend = async () => {
    if (validRecipients.length === 0) {
      toast.error("Add at least one recipient with a fax number");
      return;
    }
    if (documents.length === 0) {
      toast.error("No documents to send");
      return;
    }

    setSending(true);
    const mediaUrls = documents.map(d => d.url);

    const { data } = await base44.functions.invoke('sendBatchFax', {
      to_numbers: validRecipients.map(r => ({ number: r.number, name: r.name })),
      media_urls: mediaUrls,
      document_name: documents[0]?.name || 'Documents',
      cover_page_details: coverData || {},
      from_fax_number: fromFaxNumber || undefined
    });

    setResults(data);
    setSending(false);

    if (data?.success) {
      toast.success(`Batch sent: ${data.success_count} succeeded, ${data.failure_count} failed`);
    } else {
      toast.error(data?.error || "Batch send failed");
    }
  };

  const handleClose = () => {
    setResults(null);
    setRecipients([{ name: "", number: "" }]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            Batch Fax — Send to Multiple Recipients
          </DialogTitle>
          <DialogDescription>
            Send the same {documents.length} document{documents.length !== 1 ? "s" : ""} to multiple fax numbers at once.
          </DialogDescription>
        </DialogHeader>

        {!results ? (
          <div className="space-y-3">
            {recipients.map((r, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={r.name}
                    onChange={e => updateRecipient(i, 'name', e.target.value)}
                    placeholder="Dr. Smith"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">Fax Number *</Label>
                  <Input
                    value={r.number}
                    onChange={e => updateRecipient(i, 'number', e.target.value)}
                    placeholder="(555) 123-4567"
                    className="h-9 text-sm"
                    type="tel"
                  />
                </div>
                {recipients.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => removeRecipient(i)}>
                    <X className="w-3 h-3" />
                  </Button>
                )}
              </div>
            ))}

            <Button variant="outline" size="sm" className="w-full gap-1 text-xs" onClick={addRecipient}>
              <Plus className="w-3 h-3" /> Add Recipient
            </Button>

            <div className="flex justify-between items-center pt-3 border-t">
              <p className="text-xs text-slate-500">{validRecipients.length} valid recipient{validRecipients.length !== 1 ? "s" : ""}</p>
              <Button onClick={handleSend} disabled={sending || validRecipients.length === 0} className="gap-2">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sending ? "Sending..." : `Send to ${validRecipients.length} Recipient${validRecipients.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50">
              <div>
                <p className="text-sm font-medium">Batch ID: <span className="font-mono text-xs">{results.batch_id}</span></p>
                <p className="text-xs text-slate-500">
                  {results.success_count} sent, {results.failure_count} failed
                  {results.priority && results.priority !== 'normal' && ` • Priority: ${results.priority}`}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              {results.results?.map((r, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded border text-xs">
                  <div>
                    <p className="font-medium">{r.name || r.recipient}</p>
                    <p className="text-slate-500">{r.recipient}</p>
                  </div>
                  {r.status === 'sent' ? (
                    <Badge className="bg-green-100 text-green-700 text-[10px]">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Sent
                    </Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-700 text-[10px]">
                      <AlertCircle className="w-3 h-3 mr-1" /> Failed
                    </Badge>
                  )}
                </div>
              ))}
            </div>
            <Button onClick={handleClose} variant="outline" className="w-full">Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}