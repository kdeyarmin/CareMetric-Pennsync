import { FolderArchive } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import PageContainer from "@/components/ui/PageContainer";
import DischargeReportUploader from "@/components/admin/DischargeReportUploader";

/**
 * Bulk Discharge Import — upload a discharge report file to batch-process
 * patient discharges. Wraps the previously-unrouted uploader so admins have a
 * dedicated, linkable home for the workflow.
 */
export default function BulkDischargeImportPage() {
  return (
    <PageContainer className="max-w-5xl animate-fade-in">
      <PageHeader
        icon={FolderArchive}
        iconColor="bg-amber-600"
        eyebrow="Data Management"
        title="Bulk Discharge Import"
        description="Upload a discharge report to batch-match and process patient discharges in one pass."
        favoritePage="BulkDischargeImport"
      />
      <DischargeReportUploader />
    </PageContainer>
  );
}
