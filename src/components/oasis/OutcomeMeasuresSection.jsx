import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { getPublishedOutcomeMeasures } from "@/functions/getPublishedOutcomeMeasures";
import { computeOutcomeMeasures } from "@/functions/computeOutcomeMeasures";

/**
 * Internal outcome proxies for the caller's agency.
 *
 * Reads only through getPublishedOutcomeMeasures, which re-derives the
 * caller's agency_admin/manager membership for the named agency and returns
 * one complete published run for one exact window. "Compute now" goes through
 * computeOutcomeMeasures, which checks the same membership before it signs a
 * one-agency, one-window request to the outcome worker. The browser never
 * reads AgencyKPI or PatientOutcomeMetric rows itself and never reaches the
 * worker directly.
 *
 * Episode rows stay on the patient they were computed for: a merged duplicate
 * keeps its historical metrics (their content hash covers patient_id), so this
 * section reports counts, not a per-patient list that would look re-attributed.
 */

const WINDOWS = Object.freeze([
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
  { value: "365", label: "Last 12 months", days: 365 },
]);

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

// Whole UTC days ending yesterday, the last day the nightly job has closed.
export function outcomeWindow(days, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return { period_type: "custom", period_start: isoDay(start), period_end: isoDay(end) };
}

function brokerError(error) {
  const message = error?.response?.data?.error || error?.data?.error;
  return typeof message === "string" && message ? message : null;
}

function brokerStatus(error) {
  return Number(error?.response?.status || error?.status || 0);
}

export default function OutcomeMeasuresSection() {
  const { tenantContext } = useAuth();
  const agencyId = tenantContext?.agency_id || null;
  const queryClient = useQueryClient();
  const [windowValue, setWindowValue] = useState("90");
  const [computing, setComputing] = useState(false);
  const [notice, setNotice] = useState(null);
  const selected = WINDOWS.find((option) => option.value === windowValue) || WINDOWS[1];
  const range = useMemo(() => outcomeWindow(selected.days), [selected.days]);
  const queryKey = ["published-outcomes", agencyId, range.period_type, range.period_start, range.period_end];

  const published = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        const { data } = await getPublishedOutcomeMeasures({ agency_id: agencyId, ...range });
        return data;
      } catch (error) {
        // No publication yet for this exact window is an answer, not a failure.
        if (brokerStatus(error) === 404) return null;
        throw error;
      }
    },
    enabled: !!agencyId,
    retry: false,
  });

  const compute = async () => {
    setComputing(true);
    setNotice(null);
    try {
      const { data } = await computeOutcomeMeasures({ agency_id: agencyId, ...range });
      setNotice({
        tone: "success",
        text: data?.idempotent_replay
          ? "These numbers were already computed today for this window."
          : "Outcome measures computed and published.",
      });
      await queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      setNotice({
        tone: "error",
        text: brokerError(error) || "Outcome measures could not be computed. Please try again.",
      });
    } finally {
      setComputing(false);
    }
  };

  const kpis = Array.isArray(published.data?.agency_kpis) ? published.data.agency_kpis : [];
  const episodes = Array.isArray(published.data?.patient_outcome_metrics)
    ? published.data.patient_outcome_metrics.length
    : 0;
  const publishedAt = published.data?.publication?.published_at;

  let body;
  if (!agencyId) {
    body = <p className="text-sm text-slate-600">Outcome measures open inside an agency workspace.</p>;
  } else if (published.isLoading) {
    body = <p className="text-sm text-slate-500"><Loader2 className="inline h-4 w-4 mr-1 animate-spin" />Loading published outcomes...</p>;
  } else if (published.error) {
    body = (
      <p role="alert" className="text-sm text-red-700">
        {brokerError(published.error) || "Published outcomes could not be loaded."}
      </p>
    );
  } else if (!published.data) {
    body = (
      <p className="text-sm text-slate-600">
        No outcome measures have been published for this window yet. Choose Compute now to calculate them
        from completed Start of Care / Resumption of Care and Discharge OASIS pairs.
      </p>
    );
  } else {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          {episodes} episode{episodes === 1 ? "" : "s"} scored
          {publishedAt ? ` · published ${new Date(publishedAt).toLocaleString()}` : ""}
        </p>
        {kpis.length === 0 ? (
          <p className="text-sm text-slate-600">The published run contains no measures for this window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Published outcome measures</caption>
              <thead>
                <tr className="text-left text-slate-500">
                  <th scope="col" className="py-1 pr-3 font-medium">Measure</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Improvement</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Benchmark</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Excluded</th>
                  <th scope="col" className="py-1 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {kpis.map((kpi) => (
                  <tr key={kpi.id} className="border-t">
                    <td className="py-1 pr-3">{kpi.metric_name}</td>
                    <td className="py-1 pr-3">{Number(kpi.metric_value).toFixed(1)}%</td>
                    <td className="py-1 pr-3">{kpi.benchmark_value == null ? "—" : `${Number(kpi.benchmark_value).toFixed(1)}%`}</td>
                    <td className="py-1 pr-3">{kpi.excluded_episode_count}</td>
                    <td className="py-1"><Badge variant="outline">{String(kpi.status).replaceAll("_", " ")}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-slate-600" aria-hidden="true" />
          Outcome Measures
        </CardTitle>
        <Badge variant="outline">Internal proxy</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-500">
          Unadjusted internal improvement proxies from paired in-app OASIS assessments. They are not
          official CMS rates, star ratings or HHVBP results.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="outcome-window">Window</Label>
            <select
              id="outcome-window"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              value={windowValue}
              onChange={(e) => { setWindowValue(e.target.value); setNotice(null); }}
            >
              {WINDOWS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <Button type="button" onClick={compute} disabled={!agencyId || computing}>
            {computing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Compute now
          </Button>
          <span className="text-xs text-slate-500">{range.period_start} to {range.period_end}</span>
        </div>
        {notice && (
          <p role={notice.tone === "error" ? "alert" : "status"} className={`text-sm ${notice.tone === "error" ? "text-red-700" : "text-emerald-700"}`}>
            {notice.text}
          </p>
        )}
        {body}
      </CardContent>
    </Card>
  );
}
