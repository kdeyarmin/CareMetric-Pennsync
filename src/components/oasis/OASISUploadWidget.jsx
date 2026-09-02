import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

/**
 * OASIS file upload is paused before the browser can upload PHI. Locking the
 * OASISUpload entity write alone is too late: a direct UploadFile call would
 * already have stored the PDF before record creation failed. Restore this only
 * through the future tenant + patient/chart authorized server broker.
 */
export default function OASISUploadWidget() {
  return (
    <Card className="border-2 border-amber-300 bg-amber-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg text-amber-950">
          <ShieldAlert className="h-5 w-5 text-amber-700" aria-hidden="true" />
          OASIS Upload Temporarily Unavailable
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm leading-6 text-amber-900">
        <p>
          OASIS PDF upload and analysis are paused pending tenant and patient-chart
          security validation. No file is uploaded from this screen.
        </p>
        <p>
          Use the approved clinical record workflow until the authorized server
          upload broker is staged and verified.
        </p>
      </CardContent>
    </Card>
  );
}
