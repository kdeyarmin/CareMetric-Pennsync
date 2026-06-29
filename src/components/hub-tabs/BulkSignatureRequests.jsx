import { useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import BulkDocumentPackageCreator from '@/components/documents/BulkDocumentPackageCreator';

export default function BulkSignatureRequests() {
  useEffect(() => {
    base44.analytics.track({
      eventName: 'bulk_signature_requests_page_viewed',
      properties: { page: 'BulkSignatureRequests' },
    });
  }, []);

  return (
    <div className="space-y-4 sm:space-y-6">
      <BulkDocumentPackageCreator />
    </div>
  );
}
