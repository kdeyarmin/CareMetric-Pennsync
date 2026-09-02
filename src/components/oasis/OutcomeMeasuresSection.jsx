import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldCheck } from "lucide-react";

/**
 * Outcome data is intentionally unavailable in the browser until Base44's
 * hosted read rules are tenant-bound and independently verified. Client-side
 * filters are not authorization, and User.agency_id is not currently a
 * protected tenant claim. The secret-only backend job must never be invoked by
 * this component.
 */
export default function OutcomeMeasuresSection() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-slate-600" />
          Outcome Measures
        </CardTitle>
        <Badge variant="outline" className="text-amber-700 border-amber-300">
          Security validation pending
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium text-amber-950">
              Temporarily unavailable pending tenant security validation
            </p>
            <p className="text-sm text-amber-900">
              Direct outcome-data reads and browser recomputation are disabled.
              This section will remain unavailable until a server-owned agency
              authorization boundary and hosted tenant-scoped read rules are
              verified in nonproduction. No production outcome data is changed.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
