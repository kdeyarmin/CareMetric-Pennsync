import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Search, LogIn, LogOut, Eye, Plus, Edit, Trash2, Download,
  AlertCircle, CheckCircle, Clock, Filter
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import UserActivityUnavailable from '@/components/security/UserActivityUnavailable';
import { useActivityReport } from '@/hooks/useActivityReport';

const ACTION_CONFIG = {
  login: { icon: LogIn, color: 'bg-green-100 text-green-800', label: 'Login' },
  logout: { icon: LogOut, color: 'bg-blue-100 text-blue-800', label: 'Logout' },
  page_visit: { icon: Eye, color: 'bg-slate-100 text-slate-800', label: 'Page Visit' },
  view: { icon: Eye, color: 'bg-slate-100 text-slate-800', label: 'View' },
  create: { icon: Plus, color: 'bg-blue-100 text-blue-800', label: 'Create' },
  update: { icon: Edit, color: 'bg-yellow-100 text-yellow-800', label: 'Update' },
  delete: { icon: Trash2, color: 'bg-red-100 text-red-800', label: 'Delete' },
  export: { icon: Download, color: 'bg-navy-100 text-navy-800', label: 'Export' },
  view_document: { icon: Eye, color: 'bg-indigo-100 text-indigo-800', label: 'View Document' },
  search: { icon: Search, color: 'bg-orange-100 text-orange-800', label: 'Search' }
};

const DEVICE_CONFIG = {
  mobile: { label: 'Mobile', color: 'bg-blue-100 text-blue-800' },
  tablet: { label: 'Tablet', color: 'bg-navy-100 text-navy-800' },
  desktop: { label: 'Desktop', color: 'bg-slate-100 text-slate-800' }
};

const RANGE_DAYS = { '24h': 1, '7days': 7, '30days': 30 };

const actionLabel = (action) => ACTION_CONFIG[action]?.label
  || String(action || 'activity').replace(/_/g, ' ');

/**
 * Live staff activity for the administrator console (owner decision,
 * 2026-10-08). Rows come from getUserActivityLog's report mode, which scopes
 * them on the server — the built-in administrator platform-wide, an agency
 * administrator to their agency — and strips identifying detail fields. A
 * failed read says so instead of showing zero activity.
 */
