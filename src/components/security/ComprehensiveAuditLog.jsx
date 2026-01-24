import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { FileText, Download, Filter, Shield } from "lucide-react";
import { format } from "date-fns";

export default function ComprehensiveAuditLog() {
  const [filterType, setFilterType] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: auditLogs = [], isLoading } = useQuery({
    queryKey: ['auditTrail'],
    queryFn: () => base44.entities.AuditTrail.list('-timestamp', 500)
  });

  const { data: userActivity = [] } = useQuery({
    queryKey: ['userActivityAll'],
    queryFn: () => base44.entities.UserActivity.list('-created_date', 500)
  });

  const { data: securityLogs = [] } = useQuery({
    queryKey: ['securityLogs'],
    queryFn: () => base44.entities.SecurityLog.list('-timestamp', 500)
  });

  // Combine all logs
  const allLogs = [
    ...auditLogs.map(log => ({ ...log, source: 'audit', type: log.action })),
    ...userActivity.map(log => ({ ...log, source: 'activity', type: log.action, timestamp: log.created_date })),
    ...securityLogs.map(log => ({ ...log, source: 'security', type: log.action }))
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const filteredLogs = allLogs.filter(log => {
    const matchesType = filterType === "all" || log.source === filterType;
    const matchesSearch = !searchTerm || 
      log.user_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.type?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesType && matchesSearch;
  });

  const exportToCSV = () => {
    const headers = ['Timestamp', 'User', 'Action', 'Source', 'Details', 'IP Address'];
    const rows = filteredLogs.map(log => [
      format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss'),
      log.user_email || log.email || '',
      log.type || log.action,
      log.source,
      JSON.stringify(log.details || {}),
      log.ip_address || ''
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
  };

  const getActionColor = (type) => {
    if (type?.includes('create')) return 'bg-green-100 text-green-800';
    if (type?.includes('update')) return 'bg-blue-100 text-blue-800';
    if (type?.includes('delete')) return 'bg-red-100 text-red-800';
    if (type?.includes('login') || type?.includes('access')) return 'bg-purple-100 text-purple-800';
    return 'bg-slate-100 text-slate-800';
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-600" />
            Comprehensive Audit Log
          </h2>
          <p className="text-slate-600">Complete HIPAA-compliant activity trail</p>
        </div>
        <Button onClick={exportToCSV} variant="outline">
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Input
                placeholder="Search by user or action..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Logs</SelectItem>
                  <SelectItem value="audit">Audit Trail</SelectItem>
                  <SelectItem value="activity">User Activity</SelectItem>
                  <SelectItem value="security">Security Events</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold text-slate-900">{allLogs.length}</p>
            <p className="text-sm text-slate-500">Total Events</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold text-green-600">
              {allLogs.filter(l => l.type?.includes('create')).length}
            </p>
            <p className="text-sm text-slate-500">Created</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold text-blue-600">
              {allLogs.filter(l => l.type?.includes('update')).length}
            </p>
            <p className="text-sm text-slate-500">Updated</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold text-red-600">
              {allLogs.filter(l => l.type?.includes('delete')).length}
            </p>
            <p className="text-sm text-slate-500">Deleted</p>
          </CardContent>
        </Card>
      </div>

      {/* Log Entries */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Showing {filteredLogs.length} events</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {filteredLogs.map((log, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-slate-50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className={getActionColor(log.type)}>
                      {log.type || log.action}
                    </Badge>
                    <Badge variant="outline">{log.source}</Badge>
                    <span className="text-xs text-slate-500">
                      {format(new Date(log.timestamp), 'MMM d, yyyy HH:mm:ss')}
                    </span>
                  </div>
                  <p className="text-sm text-slate-900 font-medium">
                    {log.user_email || log.email || 'System'}
                  </p>
                  {log.details && (
                    <p className="text-xs text-slate-600 mt-1">
                      {typeof log.details === 'string' ? log.details : JSON.stringify(log.details)}
                    </p>
                  )}
                  {log.ip_address && (
                    <p className="text-xs text-slate-500 mt-1">IP: {log.ip_address}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}