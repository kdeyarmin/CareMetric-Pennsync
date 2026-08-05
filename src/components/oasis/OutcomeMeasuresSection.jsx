import { useMemo } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { computeOutcomeMeasures } from "@/functions/computeOutcomeMeasures";
import {
  IMPROVEMENT_MEASURES,
  STAR_MIN_EPISODES,
  STAR_MIN_MEASURES,
  rollupMeasures,
} from "@/components/oasis/outcomeMeasureEngine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import LoadingState from "@/components/ui/LoadingState";
import EmptyState from "@/components/ui/empty-state";
import {
  Star,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Activity,
  Info,
} from "lucide-react";

/**
 * OutcomeMeasuresSection — early-warning QoPC star-proxy dashboard for the
 * OASIS Center Quality tab (admin-gated by the caller).
 *
 * Companion-mode design (this app runs ALONGSIDE the agency's EMR):
 *   - It is a DASHBOARD over in-app data, never an alert stream, and it never
 *     infers anything from the ABSENCE of EMR-owned data.
 *   - Coverage labeling is first-class: every number is presented as "based on
 *     N complete episode pairs documented in PennSync" (episodes with BOTH the
 *     SOC/ROC and the Discharge OASIS in this app).
 *   - Official CMS star ratings come from the EMR's OASIS submissions; this
 *     view is an early-warning proxy computed from the same CMS change-score
 *     math (see outcomeMeasureEngine.js / computeOutcomeMeasures).
 *
 * Data sources:
 *   - AgencyKPI (metric_category 'quality') — the per-measure rates written by
 *     the computeOutcomeMeasures cron, incl. benchmark_value where set.
 *   - PatientOutcomeMetric (outcome_measure_source 'oasis_change_score') — one
 *     row per computed episode pair; per-measure episode counts, star_eligible
 *     flags, and the GG discharge function score are derived from these via the
 *     unit-tested engine's own rollupMeasures().
 */

// Stable display metadata for the GG measure (stored per-episode on
// PatientOutcomeMetric.gg_discharge_function_score, not as an AgencyKPI row).
const GG_MEASURE_LABEL = "GG Discharge Function Score";

const pct = (n) => `${Number(n).toFixed(1)}%`;

// Pick, per metric_name, the AgencyKPI row with the newest period_end so a
// re-run for an older period can't shadow the current rate.
function latestKpiByMeasureLabel(kpiRows) {
  const byLabel = new Map();
  for (const row of kpiRows || []) {
    const prev = byLabel.get(row.metric_name);
    if (!prev || String(row.period_end || "") > String(prev.period_end || "")) {
      byLabel.set(row.metric_name, row);
    }
  }
  return byLabel;
}

function BenchmarkDelta({ rate, benchmark }) {
  if (rate == null || benchmark == null) return null;
  const delta = Math.round((rate - benchmark) * 10) / 10;
  const up = delta >= 0;
  return (
    <Badge
      className={up ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}
    >
      {up ? (
        <TrendingUp className="w-3 h-3 mr-1" />
      ) : (
        <TrendingDown className="w-3 h-3 mr-1" />
      )}
      {up ? "+" : ""}
      {delta} pts vs benchmark ({pct(benchmark)})
    </Badge>
  );
}

function StarFloorBadge({ denominator }) {
  const met = denominator >= STAR_MIN_EPISODES;
  return met ? (
    <Badge className="bg-emerald-100 text-emerald-800">
      <Star className="w-3 h-3 mr-1" />
      Star floor met (&ge;{STAR_MIN_EPISODES} episodes)
    </Badge>
  ) : (
    <Badge variant="outline" className="text-slate-600">
      {denominator} of {STAR_MIN_EPISODES} episodes
    </Badge>
  );
}

