import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Lightbulb } from "lucide-react";

export default function PDGMScenarioModeler() {
  return (
    <Card className="border-2 border-amber-300">
      <CardHeader className="bg-amber-50">
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-amber-700" />
          PDGM Scenario Modeler
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div role="alert" className="flex items-start gap-3 text-sm text-amber-950">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-bold">Grouping and payment scenarios are unavailable — not $0.</p>
            <p className="mt-1">
              The former modeler asked an AI model to invent functional points, case-mix weights, and payment differences. Those outputs are excluded until a verified CMS HHGS 432-group grouper uses protected assessment inputs and passes golden-case tests.
            </p>
            <p className="mt-1">
              Required action: use the official EMR/CMS-approved grouper for billing and reimbursement decisions.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
