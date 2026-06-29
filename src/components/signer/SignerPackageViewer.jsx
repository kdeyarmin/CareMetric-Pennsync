import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Clock, FileText, Eye } from 'lucide-react';
import SignerDocumentSigner from './SignerDocumentSigner';

export default function SignerPackageViewer({
  packageData,
  token,
  onSignatureComplete,
}) {
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [isSigningMode, setIsSigningMode] = useState(false);

  // DocumentSignature's canonical completed status is 'completed'; tolerate the
  // legacy 'signed' value so the portal counts/splits documents correctly.
  const isDocSigned = (d) => ['signed', 'completed'].includes(d.status);
  const signedDocs = packageData.documents.filter(isDocSigned);
  const pendingDocs = packageData.documents.filter((d) => !isDocSigned(d));

  if (isSigningMode && selectedDocId) {
    return (
      <SignerDocumentSigner
        documentId={selectedDocId}
        packageData={packageData}
        token={token}
        onComplete={(allSigned) => {
          setIsSigningMode(false);
          setSelectedDocId(null);
          onSignatureComplete(allSigned);
        }}
        onCancel={() => {
          setIsSigningMode(false);
          setSelectedDocId(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Pending Documents */}
      {pendingDocs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600" />
              Pending Signature ({pendingDocs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-4 border border-amber-200 bg-amber-50 rounded-lg"
                >
                  <div className="flex items-start gap-3 flex-1">
                    <FileText className="w-5 h-5 text-amber-600 mt-1 shrink-0" />
                    <div>
                      <p className="font-medium text-slate-900">{doc.name}</p>
                      <p className="text-xs text-slate-600 mt-1">
                        Awaiting your signature
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={() => {
                      setSelectedDocId(doc.id);
                      setIsSigningMode(true);
                    }}
                    className="shrink-0"
                  >
                    Sign Now
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Signed Documents */}
      {signedDocs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              Completed ({signedDocs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {signedDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-4 border border-green-200 bg-green-50 rounded-lg"
                >
                  <div className="flex items-start gap-3 flex-1">
                    <CheckCircle2 className="w-5 h-5 text-green-600 mt-1 shrink-0" />
                    <div>
                      <p className="font-medium text-slate-900">{doc.name}</p>
                      <p className="text-xs text-slate-600 mt-1">
                        Signed on{' '}
                        {new Date(doc.signedAt).toLocaleDateString()} at{' '}
                        {new Date(doc.signedAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedDocId(doc.id);
                      setIsSigningMode(true);
                    }}
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    View
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completion Message */}
      {pendingDocs.length === 0 && signedDocs.length > 0 && (
        <Card className="bg-green-50 border-green-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-green-900">All documents signed!</p>
                <p className="text-sm text-green-800 mt-1">
                  Thank you for completing all required signatures. The document administrator has been notified.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}