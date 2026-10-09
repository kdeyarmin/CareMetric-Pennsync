import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  Shield,
  Search,
  Filter,
  Download,
  Calendar,
  User,
  Lock,
  UnlockKeyhole,
  Database,
  FileEdit,
  Trash2,
  Eye,
} from "lucide-react";
import { formatEastern } from "../utils/timezone";
import { toCsvRows } from "@/components/admin/csvExport";
import { getSeverityBadge } from "@/components/security/auditSeverityBadge";
import { downloadAuthorityBoundBlob } from "@/lib/downloadBlob";
import { isAdminLike } from "@/lib/superAdmin";
import { useActivityReport } from "@/hooks/useActivityReport";
import SecurityLogUnavailable from "@/components/security/SecurityLogUnavailable";
import UserActivityUnavailable from "@/components/security/UserActivityUnavailable";

const SECURITY_LOG_ROWS = 500;

// Activity rows keep severity inside `details`; anomaly SecurityLogs keep it as
// `details.anomaly_severity`. Read it from wherever it lives, defaulting to info.
const getLogSeverity = (log) =>
  log?.severity ?? log?.details?.severity ?? log?.details?.anomaly_severity ?? 'info';

// Security-relevant actions to highlight.
const SECURITY_ACTIONS = [
  'login', 'logout', 'failed_login',
  'user_invite', 'user_delete', 'user_role_change', 'user_role_changed',
  'user_disabled', 'user_enabled', 'user_password_reset',
  'access_denied', 'permission_change', 'role_permission_changed',
  'patient_data_access', 'patient_data_modified', 'patient_data_deleted',
  'sensitive_data_viewed', 'bulk_operation',
  'export', 'export_data', 'import_data',
  'settings_change', 'settings_updated', 'security_configuration_change',
];
const isSecurityAction = (action) => {
  const value = String(action || '').toLowerCase();
  return SECURITY_ACTIONS.some((candidate) => value.includes(candidate));
};

/**
 * The Security & Policy hub's audit trail (owner decision, 2026-10-08).
 *
 * Activity events come from getUserActivityLog's report mode, which the server
 * scopes — the built-in administrator platform-wide, an agency administrator to
 * their agency's members — and returns with identifying detail fields removed.
 * SecurityLog rows are readable in full only by the administrator account, so
 * the security view loads them for that account alone and says so to anyone
 * else instead of showing a partial log as the whole one. A source that has not
 * loaded is reported as unavailable, never as zero events.
 */
