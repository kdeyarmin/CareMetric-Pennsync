import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Search, Filter, Calendar, User } from "lucide-react";
import { formatEastern } from "@/components/utils/timezone";
import { toCsvRows } from "@/components/admin/csvExport";
import { getSeverityBadge } from "@/components/security/auditSeverityBadge";
import { downloadAuthorityBoundBlob } from "@/lib/downloadBlob";
import { isAdminLike } from "@/lib/superAdmin";

const SECURITY_LOG_ROWS = 100;
const USER_ACTIVITY_ROWS = 500;

/**
 * Security and user-activity logs for the Security & Compliance hub
 * (owner decision, 2026-10-08). Both entities admit a row's creator and the
 * built-in administrator, so the logs are loaded for the administrator alone —
 * anyone else would see a partial log presented as the whole one. A source
 * that has not loaded is reported as unavailable, never as zero events.
 */
export function useSecurityLogSources(currentUser) {
  const permitted = isAdminLike(currentUser);
  const securityLogQuery = useQuery({
    queryKey: ['securityLogs', '-timestamp', SECURITY_LOG_ROWS],
    queryFn: () => base44.entities.SecurityLog.list('-timestamp', SECURITY_LOG_ROWS),
    enabled: permitted,
  });
  const userActivityQuery = useQuery({
    queryKey: ['userActivity', '-created_date', USER_ACTIVITY_ROWS],
    queryFn: () => base44.entities.UserActivity.list('-created_date', USER_ACTIVITY_ROWS),
    enabled: permitted,
  });
  const securityLogs = permitted && securityLogQuery.isSuccess && Array.isArray(securityLogQuery.data)
    ? securityLogQuery.data
    : null;
  const userActivity = permitted && userActivityQuery.isSuccess && Array.isArray(userActivityQuery.data)
    ? userActivityQuery.data
    : null;
  return {
    permitted,
    securityLogs,
    userActivity,
    failed: securityLogQuery.isError || userActivityQuery.isError,
  };
}

/** Counts behind the overview cards; null when a source is unavailable. */
export function securityLogMetrics(securityLogs, userActivity) {
  if (!securityLogs || !userActivity) return null;
  const action = (log) => String(log?.action || '').toUpperCase();
  return {
    totalEvents: securityLogs.length + userActivity.length,
    criticalEvents: securityLogs.filter((log) => /FAILED|DENIED|DELETE/.test(action(log))).length,
    phiAccess: securityLogs.filter((log) => /PATIENT|VISIT|PHI/.test(action(log))).length,
  };
}

function SourceUnavailable({ sources, what }) {
  return (
    <Alert className="border-amber-300 bg-amber-50" role="status">
      <AlertDescription className="text-amber-950">
        {!sources.permitted
          ? `${what} requires the administrator account: these logs are readable in full only by administrators.`
          : sources.failed
            ? `${what} could not be loaded. Missing rows do not mean zero events.`
            : `Loading ${what.toLowerCase()}…`}
      </AlertDescription>
    </Alert>
  );
}

const getActionColor = (action) => {
  if (action?.includes('delete') || action?.includes('reject')) return 'text-red-600';
  if (action?.includes('approved') || action?.includes('completed')) return 'text-green-600';
  if (action?.includes('updated') || action?.includes('edited')) return 'text-blue-600';
  return 'text-slate-600';
};

