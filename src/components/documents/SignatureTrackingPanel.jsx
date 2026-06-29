import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mail, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { format } from "date-fns";

export default function SignatureTrackingPanel({ documentSignature, onRefresh }) {
  const [sendingReminder, setSendingReminder] = useState(null);

  const getSignerStatus = (signer) => {
    if (signer.signed_date) {
      return { 
        label: "Signed", 
        icon: CheckCircle2, 
        color: "bg-green-100 text-green-800",
        bg: "bg-green-50"
      };
    }
    return { 
      label: "Pending", 
      icon: Clock, 
      color: "bg-yellow-100 text-yellow-800",
      bg: "bg-yellow-50"
    };
  };

  const handleSendReminder = async (signerEmail, signerName) => {
    setSendingReminder(signerEmail);
    try {
      await base44.integrations.Core.SendEmail({
        to: signerEmail,
        subject: `[REMINDER] Signature Pending - ${documentSignature.document_type}`,
        body: `This is a reminder that you have a pending signature request for: ${documentSignature.document_type}\n\nFrom: ${documentSignature.created_by_email}\nDeadline: ${format(new Date(documentSignature.expires_at), 'MMMM d, yyyy')}\n\nPlease sign the document as soon as possible.`
      });
      
      // Add reminder event to audit trail
      const updatedAuditTrail = documentSignature.audit_trail || [];
      updatedAuditTrail.push({
        action: 'reminder_sent',
        timestamp: new Date().toISOString(),
        signer_id: documentSignature.signers.find(s => s.email === signerEmail)?.id,
        notes: `Manual reminder sent to ${signerName}`
      });

      await base44.asServiceRole.entities.DocumentSignature.update(documentSignature.id, {
        audit_trail: updatedAuditTrail
      });

      toast.success(`Reminder sent to ${signerName}`);
      onRefresh?.();
    } catch (error) {
      console.error('Error sending reminder:', error);
      toast.error('Failed to send reminder');
    } finally {
      setSendingReminder(null);
    }
  };

  const isExpired = new Date(documentSignature.expires_at) < new Date();

  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Signature Status</CardTitle>
          {isExpired && (
            <Badge variant="destructive" className="text-xs">
              <AlertCircle className="w-3 h-3 mr-1" />
              Expired
            </Badge>
          )}
        </div>
        <p className="text-xs text-slate-600 mt-1">
          Due: {format(new Date(documentSignature.expires_at), 'MMMM d, yyyy')}
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {documentSignature.signers?.map((signer) => {
            const status = getSignerStatus(signer);
            const StatusIcon = status.icon;
            
            return (
              <div key={signer.id} className={`flex items-center justify-between p-3 rounded-lg border border-slate-200 ${status.bg}`}>
                <div className="flex items-center gap-3">
                  <StatusIcon className="w-4 h-4" />
                  <div>
                    <p className="text-sm font-medium">{signer.name}</p>
                    <p className="text-xs text-slate-600">{signer.email} • {signer.role}</p>
                    {signer.signed_date && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        Signed: {format(new Date(signer.signed_date), 'MMM d, yyyy h:mm a')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={status.color} variant="secondary">
                    {status.label}
                  </Badge>
                  {!signer.signed_date && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleSendReminder(signer.email, signer.name)}
                      disabled={sendingReminder === signer.email}
                      className="text-xs h-auto py-1 px-2"
                    >
                      {sendingReminder === signer.email ? (
                        <span className="animate-spin">⏳</span>
                      ) : (
                        <>
                          <Mail className="w-3 h-3 mr-1" />
                          Remind
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}