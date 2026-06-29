import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { sendInAppNotification } from "@/lib/notify";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Clock, Mail, User, Plus, Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import { getDocumentDisplayName, getNormalizedSignatureStatus } from "@/components/signature/signatureUtils";

export default function ESignatureWorkflow({ document, documentType, patient, onClose }) {
  const [step, setStep] = useState("signers"); // signers, review, sent, tracking
  const [signers, setSigners] = useState([
    { id: 1, name: patient?.first_name || "", email: patient?.email || "", role: "patient", required: true, order: 1 }
  ]);
  const [nextSignerId, setNextSignerId] = useState(2);
  const [signMessage, setSignMessage] = useState("");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [enableReminders, setEnableReminders] = useState(true);
  const [reminderDays, setReminderDays] = useState(3);
  const [sending, setSending] = useState(false);
  const queryClient = useQueryClient();

  const normalizedDocumentName = useMemo(() => {
    if (typeof document === 'string') {
      return `${documentType} - ${patient?.first_name || 'Patient'} ${patient?.last_name || ''}`.trim();
    }

    return getDocumentDisplayName(document) || `${documentType} Document`;
  }, [document, documentType, patient?.first_name, patient?.last_name]);

  // Fetch document signatures tracking
  const { data: documentSignatures = [] } = useQuery({
    queryKey: ['document-signatures', patient?.id],
    queryFn: () => base44.entities.DocumentSignature.filter({ patient_id: patient?.id }, '-created_date', 50),
  });

  const addSigner = () => {
    setSigners([
      ...signers,
      { id: nextSignerId, name: "", email: "", role: "witness", required: false, order: signers.length + 1 }
    ]);
    setNextSignerId(nextSignerId + 1);
  };

  const removeSigner = (id) => {
    if (signers.length > 1) {
      setSigners(signers.filter(s => s.id !== id));
    }
  };

  const updateSigner = (id, field, value) => {
    setSigners(signers.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const validateSigners = () => {
    for (let signer of signers) {
      if (!signer.name.trim()) {
        toast.error(`Signer name is required`);
        return false;
      }
      if (!signer.email.trim() || !signer.email.includes("@")) {
        toast.error(`Valid email required for ${signer.name}`);
        return false;
      }
    }
    return true;
  };

  const handleSendForSignature = async () => {
    if (!validateSigners()) return;
    if (!deadlineDate) {
      toast.error("Please set a signature deadline");
      return;
    }

    setSending(true);
    try {
      const currentUser = await base44.auth.me();
      // Create document signature record
      const createdAt = new Date().toISOString();
      const normalizedSigners = signers.map((signer, index) => ({
        id: String(signer.id),
        name: signer.name.trim(),
        email: signer.email.trim().toLowerCase(),
        role: signer.role,
        required: signer.required,
        signed_date: null,
        signature: null,
        ip_address: null,
        signature_method: null,
        order: index + 1
      }));

      const docRecord = await base44.entities.DocumentSignature.create({
        patient_id: patient?.id,
        document_type: documentType,
        document_title: normalizedDocumentName,
        document_content: typeof document === 'string' ? document : document?.content || document?.document_content || '',
        document_url: document?.document_url || document?.original_pdf_url || null,
        status: "pending",
        signers: normalizedSigners,
        required_signatures: normalizedSigners.map((signer) => ({
          signer_id: signer.id,
          name: signer.name,
          role: signer.role,
          is_required: signer.required !== false,
          is_signed: false,
          order: signer.order,
        })),
        created_by_email: currentUser.email,
        message: signMessage,
        due_date: new Date(deadlineDate).toISOString(),
        expires_at: new Date(deadlineDate).toISOString(),
        reminder_sent: false,
        audit_trail: [{
          action: "sent",
          timestamp: createdAt,
          signer_id: null,
          notes: `Document sent by ${currentUser.full_name}`
        }]
      });

      // Send signing requests to signers
      for (let signer of signers) {
        await sendInAppNotification({
          user_email: signer.email,
          title: `Signature Requested: ${normalizedDocumentName}`,
          message: `${patient?.first_name} ${patient?.last_name} requests your signature on the following document: ${normalizedDocumentName}\n\nDeadline: ${new Date(deadlineDate).toLocaleDateString()}\n\nMessage: ${signMessage}`,
          type: "signature_request",
          related_entity: "DocumentSignature",
          related_id: docRecord.id,
        });

        // Send email notification with deadline
        await base44.integrations.Core.SendEmail({
          to: signer.email,
          subject: `[${signer.role.toUpperCase()}] Signature Requested: ${normalizedDocumentName}`,
          body: `You have been requested to sign a document as a ${signer.role}.\n\nDocument: ${normalizedDocumentName}\nFrom: ${patient?.first_name} ${patient?.last_name}\nDeadline: ${new Date(deadlineDate).toLocaleDateString()}\n\nMessage: ${signMessage}\n\nPlease log in to the system to review and sign the document.`
        });
      }

      // Schedule automated reminders if enabled
      if (enableReminders && reminderDays > 0) {
        await base44.functions.invoke('scheduleSignatureReminders', {
          document_id: docRecord.id,
          signer_emails: signers.map(s => s.email),
          reminder_days: reminderDays,
          deadline_date: deadlineDate
        });
      }

      queryClient.invalidateQueries({ queryKey: ['document-signatures'] });
      toast.success("Document sent for signatures!");
      setStep("tracking");
    } catch (error) {
      console.error('Error sending for signature:', error);
      toast.error("Failed to send document for signature");
    } finally {
      setSending(false);
    }
  };

  const recentDocuments = documentSignatures.slice(0, 5).map((doc) => ({
    ...doc,
    normalizedStatus: getNormalizedSignatureStatus(doc),
    normalizedName: getDocumentDisplayName(doc),
  }));

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>E-Signature Workflow</DialogTitle>
          <DialogDescription>
            Manage document signers, send for signatures, and track signing status
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Step Indicator */}
          <div className="flex gap-2">
            {["signers", "review", "sent", "tracking"].map((s, idx) => (
              <div key={s} className="flex-1">
                <div className={`h-1 rounded-full ${step === s ? "bg-blue-600" : idx < ["signers", "review", "sent", "tracking"].indexOf(step) ? "bg-green-600" : "bg-slate-300"}`} />
              </div>
            ))}
          </div>

          {step === "signers" && (
            <div className="space-y-4">
              <div>
                <Label className="text-base font-semibold mb-3 block">Signers (in order)</Label>
                <div className="space-y-3">
                  {signers.map((signer, idx) => (
                    <div key={signer.id} className="flex gap-3 p-3 border border-slate-200 rounded-lg bg-slate-50">
                      <div className="flex items-center justify-center w-8 h-8 bg-blue-600 text-white rounded-full text-sm font-semibold flex-shrink-0">
                        {idx + 1}
                      </div>
                      <div className="flex-1 space-y-2">
                        <Input
                          placeholder="Signer name"
                          value={signer.name}
                          onChange={(e) => updateSigner(signer.id, "name", e.target.value)}
                        />
                        <Input
                          placeholder="Email address"
                          type="email"
                          value={signer.email}
                          onChange={(e) => updateSigner(signer.id, "email", e.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Select value={signer.role} onValueChange={(v) => updateSigner(signer.id, "role", v)}>
                          <SelectTrigger className="w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="patient">Patient</SelectItem>
                            <SelectItem value="guardian">Guardian</SelectItem>
                            <SelectItem value="witness">Witness</SelectItem>
                            {/* 'clinician'/'other' cover physician/nurse; the
                                signers[].role enum has no physician/nurse members,
                                so those selections were silently dropped. */}
                            <SelectItem value="clinician">Clinician</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        {signers.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeSigner(signer.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <Button onClick={addSigner} variant="outline" className="mt-3 w-full" size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Signer
                </Button>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="deadline">Signature Deadline *</Label>
                  <Input
                    id="deadline"
                    type="date"
                    value={deadlineDate}
                    onChange={(e) => setDeadlineDate(e.target.value)}
                    className="mt-1"
                    min={new Date().toISOString().split('T')[0]}
                  />
                  <p className="text-xs text-slate-600 mt-1">Signers must complete by this date</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="reminders"
                      checked={enableReminders}
                      onChange={(e) => setEnableReminders(e.target.checked)}
                      className="rounded"
                    />
                    <Label htmlFor="reminders" className="text-sm">Send automated reminders</Label>
                  </div>
                  {enableReminders && (
                    <div>
                      <Label htmlFor="reminderDays" className="text-xs">Days before deadline</Label>
                      <Input
                        id="reminderDays"
                        type="number"
                        min="1"
                        max="30"
                        value={reminderDays}
                        onChange={(e) => setReminderDays(parseInt(e.target.value))}
                        className="mt-1 text-sm"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div>
                <Label>Message to Signers (Optional)</Label>
                <Textarea
                  placeholder="Add a personal message to include with the signature request..."
                  value={signMessage}
                  onChange={(e) => setSignMessage(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={() => setStep("review")} className="bg-blue-600 hover:bg-blue-700">
                  Continue
                </Button>
              </div>
            </div>
          )}

          {step === "review" && (
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-900">
                  <strong>Review before sending:</strong> {signers.length} signer{signers.length > 1 ? "s" : ""} will be requested to sign this document.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-base font-semibold">Signers to be notified:</Label>
                {signers.map((signer) => (
                  <div key={signer.id} className="flex items-center gap-3 p-2 bg-slate-50 rounded">
                    <User className="w-4 h-4 text-slate-600" />
                    <div>
                      <p className="font-medium text-sm">{signer.name}</p>
                      <p className="text-xs text-slate-600">{signer.email} • {signer.role}</p>
                    </div>
                  </div>
                ))}
              </div>

              {signMessage && (
                <div className="p-3 bg-slate-50 rounded border border-slate-200">
                  <p className="text-xs text-slate-600 font-semibold mb-1">Message:</p>
                  <p className="text-sm">{signMessage}</p>
                </div>
              )}

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Sending this document will notify all signers via email. They'll receive a link to review and sign the document.
                </AlertDescription>
              </Alert>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setStep("signers")}>Back</Button>
                <Button onClick={handleSendForSignature} disabled={sending} className="bg-green-600 hover:bg-green-700">
                  {sending ? "Sending..." : "Send for Signatures"}
                </Button>
              </div>
            </div>
          )}

          {step === "tracking" && (
            <div className="space-y-4">
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  Document sent successfully! Signers will receive notification emails.
                </AlertDescription>
              </Alert>

              <div>
                <Label className="text-base font-semibold mb-3 block">Signing Status</Label>
                <div className="space-y-2">
                  {signers.map((signer) => (
                    <div key={signer.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg">
                      <div className="flex items-center gap-3">
                        <Mail className="w-4 h-4 text-slate-600" />
                        <div>
                          <p className="font-medium text-sm">{signer.name}</p>
                          <p className="text-xs text-slate-600">{signer.email}</p>
                        </div>
                      </div>
                      <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                        <Clock className="w-3 h-3 mr-1" />
                        Pending
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-base font-semibold mb-3 block">Recent Documents</Label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {recentDocuments.length > 0 ? (
                    recentDocuments.map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div>
                          <p className="font-medium text-sm">{doc.normalizedName}</p>
                          <p className="text-xs text-slate-600">
                            Status: <Badge variant={doc.normalizedStatus === "signed" ? "default" : "secondary"}>{doc.normalizedStatus}</Badge>
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Download document"
                            onClick={() => {
                              const url = doc.signed_pdf_url || doc.document_url;
                              if (url) window.open(url, '_blank', 'noopener');
                              else toast.error('No document file is available to download yet');
                            }}
                          >
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-600">No previous documents</p>
                  )}
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button onClick={onClose} className="bg-blue-600 hover:bg-blue-700">
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
