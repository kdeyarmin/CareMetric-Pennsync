import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, Cpu, Database,
  Wifi, RefreshCw, Bell, BellOff, TrendingUp, TrendingDown, Minus,
  Clock, Zap, Server
} from "lucide-react";

const METRICS = [
  { key: "api_response", label: "API Response", unit: "ms", good: 300, warn: 800 },
  { key: "error_rate", label: "Error Rate", unit: "%", good: 1, warn: 5 },
  { key: "uptime", label: "Uptime", unit: "%", good: 99.5, warn: 99, invert: true },
  { key: "active_users", label: "Active Users", unit: "", good: null, warn: null },
];

function StatusDot({ status }) {
  const colors = { good: "bg-green-500", warn: "bg-yellow-400 animate-pulse", critical: "bg-red-500 animate-pulse" };
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status] || colors.good}`} />;
}

function MetricCard({ label, value, unit, status, trend, icon: Icon }) {
  const textColor = status === "good" ? "text-green-600" : status === "warn" ? "text-yellow-600" : "text-red-600";
  const bgColor = status === "good" ? "border-green-200 bg-green-50" : status === "warn" ? "border-yellow-200 bg-yellow-50" : "border-red-200 bg-red-50";
  const TrendIcon = trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;
  return (
    <div className={`rounded-xl border-2 p-4 ${bgColor}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <StatusDot status={status} />
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{label}</span>
        </div>
        <Icon className={`w-4 h-4 ${textColor}`} />
      </div>
      <p className={`text-2xl font-bold ${textColor}`}>{value}{unit && <span className="text-sm font-normal ml-0.5">{unit}</span>}</p>
      <div className="flex items-center gap-1 mt-1">
        <TrendIcon className="w-3 h-3 text-slate-400" />
        <span className="text-xs text-slate-400">vs last check</span>
      </div>
    </div>
  );
}

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
  const [metrics, setMetrics] = useState({});
  const [prevMetrics, setPrevMetrics] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [dismissed, setDismissed] = useState([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [autoRefresh, _setAutoRefresh] = useState(true);
  // Real measured latency + observed availability (replaces simulated values).
  const [measured, setMeasured] = useState({ apiLatency: null, dbLatency: null });
  const upProbesRef = useRef({ ok: 0, total: 0 });
  // Track the latest metrics in a ref so `refresh` doesn't depend on `metrics`
  // state (which it sets) — that dependency would re-create the callback and
  // re-fire the effect that calls it, an infinite update loop.
  const metricsRef = useRef({});

  // Fetch real entity counts for actual system data
  const { data: visits = [] } = useQuery({
    queryKey: ["health-visits"],
    queryFn: () => base44.entities.Visit.list("-created_date", 50),
    initialData: [],
    refetchInterval: autoRefresh ? 30000 : false,
  });
  const { data: users = [] } = useQuery({
    queryKey: ["health-users"],
    queryFn: () => base44.entities.User.list("-created_date", 200),
    initialData: [],
    refetchInterval: autoRefresh ? 30000 : false,
  });
  const { data: incidents = [] } = useQuery({
    queryKey: ["health-incidents"],
    queryFn: () => base44.entities.Incident.filter({ status: "reported" }, "-created_date", 50),
    initialData: [],
    refetchInterval: autoRefresh ? 30000 : false,
  });

  // Probe real backend latency and observed availability every 30s.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      // Time a real authenticated API round-trip.
      const apiStart = performance.now();
      let ok = true;
      try { await base44.auth.me(); } catch { ok = false; }
      const apiLatency = Math.round(performance.now() - apiStart);

      // Time a real DB-bound query round-trip.
      const dbStart = performance.now();
      try { await base44.entities.Visit.list("-created_date", 1); } catch { ok = false; }
      const dbLatency = Math.round(performance.now() - dbStart);

      upProbesRef.current.total += 1;
      if (ok) upProbesRef.current.ok += 1;
      if (!cancelled) setMeasured({ apiLatency, dbLatency });
    };
    probe();
    const id = setInterval(probe, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const refresh = useCallback(() => {
    setPrevMetrics(metricsRef.current);
    const today = new Date();
    const recentVisits = visits.filter(v => {
      const d = new Date(v.created_date);
      return (today - d) < 24 * 60 * 60 * 1000;
    });

    const probes = upProbesRef.current;
    const newMetrics = {
      api_response: measured.apiLatency ?? 0,
      error_rate: parseFloat((incidents.length / Math.max(visits.length, 1) * 10).toFixed(2)),
      uptime: probes.total ? parseFloat(((probes.ok / probes.total) * 100).toFixed(3)) : 100,
      active_users: users.filter(u => {
        const d = new Date(u.updated_date || u.created_date);
        return (today - d) < 60 * 60 * 1000;
      }).length,
      db_latency: measured.dbLatency ?? 0,
      visits_today: recentVisits.length,
      total_users: users.length,
    };
    metricsRef.current = newMetrics;
    setMetrics(newMetrics);
    setLastUpdated(new Date());

    // Generate alerts
    if (!notificationsEnabled) return;
    const newAlerts = [];
    if (newMetrics.error_rate > 5) newAlerts.push({ level: "critical", title: "High Error Rate", message: `Error rate at ${newMetrics.error_rate}% — exceeds 5% threshold.` });
    else if (newMetrics.error_rate > 2) newAlerts.push({ level: "warn", title: "Elevated Error Rate", message: `Error rate at ${newMetrics.error_rate}% — above normal.` });
    if (newMetrics.api_response > 800) newAlerts.push({ level: "critical", title: "API Slow Response", message: `API responding in ${newMetrics.api_response}ms — check backend load.` });
    else if (newMetrics.api_response > 400) newAlerts.push({ level: "warn", title: "API Response Degraded", message: `API at ${newMetrics.api_response}ms — slightly elevated.` });
    if (newMetrics.uptime < 99) newAlerts.push({ level: "critical", title: "Uptime Below Threshold", message: `System uptime at ${newMetrics.uptime}% — investigate immediately.` });
    setAlerts(newAlerts);
    setDismissed([]);
  }, [visits, users, incidents, notificationsEnabled, measured]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, refresh]);

  const getStatus = (key, value) => {
    const m = METRICS.find(m => m.key === key);
    if (!m || m.good === null) return "good";
    if (m.invert) return value >= m.good ? "good" : value >= m.warn ? "warn" : "critical";
    return value <= m.good ? "good" : value <= m.warn ? "warn" : "critical";
  };

  const getTrend = (key) => {
    if (!prevMetrics[key]) return 0;
    return metrics[key] - prevMetrics[key];
  };

  const visibleAlerts = alerts.filter((_, i) => !dismissed.includes(i));
  const overallStatus = visibleAlerts.some(a => a.level === "critical") ? "critical" : visibleAlerts.some(a => a.level === "warn") ? "warn" : "good";

  const statusLabel = { good: "All Systems Operational", warn: "Performance Degraded", critical: "Critical Issues Detected" };
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
          <MetricCard
            label="API Response"
            value={metrics.api_response ?? "—"}
            unit="ms"
            status={getStatus("api_response", metrics.api_response)}
            trend={getTrend("api_response")}
            icon={Zap}
          />
          <MetricCard
            label="Error Rate"
            value={metrics.error_rate ?? "—"}
            unit="%"
            status={getStatus("error_rate", metrics.error_rate)}
            trend={getTrend("error_rate")}
            icon={AlertTriangle}
          />
          <MetricCard
            label="Uptime"
            value={metrics.uptime ?? "—"}
            unit="%"
            status={getStatus("uptime", metrics.uptime)}
            trend={getTrend("uptime")}
            icon={Activity}
          />
          <MetricCard
            label="DB Latency"
            value={metrics.db_latency ?? "—"}
            unit="ms"
            status={metrics.db_latency < 30 ? "good" : metrics.db_latency < 60 ? "warn" : "critical"}
            trend={getTrend("db_latency")}
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

        <p className="text-xs text-slate-400 text-center">Auto-refreshes every 30s · API &amp; DB latency and availability measured live; entity counts are live</p>
      </CardContent>
    </Card>
  );
}