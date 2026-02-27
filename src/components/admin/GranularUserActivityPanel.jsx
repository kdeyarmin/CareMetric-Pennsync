import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Activity, User, FileText, Search, RefreshCw,
  Eye, Edit, Trash2, Plus, LogIn, MousePointer,
  Clock, ChevronDown, ChevronUp, BarChart3, Calendar,
  TrendingUp, AlertTriangle, CheckCircle2, Shield, Zap
} from "lucide-react";
import { formatEastern } from "../utils/timezone";
import { format, subDays, differenceInHours, differenceInMinutes } from "date-fns";

const ACTION_COLORS = {
  view: "bg-blue-100 text-blue-800",
  create: "bg-green-100 text-green-800",
  update: "bg-amber-100 text-amber-800",
  delete: "bg-red-100 text-red-800",
  login: "bg-purple-100 text-purple-800",
  page_visit: "bg-slate-100 text-slate-700",
  enhance: "bg-indigo-100 text-indigo-800",
  audit: "bg-orange-100 text-orange-800",
};

const ACTION_ICONS = {
  view: Eye, create: Plus, update: Edit, delete: Trash2,
  login: LogIn, page_visit: MousePointer, enhance: Zap, audit: Shield
};

function ActionIcon({ action, className = "w-3.5 h-3.5" }) {
  const Icon = ACTION_ICONS[action] || Activity;
  return <Icon className={className} />;
}

function TimeAgo({ date }) {
  if (!date) return null;
  const d = new Date(date);
  const now = new Date();
  const mins = differenceInMinutes(now, d);
  const hrs = differenceInHours(now, d);
  if (mins < 2) return <span className="text-green-600 font-medium">just now</span>;
  if (mins < 60) return <span>{mins}m ago</span>;
  if (hrs < 24) return <span>{hrs}h ago</span>;
  return <span>{format(d, "MMM d")}</span>;
}

