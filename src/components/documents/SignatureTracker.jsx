import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Clock, AlertCircle, Mail, Download, FileText } from "lucide-react";
import { toast } from "sonner";

export default function SignatureTracker({ patientId = null }) {
  const [_selectedDoc, _setSelectedDoc] = useState(null);
  const [sendingReminder, setSendingReminder] = useState(false);
  const queryClient = useQueryClient();

  // Fetch all documents with signatures
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['signature-documents', patientId],
    queryFn: () => {
      if (patientId) {
        return base44.entities.DocumentSignature.filter({ patient_id: patientId }, '-created_date', 100);
      }
      return base44.entities.DocumentSignature.list('-created_date', 100);
    },
  });

  const getStatusColor = (status) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800";
      case "in_progress":
        return "bg-blue-100 text-blue-800";
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "rejected":
        return "bg-red-100 text-red-800";
      default:
        return "bg-slate-100 text-slate-800";
    }
  };

  const getSignerStatusIcon = (signer) => {
    if (signer.signed_date) {
      return <CheckCircle2 className="w-5 h-5 text-green-600" />;
    }
    return <Clock className="w-5 h-5 text-yellow-600" />;
  };

  const getSignerStatusText = (signer) => {
    if (signer.signed_date) {
      return `Signed on ${new Date(signer.signed_date).toLocaleDateString()}`;
    }
    return "Awaiting signature";
  };

  const countSignedSigners = (signers) => {
    // Count signed among REQUIRED signers so the progress ratio stays consistent
    // with countRequiredSigners — otherwise an optional signer signing pushed the
    // numerator above the denominator (e.g. "2/1").
    return (signers || []).filter(s => s.required && s.signed_date).length;
  };

  const countRequiredSigners = (signers) => {
    return (signers || []).filter(s => s.required).length;
  };

  const handleSendReminder = async (documentId) => {
    setSendingReminder(true);
    try {
      const doc = documents.find(d => d.id === documentId);
      if (!doc) return;

      // Send reminder emails to unsigned signers
      const unsignedSigners = (doc.signers || []).filter(s => !s.signed_date);
      for (let signer of unsignedSigners) {
        await base44.integrations.Core.SendEmail({
          to: signer.email,
          subject: `Reminder: Document awaiting your signature - ${doc.document_title}`,
          body: `This is a friendly reminder that you have a document awaiting your signature.\n\nDocument: ${doc.document_title}\n\nPlease log in to the system to review and sign the document.\n\nThank you!`
        });
      }

      // Update reminder flag
      await base44.entities.DocumentSignature.update(documentId, { reminder_sent: true });
      queryClient.invalidateQueries({ queryKey: ['signature-documents'] });
      toast.success("Reminder sent to unsigned signers!");
    } catch (error) {
      console.error('Error sending reminder:', error);
      toast.error("Failed to send reminder");
    } finally {
      setSendingReminder(false);
    }
  };

  const handleDownloadDocument = async (doc) => {
    try {
      const blob = new Blob([doc.document_content], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.document_title}.txt`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      toast.success("Document downloaded!");
    } catch {
      toast.error("Failed to download document");
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8">
          <p className="text-center text-slate-500">Loading documents...</p>
        </CardContent>
      </Card>
    );
  }

  if (documents.length === 0) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="text-center">
            <FileText className="w-12 h-12 mx-auto mb-3 text-slate-400" />
            <p className="text-slate-600">No documents with signature workflows yet.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4">
        {documents.map((doc) => (
          <Card key={doc.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <CardTitle className="text-lg">{doc.document_title}</CardTitle>
                    <Badge className={getStatusColor(doc.status)}>
                      {doc.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-600">
                    {doc.document_type} • Created {new Date(doc.created_date).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownloadDocument(doc)}
                  >
                    <Download className="w-4 h-4 mr-1" />
                    Download
                  </Button>
                  {doc.status !== "completed" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSendReminder(doc.id)}
                      disabled={sendingReminder}
                    >
                      <Mail className="w-4 h-4 mr-1" />
                      Remind
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {doc.message && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm"><strong>Message:</strong> {doc.message}</p>
                </div>
              )}

              <div>
                <p className="text-sm font-semibold mb-2">
                  Signature Progress: {countSignedSigners(doc.signers)}/{countRequiredSigners(doc.signers)}
                </p>
                <div className="space-y-2">
                  {(doc.signers || []).map((signer) => (
                    <div key={signer.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="flex items-center gap-3">
                        {getSignerStatusIcon(signer)}
                        <div>
                          <p className="font-medium text-sm">{signer.name}</p>
                          <p className="text-xs text-slate-600">{signer.email}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-medium text-slate-700">
                          {signer.role}
                        </p>
                        <p className="text-xs text-slate-600">
                          {getSignerStatusText(signer)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {doc.status === "completed" && (
                <Alert className="bg-green-50 border-green-200">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-800">
                    All required signatures completed on {new Date(doc.completed_date).toLocaleDateString()}
                  </AlertDescription>
                </Alert>
              )}

              {doc.status !== "completed" && (
                <Alert className="bg-yellow-50 border-yellow-200">
                  <AlertCircle className="h-4 w-4 text-yellow-600" />
                  <AlertDescription className="text-yellow-800">
                    Awaiting signatures. Expires on {new Date(doc.expires_at).toLocaleDateString()}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}