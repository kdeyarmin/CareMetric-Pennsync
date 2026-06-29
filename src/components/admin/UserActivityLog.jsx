import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  Calendar,
  Search,
  RefreshCw,
  Eye,
  Edit,
  Trash2,
  Plus,
  LogIn,
  MousePointer
} from "lucide-react";
import { formatEastern } from "../utils/timezone";

export default function UserActivityLog() {
  const [filterUser, setFilterUser] = useState("");
  const [filterAction, setFilterAction] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: activities = [], isLoading, refetch } = useQuery({
    queryKey: ['userActivities'],
    queryFn: () => base44.entities.UserActivity.list('-created_date', 200),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
  });

  const getActionIcon = (action) => {
    const icons = {
      'view': Eye,
      'create': Plus,
      'update': Edit,
      'delete': Trash2,
      'login': LogIn,
      'page_visit': MousePointer
    };
    const Icon = icons[action] || Activity;
    return <Icon className="w-4 h-4" />;
  };

  const getActionColor = (action) => {
    const colors = {
      'view': 'bg-blue-100 text-blue-800',
      'create': 'bg-green-100 text-green-800',
      'update': 'bg-yellow-100 text-yellow-800',
      'delete': 'bg-red-100 text-red-800',
      'login': 'bg-navy-100 text-navy-800',
      'page_visit': 'bg-slate-100 text-slate-800'
    };
    return colors[action] || 'bg-slate-100 text-slate-800';
  };

  const filteredActivities = activities.filter(activity => {
    const matchesUser = !filterUser || activity.user_email === filterUser;
    const matchesAction = filterAction === "all" || activity.action === filterAction;
    const matchesSearch = !searchTerm || 
      activity.user_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      activity.action?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      activity.page?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesUser && matchesAction && matchesSearch;
  });

  const uniqueActions = [...new Set(activities.map(a => a.action))];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-600" />
            User Activity Log
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search activities..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterUser || "all"} onValueChange={(v) => setFilterUser(v === "all" ? "" : v)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filter by user" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.email}>
                  {user.full_name || user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterAction} onValueChange={setFilterAction}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter by action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {uniqueActions.map((action) => (
                <SelectItem key={action} value={action}>
                  {action}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Activity List */}
        {isLoading ? (
          <div className="text-center py-8 text-slate-500">Loading activities...</div>
        ) : filteredActivities.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <Activity className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p>No activities found</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {filteredActivities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <div className={`p-2 rounded-full ${getActionColor(activity.action)}`}>
                  {getActionIcon(activity.action)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-900">
                      {activity.user_name || activity.user_email}
                    </span>
                    <Badge className={getActionColor(activity.action)}>
                      {activity.action}
                    </Badge>
                    {activity.entity_type && (
                      <Badge variant="outline">{activity.entity_type}</Badge>
                    )}
                  </div>
                  <div className="text-sm text-slate-600 mt-1">
                    {activity.page && <span>Page: {activity.page}</span>}
                    {activity.details?.description && (
                      <span className="ml-2">• {activity.details.description}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                    <Calendar className="w-3 h-3" />
                    {formatEastern(activity.created_date, 'MMM d, yyyy h:mm a')} ET
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 text-xs text-slate-500 text-center">
          Showing {filteredActivities.length} of {activities.length} activities
        </div>
      </CardContent>
    </Card>
  );
}