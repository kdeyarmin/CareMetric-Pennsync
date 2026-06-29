import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  AlertTriangle,
  Info,
  Lock,
  UnlockKeyhole,
  Database,
  FileEdit,
  Trash2,
  Eye,
} from "lucide-react";
import { formatEastern } from "../utils/timezone";
import { toCsvRows } from "@/components/admin/csvExport";

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

  const isAdmin = currentUser?.role === 'admin';

  const { data: auditLogs = [], isLoading } = useQuery({
    queryKey: ['auditLogs'],
    queryFn: () => base44.entities.UserActivity.list('-created_date', 1000),
    enabled: isAdmin,
  });

  const { data: securityLogs = [] } = useQuery({
    queryKey: ['securityLogs'],
    queryFn: () => base44.entities.SecurityLog.list('-timestamp', 500),
    enabled: isAdmin,
  });

  // Security-related actions to highlight
  const securityActions = [
    'user_login', 'user_logout', 'failed_login',
    'user_invite', 'user_delete', 'user_role_change',
    'access_denied', 'permission_change',
    'patient_data_access', 'patient_data_modified', 'patient_data_deleted',
    'sensitive_data_viewed', 'bulk_operation',
    'export_data', 'import_data',
    'settings_change', 'security_configuration_change'
  ];

  // Combine and filter logs based on type
  const combinedLogs = filterType === 'security' 
    ? [...auditLogs.filter(log => securityActions.some(action => log.action?.toLowerCase().includes(action.toLowerCase()))),
       ...securityLogs.map(log => ({
         ...log,
         created_date: log.timestamp,
         action: log.action,
         user_email: log.user_email,
         user_name: log.user_email?.split('@')[0],
         details: log.details,
         severity: 'critical'
       }))]
    : auditLogs;

  const sortedLogs = [...combinedLogs].sort((a, b) => 
    new Date(b.created_date || b.timestamp) - new Date(a.created_date || a.timestamp)
  );

  const uniqueUsers = [...new Set(sortedLogs.map(log => log.user_email).filter(Boolean))];
  const uniqueActions = [...new Set(sortedLogs.map(log => log.action).filter(Boolean))];
  const uniqueEntities = [...new Set(sortedLogs.map(log => log.entity_type).filter(Boolean))];

  const filteredLogs = sortedLogs.filter(log => {
    const matchesSearch = !searchTerm || 
      log.user_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.action?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.entity_type?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesAction = actionFilter === 'all' || log.action === actionFilter;
    const matchesEntity = entityFilter === 'all' || log.entity_type === entityFilter;
    const matchesUser = userFilter === 'all' || log.user_email === userFilter;
    const matchesSeverity = severityFilter === 'all' || log.severity === severityFilter;
    
    const logDate = new Date(log.created_date || log.timestamp);
    const daysAgo = parseInt(dateFilter);
    const matchesDate = daysAgo === 0 || 
      (Date.now() - logDate.getTime()) <= (daysAgo * 24 * 60 * 60 * 1000);
    
    return matchesSearch && matchesAction && matchesEntity && matchesUser && matchesSeverity && matchesDate;
  });

  const exportAuditLog = () => {
    const csv = toCsvRows([
      ['Timestamp', 'User', 'Email', 'Action', 'Entity Type', 'Entity ID', 'Severity', 'IP Address', 'Details'],
      ...filteredLogs.map(log => [
        log.created_date || log.timestamp,
        log.user_name || '',
        log.user_email || '',
        log.action || '',
        log.entity_type || '',
        log.entity_id || '',
        log.severity || 'info',
        log.ip_address || '',
        JSON.stringify(log.details || {})
      ])
    ]);

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_log_${filterType}_${new Date().toISOString()}.csv`;
    a.click();
  };

  const getSeverityBadge = (severity) => {
    const config = {
      critical: { color: 'bg-red-600 text-white', icon: AlertTriangle },
      warning: { color: 'bg-yellow-600 text-white', icon: AlertTriangle },
      info: { color: 'bg-blue-600 text-white', icon: Info },
    };
    const { color, icon: Icon } = config[severity] || config.info;
    return (
      <Badge className={color}>
        <Icon className="w-3 h-3 mr-1" />
        {severity || 'info'}
      </Badge>
    );
  };

  const getActionIcon = (action) => {
    const actionLower = action?.toLowerCase() || '';
    if (actionLower.includes('delete')) return <Trash2 className="w-4 h-4 text-red-600" />;
    if (actionLower.includes('edit') || actionLower.includes('update')) return <FileEdit className="w-4 h-4 text-blue-600" />;
    if (actionLower.includes('view') || actionLower.includes('access')) return <Eye className="w-4 h-4 text-slate-600" />;
    if (actionLower.includes('login')) return <UnlockKeyhole className="w-4 h-4 text-green-600" />;
    if (actionLower.includes('logout') || actionLower.includes('denied')) return <Lock className="w-4 h-4 text-red-600" />;
    if (actionLower.includes('data') || actionLower.includes('patient')) return <Database className="w-4 h-4 text-navy-600" />;
    return <Shield className="w-4 h-4 text-slate-600" />;
  };

  const getActionColor = (action) => {
    if (action?.includes('delete') || action?.includes('reject') || action?.includes('denied')) return 'text-red-600';
    if (action?.includes('approved') || action?.includes('completed') || action?.includes('login')) return 'text-green-600';
    if (action?.includes('updated') || action?.includes('edited')) return 'text-blue-600';
    if (action?.includes('access') || action?.includes('view')) return 'text-navy-600';
    return 'text-slate-600';
  };

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card className="border-2 border-red-200">
          <CardContent className="p-12 text-center">
            <Shield className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h2>
            <p className="text-slate-600">Only administrators can view the audit trail.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const criticalCount = sortedLogs.filter(l => l.severity === 'critical').length;
  const securityEventsCount = sortedLogs.filter(l => 
    securityActions.some(action => l.action?.toLowerCase().includes(action.toLowerCase()))
  ).length;

  return (
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900 mb-1 truncate">
            {filterType === 'security' ? 'Security Events Log' : 'Complete Audit Trail'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600">
            {filterType === 'security' 
              ? 'Monitor security-critical actions and access attempts'
              : 'Comprehensive log of all user actions and system events'
            }
          </p>
        </div>
        <Button onClick={exportAuditLog} variant="outline" className="w-full sm:w-auto min-h-[44px]">
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <Card>
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-slate-600 truncate">Total Events</p>
            <p className="text-xl sm:text-2xl font-bold">{sortedLogs.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-slate-600 truncate">Filtered</p>
            <p className="text-xl sm:text-2xl font-bold">{filteredLogs.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-slate-600 truncate">Critical Events</p>
            <p className="text-xl sm:text-2xl font-bold text-red-600">{criticalCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-slate-600 truncate">
              {filterType === 'security' ? 'Security Events' : 'Active Users'}
            </p>
            <p className="text-xl sm:text-2xl font-bold">
              {filterType === 'security' ? securityEventsCount : uniqueUsers.length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-4 sm:mb-6">
        <CardHeader className="p-3 sm:p-4">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 space-y-3 sm:space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search users, actions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-11 touch-target"
              />
            </div>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="h-11 touch-target">
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
              <SelectTrigger className="h-11 touch-target">
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
              <SelectTrigger className="h-11 touch-target">
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
              <SelectTrigger className="h-11 touch-target">
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
              <SelectTrigger className="h-11 touch-target">
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

      {/* Audit Log Table */}
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
                    <TableHead className="text-xs sm:text-sm hidden xl:table-cell">IP Address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-600 mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : filteredLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                        No audit logs found matching filters
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredLogs.map((log, idx) => (
                      <TableRow key={idx} className="hover:bg-slate-50">
                        <TableCell className="text-xs whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-slate-400 hidden sm:inline" />
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
                            <User className="w-3 h-3 text-slate-400 hidden sm:inline flex-shrink-0" />
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
                                  ID: {log.entity_id.substring(0, 8)}...
                                </p>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {getSeverityBadge(log.severity)}
                        </TableCell>
                        <TableCell className="text-xs hidden xl:table-cell">
                          {log.ip_address && (
                            <code className="text-xs bg-slate-100 px-2 py-1 rounded">
                              {log.ip_address}
                            </code>
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