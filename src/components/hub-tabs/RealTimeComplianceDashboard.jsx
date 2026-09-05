import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import UserActivityUnavailable from "@/components/security/UserActivityUnavailable";

const REALTIME_COMPLIANCE_ANALYTICS_ENABLED = false;

export default function RealTimeComplianceDashboard() {
  if (!REALTIME_COMPLIANCE_ANALYTICS_ENABLED) {
    return (
      <div className="space-y-4">
        <Card className="border-2 border-amber-300 bg-amber-50">
          <CardContent className="space-y-2 p-6 text-sm text-amber-950">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldAlert className="h-5 w-5" /> Real-Time Compliance Analytics Paused
            </div>
            <p>
              This dashboard is unavailable pending tenant-scoped reporting access and
              validation of legacy AI/OASIS score fields.
            </p>
            <p>
              No audit, activity, OASIS upload, user roster, visit, patient, or training
              record is loaded from this tab.
            </p>
          </CardContent>
        </Card>
        <UserActivityUnavailable title="User activity inputs unavailable" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-2 border-amber-300 bg-amber-50">
        <CardContent className="space-y-2 p-6 text-sm text-amber-950">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="h-5 w-5" /> Real-Time Compliance Analytics Paused
          </div>
          <p>
            This dashboard is unavailable pending tenant-scoped reporting access and
            validation of legacy AI/OASIS score fields.
          </p>
          <p>
            No audit, activity, OASIS upload, user roster, visit, patient, or training
            record is loaded from this tab.
          </p>
        </CardContent>
      </Card>
      <UserActivityUnavailable title="User activity inputs unavailable" />
    </div>
  );
}