function UserActivityCard({ user, activities, visits, noteConversions, complianceAudits, trainingCompletions, tasks }) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState("timeline");

  const userEmail = user.email;

  const userActivity = useMemo(() => activities.filter(a => a.user_email === userEmail), [activities, userEmail]);
  const userVisits = useMemo(() => visits.filter(v => v.created_by === userEmail || v.nurse_email === userEmail), [visits, userEmail]);
  const userNotes = useMemo(() => noteConversions.filter(n => n.nurse_email === userEmail), [noteConversions, userEmail]);
  const userAudits = useMemo(() => complianceAudits.filter(a => a.nurse_email === userEmail), [complianceAudits, userEmail]);
  const userTraining = useMemo(() => trainingCompletions.filter(t => t.nurse_email === userEmail), [trainingCompletions, userEmail]);
  const userTasks = useMemo(() => tasks.filter(t => t.assigned_to === userEmail || t.created_by === userEmail), [tasks, userEmail]);

  const lastActive = userActivity[0]?.created_date;
  const lastLogin = userActivity.find(a => a.action === 'login')?.created_date;

  const minsAgoLastActive = lastActive ? differenceInMinutes(new Date(), new Date(lastActive)) : null;
  const isOnline = minsAgoLastActive !== null && minsAgoLastActive < 30;

  const avgCompliance = userAudits.length > 0
    ? Math.round(userAudits.reduce((s, a) => s + (a.compliance_score || 0), 0) / userAudits.length)
    : null;

  const avgQuality = userNotes.length > 0
    ? Math.round(userNotes.reduce((s, n) => s + (n.quality_score || 0), 0) / userNotes.length)
    : null;

  // Action breakdown
  const actionCounts = useMemo(() => {
    const counts = {};
    userActivity.forEach(a => { counts[a.action] = (counts[a.action] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [userActivity]);

  // Page visits breakdown
  const pageVisits = useMemo(() => {
    const counts = {};
    userActivity.filter(a => a.page).forEach(a => { counts[a.page] = (counts[a.page] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [userActivity]);

  // Activity by day (last 7 days)
  const dailyActivity = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const day = subDays(new Date(), 6 - i);
      const dayStr = format(day, "yyyy-MM-dd");
      const count = userActivity.filter(a => a.created_date?.startsWith(dayStr)).length;
      return { label: format(day, "EEE"), count };
    });
  }, [userActivity]);

  const maxDailyCount = Math.max(...dailyActivity.map(d => d.count), 1);

  const overdueTasks = userTasks.filter(t => t.status !== "completed" && t.due_date && new Date(t.due_date) < new Date()).length;

  return (
    <Card className={`transition-all ${isOnline ? "border-green-300" : ""}`}>
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="relative flex-shrink-0">
              <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
                {(user.full_name || user.email || "?")[0].toUpperCase()}
              </div>
              {isOnline && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-sm text-slate-800 truncate">{user.full_name || user.email}</span>
                <Badge variant="outline" className="text-[10px] px-1.5">{user.role || "user"}</Badge>
                {isOnline && <Badge className="bg-green-100 text-green-700 text-[10px] px-1.5">● Online</Badge>}
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                <span className="truncate">{user.email}</span>
                {lastActive && (
                  <span className="flex-shrink-0 flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" />
                    <TimeAgo date={lastActive} />
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Quick stats */}
          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            <div className="text-center px-2">
              <div className="text-base font-bold text-slate-800">{userActivity.length}</div>
              <div className="text-[9px] text-slate-500">Actions</div>
            </div>
            <div className="text-center px-2">
              <div className="text-base font-bold text-slate-800">{userVisits.length}</div>
              <div className="text-[9px] text-slate-500">Visits</div>
            </div>
            <div className="text-center px-2">
              <div className="text-base font-bold text-slate-800">{userNotes.length}</div>
              <div className="text-[9px] text-slate-500">Notes</div>
            </div>
            {avgCompliance !== null && (
              <div className="text-center px-2">
                <div className={`text-base font-bold ${avgCompliance >= 80 ? "text-green-700" : avgCompliance >= 60 ? "text-amber-700" : "text-red-700"}`}>{avgCompliance}%</div>
                <div className="text-[9px] text-slate-500">Compliance</div>
              </div>
            )}
            {overdueTasks > 0 && (
              <div className="text-center px-2">
                <div className="text-base font-bold text-red-600">{overdueTasks}</div>
                <div className="text-[9px] text-slate-500">Overdue</div>
              </div>
            )}
          </div>

          <button onClick={() => setExpanded(!expanded)} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-3 pt-0">
          <div className="border-t border-slate-100 pt-3 space-y-3">
            {/* Sub tabs */}
            <div className="flex gap-1 flex-wrap">
              {["timeline", "pages", "actions", "performance", "tasks"].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-2.5 py-1 text-[11px] rounded-md border transition-colors capitalize ${activeTab === tab ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Timeline Tab */}
            {activeTab === "timeline" && (
              <div>
                <div className="flex items-end gap-1 mb-3 h-12">
                  {dailyActivity.map((day, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                      <div
                        className="w-full bg-blue-400 rounded-t"
                        style={{ height: `${(day.count / maxDailyCount) * 40}px`, minHeight: day.count > 0 ? "4px" : "0" }}
                        title={`${day.count} actions`}
                      />
                      <span className="text-[9px] text-slate-400">{day.label}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {userActivity.slice(0, 20).map((act, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <div className={`p-1 rounded-full flex-shrink-0 ${ACTION_COLORS[act.action] || "bg-slate-100 text-slate-600"}`}>
                        <ActionIcon action={act.action} className="w-3 h-3" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-slate-700">{act.action}</span>
                        {act.page && <span className="text-slate-400 ml-1">on {act.page}</span>}
                        {act.details?.description && <span className="text-slate-400 ml-1">• {act.details.description}</span>}
                      </div>
                      <span className="text-slate-400 flex-shrink-0 text-[10px]">
                        {act.created_date ? format(new Date(act.created_date), "MMM d, h:mm a") : ""}
                      </span>
                    </div>
                  ))}
                  {userActivity.length === 0 && <p className="text-slate-400 text-xs py-3 text-center">No recorded activity</p>}
                </div>
              </div>
            )}

            {/* Pages Tab */}
            {activeTab === "pages" && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Most Visited Pages</p>
                {pageVisits.length === 0 && <p className="text-slate-400 text-xs py-2 text-center">No page data</p>}
                {pageVisits.map(([page, count], i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-slate-600 flex-1 truncate">{page}</span>
                    <Progress value={(count / (pageVisits[0]?.[1] || 1)) * 100} className="w-20 h-1.5" />
                    <span className="text-xs font-medium text-slate-700 w-8 text-right">{count}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Actions Tab */}
            {activeTab === "actions" && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Action Breakdown</p>
                {actionCounts.length === 0 && <p className="text-slate-400 text-xs py-2 text-center">No data</p>}
                {actionCounts.map(([action, count]) => (
                  <div key={action} className="flex items-center gap-2">
                    <div className={`p-1 rounded flex-shrink-0 ${ACTION_COLORS[action] || "bg-slate-100 text-slate-600"}`}>
                      <ActionIcon action={action} className="w-2.5 h-2.5" />
                    </div>
                    <span className="text-xs text-slate-600 flex-1 capitalize">{action.replace(/_/g, " ")}</span>
                    <Progress value={(count / (actionCounts[0]?.[1] || 1)) * 100} className="w-20 h-1.5" />
                    <span className="text-xs font-medium text-slate-700 w-8 text-right">{count}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Performance Tab */}
            {activeTab === "performance" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-200">
                    <div className="text-lg font-bold text-slate-800">{userNotes.length}</div>
                    <div className="text-[10px] text-slate-500">Notes Enhanced</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-200">
                    <div className={`text-lg font-bold ${avgQuality !== null ? (avgQuality >= 80 ? "text-green-700" : "text-amber-700") : "text-slate-400"}`}>
                      {avgQuality !== null ? `${avgQuality}%` : "—"}
                    </div>
                    <div className="text-[10px] text-slate-500">Avg Quality</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-200">
                    <div className={`text-lg font-bold ${avgCompliance !== null ? (avgCompliance >= 80 ? "text-green-700" : "text-amber-700") : "text-slate-400"}`}>
                      {avgCompliance !== null ? `${avgCompliance}%` : "—"}
                    </div>
                    <div className="text-[10px] text-slate-500">Avg Compliance</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-200">
                    <div className="text-lg font-bold text-slate-800">{userTraining.filter(t => t.status === "completed").length}</div>
                    <div className="text-[10px] text-slate-500">Training Done</div>
                  </div>
                </div>
                {/* Login history */}
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Recent Logins</p>
                  {userActivity.filter(a => a.action === 'login').slice(0, 5).map((a, i) => (
                    <div key={i} className="flex justify-between items-center py-1 border-b border-slate-100 text-xs">
                      <span className="text-slate-600">{a.created_date ? format(new Date(a.created_date), "MMM d, yyyy h:mm a") : ""}</span>
                      {a.details?.ip_address && <span className="text-slate-400">{a.details.ip_address}</span>}
                    </div>
                  ))}
                  {userActivity.filter(a => a.action === 'login').length === 0 && (
                    <p className="text-slate-400 text-xs">No login events recorded</p>
                  )}
                </div>
              </div>
            )}

            {/* Tasks Tab */}
            {activeTab === "tasks" && (
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {userTasks.length === 0 && <p className="text-slate-400 text-xs py-2 text-center">No tasks found</p>}
                {userTasks.slice(0, 15).map((task, i) => {
                  const isOverdue = task.status !== "completed" && task.due_date && new Date(task.due_date) < new Date();
                  return (
                    <div key={i} className={`flex items-center gap-2 p-2 rounded border text-xs ${isOverdue ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"}`}>
                      {task.status === "completed" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                      ) : isOverdue ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      )}
                      <span className={`flex-1 truncate ${task.status === "completed" ? "line-through text-slate-400" : "text-slate-700"}`}>{task.title}</span>
                      {task.due_date && (
                        <span className={`flex-shrink-0 ${isOverdue ? "text-red-600 font-medium" : "text-slate-400"}`}>
                          {format(new Date(task.due_date), "MMM d")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function GranularUserActivityPanel() {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("last_active");
  const [filterRole, setFilterRole] = useState("all");

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ["allUsers"],
    queryFn: () => base44.entities.User.list(),
  });

  const { data: activities = [], refetch, isLoading: actLoading } = useQuery({
    queryKey: ["allUserActivitiesGranular"],
    queryFn: () => base44.entities.UserActivity.list("-created_date", 500),
  });

  const { data: visits = [] } = useQuery({
    queryKey: ["allVisits"],
    queryFn: () => base44.entities.Visit.list("-visit_date", 200),
  });

  const { data: noteConversions = [] } = useQuery({
    queryKey: ["allNoteConversions"],
    queryFn: () => base44.entities.NoteConversion.list("-created_date", 200),
  });

  const { data: complianceAudits = [] } = useQuery({
    queryKey: ["allComplianceAudits"],
    queryFn: () => base44.entities.ComplianceAudit.list("-audit_date", 200),
  });

  const { data: trainingCompletions = [] } = useQuery({
    queryKey: ["allTrainingCompletions"],
    queryFn: () => base44.entities.TrainingCompletion.list(),
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["allTasks"],
    queryFn: () => base44.entities.Task.list(),
  });

  // Compute last-active per user
  const lastActiveMap = useMemo(() => {
    const map = {};
    activities.forEach(a => {
      if (!map[a.user_email] || new Date(a.created_date) > new Date(map[a.user_email])) {
        map[a.user_email] = a.created_date;
      }
    });
    return map;
  }, [activities]);

  const activityCountMap = useMemo(() => {
    const map = {};
    activities.forEach(a => { map[a.user_email] = (map[a.user_email] || 0) + 1; });
    return map;
  }, [activities]);

  const filteredUsers = useMemo(() => {
    let filtered = users.filter(u => {
      const matchSearch = !searchTerm
        || u.email?.toLowerCase().includes(searchTerm.toLowerCase())
        || u.full_name?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchRole = filterRole === "all" || u.role === filterRole;
      return matchSearch && matchRole;
    });

    filtered = [...filtered].sort((a, b) => {
      if (sortBy === "last_active") {
        const aTime = lastActiveMap[a.email] ? new Date(lastActiveMap[a.email]).getTime() : 0;
        const bTime = lastActiveMap[b.email] ? new Date(lastActiveMap[b.email]).getTime() : 0;
        return bTime - aTime;
      }
      if (sortBy === "activity_count") {
        return (activityCountMap[b.email] || 0) - (activityCountMap[a.email] || 0);
      }
      if (sortBy === "name") {
        return (a.full_name || a.email).localeCompare(b.full_name || b.email);
      }
      return 0;
    });

    return filtered;
  }, [users, searchTerm, filterRole, sortBy, lastActiveMap, activityCountMap]);

  // Summary stats
  const onlineCount = users.filter(u => {
    const la = lastActiveMap[u.email];
    return la && differenceInMinutes(new Date(), new Date(la)) < 30;
  }).length;

  const uniqueRoles = [...new Set(users.map(u => u.role).filter(Boolean))];

  return (
    <div className="space-y-4">
      {/* Header summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-3 text-center">
            <div className="text-xl font-bold text-blue-700">{users.length}</div>
            <div className="text-[10px] text-blue-600">Total Users</div>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-3 text-center">
            <div className="text-xl font-bold text-green-700">{onlineCount}</div>
            <div className="text-[10px] text-green-600">Active Now (&lt;30m)</div>
          </CardContent>
        </Card>
        <Card className="bg-purple-50 border-purple-200">
          <CardContent className="p-3 text-center">
            <div className="text-xl font-bold text-purple-700">{activities.length}</div>
            <div className="text-[10px] text-purple-600">Tracked Events</div>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-3 text-center">
            <div className="text-xl font-bold text-amber-700">
              {users.filter(u => {
                const la = lastActiveMap[u.email];
                return !la || differenceInMinutes(new Date(), new Date(la)) > 60 * 24 * 7;
              }).length}
            </div>
            <div className="text-[10px] text-amber-600">Inactive 7+ Days</div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <Input
            placeholder="Search users..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={filterRole} onValueChange={setFilterRole}>
          <SelectTrigger className="w-28 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {uniqueRoles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="last_active">Last Active</SelectItem>
            <SelectItem value="activity_count">Most Active</SelectItem>
            <SelectItem value="name">Name A-Z</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="h-8 text-xs px-2">
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
        </Button>
      </div>

      {/* User cards */}
      {(usersLoading || actLoading) ? (
        <div className="text-center py-12 text-slate-500 text-sm">Loading user activity...</div>
      ) : (
        <div className="space-y-2">
          {filteredUsers.map(user => (
            <UserActivityCard
              key={user.id}
              user={user}
              activities={activities}
              visits={visits}
              noteConversions={noteConversions}
              complianceAudits={complianceAudits}
              trainingCompletions={trainingCompletions}
              tasks={tasks}
            />
          ))}
          {filteredUsers.length === 0 && (
            <div className="text-center py-12 text-slate-500 text-sm">No users match your search.</div>
          )}
        </div>
      )}
    </div>
  );
}