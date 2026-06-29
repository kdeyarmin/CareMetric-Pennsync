import { lazy, Suspense, useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import StatCard from "@/components/ui/stat-card";
import LoadingState from "@/components/ui/LoadingState";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart3,
  Activity,
  LogIn,
  User,
  Download,
  Search,
  Clock,
  MousePointer,
  Archive,
  Loader2
} from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import EmbeddedPage from "@/components/ui/embeddedPage";
import PageHeader from "@/components/ui/PageHeader";
import { formatDistanceToNow } from "date-fns";
import { formatEastern } from "../components/utils/timezone";
import { jsPDF } from "jspdf";
import { toCsvRows } from "@/components/admin/csvExport";
import { toast } from 'sonner';

const UserActivityLog = lazy(() => import("@/components/hub-tabs/UserActivityLog"));

// Tab keys, kept in sync with the TabsTrigger values below. Used to validate the
// ?tab= deep-link so the retired Activity Log page redirects to the right tab.
const TAB_KEYS = ["report", "log"];

const tabLoader = (
  <div className="flex justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
  </div>
);

export default function UserActivityReport() {
  const [timeRange, setTimeRange] = useState("30"); // days
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("total_actions");

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  // Deep-link from e.g. the Security anomaly "Investigate" action: ?user=<email>
  // pre-fills the search so the report opens scoped to that user.
  const userParam = searchParams.get("user");
  useEffect(() => {
    if (userParam) setSearchQuery(userParam);
  }, [userParam]);
  const activeTab = TAB_KEYS.includes(requestedTab) ? requestedTab : "report";
  // Reflect the active tab in the URL so tabs are shareable/bookmarkable and the
  // retired Activity Log page deep-links correctly. "report" is the default, so it
  // stays a clean /UserActivityReport with no query string.
  const handleTabChange = (value) => {
    setSearchParams(value === "report" ? {} : { tab: value });
  };

  // Converge on the canonical URL: strip a redundant or unknown ?tab= so the
  // default tab is plain /UserActivityReport. Only fires when the param resolved
  // to the default tab, so a valid deep-link like ?tab=log is left untouched.
  useEffect(() => {
    if (requestedTab !== null && activeTab === "report") {
      setSearchParams({}, { replace: true });
    }
  }, [requestedTab, activeTab, setSearchParams]);

  // Fetch user activity data
  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['user-activities-report'],
    queryFn: () => base44.entities.UserActivity.list('-created_date', 5000)
  });

  const { data: _users = [] } = useQuery({
    queryKey: ['all-users-report'],
    queryFn: () => base44.entities.User.list('-created_date', 500)
  });

  // Filter activities by time range
  const filteredActivities = useMemo(() => {
    if (timeRange === "all") return activities;
    
    const days = parseInt(timeRange);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    return activities.filter(a => new Date(a.created_date) >= cutoffDate);
  }, [activities, timeRange]);

  // Aggregate data by user
  const userStats = useMemo(() => {
    const stats = {};
    
    filteredActivities.forEach(activity => {
      // Coerce to a safe string key: imported/legacy rows may lack user_email,
      // and an undefined email later crashes the search filter (stat.email.toLowerCase()).
      const email = activity.user_email || '';
      if (!stats[email]) {
        stats[email] = {
          email,
          name: activity.user_name || email || 'Unknown',
          total_actions: 0,
          logins: 0,
          pages_visited: new Set(),
          actions_by_type: {},
          last_activity: activity.created_date,
          first_activity: activity.created_date,
          entities_interacted: new Set()
        };
      }
      
      stats[email].total_actions++;
      
      if (activity.action === 'login') {
        stats[email].logins++;
      }
      
      if (activity.page) {
        stats[email].pages_visited.add(activity.page);
      }
      
      if (activity.entity_type) {
        stats[email].entities_interacted.add(activity.entity_type);
      }
      
      // Count actions by type
      if (!stats[email].actions_by_type[activity.action]) {
        stats[email].actions_by_type[activity.action] = 0;
      }
      stats[email].actions_by_type[activity.action]++;
      
      // Update last activity
      if (new Date(activity.created_date) > new Date(stats[email].last_activity)) {
        stats[email].last_activity = activity.created_date;
      }
      
      // Update first activity
      if (new Date(activity.created_date) < new Date(stats[email].first_activity)) {
        stats[email].first_activity = activity.created_date;
      }
    });
    
    // Convert sets to counts and arrays
    return Object.values(stats).map(stat => ({
      ...stat,
      pages_visited_count: stat.pages_visited.size,
      pages_visited_list: Array.from(stat.pages_visited),
      entities_interacted_count: stat.entities_interacted.size,
      entities_interacted_list: Array.from(stat.entities_interacted),
      top_actions: Object.entries(stat.actions_by_type)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
    }));
  }, [filteredActivities]);

  // Search and sort
  const processedStats = useMemo(() => {
    let result = userStats;
    
    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(stat =>
        stat.name.toLowerCase().includes(query) ||
        stat.email.toLowerCase().includes(query)
      );
    }
    
    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case "total_actions":
          return b.total_actions - a.total_actions;
        case "logins":
          return b.logins - a.logins;
        case "pages":
          return b.pages_visited_count - a.pages_visited_count;
        case "last_activity":
          return new Date(b.last_activity) - new Date(a.last_activity);
        case "name":
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });
    
    return result;
  }, [userStats, searchQuery, sortBy]);

  // Overall stats
  const overallStats = useMemo(() => {
    return {
      total_users: userStats.length,
      total_actions: userStats.reduce((sum, u) => sum + u.total_actions, 0),
      total_logins: userStats.reduce((sum, u) => sum + u.logins, 0),
      active_users: userStats.filter(u => {
        const lastActivity = new Date(u.last_activity);
        const daysSince = (new Date() - lastActivity) / (1000 * 60 * 60 * 24);
        return daysSince <= 7;
      }).length
    };
  }, [userStats]);

  // Export to CSV
  const exportToCSV = () => {
    try {
      if (processedStats.length === 0) {
        toast.error('No data to export');
        return;
      }

      const headers = [
        'User Name',
        'Email',
        'Total Actions',
        'Logins',
        'Pages Visited',
        'Entities Interacted',
        'Last Activity',
        'Top Action'
      ];
      
      const rows = processedStats.map(stat => [
        stat.name || '',
        stat.email || '',
        stat.total_actions || 0,
        stat.logins || 0,
        stat.pages_visited_count || 0,
        stat.entities_interacted_count || 0,
        stat.last_activity ? formatEastern(new Date(stat.last_activity), 'MMM d, yyyy') : 'N/A',
        stat.top_actions[0] ? `${stat.top_actions[0][0]} (${stat.top_actions[0][1]})` : 'N/A'
      ]);
      
      const csv = toCsvRows([headers, ...rows]);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `user_activity_report_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('CSV export error:', error);
      toast.error('Failed to generate CSV report: ' + error.message);
    }
  };

  // Export to PDF
  const exportToPDF = () => {
    try {
      if (processedStats.length === 0) {
        toast.error('No data to export');
        return;
      }

      const doc = new jsPDF();
      
      // Title
      doc.setFontSize(20);
      doc.text('User Activity Report', 20, 20);
      
      // Date and time range
      doc.setFontSize(10);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 30);
      doc.text(`Time Range: ${timeRange === 'all' ? 'All Time' : `Last ${timeRange} days`}`, 20, 35);
      
      // Overall stats
      doc.setFontSize(12);
      doc.text('Overall Statistics', 20, 45);
      doc.setFontSize(10);
      doc.text(`Total Users: ${overallStats.total_users}`, 30, 52);
      doc.text(`Total Actions: ${overallStats.total_actions}`, 30, 58);
      doc.text(`Total Logins: ${overallStats.total_logins}`, 30, 64);
      doc.text(`Active Users (7 days): ${overallStats.active_users}`, 30, 70);
      
      // User details
      let y = 85;
      doc.setFontSize(12);
      doc.text('User Activity Details', 20, y);
      y += 10;
      
      processedStats.forEach((stat, idx) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text(`${idx + 1}. ${stat.name || 'Unknown'}`, 20, y);
        doc.setFont(undefined, 'normal');
        y += 5;
        
        doc.setFontSize(8);
        doc.text(`Email: ${stat.email || 'N/A'}`, 30, y);
        y += 5;
        doc.text(`Total Actions: ${stat.total_actions || 0} | Logins: ${stat.logins || 0} | Pages: ${stat.pages_visited_count || 0} | Entities: ${stat.entities_interacted_count || 0}`, 30, y);
        y += 5;
        
        if (stat.last_activity) {
          doc.text(`Last Activity: ${formatDistanceToNow(new Date(stat.last_activity), { addSuffix: true })}`, 30, y);
          y += 5;
        }
        
        if (stat.top_actions && stat.top_actions.length > 0) {
          doc.text(`Top Actions: ${stat.top_actions.slice(0, 3).map(([action, count]) => `${action}(${count})`).join(', ')}`, 30, y);
          y += 5;
        }
        
        y += 3;
      });
      
      doc.save(`user_activity_report_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      console.error('PDF export error:', error);
      toast.error('Failed to generate PDF report: ' + error.message);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        icon={BarChart3}
        eyebrow="Admin"
        title="User Activity Report"
        description="Comprehensive analytics on user engagement and activity"
        favoritePage="UserActivityReport"
      />

      <EmbeddedPage>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            <TabsTrigger value="report" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <BarChart3 className="h-4 w-4 mr-2" />
              Report
            </TabsTrigger>
            <TabsTrigger value="log" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Archive className="h-4 w-4 mr-2" />
              Activity Log
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="report" className="space-y-4 sm:space-y-6">
          {isLoading ? (
            <LoadingState label="Loading activity data..." className="py-24" />
          ) : (
            <>
        {/* Export Actions */}
        <div className="flex justify-end gap-2">
          <Button onClick={exportToCSV} variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button onClick={exportToPDF} variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export PDF
          </Button>
        </div>

        {/* Overall Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard label="Total Users" value={overallStats.total_users} icon={User} tone="navy" />
          <StatCard label="Total Actions" value={overallStats.total_actions} icon={MousePointer} tone="emerald" />
          <StatCard label="Total Logins" value={overallStats.total_logins} icon={LogIn} tone="slate" />
          <StatCard label="Active (7 days)" value={overallStats.active_users} icon={Activity} tone="amber" />
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="activity-time-range" className="text-sm font-medium mb-2 block">Time Range</label>
                <Select value={timeRange} onValueChange={setTimeRange}>
                  <SelectTrigger id="activity-time-range">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                    <SelectItem value="180">Last 6 months</SelectItem>
                    <SelectItem value="all">All time</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label htmlFor="activity-sort-by" className="text-sm font-medium mb-2 block">Sort By</label>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger id="activity-sort-by">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="total_actions">Total Actions</SelectItem>
                    <SelectItem value="logins">Logins</SelectItem>
                    <SelectItem value="pages">Pages Visited</SelectItem>
                    <SelectItem value="last_activity">Last Activity</SelectItem>
                    <SelectItem value="name">Name (A-Z)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label htmlFor="activity-search-users" className="text-sm font-medium mb-2 block">Search Users</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="activity-search-users"
                    placeholder="Search by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* User Activity Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5" />
              User Activity Details ({processedStats.length} users)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px]">
              <div className="space-y-3">
                {processedStats.map((stat, idx) => (
                  <Card key={stat.email} className="bg-white">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-navy-600 rounded-full flex items-center justify-center text-white font-bold">
                            {(stat.name || '?').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900">{stat.name}</p>
                            <p className="text-sm text-slate-500">{stat.email}</p>
                          </div>
                        </div>
                        <Badge variant="outline" className="bg-blue-50 text-blue-700">
                          Rank #{idx + 1}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
                        <div className="p-3 bg-emerald-50 rounded-lg">
                          <p className="text-xs text-emerald-600 font-medium">Total Actions</p>
                          <p className="text-2xl font-bold text-emerald-900">{stat.total_actions}</p>
                        </div>
                        <div className="p-3 bg-navy-50 rounded-lg">
                          <p className="text-xs text-navy-600 font-medium">Logins</p>
                          <p className="text-2xl font-bold text-navy-900">{stat.logins}</p>
                        </div>
                        <div className="p-3 bg-blue-50 rounded-lg">
                          <p className="text-xs text-blue-600 font-medium">Pages</p>
                          <p className="text-2xl font-bold text-blue-900">{stat.pages_visited_count}</p>
                        </div>
                        <div className="p-3 bg-orange-50 rounded-lg">
                          <p className="text-xs text-orange-600 font-medium">Entities</p>
                          <p className="text-2xl font-bold text-orange-900">{stat.entities_interacted_count}</p>
                        </div>
                        <div className="p-3 bg-slate-50 rounded-lg">
                          <p className="text-xs text-slate-600 font-medium">Last Active</p>
                          <p className="text-xs font-bold text-slate-900 mt-1">
                            <Clock className="w-3 h-3 inline mr-1" />
                            {formatDistanceToNow(new Date(stat.last_activity), { addSuffix: true })}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div>
                          <p className="text-xs font-medium text-slate-600 mb-1">Top Actions:</p>
                          <div className="flex flex-wrap gap-1">
                            {stat.top_actions.slice(0, 5).map(([action, count]) => (
                              <Badge key={action} variant="outline" className="text-xs">
                                {action} ({count})
                              </Badge>
                            ))}
                          </div>
                        </div>

                        {stat.pages_visited_list.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-slate-600 mb-1">Pages Visited:</p>
                            <div className="flex flex-wrap gap-1">
                              {stat.pages_visited_list.slice(0, 6).map(page => (
                                <Badge key={page} variant="outline" className="text-xs bg-blue-50">
                                  {page}
                                </Badge>
                              ))}
                              {stat.pages_visited_list.length > 6 && (
                                <Badge variant="outline" className="text-xs">
                                  +{stat.pages_visited_list.length - 6} more
                                </Badge>
                              )}
                            </div>
                          </div>
                        )}

                        {stat.entities_interacted_list.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-slate-600 mb-1">Entities Interacted:</p>
                            <div className="flex flex-wrap gap-1">
                              {stat.entities_interacted_list.map(entity => (
                                <Badge key={entity} variant="outline" className="text-xs bg-emerald-50">
                                  {entity}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {processedStats.length === 0 && (
                  <EmptyState icon={Activity} title="No user activity found" description="No activity matches your current criteria." />
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="log">
          <Suspense fallback={tabLoader}>
            <UserActivityLog />
          </Suspense>
        </TabsContent>
      </Tabs>
      </EmbeddedPage>
    </PageContainer>
  );
}