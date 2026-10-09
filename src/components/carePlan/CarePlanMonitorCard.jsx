import { useState } from "react";
import { Activity, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function brokerError(error) {
  const message = error?.response?.data?.error || error?.data?.error;
  return typeof message === "string" && message ? message : "The scan could not be completed. Please try again.";
}

/**
 * Scans the selected agency's active charts' recent visits for findings that
 * warrant a care plan review (monitorClinicalDataForCarePlanUpdates).
 *
 * The server admits the built-in administrator or an agency_admin/manager of
 * that agency, selects charts by their own agency, and creates each proposal
 * once per finding and day as pending_review for the visit's nurse, who is
 * notified. Nothing changes a care plan until a clinician acts on it.
 */
export default function CarePlanMonitorCard() {
  const { tenantContext } = useAuth();
  const agencyId = tenantContext?.agency_id || null;
  const [days, setDays] = useState("7");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const scan = async () => {
    setRunning(true);
    setError(null);
    try {
      const { data } = await base44.functions.invoke("monitorClinicalDataForCarePlanUpdates", {
        agency_id: agencyId,
        timeframe_days: Number(days),
      });
      setResult(data || null);
    } catch (e) {
      setError(brokerError(e));
    } finally {
      setRunning(false);
    }
  };

  const proposals = Array.isArray(result?.proposals) ? result.proposals : [];
  return (
    <Card className="mb-4 sm:mb-6">
      <CardHeader className="p-3 sm:p-4 md:p-6">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <Activity className="h-5 w-5 text-navy-600" aria-hidden="true" />
          Clinical monitoring for care plan updates
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 sm:p-4 md:p-6 pt-0">
        <p className="text-sm text-slate-600">
          Reviews recent completed visits for vital-sign thresholds, new or worsening symptoms and care gaps,
          and proposes care plan updates for the visit&apos;s nurse to review. Proposals are never applied automatically.
        </p>
        {!agencyId ? (
          <p className="text-sm text-slate-600">Open an agency workspace to scan its charts.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm">
              <span className="block text-slate-700">Look back</span>
              <select
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              >
                <option value="3">3 days</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
              </select>
            </label>
            <Button type="button" onClick={scan} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Activity className="h-4 w-4 mr-1" />}
              Scan now
            </Button>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {result && (
          <div role="status" className="space-y-2 text-sm">
            <p>
              {result.patients_analyzed ?? 0} chart{result.patients_analyzed === 1 ? "" : "s"} with recent visits analyzed;
              {" "}{result.proposals_created ?? 0} new proposal{result.proposals_created === 1 ? "" : "s"}.
            </p>
            {proposals.length > 0 && (
              <ul className="space-y-1">
                {proposals.map((proposal) => (
                  <li key={proposal.id} className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{String(proposal.severity)}</Badge>
                    <span>{String(proposal.finding_type || "").replaceAll("_", " ")}</span>
                    {proposal.proposed_intervention && <span className="text-slate-600">— {proposal.proposed_intervention}</span>}
                    {!proposal.assigned_nurse && <span className="text-amber-700">(no assigned nurse in this agency)</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
