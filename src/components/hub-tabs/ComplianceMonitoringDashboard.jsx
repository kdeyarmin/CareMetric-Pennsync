import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import StatCard from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  Clock,
  FileWarning,
  Award,
  Bell,
  Search,
  TrendingDown,
  Users,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { format, parseISO, differenceInDays } from "date-fns";

export default function ComplianceMonitoringDashboard() {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [selectedUsers, setSelectedUsers] = useState(new Set());
  const _queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: allUsers = [], refetch: refetchUsers } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
    initialData: [],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: trainingAssignments = [], refetch: refetchAssignments } = useQuery({
    queryKey: ['allTrainingAssignments'],
    queryFn: () => base44.entities.TrainingAssignment.list('-updated_date', 500),
    initialData: [],
    refetchInterval: 30000,
  });

  const { data: personnelCredentials = [], refetch: refetchCredentials } = useQuery({
    queryKey: ['allPersonnelCredentials'],
    queryFn: () => base44.entities.PersonnelCredential.list('-updated_date', 500),
    initialData: [],
    refetchInterval: 30000,
  });

  const { data: visits = [], refetch: refetchVisits } = useQuery({
    queryKey: ['allVisits'],
    queryFn: () => base44.entities.Visit.filter({}, '-visit_date', 500),
    initialData: [],
    refetchInterval: 30000,
  });

  const sendNotificationMutation = useMutation({
    mutationFn: async ({ userEmails, message, subject }) => {
      const results = await Promise.all(
        userEmails.map(email => 
          base44.integrations.Core.SendEmail({
            to: email,
            subject: subject,
            body: message
          })
        )
      );
      return results;
    },
    onSuccess: (_, variables) => {
      toast.success(`Notifications sent to ${variables.userEmails.length} employee(s)`);
      setSelectedUsers(new Set());
    },
    onError: () => {
      toast.error("Failed to send notifications");
    }
  });

  // Calculate compliance issues
  const complianceIssues = React.useMemo(() => {
    const issues = [];
    const today = new Date();

    // Check overdue training
    trainingAssignments.forEach(assignment => {
      if (assignment.status !== 'completed' && assignment.due_date) {
        const dueDate = parseISO(assignment.due_date);
        const daysOverdue = differenceInDays(today, dueDate);
        
        if (daysOverdue > 0) {
          const user = allUsers.find(u => u.email === assignment.assigned_to_user_id);
          if (user) {
            issues.push({
              type: 'overdue_training',
              severity: daysOverdue > 30 ? 'critical' : daysOverdue > 14 ? 'high' : 'medium',
              userId: user.email,
              userName: user.full_name,
              userRole: user.role,
              title: assignment.course_title,
              daysOverdue,
              dueDate: assignment.due_date,
              details: `Training "${assignment.course_title}" is ${daysOverdue} days overdue`,
              assignmentId: assignment.id
            });
          }
        }
      }
    });

    // Check expiring/expired credentials
    personnelCredentials.forEach(cred => {
      if (cred.expiration_date) {
        const expDate = parseISO(cred.expiration_date);
        const daysUntilExpiry = differenceInDays(expDate, today);
        
        if (daysUntilExpiry <= 30 || cred.status === 'expired') {
          const user = allUsers.find(u => u.email === cred.user_id);
          if (user) {
            issues.push({
              type: 'expiring_credential',
              severity: daysUntilExpiry <= 0 ? 'critical' : daysUntilExpiry <= 7 ? 'high' : 'medium',
              userId: user.email,
              userName: user.full_name,
              userRole: user.role,
              title: cred.title,
              daysUntilExpiry,
              expirationDate: cred.expiration_date,
              details: daysUntilExpiry <= 0 
                ? `${cred.title} expired ${Math.abs(daysUntilExpiry)} days ago`
                : `${cred.title} expires in ${daysUntilExpiry} days`,
              credentialId: cred.id,
              credentialType: cred.item_type
            });
          }
        }
      }
    });

    // Check missing documentation (visits without proper notes in last 7 days)
    const recentVisits = visits.filter(v => {
      if (!v.visit_date) return false;
      const visitDate = parseISO(v.visit_date);
      return differenceInDays(today, visitDate) <= 7;
    });

    const userVisitCounts = {};
    const userIncompleteVisits = {};

    recentVisits.forEach(visit => {
      if (!userVisitCounts[visit.created_by]) {
        userVisitCounts[visit.created_by] = 0;
        userIncompleteVisits[visit.created_by] = 0;
      }
      userVisitCounts[visit.created_by]++;
      
      // Check if visit has minimal documentation
      if (!visit.assessment || !visit.interventions || visit.assessment.length < 50) {
        userIncompleteVisits[visit.created_by]++;
      }
    });

    Object.entries(userIncompleteVisits).forEach(([userEmail, count]) => {
      if (count > 0) {
        const user = allUsers.find(u => u.email === userEmail);
        if (user) {
          const totalVisits = userVisitCounts[userEmail];
          const percentage = Math.round((count / totalVisits) * 100);
          
          issues.push({
            type: 'incomplete_documentation',
            severity: percentage >= 50 ? 'high' : 'medium',
            userId: user.email,
            userName: user.full_name,
            userRole: user.role,
            title: 'Incomplete Visit Documentation',
            count,
            total: totalVisits,
            percentage,
            details: `${count} of ${totalVisits} recent visits (${percentage}%) have incomplete documentation`
          });
        }
      }
    });

    return issues;
  }, [trainingAssignments, personnelCredentials, visits, allUsers]);

  // Filter issues
  const filteredIssues = complianceIssues.filter(issue => {
    const matchesSearch = !searchTerm ||
      (issue.userName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (issue.title || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = categoryFilter === 'all' || issue.type === categoryFilter;
    const matchesSeverity = severityFilter === 'all' || issue.severity === severityFilter;
    
    return matchesSearch && matchesCategory && matchesSeverity;
  });

  // Group by user
  const groupedByUser = filteredIssues.reduce((acc, issue) => {
    if (!acc[issue.userId]) {
      acc[issue.userId] = {
        userName: issue.userName,
        userRole: issue.userRole,
        issues: []
      };
    }
    acc[issue.userId].issues.push(issue);
    return acc;
  }, {});

  // Calculate stats
  const criticalCount = complianceIssues.filter(i => i.severity === 'critical').length;
  const highCount = complianceIssues.filter(i => i.severity === 'high').length;
  const affectedUsers = Object.keys(groupedByUser).length;
  const overdueTraining = complianceIssues.filter(i => i.type === 'overdue_training').length;
  const expiringCreds = complianceIssues.filter(i => i.type === 'expiring_credential').length;
  const incompleteDoc = complianceIssues.filter(i => i.type === 'incomplete_documentation').length;

  const handleToggleUser = (userId) => {
    const newSelected = new Set(selectedUsers);
    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }
    setSelectedUsers(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedUsers.size === Object.keys(groupedByUser).length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(Object.keys(groupedByUser)));
    }
  };

  const handleNotifySelected = () => {
    if (selectedUsers.size === 0) {
      toast.error("Please select at least one employee");
      return;
    }

    const userEmails = Array.from(selectedUsers);
    const issuesSummary = userEmails.map(email => {
      const userData = groupedByUser[email];
      const issues = userData.issues.map(issue => `• ${issue.details}`).join('\n');
      return `${userData.userName}:\n${issues}`;
    }).join('\n\n');

    const message = `Dear Team Member,

You have the following compliance items requiring immediate attention:

${issuesSummary}

Please address these items as soon as possible. If you need assistance, contact your supervisor or the compliance team.

Thank you,
Compliance Management System`;

    sendNotificationMutation.mutate({
      userEmails,
      subject: "⚠️ Compliance Action Required",
      message
    });
  };

  const handleRefreshAll = () => {
    toast.promise(
      Promise.all([
        refetchUsers(),
        refetchAssignments(),
        refetchCredentials(),
        refetchVisits()
      ]),
      {
        loading: 'Refreshing compliance data...',
        success: 'Data refreshed successfully',
        error: 'Failed to refresh data'
      }
    );
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'overdue_training': return <Clock className="w-4 h-4" />;
      case 'expiring_credential': return <Award className="w-4 h-4" />;
      case 'incomplete_documentation': return <FileWarning className="w-4 h-4" />;
      default: return <AlertTriangle className="w-4 h-4" />;
    }
  };

  const getTypeLabel = (type) => {
    switch (type) {
      case 'overdue_training': return 'Overdue Training';
      case 'expiring_credential': return 'Expiring Credential';
      case 'incomplete_documentation': return 'Incomplete Documentation';
      default: return 'Compliance Issue';
    }
  };

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center">
        <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">Admin Access Required</h2>
        <p className="text-slate-600">This dashboard is only accessible to administrators.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">Real-time compliance tracking and alerts</p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefreshAll}
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
        <StatCard label="Critical Issues" value={criticalCount} icon={AlertTriangle} tone="red" />
        <StatCard label="High Priority" value={highCount} icon={TrendingDown} tone="amber" />
        <StatCard label="Affected Staff" value={affectedUsers} icon={Users} tone="navy" />
        <StatCard label="Overdue Training" value={overdueTraining} icon={Clock} tone="slate" />
        <StatCard label="Expiring Creds" value={expiringCreds} icon={Award} tone="gold" />
        <StatCard label="Incomplete Docs" value={incompleteDoc} icon={FileWarning} tone="navy" />
      </div>

      {/* Filters and Actions */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search by employee or issue..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full lg:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="overdue_training">Overdue Training</SelectItem>
                <SelectItem value="expiring_credential">Expiring Credentials</SelectItem>
                <SelectItem value="incomplete_documentation">Incomplete Docs</SelectItem>
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-full lg:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleSelectAll}
                className="flex-1 lg:flex-none"
              >
                {selectedUsers.size === Object.keys(groupedByUser).length ? 'Deselect All' : 'Select All'}
              </Button>
              <Button
                onClick={handleNotifySelected}
                disabled={selectedUsers.size === 0 || sendNotificationMutation.isPending}
                className="bg-orange-600 hover:bg-orange-700 flex-1 lg:flex-none"
              >
                <Bell className="w-4 h-4 mr-2" />
                Notify ({selectedUsers.size})
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Issues List */}
      {filteredIssues.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-slate-900 mb-2">All Clear!</h3>
            <p className="text-slate-600">No compliance issues found matching your filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedByUser).map(([userId, userData]) => {
            const isSelected = selectedUsers.has(userId);
            const criticalIssues = userData.issues.filter(i => i.severity === 'critical').length;
            const highIssues = userData.issues.filter(i => i.severity === 'high').length;

            return (
              <Card key={userId} className={`border-l-4 ${isSelected ? 'border-l-orange-500 bg-orange-50' : criticalIssues > 0 ? 'border-l-red-500' : 'border-l-slate-300'}`}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleUser(userId)}
                        className="w-5 h-5 rounded border-slate-300"
                      />
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">{userData.userName}</h3>
                        <p className="text-sm text-slate-600">{userData.userRole} • {userId}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {criticalIssues > 0 && (
                        <Badge className="bg-red-600">
                          {criticalIssues} Critical
                        </Badge>
                      )}
                      {highIssues > 0 && (
                        <Badge className="bg-orange-500">
                          {highIssues} High
                        </Badge>
                      )}
                      <Badge variant="outline">
                        {userData.issues.length} issue{userData.issues.length !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {userData.issues.map((issue, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-3 bg-white rounded-lg border">
                        <div className={`p-2 rounded-lg ${getSeverityColor(issue.severity)}`}>
                          {getTypeIcon(issue.type)}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold text-slate-900">{issue.title}</h4>
                            <Badge className={getSeverityColor(issue.severity)}>
                              {issue.severity}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {getTypeLabel(issue.type)}
                            </Badge>
                          </div>
                          <p className="text-sm text-slate-700">{issue.details}</p>
                          {issue.dueDate && (
                            <p className="text-xs text-slate-500 mt-1">
                              Due: {format(parseISO(issue.dueDate), 'MMM d, yyyy')}
                            </p>
                          )}
                          {issue.expirationDate && (
                            <p className="text-xs text-slate-500 mt-1">
                              Expires: {format(parseISO(issue.expirationDate), 'MMM d, yyyy')}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}