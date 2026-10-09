import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";

function brokerError(error) {
  const message = error?.response?.data?.error || error?.data?.error;
  return typeof message === "string" && message ? message : "Scores could not be recalculated. Please try again.";
}

/**
 * Recomputes the stored data-completeness scores for the caller's agency now
 * (the same job runs nightly). The server admits an agency_admin or manager of
 * that agency only, writes a chart's two quality fields through a
 * compare-and-swap, and never overwrites a visit's clinician compliance score.
 */
export default function DataQualityRecalculate() {
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const { data } = await base44.functions.invoke("calculateDataQualityScores", {});
      setSummary(Array.isArray(data?.agencies) ? data.agencies[0] || null : null);
    } catch (e) {
      setError(brokerError(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" size="sm" onClick={run} disabled={running}>
        {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
        Recalculate stored scores
      </Button>
      {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
      {summary && (
        <span role="status" className="text-sm text-slate-600">
          {summary.patients_scored} charts scored ({summary.patients_updated} updated),
          {" "}{summary.members_scored} staff profiles, {summary.visits_with_documentation_gaps} of {summary.visits_reviewed} visits with documentation gaps.
        </span>
      )}
    </div>
  );
}
