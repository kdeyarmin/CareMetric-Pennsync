import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { listAuthorizedVisits } from '@/functions/listAuthorizedVisits';
import { useAuth } from '@/lib/AuthContext';
import { agencyQueryKey } from '@/lib/agencyRoster';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import StatCard from "@/components/ui/stat-card";
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, Cpu, Database,
  Wifi, RefreshCw, Bell, BellOff,
  Clock, Zap, Server
} from "lucide-react";

const METRICS = [
  { key: "api_response", label: "API Response", unit: "ms", good: 300, warn: 800 },
  { key: "error_rate", label: "Error Rate", unit: "%", good: 1, warn: 5 },
  { key: "uptime", label: "Uptime", unit: "%", good: 99.5, warn: 99, invert: true },
  { key: "active_users", label: "Active Users", unit: "", good: null, warn: null },
];

// Map the monitor's health statuses onto canonical StatCard tones.
const STATUS_TONE = { healthy: "emerald", good: "emerald", warning: "amber", warn: "amber", critical: "rose", error: "rose" };

function AlertBanner({ alerts, onDismiss }) {
  if (!alerts.length) return null;
  return (
    <div className="space-y-2">
      {alerts.map((a, i) => (
        <div key={i} className={`flex items-start gap-3 rounded-lg px-4 py-3 border-l-4 ${a.level === "critical" ? "bg-red-50 border-red-500" : "bg-yellow-50 border-yellow-400"}`}>
          <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${a.level === "critical" ? "text-red-600" : "text-yellow-600"}`} />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${a.level === "critical" ? "text-red-800" : "text-yellow-800"}`}>{a.title}</p>
            <p className="text-xs text-slate-600 mt-0.5">{a.message}</p>
          </div>
          <button onClick={() => onDismiss(i)} className="text-slate-400 hover:text-slate-600 shrink-0">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function SystemHealthMonitor() {
  const { tenantContext } = useAuth();
  const probeAgencyId = tenantContext?.agency_id ?? null;
  const probeMembershipId = tenantContext?.membership_id ?? null;
  const probeMembershipVersion = tenantContext?.membership_version ?? null;
  const probeTenantRole = tenantContext?.tenant_role ?? null;
  const tenantProbeScope = JSON.stringify([
    probeAgencyId,
    probeMembershipId,
    probeMembershipVersion,
    probeTenantRole,
  ]);
  const {
    data: currentUser,
    isSuccess: currentUserReady,
    isFetching: currentUserFetching,
    isFetchedAfterMount: currentUserFetchedAfterMount,
    isError: currentUserError,
  } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });


  const [metrics, setMetrics] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [dismissed, setDismissed] = useState([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  // Real measured latency + observed availability (replaces simulated values).
  const [measured, setMeasured] = useState({
    scope: null,
    apiLatency: null,
    dbLatency: null,
    apiOk: null,
  });
  const upProbesRef = useRef({ ok: 0, total: 0 });
  // Visit volume/error-rate metrics require a reviewed bounded aggregate.
  // Do not poll the paginated PHI broker and misrepresent denial as zero data.
  const visitAggregatesAvailable = false;
  const {
    data: users = [],
    isSuccess: usersReady,
    isFetching: usersFetching,
    isFetchedAfterMount: usersFetchedAfterMount,
    isError: usersError,
  } = useQuery({
    queryKey: ["health-users", agencyQueryKey(currentUser)],
    queryFn: async () => {
      const _rows = await base44.entities.User.list("-created_date", 200);
      const { filterUsersByCallerAgency } = await import('@/lib/agencyScope');
      return filterUsersByCallerAgency(_rows, currentUser);
    },
    enabled: !!currentUser,
  });
  const userMetricsAvailable = currentUserReady
    && currentUserFetchedAfterMount
    && !currentUserFetching
    && !currentUserError
    && usersReady
    && usersFetchedAfterMount
    && !usersFetching
    && !usersError;

  // Probe real backend latency and observed availability every 30s.
  useEffect(() => {
    let cancelled = false;
    upProbesRef.current = { ok: 0, total: 0 };
    const probe = async () => {
      // Time a real authenticated API round-trip.
      const apiStart = performance.now();
      let apiOk = true;
      try { await base44.auth.me(); } catch { apiOk = false; }
      const apiLatency = Math.round(performance.now() - apiStart);

      // Time a real DB-bound query round-trip.
      let dbLatency = null;
      if (probeAgencyId) {
        let dbOk = true;
        const dbStart = performance.now();
        try {
          const result = await listAuthorizedVisits({
            agencyId: probeAgencyId,
            purpose: 'activity',
            sort: 'id_asc',
            pageSize: 1,
          });
          if (
            result.scope.membership_id !== probeMembershipId
            || result.scope.membership_version !== probeMembershipVersion
            || result.scope.tenant_role !== probeTenantRole
          ) throw new Error('Visit authority changed during health probe');
        } catch { dbOk = false; }
        dbLatency = Math.round(performance.now() - dbStart);
        upProbesRef.current.total += 1;
        if (apiOk && dbOk) upProbesRef.current.ok += 1;
      }
      if (!cancelled) setMeasured({
        scope: tenantProbeScope,
        apiLatency,
        dbLatency,
        apiOk,
      });
    };
    probe();
    const id = setInterval(probe, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [probeAgencyId, probeMembershipId, probeMembershipVersion, probeTenantRole, tenantProbeScope]);

  const scopedApiLatency = measured.scope === tenantProbeScope ? measured.apiLatency : null;
  const scopedDbLatency = measured.scope === tenantProbeScope ? measured.dbLatency : null;
  const scopedApiOk = measured.scope === tenantProbeScope ? measured.apiOk : null;

  const refresh = useCallback(() => {
    const today = new Date();

    const probes = upProbesRef.current;
    const newMetrics = {
      api_response: scopedApiLatency ?? undefined,
      error_rate: undefined,
      uptime: probes.total ? parseFloat(((probes.ok / probes.total) * 100).toFixed(3)) : undefined,
      active_users: userMetricsAvailable ? users.filter(u => {
        const d = new Date(u.updated_date || u.created_date);
        return (today - d) < 60 * 60 * 1000;
      }).length : undefined,
      db_latency: scopedDbLatency ?? undefined,
      visits_today: undefined,
      total_users: userMetricsAvailable ? users.length : undefined,
    };
    setMetrics(newMetrics);
    setLastUpdated(new Date());

    // Generate alerts
    if (!notificationsEnabled) return;
    const newAlerts = [];
    if (newMetrics.error_rate > 5) newAlerts.push({ level: "critical", title: "High Error Rate", message: `Error rate at ${newMetrics.error_rate}% — exceeds 5% threshold.` });
    else if (newMetrics.error_rate > 2) newAlerts.push({ level: "warn", title: "Elevated Error Rate", message: `Error rate at ${newMetrics.error_rate}% — above normal.` });
    if (newMetrics.api_response > 800) newAlerts.push({ level: "critical", title: "API Slow Response", message: `API responding in ${newMetrics.api_response}ms — check backend load.` });
    else if (newMetrics.api_response > 400) newAlerts.push({ level: "warn", title: "API Response Degraded", message: `API at ${newMetrics.api_response}ms — slightly elevated.` });
    if (scopedApiOk === false) newAlerts.push({ level: "critical", title: "API Probe Failed", message: "The authenticated API probe failed." });
    if (newMetrics.uptime < 99) newAlerts.push({ level: "critical", title: "Uptime Below Threshold", message: `System uptime at ${newMetrics.uptime}% — investigate immediately.` });
    setAlerts(newAlerts);
    setDismissed([]);
  }, [users, userMetricsAvailable, notificationsEnabled, scopedApiLatency, scopedDbLatency, scopedApiOk]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const getStatus = (key, value) => {
    const m = METRICS.find(m => m.key === key);
    if (!m || m.good === null) return "good";
    if (m.invert) return value >= m.good ? "good" : value >= m.warn ? "warn" : "critical";
    return value <= m.good ? "good" : value <= m.warn ? "warn" : "critical";
  };

  // A metric with no measurement yet (undefined fails every threshold
  // comparison and would read as "critical") renders as a neutral placeholder.
  const metricValue = (value, unit) => (Number.isFinite(value) ? `${value}${unit}` : "—");
  const metricTone = (value, status) => (Number.isFinite(value) ? STATUS_TONE[status] : "slate");

  const visibleAlerts = alerts.filter((_, i) => !dismissed.includes(i));
  const overallStatus = visibleAlerts.some(a => a.level === "critical")
    ? "critical"
    : visibleAlerts.some(a => a.level === "warn")
      || !visitAggregatesAvailable
      || !userMetricsAvailable
      || !tenantContext?.agency_id
      ? "warn"
      : "good";

  const statusLabel = {
    good: "All Systems Operational",
    warn: visitAggregatesAvailable ? "Performance Degraded" : "Partial Metrics Unavailable",
    critical: "Critical Issues Detected",
  };
  const statusBg = { good: "border-green-300 bg-green-50", warn: "border-yellow-300 bg-yellow-50", critical: "border-red-300 bg-red-50" };
  const StatusIcon = { good: CheckCircle2, warn: AlertTriangle, critical: XCircle }[overallStatus];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Server className="w-5 h-5 text-indigo-600" />
            System Health Monitoring
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() => setNotificationsEnabled(e => !e)}
            >
              {notificationsEnabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{notificationsEnabled ? "Alerts On" : "Alerts Off"}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={refresh}
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!visitAggregatesAvailable && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Visit volume and Visit-derived error-rate metrics are unavailable until a bounded,
            tenant-scoped aggregate broker is reviewed. They are not reported as zero.
          </div>
        )}
        {!tenantContext?.agency_id && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Select a verified tenant before DB latency or observed availability can be measured.
          </div>
        )}
        {!userMetricsAvailable && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            User activity metrics are unavailable while their authorization is pending, refreshing,
            or denied. Cached counts are withheld.
          </div>
        )}
        {/* Overall status */}
        <div className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 ${statusBg[overallStatus]}`}>
          <StatusIcon className={`w-5 h-5 ${overallStatus === "good" ? "text-green-600" : overallStatus === "warn" ? "text-yellow-600" : "text-red-600"}`} />
          <div className="flex-1">
            <p className="font-semibold text-slate-800 text-sm">{statusLabel[overallStatus]}</p>
            {lastUpdated && <p className="text-xs text-slate-500">Last checked {lastUpdated.toLocaleTimeString()}</p>}
          </div>
          <Badge className={overallStatus === "good" ? "bg-green-100 text-green-800" : overallStatus === "warn" ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"}>
            {overallStatus.toUpperCase()}
          </Badge>
        </div>

        {/* Active alerts */}
        {visibleAlerts.length > 0 && (
          <AlertBanner alerts={visibleAlerts} onDismiss={(i) => setDismissed(d => [...d, i])} />
        )}

        {/* Metric cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="API Response"
            value={metricValue(metrics.api_response, "ms")}
            tone={metricTone(metrics.api_response, getStatus("api_response", metrics.api_response))}
            sub="vs last check"
            icon={Zap}
          />
          <StatCard
            label="Error Rate"
            value={metricValue(metrics.error_rate, "%")}
            tone={metricTone(metrics.error_rate, getStatus("error_rate", metrics.error_rate))}
            sub="Visit aggregate paused"
            icon={AlertTriangle}
          />
          <StatCard
            label="Uptime"
            value={metricValue(metrics.uptime, "%")}
            tone={metricTone(metrics.uptime, getStatus("uptime", metrics.uptime))}
            sub="vs last check"
            icon={Activity}
          />
          <StatCard
            label="DB Latency"
            value={metricValue(metrics.db_latency, "ms")}
            tone={metricTone(metrics.db_latency, metrics.db_latency < 30 ? "good" : metrics.db_latency < 60 ? "warn" : "critical")}
            sub="vs last check"
            icon={Database}
          />
        </div>

        {/* Resource utilization */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Active Users", value: metrics.active_users ?? "—", icon: Wifi, color: "text-indigo-600", bg: "bg-indigo-50" },
            { label: "Visits Today", value: metrics.visits_today ?? "—", icon: Clock, color: "text-blue-600", bg: "bg-blue-50" },
            { label: "Total Users", value: metrics.total_users ?? "—", icon: Cpu, color: "text-navy-600", bg: "bg-navy-50" },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className={`rounded-xl p-3 ${bg} border border-slate-100`}>
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`w-3.5 h-3.5 ${color}`} />
                <span className="text-xs text-slate-500 font-medium">{label}</span>
              </div>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-400 text-center">Bounded API and DB latency probes refresh every 30s; full-list Visit polling is paused</p>
      </CardContent>
    </Card>
  );
}
