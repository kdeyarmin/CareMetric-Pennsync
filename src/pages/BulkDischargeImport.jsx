import { FolderArchive } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import PageContainer from "@/components/ui/PageContainer";
import DischargeReportUploader from "@/components/admin/DischargeReportUploader";

/**
 * Bulk discharge processing remains visible as a dedicated route so staff can
 * see its release state without being offered a file picker. Discharge reports
 * may contain PHI, so the browser must not upload one until the purpose-bound
 * tenant and patient authorization broker is staged and verified.
 */
export default function BulkDischargeImportPage() {
  return (
    <PageContainer className="max-w-5xl animate-fade-in">
      <PageHeader
        icon={FolderArchive}
        iconColor="bg-amber-600"
        eyebrow="Data Management"
        title="Bulk Discharge Import"
        description="File upload and automated bulk discharge processing are temporarily unavailable while the authorized tenant and patient-record workflow is completed."
        favoritePage="BulkDischargeImport"
      />
      <DischargeReportUploader />
    </PageContainer>
  );
}