export default function AuditTrailViewer({ filterType = "all" }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("7");
  const [severityFilter, setSeverityFilter] = useState("all");

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });
  const canReadSecurityLog = isAdminLike(currentUser);
  const wantsSecurityLog = filterType === 'security';

  const days = dateFilter === '0' ? null : Number(dateFilter);
  const activityQuery = useActivityReport({
    days,
    enabled: !!currentUser,
    scopeKey: currentUser?.email || null,
  });

  const securityLogQuery = useQuery({
    queryKey: ['securityLogs', '-timestamp', SECURITY_LOG_ROWS],
    queryFn: () => base44.entities.SecurityLog.list('-timestamp', SECURITY_LOG_ROWS),
    enabled: wantsSecurityLog && canReadSecurityLog,
  });

  const activityRows = useMemo(() => activityQuery.data?.activity || null, [activityQuery.data]);
  const securityRows = useMemo(() => (
    wantsSecurityLog && canReadSecurityLog && securityLogQuery.isSuccess && Array.isArray(securityLogQuery.data)
      ? securityLogQuery.data.map((log) => ({
        ...log,
        source: 'security_log',
        created_date: log.timestamp || log.created_date,
        user_name: log.user_email?.split('@')[0],
        severity: getLogSeverity(log),
      }))
      : []
  ), [wantsSecurityLog, canReadSecurityLog, securityLogQuery.isSuccess, securityLogQuery.data]);

  const sortedLogs = useMemo(() => {
    if (!activityRows) return [];
    const activity = wantsSecurityLog
      ? activityRows.filter((log) => isSecurityAction(log.action))
      : activityRows;
    return [...activity, ...securityRows].sort(
      (a, b) => new Date(b.created_date || b.timestamp) - new Date(a.created_date || a.timestamp),
    );
  }, [activityRows, securityRows, wantsSecurityLog]);

  const uniqueUsers = [...new Set(sortedLogs.map(log => log.user_email).filter(Boolean))];
  const uniqueActions = [...new Set(sortedLogs.map(log => log.action).filter(Boolean))];
  const uniqueEntities = [...new Set(sortedLogs.map(log => log.entity_type).filter(Boolean))];

  const filteredLogs = sortedLogs.filter(log => {
    const needle = searchTerm.toLowerCase();
    const matchesSearch = !searchTerm ||
      log.user_email?.toLowerCase().includes(needle) ||
      log.user_name?.toLowerCase().includes(needle) ||
      log.action?.toLowerCase().includes(needle) ||
      log.entity_type?.toLowerCase().includes(needle);
    const matchesAction = actionFilter === 'all' || log.action === actionFilter;
    const matchesEntity = entityFilter === 'all' || log.entity_type === entityFilter;
    const matchesUser = userFilter === 'all' || log.user_email === userFilter;
    const matchesSeverity = severityFilter === 'all' || getLogSeverity(log) === severityFilter;
    const logDate = new Date(log.created_date || log.timestamp);
    const daysAgo = parseInt(dateFilter, 10);
    const matchesDate = daysAgo === 0 ||
      (Date.now() - logDate.getTime()) <= (daysAgo * 24 * 60 * 60 * 1000);
    return matchesSearch && matchesAction && matchesEntity && matchesUser && matchesSeverity && matchesDate;
  });

  const exportAuditLog = () => {
    const csv = toCsvRows([
      ['Timestamp', 'User', 'Email', 'Action', 'Entity Type', 'Entity ID', 'Severity', 'Source', 'Details'],
      ...filteredLogs.map(log => [
        log.created_date || log.timestamp,
        log.user_name || '',
        log.user_email || '',
        log.action || '',
        log.entity_type || '',
        log.entity_id || '',
        getLogSeverity(log),
        log.source === 'security_log' ? 'Security log' : 'Activity',
        JSON.stringify(log.details || {})
      ])
    ]);
    downloadAuthorityBoundBlob(
      new Blob([csv], { type: 'text/csv' }),
      `audit_log_${filterType}_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const getActionIcon = (action) => {
    const actionLower = action?.toLowerCase() || '';
    if (actionLower.includes('delete')) return <Trash2 className="w-4 h-4 text-red-600" aria-hidden="true" />;
    if (actionLower.includes('edit') || actionLower.includes('update')) return <FileEdit className="w-4 h-4 text-blue-600" aria-hidden="true" />;
    if (actionLower.includes('view') || actionLower.includes('access')) return <Eye className="w-4 h-4 text-slate-600" aria-hidden="true" />;
    if (actionLower.includes('login')) return <UnlockKeyhole className="w-4 h-4 text-green-600" aria-hidden="true" />;
    if (actionLower.includes('logout') || actionLower.includes('denied')) return <Lock className="w-4 h-4 text-red-600" aria-hidden="true" />;
    if (actionLower.includes('data') || actionLower.includes('patient')) return <Database className="w-4 h-4 text-navy-600" aria-hidden="true" />;
    return <Shield className="w-4 h-4 text-slate-600" aria-hidden="true" />;
  };

  const getActionColor = (action) => {
    if (action?.includes('delete') || action?.includes('reject') || action?.includes('denied')) return 'text-red-600';
    if (action?.includes('approved') || action?.includes('completed') || action?.includes('login')) return 'text-green-600';
    if (action?.includes('updated') || action?.includes('edited')) return 'text-blue-600';
    if (action?.includes('access') || action?.includes('view')) return 'text-navy-600';
    return 'text-slate-600';
  };

  if (activityQuery.isError) {
    return wantsSecurityLog
      ? <SecurityLogUnavailable title="Security events log unavailable" />
      : <UserActivityUnavailable title="Audit trail unavailable" />;
  }

  const criticalCount = sortedLogs.filter(l => getLogSeverity(l) === 'critical').length;
  const securityEventsCount = sortedLogs.filter(l => l.source === 'security_log' || isSecurityAction(l.action)).length;
  const loaded = !!activityRows;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900 mb-1 truncate">
            {wantsSecurityLog ? 'Security Events Log' : 'Complete Audit Trail'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600">
            {wantsSecurityLog
              ? 'Monitor security-critical actions and access attempts'
              : 'Log of user actions recorded on the activity trail'}
          </p>
        </div>
        <Button onClick={exportAuditLog} variant="outline" className="w-full sm:w-auto min-h-[44px]" disabled={!loaded}>
          <Download className="w-4 h-4 mr-2" aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      {wantsSecurityLog && !canReadSecurityLog && (
        <Alert className="border-amber-300 bg-amber-50" role="status">
          <AlertDescription className="text-amber-950">
            Security-log events (failed sign-ins, access denials, anomaly scans) are readable by the administrator
            account only. Showing your agency&apos;s security-related activity events.
          </AlertDescription>
        </Alert>
      )}
      {wantsSecurityLog && canReadSecurityLog && securityLogQuery.isError && (
        <SecurityLogUnavailable title="Security-log events could not be loaded" />
      )}
      {activityQuery.data?.truncated && (
        <p className="text-xs text-amber-700" role="status">
          Activity covers the most recent {activityQuery.data.rowLimit?.toLocaleString() || 'available'} events.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <Card>
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-slate-600 truncate">Total Events</p>
            <p className="text-xl sm:text-2xl font-bold">{loaded ? sortedLogs.length : '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-slate-600 truncate">Filtered</p>
            <p className="text-xl sm:text-2xl font-bold">{loaded ? filteredLogs.length : '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-slate-600 truncate">Critical Events</p>
            <p className="text-xl sm:text-2xl font-bold text-red-600">{loaded ? criticalCount : '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-slate-600 truncate">
              {wantsSecurityLog ? 'Security Events' : 'Active Users'}
            </p>
            <p className="text-xl sm:text-2xl font-bold">
              {!loaded ? '—' : wantsSecurityLog ? securityEventsCount : uniqueUsers.length}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-4 sm:mb-6">
        <CardHeader className="p-3 sm:p-4">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2">
            <Filter className="w-4 h-4" aria-hidden="true" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 space-y-3 sm:space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
              <Input
                placeholder="Search users, actions..."
                aria-label="Search users or actions"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-11 touch-target"
              />
            </div>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="h-11 touch-target" aria-label="Action type">
                <SelectValue placeholder="Action Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {uniqueActions.slice(0, 50).map(action => (
                  <SelectItem key={action} value={action}>{action}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="h-11 touch-target" aria-label="Entity type">
                <SelectValue placeholder="Entity Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entities</SelectItem>
                {uniqueEntities.map(entity => (
                  <SelectItem key={entity} value={entity}>{entity}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="h-11 touch-target" aria-label="User">
                <SelectValue placeholder="User" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {uniqueUsers.map(user => (
                  <SelectItem key={user} value={user}>{user}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="h-11 touch-target" aria-label="Severity">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="h-11 touch-target" aria-label="Time range">
                <SelectValue placeholder="Time Range" />
              </SelectTrigger>
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
          <div className="overflow-x-auto -mx-3 sm:mx-0">
            <ScrollArea className="h-[400px] sm:h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs sm:text-sm">Timestamp</TableHead>
                    <TableHead className="text-xs sm:text-sm">User</TableHead>
                    <TableHead className="text-xs sm:text-sm">Action</TableHead>
                    <TableHead className="text-xs sm:text-sm hidden md:table-cell">Entity</TableHead>
                    <TableHead className="text-xs sm:text-sm hidden lg:table-cell">Severity</TableHead>
                    <TableHead className="text-xs sm:text-sm hidden xl:table-cell">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!loaded ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-600 mx-auto" aria-label="Loading audit events" />
                      </TableCell>
                    </TableRow>
                  ) : filteredLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                        No audit logs found matching filters
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredLogs.map((log) => (
                      <TableRow key={`${log.source || 'activity'}:${log.id}`} className="hover:bg-slate-50">
                        <TableCell className="text-xs whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-slate-400 hidden sm:inline" aria-hidden="true" />
                            <span className="hidden sm:inline">
                              {formatEastern(new Date(log.created_date || log.timestamp), 'MMM d, yyyy HH:mm:ss')}
                            </span>
                            <span className="sm:hidden">
                              {formatEastern(new Date(log.created_date || log.timestamp), 'MMM d, HH:mm')}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3 text-slate-400 hidden sm:inline flex-shrink-0" aria-hidden="true" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">{log.user_name || log.user_email?.split('@')[0]}</p>
                              <p className="text-xs text-slate-500 truncate hidden sm:block">{log.user_email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-2">
                            {getActionIcon(log.action)}
                            <span className={`font-medium ${getActionColor(log.action)} truncate`}>
                              {log.action?.replace(/_/g, ' ')}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs hidden md:table-cell">
                          {log.entity_type && (
                            <div>
                              <Badge variant="outline" className="text-xs">
                                {log.entity_type}
                              </Badge>
                              {log.entity_id && (
                                <p className="text-slate-500 mt-1 truncate text-xs">
                                  ID: {String(log.entity_id).substring(0, 8)}...
                                </p>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {getSeverityBadge(getLogSeverity(log))}
                        </TableCell>
                        <TableCell className="text-xs hidden xl:table-cell">
                          {log.source === 'security_log' ? 'Security log' : 'Activity'}
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
