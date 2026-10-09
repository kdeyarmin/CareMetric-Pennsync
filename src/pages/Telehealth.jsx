import { Video } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import TelehealthWorkspace from "@/components/telehealth/TelehealthWorkspace";

export default function Telehealth() {
  return (
    <PageContainer>
      <PageHeader
        icon={Video}
        eyebrow="Communication"
        title="Telehealth"
        description="Schedule, join, and document video visits with your patients."
        favoritePage="Telehealth"
      />
      <div className="px-3 sm:px-4 md:px-6">
        <TelehealthWorkspace />
      </div>
    </PageContainer>
  );
}
