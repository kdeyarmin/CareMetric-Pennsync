import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, PieChart } from "lucide-react";

export default function EnhancedPDGMCaseMixAnalyzer() {
  return (
    <Card className="border-2 border-amber-300">
      <CardHeader className="bg-amber-50">
        <CardTitle className="text-lg flex items-center gap-2">
          <PieChart className="w-5 h-5 text-amber-700" />
          Case-Mix Component Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div role="alert" className="flex items-start gap-3 text-sm text-amber-950">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-bold">Case-mix weights and dollar contributions are unavailable — not $0.</p>
            <p className="mt-1">
              AI-derived grouping, functional points, multipliers, and payment components are excluded until a verified CMS HHGS 432-group grouper passes golden-case tests.
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
