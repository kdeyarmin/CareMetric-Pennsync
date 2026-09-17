import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { isAdminView } from "@/lib/roles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck, Clock, TrendingUp, DollarSign } from "lucide-react";
import { buildFollowUpPlan } from "@/components/referral/referralFollowUpEngine";
import { estimateFollowUpRevenueImpact, fmtUsd } from "@/components/referral/followUpRevenueImpact";
import ReportReadState from '@/components/analytics/ReportReadState';
import { EMPTY_REPORT_ROWS, REPORT_READ_OPTIONS } from '@/components/analytics/reportReadContracts';
import useReferralReportRows from './useReferralReportRows';

const hoursBetween = (a, b) => {
  const ms = Date.parse(b) - Date.parse(a);
  return Number.isFinite(ms) && ms >= 0 ? ms / 36e5 : null;
};

/**
 * Referral follow-up analytics (Reports & Analytics → Referrals tab).
 *
 * Measures the request→response loop: turnaround by referring provider, the
 * most common documentation gaps, and how many referrals arrive complete —
 * the data behind the "your referrals always come without X" provider-
 * education conversation.
 *
 * The revenue tile renders for admin users only (agency policy: dollar
 * figures never show to nurses). The page itself is admin-only; this gate is
 * defense in depth for reuse.
 */
