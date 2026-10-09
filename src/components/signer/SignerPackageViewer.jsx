import { useState } from 'react';
import { CheckCircle2, Clock, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatLocalDate } from '@/lib/dateLocal';
import SignerDocumentSigner from './SignerDocumentSigner';

/**
 * The outside signer's own package: their documents, which ones still need
 * their signature, and the signing step for one of them. Every byte and every
 * submission goes through the callbacks the portal page fences with its lease.
 */
export default function SignerPackageViewer({ packageData, onLoadDocument, onSubmitSignature }) {
  const [selectedId, setSelectedId] = useState(null);
  const documents = Array.isArray(packageData?.documents) ? packageData.documents : [];
  const pending = documents.filter((doc) => doc.status !== 'completed');
  const signed = documents.filter((doc) => doc.status === 'completed');
  const selected = documents.find((doc) => doc.id === selectedId) || null;

  if (selected && selected.status !== 'completed') {
    return (
      <SignerDocumentSigner
        document={selected}
        signerName={packageData.signer_name}
        agreement={packageData.agreement}
        onLoadDocument={onLoadDocument}
        onSubmitSignature={onSubmitSignature}
        onDone={() => setSelectedId(null)}
        onCancel={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-navy-200 bg-navy-50">
        <CardContent className="space-y-2 pt-6 text-sm text-slate-800">
          <p className="font-semibold">Hello {packageData.signer_name},</p>
          <p>
            You have been asked to review and sign {documents.length === 1 ? 'a document' : `${documents.length} documents`}
            {packageData.package_name ? <> for <span className="font-medium">{packageData.package_name}</span></> : null}.
            {packageData.due_date ? <> Please sign by <span className="font-medium">{formatLocalDate(packageData.due_date) || packageData.due_date}</span>.</> : null}
          </p>
          {packageData.message && (
            <p className="whitespace-pre-line rounded-md border border-navy-100 bg-white p-3 text-slate-700">
              {packageData.message}
            </p>
          )}
        </CardContent>
      </Card>

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-amber-600" aria-hidden="true" />
              Waiting for your signature ({pending.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pending.map((doc) => (
              <div key={doc.id} className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <FileText className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
                  <p className="font-medium text-slate-900">{doc.name}</p>
                </div>
                <Button onClick={() => setSelectedId(doc.id)} className="min-h-[44px]">Review and sign</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {signed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
              Signed ({signed.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {signed.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-4">
                <p className="font-medium text-slate-900">{doc.name}</p>
                <Badge className="bg-green-100 text-green-800">
                  Signed{doc.signed_at ? ` ${new Date(doc.signed_at).toLocaleString()}` : ''}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
