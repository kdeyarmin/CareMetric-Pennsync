import { Link } from "react-router";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import {
  PDGM_REIMBURSEMENT_ACTION,
  PDGM_REIMBURSEMENT_BLOCKER,
} from "@/components/pdgm/pdgmAvailability";

export default function OASISRevenueAnalysis() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <Card className="border-2 border-amber-300">
        <CardHeader className="bg-amber-50">
          <CardTitle className="flex items-center gap-2 text-amber-950">
            <AlertTriangle className="h-5 w-5 text-amber-700" />
            PDGM Revenue Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-5 text-sm text-amber-950">
          <p className="font-bold">Grouping, payment, and revenue optimization are unavailable — not $0.</p>
          <p>{PDGM_REIMBURSEMENT_BLOCKER}</p>
          <p>Required action: {PDGM_REIMBURSEMENT_ACTION}</p>
          <Link to={`${createPageUrl("OASISCenter")}?tab=analyze`}>
            <Button variant="outline" className="mt-2">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Analyzer
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
