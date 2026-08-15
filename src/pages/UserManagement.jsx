import React, { useState, useMemo, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { agencyQueryKey } from '@/lib/agencyRoster';
import { isAdminView } from "@/lib/roles";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Users,
  Shield,
  Search,
  Edit,
  UserX,
  UserCheck,
  Mail,
  Calendar,
  Filter,
  Send,
  Clock,
  AlertTriangle,
  Key,
  Loader2,
  Trash2,
  Activity,
  ChevronUp
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import PageContainer from "@/components/ui/PageContainer";
import LoadingState from "@/components/ui/LoadingState";
import StatCard from "@/components/ui/stat-card";
import EmptyState from "@/components/ui/empty-state";
import AccessDeniedState from "@/components/ui/AccessDeniedState";
import ListPaginationControls from "@/components/ui/ListPaginationControls";
import { paginateRows, clampPageSize } from "@/lib/pagination";
import { format } from "date-fns";
import { formatEastern } from "@/components/utils/timezone";
import { toast } from "sonner";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";
import UserActivityPanel from "@/components/admin/UserActivityPanel";
import { buildOffboardInvokeArgs } from "@/components/admin/runUserOffboard";

export default function UserManagement() {
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedUser, setSelectedUser] = useState(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDisableDialog, setShowDisableDialog] = useState(false);
  const [showPasswordResetDialog, setShowPasswordResetDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [resetPasswordResult, setResetPasswordResult] = useState(null);
  const [editedRole, setEditedRole] = useState("");
  const [editForm, setEditForm] = useState({ full_name: '', phone: '', credential_type: '' });
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [showDeleteInvitationDialog, setShowDeleteInvitationDialog] = useState(false);
  const [selectedInvitation, setSelectedInvitation] = useState(null);
  const [showUserSetupDialog, setShowUserSetupDialog] = useState(false);
  const [setupFormData, setSetupFormData] = useState({ email: '', full_name: '', role: 'user', staff_type: '' });
  const [expandedActivityUser, setExpandedActivityUser] = useState(null);
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(25);

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: allUsers = [], isLoading } = useQuery({
    queryKey: ['allUsersManagement', agencyQueryKey(currentUser)],
    queryFn: async () => {
      const _rows = await base44.entities.User.list('-created_date', 5000);
      const { filterUsersByCallerAgency } = await import('@/lib/agencyScope');
      return filterUsersByCallerAgency(_rows, currentUser);
    },
    enabled: isAdminView(currentUser),
  });

  const { data: userActivities = [] } = useQuery({
    queryKey: ['userActivitiesSummary'],
    queryFn: () => base44.entities.UserActivity.list('-created_date', 1000),
    enabled: isAdminView(currentUser),
  });

  const { data: invitations = [] } = useQuery({
    queryKey: ['userInvitations', allUsers.length],
    queryFn: async () => {
      const allInvitations = await base44.entities.UserInvitation.list('-created_date', 5000);
      const userEmails = new Set(allUsers.map(u => (u.email || '').toLowerCase()).filter(Boolean));
      return allInvitations.filter(inv => !userEmails.has((inv.email || '').toLowerCase()));
    },
    enabled: isAdminView(currentUser) && allUsers.length > 0,
  });

  // No client-side User.update mutation here on purpose. User write RLS admits
  // any admin, but userManagement.updateUser additionally enforces that only a
  // super admin may grant the 'admin' role. Editing through the function
  // (handleSaveUser) keeps that escalation guard on the path; a direct
  // entities.User.update from the client would skip it.

  const resendInvitationMutation = useMutation({
    mutationFn: async (invitationId) => {
      const invitation = invitations.find(i => i.id === invitationId);
      if (invitation) {
        await logActivity(ActivityActions.INVITATION_RESENT, {
          invited_email: invitation.email,
          invited_name: invitation.full_name,
          entity_type: 'UserInvitation',
          entity_id: invitationId
        });
      }
      const res = await base44.functions.invoke('resendInvitation', { invitation_id: invitationId });
      const data = res?.data ?? res;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userInvitations'] });
      toast.success('Invitation resent successfully!');
    },
    onError: (error) => {
      toast.error('Failed to resend invitation: ' + error.message);
    }
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (userEmail) => base44.functions.invoke('resetUserPassword', { userEmail }),
    onSuccess: (data) => {
      setResetPasswordResult(data?.data || data);
    },
    onError: (error) => {
      setResetPasswordResult({ success: false, error: error?.message || 'Failed to reset password' });
      toast.error('Failed to reset password: ' + (error?.message || 'Unknown error'));
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId) => base44.entities.User.delete(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allUsersManagement'] });
      queryClient.invalidateQueries({ queryKey: ['allUsers'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowDeleteDialog(false);
      setSelectedUser(null);
    },
  });

  const deleteInvitationMutation = useMutation({
    mutationFn: async (invitationId) => {
      const invitation = invitations.find(i => i.id === invitationId);
      if (invitation) {
        await logActivity(ActivityActions.INVITATION_DELETED, {
          invited_email: invitation.email,
          invited_name: invitation.full_name,
          entity_type: 'UserInvitation',
          entity_id: invitationId
        });
      }
      const res = await base44.functions.invoke('userManagement', { action: 'cancel_invitation', invitation_id: invitationId });
      const data = res?.data ?? res;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userInvitations'] });
      setShowDeleteInvitationDialog(false);
      setSelectedInvitation(null);
      toast.success('Invitation deleted successfully!');
    },
    onError: (error) => {
      toast.error('Failed to delete invitation: ' + error.message);
    }
  });

  const createUserMutation = useMutation({
    mutationFn: async (data) => {
      const res = await base44.functions.invoke('createUserWithTempPassword', data);
      const body = res?.data ?? res;
      if (body?.error) throw new Error(body.error);
      return body;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['userInvitations'] });
      setShowUserSetupDialog(false);
      setSetupFormData({ email: '', full_name: '', role: 'user', staff_type: '' });
      const manualLabel = variables?.role === 'admin' ? 'Facility Administrator Manual' : 'User Manual';
      toast.success(`Invitation sent${variables?.email ? ` to ${variables.email}` : ''}. They'll receive a branded welcome email with app-install steps and their ${manualLabel}.`);
    },
    onError: (error) => {
      toast.error('Failed to create user: ' + error.message);
    }
  });

  const handleEditUser = (user) => {
    setSelectedUser(user);
    setEditedRole(user.role);
    setEditForm({
      full_name: user.full_name || '',
      phone: user.phone || '',
      credential_type: user.credential_type || '',
    });
    setShowEditDialog(true);
  };

  const handleSaveUser = async () => {
    if (!selectedUser) return;
    setIsSavingUser(true);
    try {
      await base44.functions.invoke('userManagement', {
        action: 'update_user',
        user_id: selectedUser.id,
        full_name: editForm.full_name,
        phone: editForm.phone,
        credential_type: editForm.credential_type,
        role: editedRole,
      });
      logActivity(ActivityActions.USER_ROLE_CHANGED, {
        user_email: selectedUser.email,
        old_role: selectedUser.role,
        new_role: editedRole,
        entity_type: 'User',
        entity_id: selectedUser.id
      });
      queryClient.invalidateQueries({ queryKey: ['allUsersManagement'] });
      queryClient.invalidateQueries({ queryKey: ['allUsers'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User updated successfully');
      setShowEditDialog(false);
      setSelectedUser(null);
    } catch (error) {
      toast.error('Failed to update user: ' + error.message);
    } finally {
      setIsSavingUser(false);
    }
  };

  const handleToggleActive = (user) => {
    setSelectedUser(user);
    setShowDisableDialog(true);
  };

  const confirmToggleActive = async () => {
    if (!selectedUser) return;
    const enabling = selectedUser.is_active === false;
    try {
      const args = buildOffboardInvokeArgs({
        targetUser: selectedUser,
        currentUser,
        enabling,
        reason: enabling
          ? undefined
          : `Disabled via User Management by ${currentUser?.email || 'admin'}`,
      });
      const res = await base44.functions.invoke('offboardUser', args);
      queryClient.invalidateQueries({ queryKey: ['allUsersManagement'] });
      queryClient.invalidateQueries({ queryKey: ['allUsers'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      const payload = res?.data || res || {};
      // Log only after the invoke resolves. Logging first meant a rejected
      // offboard (e.g. the server's super-admin-only check) still left an audit
      // row asserting a disable that never happened.
      logActivity(enabling ? ActivityActions.USER_ENABLED : ActivityActions.USER_DISABLED, {
        user_email: selectedUser.email,
        user_name: selectedUser.full_name,
        entity_type: 'User',
        entity_id: selectedUser.id,
        offboarding: !enabling,
        revocation_complete: payload.complete !== false,
      });
      if (enabling) {
        toast.success('User reactivated.');
      } else if (payload.complete === false) {
        // The account is deactivated, but some access was not revoked. Telling
        // the admin this succeeded would leave live PHI access unnoticed.
        toast.warning(
          payload.message
            || 'User deactivated, but some access revocation did not complete. Review the offboarding audit entry and re-run.',
          { duration: 10000 },
        );
      } else {
        toast.success(
          'User offboarded: account deactivated, patients unassigned, work number released, on-call cleared.'
        );
      }
      setShowDisableDialog(false);
      setSelectedUser(null);
    } catch (err) {
      toast.error(err?.message || 'Could not update user status');
    }
  };

  const handleResetPassword = (user) => {
    setSelectedUser(user);
    setResetPasswordResult(null);
    setShowPasswordResetDialog(true);
  };

  const confirmResetPassword = () => {
    if (!selectedUser) return;
    logActivity(ActivityActions.USER_PASSWORD_RESET, {
      user_email: selectedUser.email,
      user_name: selectedUser.full_name,
      entity_type: 'User',
      entity_id: selectedUser.id
    });
    resetPasswordMutation.mutate(selectedUser.email);
  };

  const handleDeleteUser = (user) => {
    setSelectedUser(user);
    setShowDeleteDialog(true);
  };

  const handleCreateUser = () => {
    if (!setupFormData.email || !setupFormData.full_name) {
      toast.error('Email and full name are required');
      return;
    }
    logActivity(ActivityActions.INVITATION_SENT, {
      invited_email: setupFormData.email,
      invited_name: setupFormData.full_name,
      role: setupFormData.role,
      staff_type: setupFormData.staff_type,
      entity_type: 'UserInvitation'
    });
    createUserMutation.mutate(setupFormData);
  };

  const confirmDeleteUser = () => {
    if (!selectedUser) return;
    logActivity(ActivityActions.USER_DELETED, {
      user_email: selectedUser.email,
      user_name: selectedUser.full_name,
      entity_type: 'User',
      entity_id: selectedUser.id
    });
    deleteUserMutation.mutate(selectedUser.id);
  };

  const filteredUsers = useMemo(() => allUsers.filter(user => {
    if (roleFilter !== 'all' && user.role !== roleFilter) return false;
    if (statusFilter !== 'all') {
      if (statusFilter === 'active' && user.is_active === false) return false;
      if (statusFilter === 'inactive' && user.is_active !== false) return false;
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        user.full_name?.toLowerCase().includes(query) ||
        user.email?.toLowerCase().includes(query)
      );
    }
    return true;
  }), [allUsers, roleFilter, statusFilter, searchQuery]);

  // Reset to page 1 when filters change so an empty page never strands the admin.
  useEffect(() => {
    setUserPage(1);
  }, [roleFilter, statusFilter, searchQuery]);

  const pageSize = clampPageSize(userPageSize, { max: 100, fallback: 25 });
  const userPageWindow = useMemo(
    () => paginateRows(filteredUsers, { page: userPage, pageSize, maxPageSize: 100 }),
    [filteredUsers, userPage, pageSize],
  );
  const pagedUsers = userPageWindow.items;

  const activityByEmail = useMemo(() => {
    const m = new Map();
    for (const a of userActivities) {
      const entry = m.get(a.user_email);
      if (entry) {
        entry.count += 1;
      } else {
        m.set(a.user_email, { count: 1, last: a.created_date });
      }
    }
    return m;
  }, [userActivities]);

  const getUserActivityCount = (email) => activityByEmail.get(email)?.count || 0;
  const getUserLastActivity = (email) => activityByEmail.get(email)?.last || null;

  const now = new Date();
  const pendingInvitations = invitations.filter(i => i.status === 'pending' && new Date(i.expires_at) >= now);
  const expiredInvitations = invitations.filter(i => i.status === 'expired' || (i.status === 'pending' && new Date(i.expires_at) < now));

  const stats = {
    total: allUsers.length,
    admins: allUsers.filter(u => u.role === 'admin').length,
    nurses: allUsers.filter(u => u.role === 'user').length,
    active: allUsers.filter(u => u.is_active !== false).length,
    inactive: allUsers.filter(u => u.is_active === false).length,
  };

  const getRoleBadge = (role) => {
    const colors = {
      admin: 'bg-slate-800 text-white border-slate-700 font-medium',
      user: 'bg-slate-100 text-slate-700 border-slate-200',
      manager: 'bg-slate-200 text-slate-800 border-slate-300 font-medium'
    };
    const labels = {
      admin: 'Admin',
      user: 'Nurse',
      manager: 'Manager'
    };
    return (
      <Badge className={colors[role] || 'bg-slate-100 text-slate-800'}>
        {labels[role] || role}
      </Badge>
    );
  };

  if (!isAdminView(currentUser)) {
    return (
      <AccessDeniedState
        title="Access Restricted"
        description="Only administrators can access User Management."
      />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={Users}
        eyebrow="Manage"
        title="User Management"
        description="Manage user accounts, roles, and permissions"
        favoritePage="UserManagement"
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <StatCard label="Total Users" value={stats.total} icon={Users} tone="slate" />
        <StatCard label="Admins" value={stats.admins} icon={Shield} tone="navy" />
        <StatCard label="Nurses" value={stats.nurses} icon={Users} tone="blue" />
        <StatCard label="Active" value={stats.active} icon={UserCheck} tone="emerald" />
        <StatCard label="Inactive" value={stats.inactive} icon={UserX} tone="red" />
      </div>

      <Card className="mb-4 sm:mb-6 modern-card">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 items-start sm:items-center justify-between">
            <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 items-start sm:items-center flex-1">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-medium">Filters:</span>
              </div>
              <div className="relative flex-1 w-full sm:max-w-xs">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-11 touch-target"
                />
              </div>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-full sm:w-40 h-11 touch-target">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="user">Nurse</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-40 h-11 touch-target">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setUserPageSize(clampPageSize(v, { max: 100, fallback: 25 }));
                  setUserPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-36 h-11 touch-target">
                  <SelectValue placeholder="Page size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25 per page</SelectItem>
                  <SelectItem value="50">50 per page</SelectItem>
                  <SelectItem value="100">100 per page</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => setShowUserSetupDialog(true)}
              className="btn-primary w-full sm:w-auto"
            >
              <Users className="w-4 h-4 mr-2" />
              Add New User
            </Button>
          </div>
        </CardContent>
      </Card>

      {pendingInvitations.length > 0 && (
        <Card className="mb-4 sm:mb-6 modern-card border-slate-200 bg-white">
          <CardHeader className="p-3 sm:p-4 md:p-6 border-b border-slate-100 bg-slate-50 rounded-t-xl">
            <CardTitle className="flex items-center justify-between text-base sm:text-lg text-slate-800">
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-slate-500" />
                <span>Pending Invitations ({pendingInvitations.length})</span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 md:p-6">
            <div className="space-y-3">
              {pendingInvitations.map((invitation) => {
                const expiresAt = new Date(invitation.expires_at);
                const hoursUntilExpiry = (expiresAt - now) / (1000 * 60 * 60);
                const isExpiringSoon = hoursUntilExpiry > 0 && hoursUntilExpiry <= 24;
                return (
                  <div key={invitation.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-white rounded-lg border border-slate-200 shadow-sm hover:border-slate-300 transition-colors">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-slate-900">{invitation.full_name}</p>
                        <Badge className="text-xs">{invitation.role}</Badge>
                        <Badge className="bg-blue-100 text-blue-800 text-xs">Pending</Badge>
                        {isExpiringSoon && (
                          <Badge className="bg-orange-100 text-orange-800 flex items-center gap-1 text-xs">
                            <Clock className="w-3 h-3" />
                            Expiring Soon
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 mt-1">{invitation.email}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Expires: {format(expiresAt, 'MMM d, yyyy')}
                        </span>
                        {invitation.resend_count > 0 && (
                          <span>Resent {invitation.resend_count}x</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resendInvitationMutation.mutate(invitation.id)}
                        disabled={resendInvitationMutation.isPending}
                        className="flex items-center gap-2 min-h-[44px] flex-1 sm:flex-none"
                      >
                        <Send className="w-4 h-4" />
                        Resend
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelectedInvitation(invitation);
                          setShowDeleteInvitationDialog(true);
                        }}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 min-h-[44px] w-10"
                        title="Delete invitation"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {expiredInvitations.length > 0 && (
        <Card className="mb-4 sm:mb-6 modern-card border-red-200 bg-white">
          <CardHeader className="p-3 sm:p-4 md:p-6 border-b border-red-100 bg-red-50/50 rounded-t-xl">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg text-red-800">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <span>Expired Invitations ({expiredInvitations.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 md:p-6">
            <div className="space-y-3">
              {expiredInvitations.map((invitation) => {
                const expiresAt = new Date(invitation.expires_at);
                return (
                  <div key={invitation.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-white rounded-lg border border-slate-200 shadow-sm hover:border-red-200 transition-colors">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-slate-900">{invitation.full_name}</p>
                        <Badge className="text-xs">{invitation.role}</Badge>
                        <Badge className="bg-red-100 text-red-800 text-xs">Expired</Badge>
                      </div>
                      <p className="text-sm text-slate-600 mt-1">{invitation.email}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Expired: {format(expiresAt, 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resendInvitationMutation.mutate(invitation.id)}
                        disabled={resendInvitationMutation.isPending}
                        className="flex items-center gap-2 min-h-[44px] flex-1 sm:flex-none"
                      >
                        <Send className="w-4 h-4" />
                        Resend New Link
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelectedInvitation(invitation);
                          setShowDeleteInvitationDialog(true);
                        }}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 min-h-[44px] w-10"
                        title="Delete invitation"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="modern-card">
        <CardHeader className="p-3 sm:p-4 md:p-6">
          <CardTitle className="flex items-center justify-between text-base sm:text-lg">
            <span>Users ({filteredUsers.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 md:p-6">
          {isLoading ? (
            <LoadingState label="Loading users..." className="py-8 sm:py-12" />
          ) : filteredUsers.length === 0 ? (
            <EmptyState title="No users found" icon={Users} />
          ) : (
            <>
            <div className="overflow-x-auto -mx-3 sm:mx-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs sm:text-sm">User</TableHead>
                    <TableHead className="text-xs sm:text-sm hidden md:table-cell">Email</TableHead>
                    <TableHead className="text-xs sm:text-sm">Role</TableHead>
                    <TableHead className="text-xs sm:text-sm">Status</TableHead>
                    <TableHead className="text-xs sm:text-sm hidden lg:table-cell">Activity</TableHead>
                    <TableHead className="text-xs sm:text-sm hidden lg:table-cell">Last Active</TableHead>
                    <TableHead className="text-xs sm:text-sm">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedUsers.map((user) => {
                    const activityCount = getUserActivityCount(user.email);
                    const lastActivity = getUserLastActivity(user.email);
                    const isActive = user.is_active !== false;
                    return (
                      <React.Fragment key={user.id}>
                      <TableRow className={!isActive ? 'opacity-50' : ''}>
                        <TableCell className="text-xs sm:text-sm">
                          <div className="flex items-center gap-2 sm:gap-3">
                            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-navy-600 rounded-full flex items-center justify-center text-white text-xs sm:text-sm font-medium flex-shrink-0">
                              {user.full_name?.charAt(0) || 'U'}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900 truncate">{user.full_name}</p>
                              <p className="text-xs text-slate-600 md:hidden truncate">{user.email}</p>
                              {currentUser.email === user.email && (
                                <Badge className="text-xs bg-blue-500 text-white">You</Badge>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs sm:text-sm hidden md:table-cell">
                          <div className="flex items-center gap-1 text-slate-600">
                            <Mail className="w-3 h-3" />
                            <span className="truncate">{user.email}</span>
                          </div>
                        </TableCell>
                        <TableCell>{getRoleBadge(user.role)}</TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                            {isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs sm:text-sm hidden lg:table-cell">
                          {activityCount > 0 ? `${activityCount} actions` : 'No activity'}
                        </TableCell>
                        <TableCell className="text-xs sm:text-sm text-slate-600 hidden lg:table-cell">
                          {lastActivity ? (
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {formatEastern(lastActivity, 'MMM d, yyyy')}
                            </div>
                          ) : (
                            'Never'
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 sm:gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setExpandedActivityUser(expandedActivityUser === user.id ? null : user.id)}
                              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 min-h-[44px] w-10 sm:w-auto p-2"
                              title="View activity"
                            >
                              <Activity className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditUser(user)}
                              disabled={currentUser.email === user.email}
                              title="Edit user role"
                              className="min-h-[44px] w-10 sm:w-auto p-2"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleResetPassword(user)}
                              className="min-h-[44px] w-10 sm:w-auto p-2"
                              title="Reset password"
                            >
                              <Key className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleActive(user)}
                              disabled={currentUser.email === user.email}
                              className={`min-h-[44px] w-10 sm:w-auto p-2 ${isActive ? 'text-red-600 hover:text-red-700' : 'text-emerald-600 hover:text-emerald-700'}`}
                              title={isActive ? 'Disable / offboard user' : 'Enable user'}
                            >
                              {isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteUser(user)}
                              disabled={currentUser.email === user.email}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50 min-h-[44px] w-10 sm:w-auto p-2"
                              title="Delete user permanently"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedActivityUser === user.id && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-blue-50 border-blue-100 px-4 py-4">
                            <div className="flex items-center gap-2 mb-3">
                              <Activity className="w-4 h-4 text-blue-600" />
                              <span className="text-sm font-semibold text-blue-900">Activity Log — {user.full_name}</span>
                              <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs text-blue-600" onClick={() => setExpandedActivityUser(null)}>
                                Close <ChevronUp className="w-3.5 h-3.5 ml-1" />
                              </Button>
                            </div>
                            <UserActivityPanel userEmail={user.email} userName={user.full_name} />
                          </TableCell>
                        </TableRow>
                      )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <ListPaginationControls
              page={userPageWindow.page}
              totalPages={userPageWindow.totalPages}
              totalItems={userPageWindow.totalItems}
              startIndex={userPageWindow.startIndex}
              endIndex={userPageWindow.endIndex}
              hasPreviousPage={userPageWindow.hasPreviousPage}
              hasNextPage={userPageWindow.hasNextPage}
              onPageChange={(p) => {
                setExpandedActivityUser(null);
                setUserPage(p);
              }}
              itemLabel="users"
            />
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-4">
              <div>
                <Label className="text-sm text-slate-600">Email</Label>
                <p className="text-sm text-slate-500">{selectedUser.email}</p>
              </div>
              <div>
                <Label htmlFor="edit_full_name">Full Name</Label>
                <Input
                  id="edit_full_name"
                  value={editForm.full_name}
                  onChange={(e) => setEditForm(prev => ({ ...prev, full_name: e.target.value }))}
                  className="mt-1"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <Label htmlFor="edit_phone">Phone Number</Label>
                <Input
                  id="edit_phone"
                  type="tel"
                  value={editForm.phone}
                  onChange={(e) => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
                  className="mt-1"
                  placeholder="(555) 123-4567"
                />
              </div>
              <div>
                <Label htmlFor="edit_credential">Credential Type</Label>
                <Select
                  value={editForm.credential_type || "none"}
                  onValueChange={(value) => setEditForm(prev => ({ ...prev, credential_type: value === "none" ? "" : value }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select credential" />
                  </SelectTrigger>
                  <SelectContent style={{ zIndex: 9999 }}>
                    <SelectItem value="RN">RN - Registered Nurse</SelectItem>
                    <SelectItem value="LPN">LPN - Licensed Practical Nurse</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Role</Label>
                <Select value={editedRole} onValueChange={setEditedRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent style={{ zIndex: 9999 }}>
                    <SelectItem value="user">Nurse</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveUser} disabled={isSavingUser} className="bg-navy-600 hover:bg-navy-700">
              {isSavingUser ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>) : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDisableDialog} onOpenChange={setShowDisableDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectedUser?.is_active === false ? 'Enable User' : 'Disable / Offboard User'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectedUser?.is_active === false ? (
                <>Are you sure you want to enable <strong>{selectedUser?.full_name}</strong>? They will be able to access the system again.</>
              ) : (
                <>Are you sure you want to offboard <strong>{selectedUser?.full_name}</strong>? This deactivates the account, unassigns patients, releases the work number, clears on-call shifts, and records audit metadata. Platform-level rejection of inactive sessions still requires hosted RLS verification (LR-01).</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmToggleActive}
              className={selectedUser?.is_active === false ? 'bg-emerald-600' : 'bg-red-600'}
            >
              {selectedUser?.is_active === false ? 'Enable' : 'Offboard'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              Delete User Permanently
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete <strong>{selectedUser?.full_name}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteUser} disabled={deleteUserMutation.isPending} className="bg-red-600 hover:bg-red-700">
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteInvitationDialog} onOpenChange={setShowDeleteInvitationDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Invitation</AlertDialogTitle>
            <AlertDialogDescription>
              Delete invitation for <strong>{selectedInvitation?.email}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteInvitationMutation.mutate(selectedInvitation.id)}
              disabled={deleteInvitationMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete Invitation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showPasswordResetDialog} onOpenChange={setShowPasswordResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5 text-orange-600" />
              Reset User Password
            </AlertDialogTitle>
            <AlertDialogDescription>
              {!resetPasswordResult ? (
                <>Reset password for <strong>{selectedUser?.full_name}</strong>? A temporary password will be emailed to <strong>{selectedUser?.email}</strong>.</>
              ) : resetPasswordResult.success ? (
                <Alert className="bg-emerald-50 border-emerald-300">
                  <AlertDescription className="text-emerald-900">Password reset successfully. Temporary password delivered by email only.</AlertDescription>
                </Alert>
              ) : (
                <Alert className="bg-red-50 border-red-300">
                  <AlertDescription className="text-red-900">Failed: {resetPasswordResult?.error || 'Unknown error'}</AlertDescription>
                </Alert>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {!resetPasswordResult ? (
              <>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={confirmResetPassword} disabled={resetPasswordMutation.isPending} className="bg-orange-600 hover:bg-orange-700">
                  Reset Password
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction onClick={() => { setShowPasswordResetDialog(false); setResetPasswordResult(null); setSelectedUser(null); }}>
                Done
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showUserSetupDialog} onOpenChange={setShowUserSetupDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="email">Email Address</Label>
              <Input id="email" type="email" placeholder="user@example.com" value={setupFormData.email} onChange={(e) => setSetupFormData({ ...setupFormData, email: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="full_name">Full Name</Label>
              <Input id="full_name" placeholder="John Doe" value={setupFormData.full_name} onChange={(e) => setSetupFormData({ ...setupFormData, full_name: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="role">Role</Label>
              <Select value={setupFormData.role} onValueChange={(role) => setSetupFormData({ ...setupFormData, role })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent style={{ zIndex: 9999 }}>
                  <SelectItem value="user">Nurse</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUserSetupDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateUser} disabled={createUserMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700">
              {createUserMutation.isPending ? 'Creating...' : 'Create User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
