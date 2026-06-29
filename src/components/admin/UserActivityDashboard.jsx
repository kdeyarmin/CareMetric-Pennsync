import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
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

const ACTION_CONFIG = {
  login: { icon: LogIn, color: 'bg-green-100 text-green-800', label: 'Login' },
  logout: { icon: LogOut, color: 'bg-blue-100 text-blue-800', label: 'Logout' },
  page_visit: { icon: Eye, color: 'bg-slate-100 text-slate-800', label: 'Page Visit' },
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

export default function UserActivityDashboard() {
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [dateRange, setDateRange] = useState('24h');

  // Fetch all user activities
  const { data: activities = [], isLoading } = useQuery({
    // dateRange is read in queryFn to compute the cutoff, so it must be part of
    // the key — otherwise changing the range serves the stale cached result.
    queryKey: ['userActivities', dateRange],
    queryFn: async () => {
      const cutoffDate = new Date();
      if (dateRange === '24h') {
        cutoffDate.setHours(cutoffDate.getHours() - 24);
      } else if (dateRange === '7days') {
        cutoffDate.setDate(cutoffDate.getDate() - 7);
      } else if (dateRange === '30days') {
        cutoffDate.setDate(cutoffDate.getDate() - 30);
      }

      const allActivities = await base44.asServiceRole.entities.UserActivity.list('-created_date', 500);
      return allActivities.filter(a => new Date(a.created_date) >= cutoffDate);
    },
    refetchInterval: 10000 // Refresh every 10 seconds
  });

  // Get unique users
  const users = useMemo(() => {
    const uniqueEmails = new Set(activities.map(a => a.user_email));
    return Array.from(uniqueEmails).sort();
  }, [activities]);

  // Filter activities
  const filteredActivities = useMemo(() => {
    let filtered = activities;

    if (actionFilter !== 'all') {
      filtered = filtered.filter(a => a.action === actionFilter);
    }

    if (userFilter !== 'all') {
      filtered = filtered.filter(a => a.user_email === userFilter);
    }

    if (searchTerm) {
      filtered = filtered.filter(a =>
        a.user_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.page?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.entity_type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.action?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    return filtered;
  }, [activities, actionFilter, userFilter, searchTerm]);

  // Calculate statistics
  const stats = useMemo(() => {
    return {
      totalActivities: activities.length,
      uniqueUsers: new Set(activities.map(a => a.user_email)).size,
      failures: activities.filter(a => a.status === 'failure').length,
      loginCount: activities.filter(a => a.action === 'login').length
    };
  }, [activities]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900">User Activity Tracking</h2>
        <p className="text-slate-600 mt-1">Monitor all user actions and system usage</p>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-slate-500 text-sm mb-1">Total Activities</p>
              <p className="text-3xl font-bold text-slate-900">{stats.totalActivities}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-slate-500 text-sm mb-1">Active Users</p>
              <p className="text-3xl font-bold text-blue-600">{stats.uniqueUsers}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-slate-500 text-sm mb-1">Logins</p>
              <p className="text-3xl font-bold text-green-600">{stats.loginCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-slate-500 text-sm mb-1">Failures</p>
              <p className="text-3xl font-bold text-red-600">{stats.failures}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
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
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search activities..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="login">Login</SelectItem>
                <SelectItem value="logout">Logout</SelectItem>
                <SelectItem value="page_visit">Page Visit</SelectItem>
                <SelectItem value="create">Create</SelectItem>
                <SelectItem value="update">Update</SelectItem>
                <SelectItem value="delete">Delete</SelectItem>
                <SelectItem value="export">Export</SelectItem>
                <SelectItem value="search">Search</SelectItem>
              </SelectContent>
            </Select>

            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger>
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
              <SelectTrigger>
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

      {/* Activity List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Activities ({filteredActivities.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <p className="text-slate-500">Loading activities...</p>
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
                  const deviceConfig = DEVICE_CONFIG[activity.device_type] || DEVICE_CONFIG.desktop;

                  return (
                    <TableRow key={activity.id}>
                      <TableCell className="text-slate-900">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-slate-400" />
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
                          <ActionIcon className="h-3 w-3 mr-1" />
                          {actionConfig.label}
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
                        <Badge className={deviceConfig.color}>
                          {deviceConfig.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {activity.status === 'failure' ? (
                          <div className="flex items-center gap-1">
                            <AlertCircle className="h-4 w-4 text-red-600" />
                            <span className="text-red-600 font-medium">Failed</span>
                          </div>
                        ) : activity.status === 'warning' ? (
                          <Badge variant="warning">Warning</Badge>
                        ) : (
                          <div className="flex items-center gap-1">
                            <CheckCircle className="h-4 w-4 text-emerald-600" />
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