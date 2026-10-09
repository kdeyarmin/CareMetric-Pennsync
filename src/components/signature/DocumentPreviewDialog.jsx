import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import DocumentBytesViewer from '@/components/signature/DocumentBytesViewer';

/** Shows PDF bytes a staff broker returned (a placement preview or a certificate). */
export default function DocumentPreviewDialog({ preview, onClose }) {
  return (
    <Dialog open={!!preview} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{preview?.title || 'Preview'}</DialogTitle>
          {preview?.description && <DialogDescription>{preview.description}</DialogDescription>}
        </DialogHeader>
        {preview?.bytes && <DocumentBytesViewer bytes={preview.bytes} title={preview.title || 'Preview'} />}
      </DialogContent>
    </Dialog>
  );
}
