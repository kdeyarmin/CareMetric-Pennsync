import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Info, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { getPublishedOutcomeMeasures } from "@/functions/getPublishedOutcomeMeasures";
import { manageOASISRecords } from "@/functions/manageOASISRecords";

/**
 * Published OASIS outcome measures for one agency and one day.
 *
 * Released by the owner on 2026-10-08 ("turn everything on"). The section READS
 * ONLY: every value comes from getPublishedOutcomeMeasures, which admits the
 * protected platform owner or an active agency_admin/manager membership in the
 * requested agency (never a self-editable profile field), and returns a run
 * only once the nightly pipeline has published it with every row's content
 * hash verified. Nothing here computes, recomputes or writes an outcome: the
 * computation job is internal-secret-only and is never reachable from a
 * browser session.
 *
 * The rates are the app's internal improvement proxies over verified CMS-aligned
 * responses — unadjusted, and not official CMS results.
 */

const STATUS_STYLES = {
  on_target: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  critical: "bg-red-100 text-red-800",
};
const STATUS_LABELS = {
  on_target: "At or above benchmark",
  warning: "Near benchmark / no benchmark",
  critical: "Below benchmark",
};

/** Yesterday's calendar date in UTC — the window the nightly dispatcher publishes. */
export function previousUtcDate(now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return date.toISOString().slice(0, 10);
}

function errorStatus(error) {
  return error?.response?.status ?? error?.status ?? null;
}

function errorMessage(error) {
  return error?.response?.data?.error || error?.message || "Outcome measures could not be loaded.";
}

export default function OutcomeMeasuresSection() {
  const { user, tenantContext } = useAuth();
  const ownAgencyId = tenantContext?.agency_id || "";
  const [chosenAgencyId, setChosenAgencyId] = useState("");
  const [day, setDay] = useState(() => previousUtcDate());

  // The platform owner has no agency of their own and picks one; everyone
  // else reports on the agency their membership binds.
  const agencies = useQuery({
    queryKey: ["oasisOutcomeAgencies", user?.id, ownAgencyId],
    queryFn: async () => (await manageOASISRecords("list_agencies"))?.agencies || [],
    enabled: !!user?.id && !ownAgencyId,
    retry: false,
  });
  const agencyId = ownAgencyId || chosenAgencyId
    || (agencies.data?.length === 1 ? agencies.data[0].id : "");

  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(day);
  const outcomes = useQuery({
    queryKey: ["publishedOutcomeMeasures", agencyId, day],
    queryFn: async () => (await getPublishedOutcomeMeasures({
      agency_id: agencyId,
      period_type: "daily",
      period_start: day,
      period_end: day,
    }))?.data,
    enabled: !!agencyId && validDay,
    retry: false,
  });

  const notPublished = outcomes.isError && errorStatus(outcomes.error) === 404;
  const kpis = outcomes.data?.agency_kpis || [];
  const episodes = outcomes.data?.patient_outcome_metrics || [];
  const publication = outcomes.data?.publication;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-slate-600" />
          Outcome Measures
        </CardTitle>
        <Badge variant="outline" className="text-slate-700">Internal proxies — not CMS results</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          {!ownAgencyId && (agencies.data?.length || 0) > 1 && (
            <div className="space-y-1">
              <Label htmlFor="outcome-agency">Agency</Label>
              <select
                id="outcome-agency"
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                value={agencyId}
                onChange={(event) => setChosenAgencyId(event.target.value)}
              >
                <option value="">Choose an agency</option>
                {agencies.data.map((agency) => (
                  <option key={agency.id} value={agency.id}>{agency.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="outcome-day">Reporting day (UTC)</Label>
            <Input
              id="outcome-day"
              type="date"
              value={day}
              max={previousUtcDate()}
              onChange={(event) => setDay(event.target.value)}
              className="w-44"
            />
          </div>
        </div>

        {!agencyId && !agencies.isLoading && (
          <p className="text-sm text-slate-600">
            {agencies.isError ? errorMessage(agencies.error) : "Choose an agency to see its published outcome measures."}
          </p>
        )}

        {outcomes.isLoading && agencyId && (
          <p className="text-sm text-slate-600">Loading published outcome measures…</p>
        )}

        {notPublished && (
          <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <Info className="w-5 h-5 text-slate-600 mt-0.5 shrink-0" />
            <div className="space-y-1 text-sm text-slate-700">
              <p className="font-medium text-slate-900">No published outcome run for {day}.</p>
              <p>
                Outcome measures are computed overnight for the previous day and appear here once the
                run is published. Choose another day, or check back after tonight&apos;s run.
              </p>
            </div>
          </div>
        )}

        {outcomes.isError && !notPublished && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
            <AlertTriangle className="w-5 h-5 text-red-700 mt-0.5 shrink-0" />
            <p className="text-sm text-red-900">{errorMessage(outcomes.error)}</p>
          </div>
        )}

        {outcomes.isSuccess && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              {episodes.length} discharge episode{episodes.length === 1 ? "" : "s"} paired with their start or
              resumption of care
              {publication?.published_at ? ` · published ${new Date(publication.published_at).toLocaleString()}` : ""}
              {publication?.calculation_version ? ` · ${publication.calculation_version}` : ""}
            </p>
            {kpis.length === 0 ? (
              <p className="text-sm text-slate-600">
                The run for this day published no measure with an eligible episode.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {kpis.map((kpi) => (
                  <div key={kpi.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-slate-900">{kpi.metric_name}</p>
                      <Badge className={STATUS_STYLES[kpi.status] || "bg-slate-100 text-slate-800"}>
                        {STATUS_LABELS[kpi.status] || kpi.status}
                      </Badge>
                    </div>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{kpi.metric_value}{kpi.unit}</p>
                    {kpi.benchmark_value != null && (
                      <p className="text-xs text-slate-600">Benchmark {kpi.benchmark_value}{kpi.unit}</p>
                    )}
                    {(kpi.contributing_factors || []).length > 0 && (
                      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
                        {kpi.contributing_factors.map((factor) => <li key={factor}>{factor}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-500">
              Unadjusted improvement proxies over verified CMS-aligned responses. They do not apply CMS
              risk adjustment or the complete published specifications, and are not official CMS results.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
