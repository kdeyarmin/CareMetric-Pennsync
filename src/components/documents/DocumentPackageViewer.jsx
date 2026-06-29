import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Eye, Download, FileText, RefreshCw } from 'lucide-react';
import DocumentVersionHistory from './DocumentVersionHistory';
import DocumentReplacementDialog from './DocumentReplacementDialog';

export default function DocumentPackageViewer({ packageId }) {
  const [replacingDocument, setReplacingDocument] = useState(null);
  const [replacementDialogOpen, setReplacementDialogOpen] = useState(false);
  const _queryClient = useQueryClient();

  const { data: pkg } = useQuery({
    queryKey: ['document-package', packageId],
    queryFn: () => base44.entities.DocumentPackage.get(packageId),
  });

  const { data: signatures = [] } = useQuery({
    queryKey: ['package-signatures', packageId],
    queryFn: async () => {
      if (!pkg?.document_signatures?.length) return [];
      const sigs = await Promise.all(
        pkg.document_signatures.map(id =>
          base44.entities.DocumentSignature.get(id)
        )
      );
      return sigs;
    },
    enabled: !!pkg?.document_signatures,
  });

  const handlePreview = (url) => {
    window.open(url, '_blank');
  };

  const handleDownload = (url, name) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.pdf`;
    link.click();
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'signed':
        return 'bg-green-100 text-green-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'declined':
        return 'bg-red-100 text-red-800';
      case 'expired':
        return 'bg-slate-100 text-slate-800';
      default:
        return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <>
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Documents in Package</h3>
        
        <div className="space-y-3">
          {signatures.map((sig) => (
            <Card key={sig.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-600" />
                      <CardTitle className="text-base">{sig.document_name}</CardTitle>
                      <Badge className={getStatusColor(sig.status)}>
                        {sig.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Type: {sig.document_type}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setReplacingDocument(sig);
                      setReplacementDialogOpen(true);
                    }}
                    className="gap-1 shrink-0"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Update
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Current Document Actions */}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handlePreview(sig.document_url || sig.original_pdf_url)}
                    className="flex-1 gap-1"
                  >
                    <Eye className="w-3 h-3" />
                    Preview Current
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDownload(sig.document_url || sig.original_pdf_url, sig.document_name)}
                    className="flex-1 gap-1"
                  >
                    <Download className="w-3 h-3" />
                    Download
                  </Button>
                </div>

                {/* Version History */}
                <div className="border-t pt-4">
                  <DocumentVersionHistory
                    documentSignatureId={sig.id}
                    packageId={packageId}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {signatures.length === 0 && (
          <div className="text-center py-8 text-slate-500">
            No documents in this package
          </div>
        )}
      </div>

      {/* Document Replacement Dialog */}
      {replacingDocument && (
        <DocumentReplacementDialog
          open={replacementDialogOpen}
          onClose={() => {
            setReplacementDialogOpen(false);
            setReplacingDocument(null);
          }}
          documentSignature={replacingDocument}
          packageId={packageId}
        />
      )}
    </>
  );
}