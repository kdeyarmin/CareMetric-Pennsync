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
import AIAdminAnomalyDetector from "../components/admin/AIAdminAnomalyDetector";
import DetailedAuditTrailViewer from "../components/admin/DetailedAuditTrailViewer";
import UserManagement from "../components/admin/UserManagement";
import RegulatoryComplianceManager from "../components/admin/RegulatoryComplianceManager";
import ProviderSettingsManager from "../components/admin/ProviderSettingsManager";
import AIModelConfigurationManager from "../components/admin/AIModelConfigurationManager";
import TrainingProgressDashboard from "../components/training/TrainingProgressDashboard";

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

  const { data: auditLogs = [] } = useQuery({
    queryKey: ['auditLogs'],
    queryFn: () => base44.entities.AuditTrail.list('-timestamp', 200),
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
    onError: (error) => {
      alert('Failed to update user role. Please try again.');
    }
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
        <Alert className="border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900">
           <AlertTriangle className="w-5 h-5 text-slate-700 dark:text-slate-400" />
           <AlertDescription className="text-slate-900 dark:text-slate-100">
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
         <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">Admin Dashboard</h1>
         <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400">Manage users, monitor system, and view security logs</p>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6 sm:mb-8">
        <Card className="bg-slate-600 dark:bg-slate-700 text-white border-none shadow-lg">
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-200 text-xs sm:text-sm font-medium mb-1">Total Users</p>
                <p className="text-2xl sm:text-3xl md:text-4xl font-bold">{totalUsers}</p>
                <p className="text-slate-200 text-xs mt-1">{adminUsers} admins</p>
                </div>
                <Users className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-slate-300" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-500 dark:bg-slate-600 text-white border-none shadow-lg">
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-100 text-xs sm:text-sm font-medium mb-1">Active Patients</p>
                <p className="text-2xl sm:text-3xl md:text-4xl font-bold">{activePatients}</p>
                <p className="text-slate-100 text-xs mt-1">of {patients.length} total</p>
                </div>
                <Activity className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-slate-300" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-400 dark:bg-slate-600 text-white border-none shadow-lg">
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-100 text-xs sm:text-sm font-medium mb-1">Visits This Week</p>
                <p className="text-2xl sm:text-3xl md:text-4xl font-bold">{visitsThisWeek}</p>
                <p className="text-slate-100 text-xs mt-1">{completedVisits} total completed</p>
              </div>
              <CheckCircle2 className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-purple-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-300 dark:bg-slate-600 text-white border-none shadow-lg">
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-100 text-xs sm:text-sm font-medium mb-1">Avg Doc Time</p>
                <p className="text-2xl sm:text-3xl md:text-4xl font-bold">{Math.round(avgDocTime)}</p>
                <p className="text-slate-100 text-xs mt-1">minutes</p>
                </div>
                <Database className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-slate-300" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-9 gap-1 sm:gap-2 h-auto">
          <TabsTrigger value="overview" className="text-xs sm:text-sm py-2 sm:py-3">Overview</TabsTrigger>
          <TabsTrigger value="users" className="text-xs sm:text-sm py-2 sm:py-3">Users</TabsTrigger>
          <TabsTrigger value="training" className="text-xs sm:text-sm py-2 sm:py-3">Training</TabsTrigger>
          <TabsTrigger value="providers" className="text-xs sm:text-sm py-2 sm:py-3">Providers</TabsTrigger>
          <TabsTrigger value="ai-models" className="text-xs sm:text-sm py-2 sm:py-3">
            <span className="hidden md:inline">AI Models</span>
            <span className="md:hidden">AI</span>
          </TabsTrigger>
          <TabsTrigger value="compliance" className="text-xs sm:text-sm py-2 sm:py-3">
            <span className="hidden md:inline">Compliance Rules</span>
            <span className="md:hidden">Rules</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="text-xs sm:text-sm py-2 sm:py-3">Audit</TabsTrigger>
          <TabsTrigger value="security" className="text-xs sm:text-sm py-2 sm:py-3">
            <span className="hidden md:inline">Security Logs</span>
            <span className="md:hidden">Security</span>
          </TabsTrigger>
          <TabsTrigger value="encryption" className="text-xs sm:text-sm py-2 sm:py-3">
            <span className="hidden lg:inline">Encryption</span>
            <span className="lg:hidden">Encrypt</span>
          </TabsTrigger>
          <TabsTrigger value="data" className="text-xs sm:text-sm py-2 sm:py-3">Data</TabsTrigger>
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
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-base sm:text-lg">System Health</CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <div className="space-y-3 sm:space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 sm:p-4 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-300 dark:border-slate-700">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6 text-slate-700 dark:text-slate-400 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-sm sm:text-base text-slate-900 dark:text-slate-100">System Online</p>
                      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">All services operational</p>
                    </div>
                  </div>
                  <Badge className="bg-slate-300 text-slate-900 dark:bg-slate-700 dark:text-slate-100 text-xs sm:text-sm">Healthy</Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                  <div className="p-4 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-300 dark:border-slate-700">
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Database Records</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                      {patients.length + visits.length + users.length}
                    </p>
                  </div>
                  <div className="p-4 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-300 dark:border-slate-700">
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Security Events (Last 100)</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{securityLogs.length}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-base sm:text-lg">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <div className="space-y-2 sm:space-y-3">
                {visits.slice(0, 5).map((visit) => {
                  const patient = patients.find(p => p.id === visit.patient_id);
                  return (
                    <div key={visit.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-3 bg-slate-100 dark:bg-slate-900 rounded-lg">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm sm:text-base text-slate-900 dark:text-slate-100 break-words">
                          Visit: {patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown Patient'}
                        </p>
                        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                          {visit.visit_date} • {visit.visit_type.replace(/_/g, ' ')}
                        </p>
                      </div>
                      <Badge className={`flex-shrink-0 text-xs ${
                        visit.status === 'completed' ? 'bg-slate-300 text-slate-900 dark:bg-slate-700 dark:text-slate-100' :
                        visit.status === 'in_progress' ? 'bg-slate-300 text-slate-900 dark:bg-slate-700 dark:text-slate-100' :
                        'bg-slate-300 text-slate-900 dark:bg-slate-700 dark:text-slate-100'
                      }`}>
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

          <UserManagement users={users} currentUser={currentUser} />
        </TabsContent>

        {/* Training Management Tab */}
        <TabsContent value="training" className="space-y-6">
          {currentUser && <TrainingProgressDashboard />}
        </TabsContent>

        {/* Provider Settings Tab */}
        <TabsContent value="providers" className="space-y-6">
          <ProviderSettingsManager />
        </TabsContent>

        {/* AI Model Configuration Tab */}
        <TabsContent value="ai-models" className="space-y-6">
          <AIModelConfigurationManager />
        </TabsContent>

        {/* Compliance Rules Management Tab */}
        <TabsContent value="compliance" className="space-y-6">
          <RegulatoryComplianceManager />
        </TabsContent>

        {/* Audit Trail Tab */}
        <TabsContent value="audit" className="space-y-6">
          {/* AI Anomaly Detection for Admin Actions */}
          <AIAdminAnomalyDetector auditLogs={auditLogs} />

          {/* Detailed Audit Trail Viewer */}
          <DetailedAuditTrailViewer auditLogs={auditLogs} />
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
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                <Shield className="w-4 h-4 sm:w-5 sm:h-5" />
                Security Event Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                {Object.entries(securityEventCounts)
                  .sort(([,a], [,b]) => b - a)
                  .slice(0, 6)
                  .map(([action, count]) => (
                    <div key={action} className="p-4 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-300 dark:border-slate-700">
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">{action.replace(/_/g, ' ')}</p>
                      <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{count}</p>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-base sm:text-lg">Recent Security Events</CardTitle>
            </CardHeader>
            <CardContent className="p-0 sm:p-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs sm:text-sm">Timestamp</TableHead>
                      <TableHead className="text-xs sm:text-sm">User</TableHead>
                      <TableHead className="text-xs sm:text-sm">Action</TableHead>
                      <TableHead className="hidden md:table-cell text-xs sm:text-sm">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
                  {securityLogs.slice(0, 20).map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs sm:text-sm whitespace-nowrap">
                        <span className="hidden sm:inline">{format(new Date(log.timestamp), 'MMM d, yyyy HH:mm:ss')}</span>
                        <span className="sm:hidden">{format(new Date(log.timestamp), 'MMM d HH:mm')}</span>
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm max-w-[100px] sm:max-w-none truncate">{log.user_email}</TableCell>
                      <TableCell>
                        <Badge variant={
                          log.action.includes('UNAUTHORIZED') || log.action.includes('ERROR') 
                            ? 'destructive' 
                            : 'outline'
                        } className="text-xs">
                          <span className="hidden sm:inline">{log.action}</span>
                          <span className="sm:hidden">{log.action.substring(0, 10)}</span>
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs sm:text-sm text-gray-600 max-w-[200px] truncate">
                        {log.details ? JSON.stringify(log.details).substring(0, 50) + '...' : 'N/A'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
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
                    <span className="text-sm text-slate-600 dark:text-slate-400">Active</span>
                    <span className="font-bold">{activePatients}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">Home Health</span>
                    <span className="font-bold">
                      {patients.filter(p => p.care_type === 'home_health').length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">Hospice</span>
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
                    <span className="text-sm text-slate-600 dark:text-slate-400">Completed</span>
                    <span className="font-bold">{completedVisits}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">Scheduled</span>
                    <span className="font-bold">
                      {visits.filter(v => v.status === 'scheduled').length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">In Progress</span>
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
                    <span className="text-sm text-slate-600 dark:text-slate-400">Users</span>
                    <span className="font-bold">{users.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">Security Logs</span>
                    <span className="font-bold">{securityLogs.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">Care Plans</span>
                    <span className="font-bold">N/A</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">Storage Used</span>
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