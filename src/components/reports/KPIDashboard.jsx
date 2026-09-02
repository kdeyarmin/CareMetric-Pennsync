import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

/**
 * Reporting is intentionally paused. The former browser implementation listed
 * multiple clinical entities whose hosted RLS is not yet tenant-bound. Client
 * filters are not an authorization boundary, so this surface must not fetch any
 * reporting data until a server-owned tenant broker is staged and proved.
 */
export default function KPIDashboard() {
  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardContent className="flex items-start gap-3 p-6">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
        <div>
          <h3 className="font-semibold text-amber-950">Reporting temporarily unavailable</h3>
          <p className="mt-1 text-sm leading-6 text-amber-900">
            This dashboard is paused pending tenant security validation. No clinical reporting
            data is loaded from the browser while the server-authorized reporting boundary is
            being verified.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
