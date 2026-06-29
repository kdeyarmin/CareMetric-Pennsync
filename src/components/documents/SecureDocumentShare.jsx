import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Mail, AlertCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

// NOTE: There is no backend that mints, persists, validates, or expires a
// document share token, and no /shared-document route exists. A "secure share
// link" cannot be implemented safely on the client alone, so the link-sharing
// path is intentionally disabled and the previous "HIPAA-secure / auto-expiring
// link" claims have been removed rather than left as a fake security control.
export default function SecureDocumentShare({ documentName, _documentData }) {
  const [isOpen, setIsOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleNotify = async () => {
    if (!recipientEmail) {
      toast.error('Please enter a recipient email');
      return;
    }

    setIsSending(true);
    try {
      // Record the notification action for the audit trail.
      await base44.entities.SecurityLog.create({
        user_email: (await base44.auth.me()).email,
        action: 'notify_document_recipient',
        details: {
          document_name: documentName,
          recipient_email: recipientEmail,
          // Explicitly NOT a secure share — no link/token was issued.
          method: 'email_notification_only',
          shared_at: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      });

      // Send a notification email WITHOUT a share link. We cannot guarantee a
      // secure, expiring, access-controlled link from the client, so we don't
      // pretend to. The recipient is directed to request access through normal
      // channels instead of clicking a fabricated "secure" URL.
      await base44.integrations.Core.SendEmail({
        to: recipientEmail,
        subject: `Document available: ${documentName}`,
        body:
          `A document ("${documentName}") is ready to be shared with you.\n\n` +
          `For your privacy and security, this notification does not contain the document ` +
          `or a direct link. Please contact the sending healthcare provider to arrange ` +
          `secure access through an approved channel.`,
      });

      toast.success(`Recipient notified at ${recipientEmail}`);
      setRecipientEmail('');
      setIsOpen(false);
    } catch (error) {
      console.error('Notify error:', error);
      toast.error('Failed to notify recipient');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        variant="outline"
        className="gap-2"
      >
        <Mail className="w-4 h-4" />
        Notify Recipient
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-slate-600" />
              Notify a Recipient
            </DialogTitle>
            <DialogDescription>
              Send an email letting a recipient know that {documentName} is available.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert className="bg-amber-50 border-amber-300">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="ml-3 text-sm text-amber-900">
                <p className="font-semibold">Secure document sharing is not yet available.</p>
                <p>
                  This action only sends a notification email — it does NOT attach the document or
                  generate an access link. There is no enforced expiry, watermarking, or
                  access-controlled link. To actually share the document, use an approved secure
                  channel.
                </p>
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="recipient-email">Recipient Email</Label>
              <Input
                id="recipient-email"
                type="email"
                placeholder="specialist@hospital.com"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
              />
            </div>

            <Alert className="bg-slate-50 border-slate-200">
              <AlertCircle className="h-4 w-4 text-slate-600" />
              <AlertDescription className="ml-3 text-xs text-slate-700">
                The recipient should be an authorized healthcare provider or covered entity. This
                notification is logged for the audit trail.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={isSending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleNotify}
              disabled={isSending}
            >
              {isSending ? 'Sending...' : 'Send Notification'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}