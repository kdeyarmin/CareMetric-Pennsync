import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search } from 'lucide-react';

const ACTION_TYPES = [
  'login',
  'logout',
  'create',
  'update',
  'delete',
  'view',
  'export',
  'download',
  'upload',
];

export default function EnhancedUserActivityLog() {
  const [selectedRole, setSelectedRole] = useState('all');
  const [selectedAction, setSelectedAction] = useState('all');
  const [searchEmail, setSearchEmail] = useState('');

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['userActivities'],
    queryFn: () => base44.entities.UserActivity.list('-created_date', 500),
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => base44.entities.Role.list(),
  });

  const { data: userPermissions = [] } = useQuery({
    queryKey: ['userPermissions'],
    queryFn: () => base44.entities.UserPermission.list(),
  });

  const filteredActivities = useMemo(() => {
    return activities.filter(activity => {
      const matchesEmail = !searchEmail || activity.user_email?.toLowerCase().includes(searchEmail.toLowerCase());
      const matchesAction = selectedAction === 'all' || activity.action === selectedAction;

      let matchesRole = selectedRole === 'all';
      if (selectedRole !== 'all') {
        const userPerm = userPermissions.find(p => p.user_email === activity.user_email);
        matchesRole = userPerm?.role_name === selectedRole;
      }

      return matchesEmail && matchesAction && matchesRole;
    });
  }, [activities, selectedRole, selectedAction, searchEmail, userPermissions]);

  const getRoleForUser = (email) => {
    return userPermissions.find(p => p.user_email === email)?.role_name || 'N/A';
  };

  const getActionColor = (action) => {
    const colors = {
      login: 'bg-green-100 text-green-800',
      logout: 'bg-gray-100 text-gray-800',
      create: 'bg-blue-100 text-blue-800',
      update: 'bg-yellow-100 text-yellow-800',
      delete: 'bg-red-100 text-red-800',
      view: 'bg-purple-100 text-purple-800',
      export: 'bg-indigo-100 text-indigo-800',
    };
    return colors[action] || 'bg-gray-100 text-gray-800';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Activity Log</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Filter by Role</label>
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                {roles.map(role => (
                  <SelectItem key={role.id} value={role.name}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Filter by Action</label>
            <Select value={selectedAction} onValueChange={setSelectedAction}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {ACTION_TYPES.map(action => (
                  <SelectItem key={action} value={action}>
                    {action.charAt(0).toUpperCase() + action.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Search Email</label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search user email..."
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin h-6 w-6 text-gray-400" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2">User Email</th>
                  <th className="text-left py-2 px-2">Role</th>
                  <th className="text-left py-2 px-2">Action</th>
                  <th className="text-left py-2 px-2">Page</th>
                  <th className="text-left py-2 px-2">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {filteredActivities.length > 0 ? (
                  filteredActivities.map(activity => (
                    <tr key={activity.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-2 font-medium">{activity.user_email}</td>
                      <td className="py-2 px-2">
                        <Badge variant="outline">{getRoleForUser(activity.user_email)}</Badge>
                      </td>
                      <td className="py-2 px-2">
                        <Badge className={getActionColor(activity.action)}>
                          {activity.action}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-gray-600">{activity.page || 'N/A'}</td>
                      <td className="py-2 px-2 text-gray-500 text-xs">
                        {new Date(activity.created_date).toLocaleString()}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="py-8 text-center text-gray-500">
                      No activity logs match the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="text-sm text-gray-600">
          Showing {filteredActivities.length} of {activities.length} activities
        </div>
      </CardContent>
    </Card>
  );
}