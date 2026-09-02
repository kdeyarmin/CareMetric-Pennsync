import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export default function AISmartOASISAssistant() {
  return (
    <Alert className="border-amber-300 bg-amber-50">
      <AlertTriangle className="h-4 w-4 text-amber-700" />
      <AlertDescription className="text-sm text-amber-950">
        <strong>AI OASIS scoring suggestions are paused.</strong> No referral or assessment data is sent for automated OASIS scoring, case-mix, grouping, or payment guidance while OASIS v2 and the verified CMS grouper remain default-off. Record clinician-observed responses in the official workflow and use the EMR/CMS-approved grouper.
      </AlertDescription>
    </Alert>
  );
}
