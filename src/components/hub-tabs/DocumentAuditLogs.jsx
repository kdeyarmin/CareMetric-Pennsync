import { useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import DocumentAuditLogViewer from '@/components/documents/DocumentAuditLogViewer';

export default function DocumentAuditLogs() {
  useEffect(() => {
    base44.analytics.track({
      eventName: 'document_audit_logs_page_viewed',
      properties: { page: 'DocumentAuditLogs' },
    });
  }, []);

  return (
    <div className="space-y-4 sm:space-y-6">
      <DocumentAuditLogViewer />
    </div>
  );
}