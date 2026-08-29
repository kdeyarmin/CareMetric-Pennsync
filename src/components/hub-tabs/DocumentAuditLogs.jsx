import { useEffect } from 'react';
import { trackEvent } from '@/lib/trackEvent';
import DocumentAuditLogViewer from '@/components/documents/DocumentAuditLogViewer';

export default function DocumentAuditLogs() {
  useEffect(() => {
    // Non-fatal: a page-view ping must never be able to blank this tab.
    trackEvent('document_audit_logs_page_viewed', { page: 'DocumentAuditLogs' });
  }, []);

  return (
    <div className="space-y-4 sm:space-y-6">
      <DocumentAuditLogViewer />
    </div>
  );
}