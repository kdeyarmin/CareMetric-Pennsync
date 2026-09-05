import { Activity } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import UserActivityUnavailable from "@/components/security/UserActivityUnavailable";

export default function UserActivityReport() {
  return (
    <PageContainer>
      <PageHeader
        icon={Activity}
        eyebrow="Administration"
        title="User Activity Report"
        description="Audit history is paused until records can be read through a verified tenant-authorized broker."
        favoritePage="UserActivityReport"
      />
      <UserActivityUnavailable title="User activity reporting unavailable" />
    </PageContainer>
  );
}
