import { useQuery } from "@tanstack/react-query";
import { getCommsDashboard } from "@/functions/getCommsDashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Radio,
  MessageSquare,
  Phone,
  Send,
  Voicemail,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/stat-card";

const TYPE_ICON = {
  sms: MessageSquare,
  call: Phone,
  fax: Send,
};

function formatDay(key) {
  // key is 'YYYY-MM-DD'
  const parts = String(key || "").split("-");
  if (parts.length === 3) return `${parts[1]}/${parts[2]}`;
  return key;
}

export default function CommsDashboard() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["comms-dashboard"],
    queryFn: async () => {
      const res = await getCommsDashboard({});
      return res?.data || {};
    },
    staleTime: 60000,
  });

  const summary = data?.summary || {};
  const sms = summary.sms || {};
  const calls = summary.calls || {};
  const fax = summary.fax || {};
  const daily = summary.daily || [];
  const failures = data?.failures || [];
  const perNumber = data?.per_number || [];

  const callCompletion =
    calls.total > 0 ? Math.round((calls.completed / calls.total) * 100) : 0;

  const chartData = daily.map((d) => ({
    date: formatDay(d.date),
    SMS: d.sms,
    Calls: d.calls,
    Faxes: d.faxes,
  }));

  return (
    <PageContainer>
      <PageHeader
        icon={Radio}
        eyebrow="Administration"
        title="Communications Dashboard"
        description="SMS, voice, and fax delivery health across your agency"
        favoritePage="CommsDashboard"
        actions={
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm min-h-[44px] hover:bg-muted"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      />

      {isLoading && (
        <div className="py-12 text-center text-muted-foreground">Loading communications data…</div>
      )}

      {isError && (
        <Card className="border-red-200">
          <CardContent className="p-4 text-red-600 text-sm">
            Failed to load dashboard: {error?.message || "Unknown error"}
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
            <StatCard
              title="SMS Delivery Rate"
              value={`${sms.delivery_rate ?? 0}%`}
              sub={`${sms.delivered ?? 0}/${sms.outbound ?? 0} delivered`}
              icon={MessageSquare}
              tone="blue"
            />
            <StatCard
              title="Call Completion"
              value={`${callCompletion}%`}
              sub={`${calls.completed ?? 0}/${calls.total ?? 0} completed`}
              icon={Phone}
              tone="green"
            />
            <StatCard
              title="Fax Delivery Rate"
              value={`${fax.delivery_rate ?? 0}%`}
              sub={`${fax.delivered ?? 0}/${fax.total ?? 0} delivered`}
              icon={Send}
              tone="purple"
            />
            <StatCard
              title="Voicemail Backlog"
              value={calls.voicemail_backlog ?? 0}
              sub={`${calls.missed ?? 0} missed calls`}
              icon={Voicemail}
              tone="amber"
            />
          </div>

          {/* 7-day volume chart */}
          <Card className="mb-4 sm:mb-6">
            <CardHeader className="p-3 sm:p-4 md:p-6">
              <CardTitle className="text-base sm:text-lg">7-Day Volume</CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 md:p-6">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" style={{ fontSize: "12px" }} />
                  <YAxis allowDecimals={false} style={{ fontSize: "12px" }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="SMS" fill="#3557b0" />
                  <Bar dataKey="Calls" fill="#22c55e" />
                  <Bar dataKey="Faxes" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {/* Recent failures */}
            <Card>
              <CardHeader className="p-3 sm:p-4 md:p-6">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  Recent Failures
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 md:p-6 pt-0">
                {failures.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No recent failures.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>To</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>When</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {failures.map((f, i) => {
                          const Icon = TYPE_ICON[f.type] || AlertTriangle;
                          return (
                            <TableRow key={`${f.type}-${i}`}>
                              <TableCell>
                                <Badge variant="outline" className="gap-1">
                                  <Icon className="w-3 h-3" />
                                  {f.type}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-mono text-xs">{f.to || "—"}</TableCell>
                              <TableCell className="text-xs">{f.reason || "—"}</TableCell>
                              <TableCell className="text-xs whitespace-nowrap">
                                {f.created_date
                                  ? new Date(f.created_date).toLocaleString()
                                  : "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Per-number activity */}
            <Card>
              <CardHeader className="p-3 sm:p-4 md:p-6">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <Phone className="w-4 h-4 text-blue-600" />
                  Activity by Number
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 md:p-6 pt-0">
                {perNumber.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No outbound activity.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Number</TableHead>
                          <TableHead>User</TableHead>
                          <TableHead className="text-right">SMS</TableHead>
                          <TableHead className="text-right">Calls</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {perNumber.map((p, i) => (
                          <TableRow key={`${p.number}-${i}`}>
                            <TableCell className="font-mono text-xs">{p.number}</TableCell>
                            <TableCell className="text-xs">{p.user_full_name || "—"}</TableCell>
                            <TableCell className="text-right">{p.sms}</TableCell>
                            <TableCell className="text-right">{p.calls}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {data?.generated_at && (
            <p className="text-xs text-muted-foreground mt-4">
              Generated {new Date(data.generated_at).toLocaleString()}
            </p>
          )}
        </>
      )}
    </PageContainer>
  );
}
