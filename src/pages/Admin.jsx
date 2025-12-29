import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield,
  Users,
  Activity,
  Database,
  Settings,
  AlertTriangle,
  CheckCircle2,
  UserPlus,
  Search,
  Eye,
  Trash2,
  Mail,
  Key
} from "lucide-react";
import { format } from "date-fns";
import SecurityEncryptionCheck from "../components/admin/SecurityEncryptionCheck";
import AIAnomalyDetector from "../components/admin/AIAnomalyDetector";
import AIRoleSuggestions from "../components/admin/AIRoleSuggestions";
import AISystemHealthSummary from "../components/admin/AISystemHealthSummary";
import UserPasswordReset from "../components/admin/UserPasswordReset";

export default function Admin() {
  const queryClient = useQueryClient();
  const [isAdmin, setIsAdmin] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTab, setSelectedTab] = useState("overview");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("user");

  // Check if current user is admin
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const user = await base44.auth.me();
      setIsAdmin(user.role === 'admin');
      return user;
    },
  });

  // Fetch all users
  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list('-created_date'),
    initialData: [],
    enabled: isAdmin === true,
  });

  // Fetch all patients
  const { data: patients } = useQuery({
    queryKey: ['allPatients'],
    queryFn: () => base44.entities.Patient.list('-created_date'),
    initialData: [],
    enabled: isAdmin === true,
  });

  // Fetch all visits
  const { data: visits } = useQuery({
    queryKey: ['allVisits'],
    queryFn: () => base44.entities.Visit.list('-visit_date', 200),
    initialData: [],
    enabled: isAdmin === true,
  });

  // Fetch security logs
  const { data: securityLogs } = useQuery({
    queryKey: ['securityLogs'],
    queryFn: () => base44.entities.SecurityLog.list('-timestamp', 100),
    initialData: [],
    enabled: isAdmin === true,
  });

  const { data: userActivity = [] } = useQuery({
    queryKey: ['userActivity'],
    queryFn: () => base44.entities.UserActivity.list('-created_date', 200),
    initialData: [],
    enabled: isAdmin === true,
  });

  // Update user role mutation
  const updateUserRoleMutation = useMutation({
    mutationFn: ({ userId, role }) => base44.entities.User.update(userId, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allUsers'] });
      alert('User role updated successfully');
    },
  });

  // Calculate metrics
  const totalUsers = users.length;
  const adminUsers = users.filter(u => u.role === 'admin').length;
  const activePatients = patients.filter(p => p.status === 'active').length;
  const visitsThisWeek = visits.filter(v => {
    const visitDate = new Date(v.visit_date);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return visitDate >= weekAgo;
  }).length;
  const completedVisits = visits.filter(v => v.status === 'completed').length;
  const avgDocTime = visits
    .filter(v => v.start_time && v.end_time)
    .reduce((sum, v) => {
      const start = new Date(`2000-01-01 ${v.start_time}`);
      const end = new Date(`2000-01-01 ${v.end_time}`);
      const diff = (end - start) / 1000 / 60;
      return sum + diff;
    }, 0) / (completedVisits || 1);

  // Filter users by search
  const filteredUsers = (users || []).filter(user =>
    user && (
      (user.email || '').toLowerCase().includes((searchTerm || '').toLowerCase()) ||
      (user.full_name || '').toLowerCase().includes((searchTerm || '').toLowerCase())
    )
  );

  // Security events by type
  const securityEventCounts = securityLogs.reduce((acc, log) => {
    acc[log.action] = (acc[log.action] || 0) + 1;
    return acc;
  }, {});

  const handleInviteUser = async () => {
    if (!inviteEmail) {
      alert('Please enter an email address');
      return;
    }
    
    try {
      await base44.integrations.Core.SendEmail({
        to: inviteEmail,
        subject: 'Invitation to Join PennCares',
        body: `You have been invited to join PennCares as a ${inviteRole === 'admin' ? 'Administrator' : 'User'}.
        
Please visit the app to create your account and start documenting patient visits.

Role: ${inviteRole === 'admin' ? 'Administrator' : 'User'}

If you have any questions, please contact your administrator.`,
        from_name: 'PennCares Admin'
      });
      
      alert('Invitation sent successfully!');
      setInviteEmail('');
    } catch (error) {
      console.error('Failed to send invite:', error);
      alert('Failed to send invitation. Please try again.');
    }
  };

  // Check if user is admin
  if (isAdmin === null) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center text-gray-500">
            Checking permissions...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <Alert className="border-red-300 bg-red-50">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <AlertDescription className="text-red-900">
            <p className="font-semibold mb-2">Access Denied</p>
            <p>You do not have administrator privileges to access this page.</p>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Admin Dashboard</h1>
        <p className="text-sm sm:text-base text-gray-600">Manage users, monitor system, and view security logs</p>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6 sm:mb-8">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white border-none shadow-lg">
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-xs sm:text-sm font-medium mb-1">Total Users</p>
                <p className="text-2xl sm:text-3xl md:text-4xl font-bold">{totalUsers}</p>
                <p className="text-blue-100 text-xs mt-1">{adminUsers} admins</p>
              </div>
              <Users className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-blue-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white border-none shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm font-medium mb-1">Active Patients</p>
                <p className="text-4xl font-bold">{activePatients}</p>
                <p className="text-green-100 text-xs mt-1">of {patients.length} total</p>
              </div>
              <Activity className="w-12 h-12 text-green-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white border-none shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-sm font-medium mb-1">Visits This Week</p>
                <p className="text-4xl font-bold">{visitsThisWeek}</p>
                <p className="text-purple-100 text-xs mt-1">{completedVisits} total completed</p>
              </div>
              <CheckCircle2 className="w-12 h-12 text-purple-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white border-none shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-orange-100 text-sm font-medium mb-1">Avg Doc Time</p>
                <p className="text-4xl font-bold">{Math.round(avgDocTime)}</p>
                <p className="text-orange-100 text-xs mt-1">minutes</p>
              </div>
              <Database className="w-12 h-12 text-orange-200" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          <TabsTrigger value="overview" className="text-xs sm:text-sm">Overview</TabsTrigger>
          <TabsTrigger value="users" className="text-xs sm:text-sm">User Management</TabsTrigger>
          <TabsTrigger value="security" className="text-xs sm:text-sm">Security Logs</TabsTrigger>
          <TabsTrigger value="encryption" className="text-xs sm:text-sm">Encryption</TabsTrigger>
          <TabsTrigger value="data" className="text-xs sm:text-sm">Data Browser</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* AI System Health Summary */}
          <AISystemHealthSummary
            totalUsers={totalUsers}
            activePatients={activePatients}
            visitsThisWeek={visitsThisWeek}
            avgDocTime={avgDocTime}
            securityLogs={securityLogs}
          />

          <Card>
            <CardHeader>
              <CardTitle>System Health</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                    <div>
                      <p className="font-semibold text-gray-900">System Online</p>
                      <p className="text-sm text-gray-600">All services operational</p>
                    </div>
                  </div>
                  <Badge className="bg-green-100 text-green-800">Healthy</Badge>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="p-4 bg-gray-50 rounded-lg border">
                    <p className="text-sm text-gray-600 mb-1">Database Records</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {patients.length + visits.length + users.length}
                    </p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg border">
                    <p className="text-sm text-gray-600 mb-1">Security Events (Last 100)</p>
                    <p className="text-2xl font-bold text-gray-900">{securityLogs.length}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {visits.slice(0, 5).map((visit) => {
                  const patient = patients.find(p => p.id === visit.patient_id);
                  return (
                    <div key={visit.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">
                          Visit: {patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown Patient'}
                        </p>
                        <p className="text-sm text-gray-600">
                          {visit.visit_date} • {visit.visit_type.replace(/_/g, ' ')}
                        </p>
                      </div>
                      <Badge className={
                        visit.status === 'completed' ? 'bg-green-100 text-green-800' :
                        visit.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-blue-100 text-blue-800'
                      }>
                        {visit.status}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* User Management Tab */}
        <TabsContent value="users" className="space-y-6">
          {/* AI Role Suggestions */}
          <AIRoleSuggestions users={users} userActivity={userActivity} />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="w-5 h-5" />
                Invite New User
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <Label htmlFor="inviteEmail">Email Address</Label>
                  <Input
                    id="inviteEmail"
                    type="email"
                    placeholder="user@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="inviteRole">Role</Label>
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Administrator</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                onClick={handleInviteUser}
                className="mt-4 bg-blue-600 hover:bg-blue-700"
              >
                <Mail className="w-4 h-4 mr-2" />
                Send Invitation
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>All Users ({filteredUsers.length})</CardTitle>
              <div className="relative mt-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search users by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.full_name || 'N/A'}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <Badge variant={user.role === 'admin' ? 'default' : 'outline'}>
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {format(new Date(user.created_date), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Select
                            value={user.role}
                            onValueChange={(role) => updateUserRoleMutation.mutate({ 
                              userId: user.id, 
                              role 
                            })}
                            disabled={user.id === currentUser?.id}
                          >
                            <SelectTrigger className="w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="user">User</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                          <UserPasswordReset
                            user={user}
                            trigger={
                              <Button size="sm" variant="outline" className="gap-1">
                                <Key className="w-3 h-3" />
                                Reset
                              </Button>
                            }
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Encryption & Security Tab */}
        <TabsContent value="encryption" className="space-y-6">
          <SecurityEncryptionCheck />
        </TabsContent>

        {/* Security Logs Tab */}
        <TabsContent value="security" className="space-y-6">
          {/* AI Anomaly Detection */}
          <AIAnomalyDetector securityLogs={securityLogs} />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Security Event Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4">
                {Object.entries(securityEventCounts)
                  .sort(([,a], [,b]) => b - a)
                  .slice(0, 6)
                  .map(([action, count]) => (
                    <div key={action} className="p-4 bg-gray-50 rounded-lg border">
                      <p className="text-sm text-gray-600 mb-1">{action.replace(/_/g, ' ')}</p>
                      <p className="text-2xl font-bold text-gray-900">{count}</p>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Security Events</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {securityLogs.slice(0, 20).map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm">
                        {format(new Date(log.timestamp), 'MMM d, yyyy HH:mm:ss')}
                      </TableCell>
                      <TableCell className="text-sm">{log.user_email}</TableCell>
                      <TableCell>
                        <Badge variant={
                          log.action.includes('UNAUTHORIZED') || log.action.includes('ERROR') 
                            ? 'destructive' 
                            : 'outline'
                        }>
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {log.details ? JSON.stringify(log.details).substring(0, 50) + '...' : 'N/A'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Data Browser Tab */}
        <TabsContent value="data" className="space-y-6">
          <div className="grid md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Patients</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Total</span>
                    <span className="font-bold">{patients.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Active</span>
                    <span className="font-bold">{activePatients}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Home Health</span>
                    <span className="font-bold">
                      {patients.filter(p => p.care_type === 'home_health').length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Hospice</span>
                    <span className="font-bold">
                      {patients.filter(p => p.care_type === 'hospice').length}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Visits</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Total</span>
                    <span className="font-bold">{visits.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Completed</span>
                    <span className="font-bold">{completedVisits}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Scheduled</span>
                    <span className="font-bold">
                      {visits.filter(v => v.status === 'scheduled').length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">In Progress</span>
                    <span className="font-bold">
                      {visits.filter(v => v.status === 'in_progress').length}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>System</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Users</span>
                    <span className="font-bold">{users.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Security Logs</span>
                    <span className="font-bold">{securityLogs.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Care Plans</span>
                    <span className="font-bold">N/A</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Storage Used</span>
                    <span className="font-bold">N/A</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Alert>
            <Database className="w-4 h-4" />
            <AlertDescription>
              For detailed data management, use the Dashboard → Data tab to view and manage individual records.
            </AlertDescription>
          </Alert>
        </TabsContent>
      </Tabs>
    </div>
  );
}