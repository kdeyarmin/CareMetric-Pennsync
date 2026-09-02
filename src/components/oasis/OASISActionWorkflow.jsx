import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export default function OASISActionWorkflow() {
  return (
    <Alert className="border-amber-300 bg-amber-50">
      <AlertTriangle className="h-4 w-4 text-amber-700" />
      <AlertDescription className="text-sm text-amber-950">
        <strong>Revenue-driven OASIS action items are unavailable.</strong> Legacy AI revenue tips and payment amounts are not converted into action items or tasks. Clinical documentation work must be based on observed patient findings; use the official EMR/CMS-approved grouper for reimbursement decisions.
      </AlertDescription>
    </Alert>
  );
}