export default function FollowUpAnalytics() {
  const userQuery = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
    ...REPORT_READ_OPTIONS,
  });
  const currentUser = userQuery.isSuccess ? userQuery.data : null;
  const adminView = isAdminView(currentUser);

  const referralQuery = useReferralReportRows();
  const referrals = referralQuery.isSuccess ? referralQuery.data : EMPTY_REPORT_ROWS;

  const rateQuery = useQuery({
    queryKey: ["pdgm-rate-config", currentUser?.agency_name || null],
    queryFn: async () => {
      const { fetchCallerPdgmRateConfig } = await import("@/lib/agencySettings");
      return fetchCallerPdgmRateConfig(currentUser?.agency_name);
    },
    enabled: adminView,
    ...REPORT_READ_OPTIONS,
  });
  const rateConfig = rateQuery.isSuccess ? rateQuery.data : null;

  const stats = useMemo(() => {
    const processed = (referrals || []).filter((r) => r.extracted_data && r.analysis_results);
    const withRequests = processed.filter((r) => r.follow_up_requests);

    // generated_at records drafting, not transmission or delivery. Keep that
    // distinction visible until provider delivery receipts are available.
    const turnarounds = [];
    const byProvider = new Map();
    for (const r of withRequests) {
      const fu = r.follow_up_requests;
      const provider = r.extracted_data?.demographics?.referring_physician || r.referral_source || "Unknown provider";
      const entry = byProvider.get(provider) || { provider, sent: 0, received: 0, hours: [] };
      entry.sent += 1;
      if (typeof fu.received_at === 'string' && Number.isFinite(Date.parse(fu.received_at))) {
        entry.received += 1;
        const h = fu.generated_at ? hoursBetween(fu.generated_at, fu.received_at) : null;
        if (h !== null) {
          entry.hours.push(h);
          turnarounds.push(h);
        }
      }
      byProvider.set(provider, entry);
    }
    const providerRows = [...byProvider.values()]
      .map((p) => ({
        ...p,
        avgHours: p.hours.length ? p.hours.reduce((a, b) => a + b, 0) / p.hours.length : null,
      }))
      .sort((a, b) => b.sent - a.sent)
      .slice(0, 8);

    // Most common gaps + arrival completeness, from a fresh deterministic
    // review of each processed referral (cheap string work).
    const gapCounts = new Map();
    let completeOnArrival = 0;
    let atRiskTotal = null;
    let upsideLow = null;
    let upsideHigh = null;
    for (const r of processed) {
      try {
        const plan = buildFollowUpPlan(r.extracted_data, {
          rates: rateConfig?.rates,
          icdGroups: rateConfig?.icd10_clinical_groups,
          socDate: r.estimated_start_date,
        });
        if (plan.counts.critical === 0) completeOnArrival += 1;
        for (const it of plan.items) {
          gapCounts.set(it.title, (gapCounts.get(it.title) || 0) + 1);
        }
        // Open exposure: only referrals whose gaps aren't resolved yet.
        // Computed ONLY for admin viewers — dollar figures are admin-only by
        // policy, so non-admin renders never even run the estimator
        // (defense-in-depth if this widget is reused on a non-admin page).
        if (adminView && r.follow_up_requests?.status !== "resolved") {
          const impact = estimateFollowUpRevenueImpact(plan, { rates: rateConfig?.rates });
          if (impact.available) {
            atRiskTotal = (atRiskTotal ?? 0) + impact.totalAtRisk;
            upsideLow = (upsideLow ?? 0) + impact.totalUpsideLow;
            upsideHigh = (upsideHigh ?? 0) + impact.totalUpsideHigh;
          }
        }
      } catch {
        // A malformed extraction shouldn't break the whole report.
      }
    }
    const topGaps = [...gapCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

    return {
      processedCount: processed.length,
      sentCount: withRequests.length,
      receivedCount: withRequests.filter((r) => typeof r.follow_up_requests?.received_at === 'string'
        && Number.isFinite(Date.parse(r.follow_up_requests.received_at))).length,
      avgTurnaroundHours: turnarounds.length ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length : null,
      completePct: processed.length ? Math.round((completeOnArrival / processed.length) * 100) : null,
      providerRows,
      topGaps,
      atRiskTotal,
      upsideLow,
      upsideHigh,
    };
  }, [referrals, rateConfig, adminView]);

  const fmtHours = (h) => (h === null ? "—" : h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`);

  if (!referralQuery.scopeAvailable) return <p role="status">Select an authorized agency before viewing referral reports.</p>;
  if (!referralQuery.isSuccess || referralQuery.isError) return <ReportReadState queries={[referralQuery]} title="Referral report data" />;
  if (referralQuery.capped) return <p role="status">A source reached its record limit. A complete referral follow-up report cannot be verified, so totals are unavailable.</p>;

  return (
    <div className="space-y-4 mt-6">
      <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
        <ClipboardCheck className="w-5 h-5 text-navy-600" />
        Referral Follow-Up Loop
      </h3>

      <div className={`grid grid-cols-2 ${adminView ? "md:grid-cols-4" : "md:grid-cols-3"} gap-3`}>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase">Requests generated / responses recorded</p>
            <p className="text-2xl font-bold text-slate-900">
              {stats.sentCount} / {stats.receivedCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1">
              <Clock className="w-3 h-3" /> Avg draft-to-response time
            </p>
            <p className="text-2xl font-bold text-slate-900">{fmtHours(stats.avgTurnaroundHours)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> Complete at review
            </p>
            <p className="text-2xl font-bold text-slate-900">
              {stats.completePct === null ? "—" : `${stats.completePct}%`}
            </p>
            <p className="text-xs text-slate-500">no critical gaps at review</p>
          </CardContent>
        </Card>
        {/* Revenue exposure — ADMIN ONLY by policy */}
        {adminView && (
          <Card className="border-emerald-200 bg-emerald-50">
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-emerald-800 uppercase flex items-center gap-1">
                <DollarSign className="w-3 h-3" /> Open exposure (est.)
              </p>
              <p className="text-xl font-bold text-emerald-900">
                {stats.atRiskTotal === null ? "Unavailable — not $0" : fmtUsd(stats.atRiskTotal)}
              </p>
              {Number.isFinite(stats.upsideHigh) && stats.upsideHigh > 0 && (
                <p className="text-xs text-emerald-800">
                  +{fmtUsd(stats.upsideLow)}–{fmtUsd(stats.upsideHigh)} upside
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Draft-to-response time by referring provider</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {stats.providerRows.length === 0 && (
              <p className="text-sm text-slate-500">No follow-up requests generated yet.</p>
            )}
            {stats.providerRows.map((p) => (
              <div key={p.provider} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5 gap-2">
                <span className="truncate text-slate-800">{p.provider}</span>
                <span className="flex items-center gap-2 flex-shrink-0 text-xs text-slate-600">
                  <Badge variant="outline">{p.sent} generated</Badge>
                  <Badge variant="outline" className={p.received < p.sent ? "text-amber-700" : "text-green-700"}>
                    {p.received} responses recorded
                  </Badge>
                  {fmtHours(p.avgHours)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Most common referral gaps</CardTitle>
            <p className="text-xs text-slate-500">Across {stats.processedCount} processed referral(s) — provider-education targets</p>
          </CardHeader>
          <CardContent className="space-y-1">
            {stats.topGaps.length === 0 && <p className="text-sm text-slate-500">No gaps found.</p>}
            {stats.topGaps.map(([title, count]) => (
              <div key={title} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5 gap-2">
                <span className="truncate text-slate-800">{title}</span>
                <Badge className="bg-navy-600 text-white flex-shrink-0">{count}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