export function SecurityEventLog({ sources }) {
  const { securityLogs, userActivity } = sources;
  if (!securityLogs || !userActivity) return <SourceUnavailable sources={sources} what="The security event log" />;
  const uniqueUsers = new Set(userActivity.map((log) => log.user_email));

  const exportSecurityLog = () => {
    const csv = toCsvRows([
      ['Timestamp', 'User', 'Action', 'Details'],
      ...securityLogs.slice(0, 50).map((log) => [
        log.timestamp || log.created_date,
        log.user_email,
        log.action,
        JSON.stringify(log.details || {}),
      ]),
    ]);
    downloadAuthorityBoundBlob(new Blob([csv], { type: 'text/csv' }), `security_log_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-sm text-slate-600">Security Events</p><p className="text-2xl font-bold">{securityLogs.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-slate-600">User Actions</p><p className="text-2xl font-bold">{userActivity.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-slate-600">Critical</p><p className="text-2xl font-bold text-red-600">{userActivity.filter((log) => log.severity === 'critical').length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-slate-600">Active Users</p><p className="text-2xl font-bold">{uniqueUsers.size}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Recent Security Events</span>
            <Button variant="outline" size="sm" onClick={exportSecurityLog}>
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {securityLogs.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No security events are recorded in the loaded log.</p>
            ) : (
              securityLogs.slice(0, 20).map((log, idx) => (
                <div
                  key={log.id || idx}
                  className={`p-3 rounded-lg border ${
                    log.action?.includes('FAILED') || log.action?.includes('DELETE')
                      ? 'bg-red-50 border-red-200'
                      : log.action?.includes('PHI') || log.action?.includes('PATIENT')
                        ? 'bg-yellow-50 border-yellow-200'
                        : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-semibold text-sm text-slate-900">{log.action}</p>
                      <p className="text-xs text-slate-600">{log.user_email} • {log.user_role}</p>
                      {log.details && (
                        <p className="text-xs text-slate-500 mt-1">{JSON.stringify(log.details).substring(0, 100)}...</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">{new Date(log.timestamp || log.created_date).toLocaleDateString()}</p>
                      <p className="text-xs text-slate-500">{new Date(log.timestamp || log.created_date).toLocaleTimeString()}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function UserActivityLog({ sources }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("7");
  const [severityFilter, setSeverityFilter] = useState("all");
  const userActivity = sources.userActivity;

  const uniqueUsers = useMemo(() => [...new Set((userActivity || []).map((log) => log.user_email).filter(Boolean))], [userActivity]);
  const uniqueActions = useMemo(() => [...new Set((userActivity || []).map((log) => log.action).filter(Boolean))], [userActivity]);
  const uniqueEntities = useMemo(() => [...new Set((userActivity || []).map((log) => log.entity_type).filter(Boolean))], [userActivity]);

  const filteredLogs = useMemo(() => (userActivity || []).filter((log) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = !term
      || log.user_email?.toLowerCase().includes(term)
      || log.user_name?.toLowerCase().includes(term)
      || log.action?.toLowerCase().includes(term)
      || log.entity_type?.toLowerCase().includes(term);
    const matchesAction = actionFilter === 'all' || log.action === actionFilter;
    const matchesEntity = entityFilter === 'all' || log.entity_type === entityFilter;
    const matchesUser = userFilter === 'all' || log.user_email === userFilter;
    const matchesSeverity = severityFilter === 'all' || log.severity === severityFilter;
    const daysAgo = parseInt(dateFilter, 10);
    const matchesDate = daysAgo === 0
      || (Date.now() - new Date(log.created_date).getTime()) <= daysAgo * 24 * 60 * 60 * 1000;
    return matchesSearch && matchesAction && matchesEntity && matchesUser && matchesSeverity && matchesDate;
  }), [actionFilter, dateFilter, entityFilter, searchTerm, severityFilter, userActivity, userFilter]);

  if (!userActivity) return <SourceUnavailable sources={sources} what="The user activity log" />;

  const exportAuditLog = () => {
    const csv = toCsvRows([
      ['Timestamp', 'User', 'Email', 'Action', 'Entity Type', 'Entity ID', 'Severity', 'Details'],
      ...filteredLogs.map((log) => [
        log.created_date,
        log.user_name,
        log.user_email,
        log.action,
        log.entity_type || '',
        log.entity_id || '',
        log.severity || 'info',
        JSON.stringify(log.details || {}),
      ]),
    ]);
    downloadAuthorityBoundBlob(new Blob([csv], { type: 'text/csv' }), `audit_log_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-sm text-slate-600">Total Events</p><p className="text-2xl font-bold">{userActivity.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-slate-600">Filtered</p><p className="text-2xl font-bold">{filteredLogs.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-slate-600">Critical Events</p><p className="text-2xl font-bold text-red-600">{userActivity.filter((log) => log.severity === 'critical').length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-slate-600">Active Users</p><p className="text-2xl font-bold">{uniqueUsers.length}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="p-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Filters
            </CardTitle>
            <Button onClick={exportAuditLog} variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search users, actions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-11 touch-target"
                aria-label="Search user activity"
              />
            </div>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="h-11 touch-target" aria-label="Action type"><SelectValue placeholder="Action Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {uniqueActions.map((action) => <SelectItem key={action} value={action}>{action}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="h-11 touch-target" aria-label="Entity type"><SelectValue placeholder="Entity Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entities</SelectItem>
                {uniqueEntities.map((entity) => <SelectItem key={entity} value={entity}>{entity}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="h-11 touch-target" aria-label="User"><SelectValue placeholder="User" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {uniqueUsers.map((user) => <SelectItem key={user} value={user}>{user}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="h-11 touch-target" aria-label="Severity"><SelectValue placeholder="Severity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="h-11 touch-target" aria-label="Time range"><SelectValue placeholder="Time Range" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">All Time</SelectItem>
                <SelectItem value="1">Last 24 Hours</SelectItem>
                <SelectItem value="7">Last 7 Days</SelectItem>
                <SelectItem value="30">Last 30 Days</SelectItem>
                <SelectItem value="90">Last 90 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <ScrollArea className="h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-sm">Timestamp</TableHead>
                    <TableHead className="text-sm">User</TableHead>
                    <TableHead className="text-sm">Action</TableHead>
                    <TableHead className="text-sm hidden md:table-cell">Entity</TableHead>
                    <TableHead className="text-sm hidden lg:table-cell">Severity</TableHead>
                    <TableHead className="text-sm hidden lg:table-cell">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-slate-500">No audit logs found matching filters</TableCell>
                    </TableRow>
                  ) : (
                    filteredLogs.map((log, idx) => (
                      <TableRow key={log.id || idx} className="hover:bg-slate-50">
                        <TableCell className="text-xs whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-slate-400 hidden sm:inline" />
                            <span className="hidden sm:inline">{formatEastern(new Date(log.created_date), 'MMM d, yyyy HH:mm:ss')}</span>
                            <span className="sm:hidden">{formatEastern(new Date(log.created_date), 'MMM d, HH:mm')}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3 text-slate-400 hidden sm:inline flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">{log.user_name}</p>
                              <p className="text-xs text-slate-500 truncate hidden sm:block">{log.user_email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className={`font-medium ${getActionColor(log.action)} truncate block`}>{log.action?.replace(/_/g, ' ')}</span>
                        </TableCell>
                        <TableCell className="text-xs hidden md:table-cell">
                          {log.entity_type && (
                            <div>
                              <Badge variant="outline" className="text-xs">{log.entity_type}</Badge>
                              {log.entity_id && <p className="text-slate-500 mt-1 truncate">ID: {String(log.entity_id).substring(0, 8)}...</p>}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">{getSeverityBadge(log.severity)}</TableCell>
                        <TableCell className="text-xs max-w-xs hidden lg:table-cell">
                          {log.details && (
                            <details className="cursor-pointer">
                              <summary className="text-blue-600 hover:text-blue-700">View details</summary>
                              <pre className="mt-2 p-2 bg-slate-100 rounded text-xs overflow-auto max-h-32">{JSON.stringify(log.details, null, 2)}</pre>
                            </details>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
