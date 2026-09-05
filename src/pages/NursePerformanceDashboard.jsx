import { TrendingUp } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import UserActivityUnavailable from "@/components/security/UserActivityUnavailable";

export default function NursePerformanceDashboard() {
  return (
    <PageContainer>
      <PageHeader
        icon={TrendingUp}
        eyebrow="Performance"
        title="Nurse Performance Dashboard"
        description="Derived performance scores and recommendations are paused until every source record has verified tenant provenance."
        favoritePage="NursePerformanceDashboard"
      />
      <UserActivityUnavailable title="Nurse performance analysis unavailable" />
    </PageContainer>
  );
}
