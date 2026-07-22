import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { sendFax } from "@/functions/sendFax";
import FaxRecipientFields from "@/components/fax/FaxRecipientFields";

export default function DocumentRecordFaxDialog({ record, patient, open, onOpenChange }) {
  const [recipient, setRecipient] = useState({ id: "", name: "", fax: "" });
  const [isSending, setIsSending] = useState(false);
  const documentName = record?.document_name || record?.file_name || "Patient document";

  useEffect(() => {
    if (!open) setRecipient({ id: "", name: "", fax: "" });
  }, [open]);

  const handleSend = async () => {
    if (!record?.file_url || !recipient.fax?.trim()) return toast.error("Select a provider or enter a fax number");
    setIsSending(true);
    try {
      await sendFax({ file_url: record.file_url, to_number: recipient.fax, to_name: recipient.name || undefined, document_name: documentName, patient_id: patient.id });
      toast.success("Fax queued successfully");
      onOpenChange(false);
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || "Unable to send fax");
    } finally {
      setIsSending(false);
    }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>Send patient document by fax</DialogTitle>
        <DialogDescription>Confirm the recipient before sending {documentName} for {patient.first_name} {patient.last_name}.</DialogDescription>
      </DialogHeader>
      <div className="rounded-lg border bg-slate-50 p-3 text-sm dark:bg-slate-800"><span className="font-semibold">File:</span> {documentName}</div>
      <FaxRecipientFields recipient={recipient} onChange={setRecipient} enabled={open} />
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>Cancel</Button>
        <Button onClick={handleSend} disabled={isSending || !recipient.fax?.trim()}>
          {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          {isSending ? "Sending..." : "Confirm & Send"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}