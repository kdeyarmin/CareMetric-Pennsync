import { ShieldCheck } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import PageContainer from "@/components/ui/PageContainer";
import CredentialComplianceReport from "@/components/admin/CredentialComplianceReport";

/**
 * Credential Compliance — agency-wide view of staff license/credential status
 * and upcoming expirations. Wraps the previously-unrouted compliance report so
 * admins can monitor and act on expiring personnel credentials.
 */
export default function CredentialCompliancePage() {
  return (
    <PageContainer className="animate-fade-in">
      <PageHeader
        icon={ShieldCheck}
        iconColor="bg-emerald-600"
        eyebrow="Staff Management"
        title="Credential Compliance"
        description="Track staff licenses and credentials, flag expired or expiring items, and keep the agency audit-ready."
        favoritePage="CredentialCompliance"
      />
      <CredentialComplianceReport />
    </PageContainer>
  );
}
