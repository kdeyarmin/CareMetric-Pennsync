import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { Building2 } from "lucide-react";
import FacilityDocumentationRulesManager from "@/components/admin/FacilityDocumentationRulesManager";

export default function FacilityDocumentationRules() {
  return (
    <PageContainer>
      <PageHeader
        icon={Building2}
        eyebrow="Compliance"
        title="Facility Documentation Rules"
        description="Enforce facility-specific documentation requirements from state surveys or agency policy — e.g. oxygen patients need an SpO2 in every note, diabetics need a blood sugar, wounds need measurements. Nurses see the applicable requirements live while charting."
      />
      <FacilityDocumentationRulesManager />
    </PageContainer>
  );
}
