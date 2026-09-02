import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export default function ProactiveRescoringEngine() {
  return (
    <Alert className="border-amber-300 bg-amber-50">
      <AlertTriangle className="h-4 w-4 text-amber-700" />
      <AlertDescription className="text-sm text-amber-950">
        <strong>PDGM rescoring is unavailable.</strong> The prior AI workflow suggested higher OASIS scores, diagnoses, and payment changes without a verified CMS grouper or protected clinical provenance. No assessment data is sent for that analysis. Use documented patient findings and the official EMR/CMS-approved grouper.
      </AlertDescription>
    </Alert>
  );
}
