import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, FileText } from "lucide-react";
import {
  PDGM_REIMBURSEMENT_ACTION,
  PDGM_REIMBURSEMENT_BLOCKER,
} from "@/components/pdgm/pdgmAvailability";

export default function ClinicalManagerBriefCard() {
  return (
    <Card className="border-2 border-amber-300">
      <CardHeader className="bg-amber-50">
        <CardTitle className="flex items-center gap-2 text-lg text-amber-950">
          <FileText className="h-5 w-5" /> Clinical Manager Reimbursement Brief
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-5">
        <div role="alert" className="flex items-start gap-3 text-sm text-amber-950">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-bold">The reimbursement/coding brief is unavailable.</p>
            <p className="mt-1">{PDGM_REIMBURSEMENT_BLOCKER}</p>
            <p className="mt-1">Diagnoses are not re-sequenced for higher payment, and no reimbursement PDF or email is generated.</p>
            <p className="mt-1">Required action: {PDGM_REIMBURSEMENT_ACTION}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
