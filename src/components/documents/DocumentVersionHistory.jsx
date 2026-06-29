import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronDown, ChevronUp, Download, Eye } from 'lucide-react';

export default function DocumentVersionHistory({ documentSignatureId, _packageId }) {
  const [expandedVersion, setExpandedVersion] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['document-versions', documentSignatureId],
    queryFn: () =>
      base44.entities.DocumentVersion.filter(
        { document_signature_id: documentSignatureId },
        '-version_number'
      ),
    initialData: []
  });

  const handlePreview = (url) => {
    setPreviewUrl(url);
    setPreviewOpen(true);
  };

  const handleDownload = (url, name) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.pdf`;
    link.click();
  };

  if (isLoading) {
    return <div className="text-sm text-slate-500">Loading version history...</div>;
  }

  if (versions.length === 0) {
    return <div className="text-sm text-slate-500">No version history available</div>;
  }

  return (
    <>
      <div className="space-y-2">
        <h4 className="font-semibold text-sm text-slate-700">Version History ({versions.length})</h4>
        <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
          {versions.map((version) => (
            <div key={version.id} className="p-3 hover:bg-slate-50 transition-colors">
              <button
                onClick={() => setExpandedVersion(expandedVersion === version.id ? null : version.id)}
                className="w-full text-left flex items-start justify-between gap-2 py-1"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">
                      Version {version.version_number}
                      {version.is_current && (
                        <Badge className="ml-2 bg-green-100 text-green-800">Current</Badge>
                      )}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    Uploaded {new Date(version.uploaded_at).toLocaleDateString()} by {version.uploaded_by}
                  </div>
                  {version.change_reason && (
                    <div className="text-xs text-slate-500 mt-1">Reason: {version.change_reason}</div>
                  )}
                </div>
                {expandedVersion === version.id ? (
                  <ChevronUp className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
                )}
              </button>

              {expandedVersion === version.id && (
                <div className="mt-3 pt-3 border-t space-y-3 pl-4">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-slate-600">Signature Status:</span>
                      <Badge className="ml-1" variant="outline">
                        {version.signature_status_at_version || 'Unknown'}
                      </Badge>
                    </div>
                    <div>
                      <span className="text-slate-600">Invalidated Previous:</span>
                      <Badge className="ml-1" variant={version.invalidated_previous_signatures ? 'destructive' : 'secondary'}>
                        {version.invalidated_previous_signatures ? 'Yes' : 'No'}
                      </Badge>
                    </div>
                  </div>

                  {version.change_summary && (
                    <div className="text-xs bg-slate-50 p-2 rounded border">
                      <p className="text-slate-700">{version.change_summary}</p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePreview(version.pdf_url)}
                      className="flex-1 gap-1"
                    >
                      <Eye className="w-3 h-3" />
                      Preview
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownload(version.pdf_url, version.document_name)}
                      className="flex-1 gap-1"
                    >
                      <Download className="w-3 h-3" />
                      Download
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* PDF Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Document Preview</DialogTitle>
          </DialogHeader>
          <div className="w-full h-[70vh] border rounded-lg overflow-hidden">
            {previewUrl && (
              <iframe src={previewUrl} className="w-full h-full" title="Document Preview" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}