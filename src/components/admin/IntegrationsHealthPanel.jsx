import { useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity, CheckCircle2, AlertTriangle, XCircle, Loader2, RefreshCw, KeyRound,
} from "lucide-react";

/**
 * IntegrationsHealthPanel — one at-a-glance, read-only capability board for the
 * integrations the current source tree uses. It never sends a message, creates
 * media, invokes a billable model, or places a call. Where safe, it makes a
 * bounded authenticated GET; platform capabilities and release gates are
 * reported without claiming end-to-end delivery.
 *
 * Keys shown with the "Platform secret" tag are injected by Base44 and are not
 * editable from inside the app — they're changed in the Base44 project settings.
 * The Telnyx credential IS editable in-app (see the Telnyx section on this page).
 */

const STATUS_META = {
  ok: { Icon: CheckCircle2, color: "text-green-600", badge: "bg-green-100 text-green-800", label: "Check passed" },
  warn: { Icon: AlertTriangle, color: "text-amber-600", badge: "bg-amber-100 text-amber-800", label: "Attention" },
  fail: { Icon: XCircle, color: "text-red-600", badge: "bg-red-100 text-red-800", label: "Failing" },
};

function IntegrationRow({ item }) {
  const meta = STATUS_META[item.status] || STATUS_META.warn;
  const { Icon } = meta;
  const releaseLabel = item.release_state === "released"
    ? "Released"
    : item.release_state === "paused"
      ? "Paused"
      : null;
  return (
    <div className="flex items-start gap-3 py-3">
      <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${meta.color}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-slate-900">{item.label}</p>
          <span className="text-[10px] uppercase tracking-wide text-slate-400 border border-slate-200 rounded px-1 py-0.5">
            {item.category}
          </span>
          {releaseLabel && (
            <span className={`text-[10px] uppercase tracking-wide rounded border px-1 py-0.5 ${
              item.release_state === "released"
                ? "border-green-200 text-green-700"
                : "border-amber-200 text-amber-700"
            }`}>
              {releaseLabel}
            </span>
          )}
          {item.editable_in_app ? (
            <span className="text-[10px] uppercase tracking-wide text-indigo-500 border border-indigo-200 rounded px-1 py-0.5">
              Editable below
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-wide text-slate-400 border border-slate-200 rounded px-1 py-0.5">
              Backend-managed
            </span>
          )}
        </div>
        <p className="text-xs text-slate-600 mt-0.5">{item.detail}</p>
      </div>
      <Badge className={`${meta.badge} flex-shrink-0`}>{meta.label}</Badge>
    </div>
  );
}

export default function IntegrationsHealthPanel() {
  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["integrations-health"],
    queryFn: async () => {
      const res = await base44.functions.invoke("checkAllIntegrations", {});
      return res?.data || res;
    },
    refetchOnWindowFocus: false,
  });

  // Memoized so the `|| []` fallback isn't a fresh array identity on every
  // render, which would invalidate the useMemo below on renders where nothing
  // actually changed.
  const items = useMemo(() => data?.integrations || [], [data]);

  const summary = useMemo(() => {
    const counts = { ok: 0, warn: 0, fail: 0 };
    for (const i of items) if (counts[i.status] !== undefined) counts[i.status] += 1;
    return counts;
  }, [items]);

  return (
    <Card id="integrations-health" className="scroll-mt-24 border-indigo-100">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-600" />
            Integration Health
          </span>
          {items.length > 0 && (
            <div className="flex items-center gap-1.5">
              {summary.fail > 0 && <Badge className="bg-red-100 text-red-800">{summary.fail} failing</Badge>}
              {summary.warn > 0 && <Badge className="bg-amber-100 text-amber-800">{summary.warn} attention</Badge>}
              {summary.fail === 0 && summary.warn === 0 && (
                <Badge className="bg-green-100 text-green-800">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> All healthy
                </Badge>
              )}
            </div>
          )}
        </CardTitle>
        <CardDescription>
          Read-only capability and release-state checks. No message, email, fax, media job, model invocation,
          or call is created; a successful credential probe does not authorize delivery.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Couldn't run the health check: {error.message}
          </div>
        )}

        {isFetching && items.length === 0 ? (
          <div className="flex items-center gap-2 py-8 justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" /> Checking integrations…
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((item) => <IntegrationRow key={item.id} item={item} />)}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap border-t pt-3">
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5" />
            Backend-managed configuration lives in Base44 project settings; Telnyx configuration is editable below.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Re-testing…</>
            ) : (
              <><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Re-run read-only checks</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
