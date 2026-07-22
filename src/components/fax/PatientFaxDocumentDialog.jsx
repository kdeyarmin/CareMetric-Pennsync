import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sendFax } from "@/functions/sendFax";
import FaxRecipientFields from "@/components/fax/FaxRecipientFields";

export default function PatientFaxDocumentDialog({ patient, open, onOpenChange }) {
  const [recordId, setRecordId] = useState("");
  const [recipient, setRecipient] = useState({ id: "", name: "", fax: "" });
  const [isSending, setIsSending] = useState(false);
  const { data: records = [], isLoading } = useQuery({
    queryKey: ["patient-document-records", patient.id],
    enabled: open,
    queryFn: () => base44.entities.DocumentRecord.filter({ patient_id: patient.id }, "-created_date", 100),
  });
  const availableRecords = records.filter((record) => record.file_url && !record.is_archived);
  const selectedRecord = availableRecords.find((record) => record.id === recordId);

  const closeDialog = () => {
    setRecordId("");
    setRecipient({ id: "", name: "", fax: "" });
    onOpenChange(false);
  };

  const handleSend = async () => {
    if (!selectedRecord || !recipient.fax?.trim()) return toast.error("Select a document and recipient");
    setIsSending(true);
    try {
      await sendFax({ file_url: selectedRecord.file_url, to_number: recipient.fax, to_name: recipient.name || undefined, document_name: selectedRecord.document_name || selectedRecord.file_name, patient_id: patient.id });
      toast.success("Fax queued successfully");
      closeDialog();
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || "Unable to send fax");
    } finally {
      setIsSending(false);
    }
  };

  return <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? onOpenChange(true) : closeDialog()}>
    <DialogContent className="max-w-xl">
      <DialogHeader><DialogTitle>Fax Document</DialogTitle><DialogDescription>Select a DocumentRecord file for {patient.first_name} {patient.last_name}, then confirm the external healthcare provider.</DialogDescription></DialogHeader>
      <div className="space-y-2"><Label>DocumentRecord file</Label><Select value={recordId} onValueChange={setRecordId} disabled={isLoading}><SelectTrigger><SelectValue placeholder={isLoading ? "Loading files..." : "Select a file"} /></SelectTrigger><SelectContent>{availableRecords.map((record) => <SelectItem key={record.id} value={record.id}>{record.document_name || record.file_name}</SelectItem>)}</SelectContent></Select>{!isLoading && availableRecords.length === 0 && <p className="text-sm text-slate-500">No fax-ready DocumentRecord files are available.</p>}</div>
      <FaxRecipientFields recipient={recipient} onChange={setRecipient} enabled={open} />
      <DialogFooter><Button variant="outline" onClick={closeDialog} disabled={isSending}>Cancel</Button><Button onClick={handleSend} disabled={isSending || !selectedRecord || !recipient.fax?.trim()}>{isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}{isSending ? "Sending..." : "Send Fax"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}