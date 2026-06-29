import { FolderArchive } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import DischargeReportUploader from "@/components/admin/DischargeReportUploader";

/**
 * Bulk Discharge Import — upload a discharge report file to batch-process
 * patient discharges. Wraps the previously-unrouted uploader so admins have a
 * dedicated, linkable home for the workflow.
 */
export default function BulkDischargeImportPage() {
  return (
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in">
      <PageHeader
        icon={FolderArchive}
        iconColor="bg-amber-600"
        eyebrow="Data Management"
        title="Bulk Discharge Import"
        description="Upload a discharge report to batch-match and process patient discharges in one pass."
        favoritePage="BulkDischargeImport"
      />
      <DischargeReportUploader />
    </div>
  );
}