export default function OutcomeMeasuresSection() {
  const queryClient = useQueryClient();

  // Deliberately NO initialData on either query: defaulting to [] would render
  // zero rates and a "0 episodes" coverage line mid-fetch. Loading, error, and
  // genuinely-empty are rendered as distinct states below.
  const kpisQuery = useQuery({
    queryKey: ["outcomeMeasureKpis"],
    queryFn: () =>
      base44.entities.AgencyKPI.filter(
        { metric_category: "quality" },
        "-period_end",
        1000
      ),
  });

  const metricsQuery = useQuery({
    queryKey: ["patientOutcomeMetrics"],
    queryFn: () =>
      base44.entities.PatientOutcomeMetric.filter(
        { outcome_measure_source: "oasis_change_score" },
        "-episode_end",
        5000
      ),
  });

  const recompute = useMutation({
    mutationFn: () => computeOutcomeMeasures({}),
    onSuccess: (res) => {
      const data = res?.data || {};
      if (data.success === false) {
        toast.error(`Recompute failed: ${data.error || "unknown error"}`);
        return;
      }
      toast.success(
        `Outcome measures recomputed — ${data.discharges_evaluated ?? 0} episode pair(s) evaluated, ${data.agency_kpis_written ?? 0} KPI row(s) written.`
      );
      queryClient.invalidateQueries({ queryKey: ["outcomeMeasureKpis"] });
      queryClient.invalidateQueries({ queryKey: ["patientOutcomeMetrics"] });
    },
    onError: (err) => {
      toast.error(`Recompute failed: ${err?.message || "unknown error"}`);
    },
  });

  const metrics = metricsQuery.data;
  const kpis = kpisQuery.data;

  const derived = useMemo(() => {
    if (!metrics || !kpis) return null;

    // Re-shape each PatientOutcomeMetric's persisted measure_results into the
    // outcome shape rollupMeasures() expects, so per-measure numerators,
    // denominators, and star_eligible flags come from the exact unit-tested
    // engine logic (no re-implementation to drift).
    const rollup = rollupMeasures(
      metrics.map((row) => ({
        measures: (row.measure_results || []).map((r) => ({
          key: r.measure,
          status: r.status,
        })),
      }))
    );

    const kpiByLabel = latestKpiByMeasureLabel(
      kpis.filter((k) =>
        IMPROVEMENT_MEASURES.some((m) => m.label === k.metric_name)
      )
    );

    const rows = rollup.measures.map((m) => {
      const kpi = kpiByLabel.get(m.label);
      return {
        key: m.key,
        label: m.label,
        item: m.item,
        // Prefer the cron-written AgencyKPI rate (it carries the benchmark and
        // period); fall back to the client-side rollup when no KPI row exists.
        rate: kpi?.metric_value ?? m.rate,
        benchmark: kpi?.benchmark_value ?? null,
        numerator: m.numerator,
        denominator: m.denominator,
        starEligible: m.star_eligible,
      };
    });

    // GG discharge function score: averaged over the episodes where the GG item
    // set was complete enough to score (stored per-episode by the cron).
    const ggScores = metrics
      .map((row) => row.gg_discharge_function_score)
      .filter((n) => typeof n === "number" && Number.isFinite(n));
    const gg = {
      label: GG_MEASURE_LABEL,
      count: ggScores.length,
      average: ggScores.length
        ? Math.round(
            (ggScores.reduce((a, b) => a + b, 0) / ggScores.length) * 10
          ) / 10
        : null,
    };

    // Floor progress across the 6 measures shown here (5 improvement + GG),
    // all of which feed the 7 QoPC star inputs.
    const measuresAtFloor =
      rollup.star_eligible_measure_count +
      (gg.count >= STAR_MIN_EPISODES ? 1 : 0);

    return {
      totalEpisodes: metrics.length,
      rows,
      gg,
      measuresAtFloor,
    };
  }, [metrics, kpis]);

  // isPending, not isLoading: react-query v5 defines isLoading as
  // `isPending && isFetching`, so an offline mount (status 'pending',
  // fetchStatus 'paused') is neither loading nor error — execution fell through
  // to the success branch with `derived` still null and threw on
  // derived.totalEpisodes, taking out the whole page via the route error
  // boundary. The `|| !derived` below is belt-and-braces for the same class.
  const isLoading = kpisQuery.isPending || metricsQuery.isPending;
  const isError = kpisQuery.isError || metricsQuery.isError;

  const recomputeButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => recompute.mutate()}
      disabled={recompute.isPending}
    >
      <RefreshCw
        className={`w-4 h-4 mr-2 ${recompute.isPending ? "animate-spin" : ""}`}
      />
      {recompute.isPending ? "Recomputing…" : "Recompute now"}
    </Button>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Star className="w-5 h-5 text-amber-500" />
          Outcome Measures — Star-Rating Early Warning
        </CardTitle>
        {recomputeButton}
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading || (!isError && !derived) ? (
          <LoadingState label="Loading outcome measures…" />
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertTriangle className="w-6 h-6 text-red-500" />
            <p className="text-sm text-slate-700 font-medium">
              Couldn&apos;t load outcome measures.
            </p>
            <p className="text-xs text-slate-500">
              {kpisQuery.error?.message ||
                metricsQuery.error?.message ||
                "The quality-metric reads failed."}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                kpisQuery.refetch();
                metricsQuery.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : (
          <>
            {/* Coverage labeling — first-class, not a footnote. */}
            <div className="rounded-lg bg-navy-50/60 border border-navy-100 p-4">
              <p className="text-sm font-semibold text-slate-900">
                Based on {derived.totalEpisodes} complete episode pair
                {derived.totalEpisodes === 1 ? "" : "s"} documented in PennSync
              </p>
              <p className="text-xs text-slate-600 mt-1">
                An episode pair counts only when both its SOC/ROC and Discharge
                OASIS are documented in this app. Episodes assessed or
                discharged in your EMR are not included here — and are never
                alerted on.
              </p>
            </div>

            {derived.totalEpisodes === 0 ? (
              <EmptyState
                icon={Activity}
                title={`0 of ${STAR_MIN_EPISODES} episodes — measures appear as episodes accumulate`}
                description={`Outcome measures are computed from episode pairs (SOC/ROC + Discharge OASIS) documented in PennSync. Once pairs accumulate, each measure needs ${STAR_MIN_EPISODES} eligible episodes — and the agency ${STAR_MIN_MEASURES} of the 7 reported measures — before CMS would assign a star.`}
                action={recomputeButton}
              />
            ) : (
              <>
                {/* Progress toward the CMS star-eligibility floors. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">
                        Episode pairs toward the {STAR_MIN_EPISODES}-episode
                        floor
                      </span>
                      <span className="font-semibold text-slate-900">
                        {derived.totalEpisodes} / {STAR_MIN_EPISODES}
                      </span>
                    </div>
                    <Progress
                      value={(derived.totalEpisodes / STAR_MIN_EPISODES) * 100}
                      className="h-2"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">
                        Measures at the floor (all {STAR_MIN_MEASURES} tracked
                        measures needed for a star)
                      </span>
                      <span className="font-semibold text-slate-900">
                        {derived.measuresAtFloor} / {STAR_MIN_MEASURES}
                      </span>
                    </div>
                    <Progress
                      value={
                        (derived.measuresAtFloor / STAR_MIN_MEASURES) * 100
                      }
                      className="h-2"
                    />
                  </div>
                </div>

                {derived.totalEpisodes < STAR_MIN_EPISODES && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <Info className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-amber-900">
                      {derived.totalEpisodes} of {STAR_MIN_EPISODES} episodes —
                      measures appear as episodes accumulate. Rates below are
                      early signals over a small sample, not star-eligible
                      results.
                    </p>
                  </div>
                )}

                {/* The five improvement measures. */}
                <div className="space-y-3">
                  {derived.rows.map((m) => (
                    <div
                      key={m.key}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-slate-900">
                            {m.label}
                          </p>
                          <Badge variant="outline" className="uppercase">
                            {m.item}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {m.numerator} of {m.denominator} eligible episode
                          {m.denominator === 1 ? "" : "s"} improved
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <BenchmarkDelta rate={m.rate} benchmark={m.benchmark} />
                        <StarFloorBadge denominator={m.denominator} />
                        <span className="text-xl font-bold text-slate-900 tabular-nums w-20 text-right">
                          {m.rate != null ? pct(m.rate) : "—"}
                        </span>
                      </div>
                    </div>
                  ))}

                  {/* GG discharge function score (per-episode raw score, averaged). */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-900">
                          {derived.gg.label}
                        </p>
                        <Badge variant="outline" className="uppercase">
                          GG0130 + GG0170
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Average raw discharge function score across{" "}
                        {derived.gg.count} scored episode
                        {derived.gg.count === 1 ? "" : "s"} (higher = more
                        independent)
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StarFloorBadge denominator={derived.gg.count} />
                      <span className="text-xl font-bold text-slate-900 tabular-nums w-20 text-right">
                        {derived.gg.average != null ? derived.gg.average : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            <p className="flex items-start gap-2 text-xs text-slate-500 border-t border-slate-100 pt-3">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                Official CMS star ratings are computed from your EMR&apos;s
                OASIS submissions. This view is an early-warning proxy over the
                assessments documented in PennSync, using the same CMS
                change-score math. See the full picture on the{" "}
                <Link
                  to="/OASISCenter?tab=analytics"
                  className="underline text-navy-700"
                >
                  Analytics tab
                </Link>
                .
              </span>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
