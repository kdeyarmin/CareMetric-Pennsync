import { Video } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import TelehealthWorkspace from "@/components/telehealth/TelehealthWorkspace";

/**
 * Telehealth visits for one chart (owner decision, 2026-10-08).
 *
 * Everything goes through the released, agency-scoped session broker
 * (manageTelehealthSession): listing this patient's visits requires a chart the
 * caller may open (agency-wide role, chart creator or an active care-team
 * assignment), scheduling one re-checks that chart on the server and takes the
 * patient's name from the chart rather than from this page, and the patient's
 * invite link is a hashed, rotatable token (rotateTelehealthJoinToken /
 * createTelehealthToken). No session row is read or written from the browser.
 */
export default function PatientTelehealthPanel({ patientId, patientName = "", agencyId = null }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Video className="h-4 w-4 text-blue-600" aria-hidden="true" />
          Telehealth visits
        </CardTitle>
      </CardHeader>
      <CardContent>
        <TelehealthWorkspace patientId={patientId} patientName={patientName} agencyId={agencyId} />
      </CardContent>
    </Card>
  );
}
