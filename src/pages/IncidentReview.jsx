import { ShieldAlert } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import IncidentReviewQueue from "@/components/incident/IncidentReviewQueue";

// Admin-only incident review queue. Staff report incidents on /Incidents; admins
// triage, acknowledge (under review) and resolve them here. Submission-time
// notifications to admins are handled by submitIncidentReport /
// submitStateReportableIncident — this page is the central review surface.
export default function IncidentReview() {
  return (
    <PageContainer>
      <PageHeader
        icon={ShieldAlert}
        eyebrow="Office"
        title="Incident Review"
        description="Review, acknowledge, and resolve incident reports submitted by staff. State-reportable events are flagged in red."
        favoritePage="IncidentReview"
      />
      <IncidentReviewQueue />
    </PageContainer>
  );
}