export default function UserActivityDashboard() {
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [dateRange, setDateRange] = useState('24h');

  const days = RANGE_DAYS[dateRange] ?? 1;
  const reportQuery = useActivityReport({ days, refetchInterval: 60_000 });
  const report = reportQuery.data || null;
  const activities = useMemo(() => {
    if (!report) return [];
    // The server filters by whole days; trim the 24-hour view to the hour.
    const cutoff = Date.now() - days * 86_400_000;
    return report.activity.filter((a) => {
      const at = Date.parse(a.created_date || '');
      return Number.isFinite(at) && at >= cutoff;
    });
  }, [report, days]);

  const users = useMemo(() => {
    const uniqueEmails = new Set(activities.map(a => a.user_email).filter(Boolean));
    return Array.from(uniqueEmails).sort();
  }, [activities]);

  const actions = useMemo(
    () => Array.from(new Set(activities.map((a) => a.action).filter(Boolean))).sort(),
    [activities],
  );

  const filteredActivities = useMemo(() => {
    let filtered = activities;
    if (actionFilter !== 'all') filtered = filtered.filter(a => a.action === actionFilter);
    if (userFilter !== 'all') filtered = filtered.filter(a => a.user_email === userFilter);
    if (searchTerm) {
      const needle = searchTerm.toLowerCase();
      filtered = filtered.filter(a =>
        a.user_email?.toLowerCase().includes(needle) ||
        a.user_name?.toLowerCase().includes(needle) ||
        a.page?.toLowerCase().includes(needle) ||
        a.entity_type?.toLowerCase().includes(needle) ||
        a.action?.toLowerCase().includes(needle)
      );
    }
    return filtered;
  }, [activities, actionFilter, userFilter, searchTerm]);

  const stats = useMemo(() => ({
    totalActivities: activities.length,
    uniqueUsers: new Set(activities.map(a => a.user_email)).size,
    failures: activities.filter(a => a.status === 'failure').length,
    loginCount: activities.filter(a => a.action === 'login').length
  }), [activities]);

  const statValue = (value) => (report ? value : '—');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">User Activity Tracking</h2>
        <p className="text-slate-600 mt-1">
          Monitor sign-ins, user actions and system usage. Sign-ins are recorded by the server, once per person per half hour.
        </p>
      </div>

      {reportQuery.isError && (
        <UserActivityUnavailable title="User activity could not be loaded" />
      )}
      {report?.truncated && (
        <p className="text-xs text-amber-700" role="status">
          Showing the most recent {report.rowLimit?.toLocaleString() || 'available'} events; older events in this range are not counted.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-slate-500 text-sm mb-1">Total Activities</p>
              <p className="text-3xl font-bold text-slate-900">{statValue(stats.totalActivities)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-slate-500 text-sm mb-1">Active Users</p>
              <p className="text-3xl font-bold text-blue-600">{statValue(stats.uniqueUsers)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-slate-500 text-sm mb-1">Sign-ins</p>
              <p className="text-3xl font-bold text-green-600">{statValue(stats.loginCount)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-slate-500 text-sm mb-1">Failures</p>
              <p className="text-3xl font-bold text-red-600">{statValue(stats.failures)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <Input
                placeholder="Search activities..."
                aria-label="Search activities"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger aria-label="Action">
                <SelectValue placeholder="All Actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {actions.map((action) => (
                  <SelectItem key={action} value={action}>{actionLabel(action)}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger aria-label="User">
                <SelectValue placeholder="All Users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {users.map(email => (
                  <SelectItem key={email} value={email}>
                    {email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger aria-label="Time range">
                <SelectValue placeholder="Last 24 hours" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7days">Last 7 days</SelectItem>
                <SelectItem value="30days">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Activities ({report ? filteredActivities.length : '—'})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {reportQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <p className="text-slate-500">Loading activities...</p>
            </div>
          ) : !report ? (
            <div className="flex justify-center py-8">
              <p className="text-slate-500">Activity is unavailable — this is not a zero count.</p>
            </div>
          ) : filteredActivities.length === 0 ? (
            <div className="flex justify-center py-8">
              <p className="text-slate-500">No activities found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredActivities.map((activity) => {
                  const actionConfig = ACTION_CONFIG[activity.action] || ACTION_CONFIG.page_visit;
                  const ActionIcon = actionConfig.icon;
                  const deviceConfig = DEVICE_CONFIG[activity.device_type] || null;

                  return (
                    <TableRow key={activity.id}>
                      <TableCell className="text-slate-900">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                          {new Date(activity.created_date).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-slate-900">{activity.user_name || 'Unknown'}</p>
                        <p className="text-xs text-slate-500">{activity.user_email}</p>
                      </TableCell>
                      <TableCell>
                        <Badge className={actionConfig.color}>
                          <ActionIcon className="h-3 w-3 mr-1" aria-hidden="true" />
                          {actionLabel(activity.action)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {activity.entity_type ? (
                          <div>
                            <p className="text-sm font-medium">{activity.entity_type}</p>
                            {activity.page && <p className="text-xs text-slate-500">{activity.page}</p>}
                          </div>
                        ) : activity.page ? (
                          <p className="text-sm">{activity.page}</p>
                        ) : (
                          <p className="text-slate-400 text-xs">-</p>
                        )}
                      </TableCell>
                      <TableCell>
                        {deviceConfig ? (
                          <Badge className={deviceConfig.color}>{deviceConfig.label}</Badge>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {activity.status === 'failure' ? (
                          <div className="flex items-center gap-1">
                            <AlertCircle className="h-4 w-4 text-red-600" aria-hidden="true" />
                            <span className="text-red-600 font-medium">Failed</span>
                          </div>
                        ) : activity.status === 'warning' ? (
                          <Badge variant="warning">Warning</Badge>
                        ) : (
                          <div className="flex items-center gap-1">
                            <CheckCircle className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                            <span className="text-emerald-600 font-medium">Success</span>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
