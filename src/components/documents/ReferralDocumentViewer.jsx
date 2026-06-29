import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, ExternalLink, Send } from "lucide-react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from 'sonner';

export default function ReferralDocumentViewer({ patientId }) {
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [selectedReferral, setSelectedReferral] = useState(null);
  const [messageText, setMessageText] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [isSending, setIsSending] = useState(false);

  const { data: referrals = [] } = useQuery({
    queryKey: ['patientReferrals', patientId],
    queryFn: () => base44.entities.Referral.filter({ patient_id: patientId }, '-created_date'),
    initialData: [],
    enabled: !!patientId,
  });

  // Filter to only show processed documents
  const processedReferrals = referrals.filter(r => r.processed_document_url || r.document_url);

  const { data: users = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
    initialData: [],
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const handleSendDocument = async () => {
    if (!recipientEmail || !selectedReferral) return;

    setIsSending(true);
    try {
      await base44.entities.Message.create({
        patient_id: patientId,
        thread_id: `referral-doc-${selectedReferral.id}`,
        subject: `Referral Document: ${selectedReferral.patient_name || 'Patient'}`,
        message_text: messageText || `${selectedReferral.documentUrl === selectedReferral.processed_document_url ? 'AI-processed admission packet' : 'Referral document'} for ${selectedReferral.patient_name}.\n\nReferral Date: ${selectedReferral.referral_date ? format(new Date(selectedReferral.referral_date), 'MM/dd/yyyy') : 'N/A'}\nSource: ${selectedReferral.referral_source || 'N/A'}`,
        sender_name: currentUser?.full_name || 'System',
        sender_email: currentUser?.email,
        recipients: [recipientEmail],
        priority: selectedReferral.priority === 'urgent' ? 'urgent' : 'normal',
        attachments: [selectedReferral.documentUrl],
        related_event_id: selectedReferral.id,
        related_event_type: 'referral'
      });

      setSendDialogOpen(false);
      setMessageText("");
      setRecipientEmail("");
      toast.success('Referral document sent successfully!');
    } catch (error) {
      console.error('Error sending document:', error);
      toast.error('Failed to send document. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  if (processedReferrals.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-slate-500">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p>No referral documents available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {processedReferrals.map((referral) => {
        // Prefer processed document, fall back to original
        const documentUrl = referral.processed_document_url || referral.document_url;
        const isProcessed = !!referral.processed_document_url;
        
        return (
        <Card key={referral.id} className="border-l-4 border-l-navy-500">
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-navy-600" />
                  <p className="font-semibold text-slate-900">
                    {referral.patient_name || 'Unknown Patient'}
                  </p>
                  {isProcessed && (
                    <Badge className="bg-green-600">
                      AI Processed
                    </Badge>
                  )}
                  {referral.priority && (
                    <Badge className={
                      referral.priority === 'urgent' ? 'bg-red-600' :
                      referral.priority === 'high' ? 'bg-orange-600' :
                      'bg-blue-600'
                    }>
                      {referral.priority}
                    </Badge>
                  )}
                </div>
                <div className="space-y-1 text-xs text-slate-600">
                  <p>Source: {referral.referral_source || 'N/A'}</p>
                  <p>Date: {referral.referral_date ? format(new Date(referral.referral_date), 'MMM d, yyyy') : 'N/A'}</p>
                  {referral.assigned_to && (
                    <p>Assigned to: {users.find(u => u.email === referral.assigned_to)?.full_name || referral.assigned_to}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {documentUrl && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(documentUrl, '_blank')}
                    >
                      <ExternalLink className="w-4 h-4 mr-1" />
                      {isProcessed ? 'View Processed' : 'View'}
                    </Button>
                    {referral.document_url && referral.processed_document_url && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(referral.document_url, '_blank')}
                      >
                        Original
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="bg-navy-600 hover:bg-navy-700"
                      onClick={() => {
                        setSelectedReferral({ ...referral, documentUrl });
                        setSendDialogOpen(true);
                      }}
                    >
                      <Send className="w-4 h-4 mr-1" />
                      Send
                    </Button>
                  </>
                )}
              </div>
            </div>
            {referral.diagnosis && (
              <div className="bg-navy-50 p-2 rounded">
                <p className="text-xs font-semibold text-navy-900">Primary Diagnosis</p>
                <p className="text-sm text-slate-900">{referral.diagnosis}</p>
              </div>
            )}
          </CardContent>
        </Card>
        );
      })}

      {/* Send Document Dialog */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Referral Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription className="text-blue-900 text-sm">
                Sending: {selectedReferral?.patient_name || 'Unknown Patient'} {selectedReferral?.documentUrl === selectedReferral?.processed_document_url ? 'processed admission packet' : 'referral document'}
              </AlertDescription>
            </Alert>

            <div>
              <Label>Send To</Label>
              <Select value={recipientEmail} onValueChange={setRecipientEmail}>
                <SelectTrigger>
                  <SelectValue placeholder="Select nurse or user" />
                </SelectTrigger>
                <SelectContent>
                  {users.filter(u => u.email !== currentUser?.email).map(u => (
                    <SelectItem key={u.email} value={u.email}>
                      {u.full_name || u.email} {u.role === 'admin' && '(Admin)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Message (Optional)</Label>
              <Textarea
                placeholder="Add a message about this referral..."
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSendDocument}
              disabled={!recipientEmail || isSending}
              className="bg-navy-600 hover:bg-navy-700"
            >
              {isSending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Document
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}