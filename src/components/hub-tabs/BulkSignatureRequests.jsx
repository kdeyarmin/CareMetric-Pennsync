import { useEffect } from 'react';
import { trackEvent } from '@/lib/trackEvent';
import BulkDocumentPackageCreator from '@/components/documents/BulkDocumentPackageCreator';

export default function BulkSignatureRequests() {
  useEffect(() => {
    // Non-fatal: a page-view ping must never be able to blank this tab.
    trackEvent('bulk_signature_requests_page_viewed', { page: 'BulkSignatureRequests' });
  }, []);

  return (
    <div className="space-y-4 sm:space-y-6">
      <BulkDocumentPackageCreator />
    </div>
  );
}
