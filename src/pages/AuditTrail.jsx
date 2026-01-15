import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Shield, Search, Download, Eye, AlertTriangle, 
  Filter, Calendar, User, Database
} from "lucide-react";
import { format } from "date-fns";

export default function AuditTrail() {
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [sensitiveOnly, setSensitiveOnly] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: auditLogs = [], isLoading } = useQuery({
    queryKey: ['auditTrail'],
    queryFn: async () => {
      const logs = await base44.entities.AuditTrail.list('-timestamp', 500);
      return logs;
    },
    enabled: currentUser?.role === 'admin'
  });

  if (currentUser?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-6 h-6" />
              Access Denied
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600">
              Only administrators can access the audit trail.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Filter logs
  const filteredLogs = auditLogs.filter(log => {
    const matchesSearch = !searchTerm || 
      log.user_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.entity_id?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesAction = actionFilter === 'all' || log.action === actionFilter;
    const matchesEntity = entityFilter === 'all' || log.entity_type === entityFilter;
    const matchesSensitive = !sensitiveOnly || log.is_sensitive;

    return matchesSearch && matchesAction && matchesEntity && matchesSensitive;
  });

  const getActionBadge = (action) => {
    const colors = {
      view: 'bg-blue-500',
      create: 'bg-green-500',
      update: 'bg-yellow-500',
      delete: 'bg-red-500',
      export: 'bg-purple-500',
      login: 'bg-indigo-500',
      access_denied: 'bg-red-600'
    };
    return <Badge className={colors[action] || 'bg-gray-500'}>{action}</Badge>;
  };

  const exportAuditLog = () => {
    const csv = [
      ['Timestamp', 'User', 'Role', 'Action', 'Entity Type', 'Entity ID', 'Description', 'Sensitive'],
      ...filteredLogs.map(log => [
        log.timestamp,
        log.user_email,
        log.user_role,
        log.action,
        log.entity_type,
        log.entity_id || '',
        log.description || '',
        log.is_sensitive ? 'Yes' : 'No'
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-trail-${new Date().toISOString()}.csv`;
    a.click();
  };

  const uniqueEntities = [...new Set(auditLogs.map(log => log.entity_type))].sort();

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Shield className="w-8 h-8 text-indigo-600" />
              Audit Trail
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Complete log of all sensitive data access and modifications
            </p>
          </div>
          <Button onClick={exportAuditLog} variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {auditLogs.length}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Total Events</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-red-600">
                {auditLogs.filter(l => l.is_sensitive).length}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Sensitive Access</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-blue-600">
                {auditLogs.filter(l => l.action === 'view').length}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">View Events</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-yellow-600">
                {auditLogs.filter(l => ['create', 'update', 'delete'].includes(l.action)).length}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Modifications</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Filter className="w-5 h-5" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search user, description..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="view">View</SelectItem>
                  <SelectItem value="create">Create</SelectItem>
                  <SelectItem value="update">Update</SelectItem>
                  <SelectItem value="delete">Delete</SelectItem>
                  <SelectItem value="export">Export</SelectItem>
                </SelectContent>
              </Select>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Entities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entities</SelectItem>
                  {uniqueEntities.map(entity => (
                    <SelectItem key={entity} value={entity}>{entity}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant={sensitiveOnly ? "default" : "outline"}
                onClick={() => setSensitiveOnly(!sensitiveOnly)}
                className="w-full"
              >
                <AlertTriangle className="w-4 h-4 mr-2" />
                {sensitiveOnly ? 'Sensitive Only' : 'All Records'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Audit Log List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Audit Logs ({filteredLogs.length})</span>
              {isLoading && <span className="text-sm text-gray-500">Loading...</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {filteredLogs.map((log, idx) => (
                <div
                  key={log.id || idx}
                  className={`p-4 rounded-lg border transition-colors ${
                    log.is_sensitive 
                      ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800' 
                      : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-gray-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {getActionBadge(log.action)}
                        <Badge variant="outline" className="text-xs">
                          <Database className="w-3 h-3 mr-1" />
                          {log.entity_type}
                        </Badge>
                        {log.is_sensitive && (
                          <Badge className="bg-red-600 text-xs">
                            <Shield className="w-3 h-3 mr-1" />
                            Sensitive
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {log.user_name || log.user_email} ({log.user_role})
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(log.timestamp), 'MMM dd, yyyy HH:mm:ss')}
                        </span>
                      </div>
                      {log.description && (
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          {log.description}
                        </p>
                      )}
                      {log.entity_id && (
                        <p className="text-xs text-gray-500 dark:text-gray-500">
                          Entity ID: {log.entity_id}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {filteredLogs.length === 0 && (
                <div className="text-center py-12">
                  <Eye className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">No audit logs found matching your filters</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}