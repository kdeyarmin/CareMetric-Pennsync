import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export default function AIProactiveDocumentationAssistant() {
  return (
    <Alert className="border-amber-300 bg-amber-50">
      <AlertTriangle className="h-4 w-4 text-amber-700" />
      <AlertDescription className="text-sm text-amber-950">
        <strong>AI PDGM documentation optimization is unavailable.</strong> No assessment data is sent for automated score changes, grouping, payment, or revenue suggestions. Clinicians should document observed findings without payment-driven wording.
      </AlertDescription>
    </Alert>
  );
}
