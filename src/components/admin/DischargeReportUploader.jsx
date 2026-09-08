import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

/**
 * Discharge reports can contain PHI. Keep this component static while the
 * processDischargeReport backend is intentionally paused: uploading first and
 * discovering the pause second would already have stored the file. Restore a
 * picker only after an authorized server upload + processing broker has passed
 * isolated hosted validation.
 */
export default function DischargeReportUploader() {
  return (
    <Card className="border-2 border-amber-300 bg-amber-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg text-amber-950">
          <ShieldAlert className="h-5 w-5 text-amber-700" aria-hidden="true" />
          Discharge Report Upload Temporarily Unavailable
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-6 text-amber-900">
        <p>
          Discharge reports may contain protected health information. File upload
          and automated processing are paused pending tenant, patient-record, and
          audit security validation. No file is uploaded from this screen.
        </p>
        <p>
          Use the approved patient discharge workflow to review and discharge
          each patient individually until the authorized bulk broker is released.
        </p>
      </CardContent>
    </Card>
  );
}
