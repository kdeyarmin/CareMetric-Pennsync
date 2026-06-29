import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
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
  ShieldAlert,
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
import { format } from "date-fns";
import { formatEastern } from "@/components/utils/timezone";
import { toast } from "sonner";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";
import UserActivityPanel from "@/components/admin/UserActivityPanel";

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

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: allUsers = [], isLoading } = useQuery({
    queryKey: ['allUsersManagement'],
    queryFn: () => base44.entities.User.list(),
    enabled: currentUser?.role === 'admin',
  });

  const { data: userActivities = [] } = useQuery({
    queryKey: ['userActivitiesSummary'],
    queryFn: () => base44.entities.UserActivity.list('-created_date', 1000),
    enabled: currentUser?.role === 'admin',
  });

  const { data: invitations = [] } = useQuery({
    // Include the user count in the key so the "already signed up" filter below
    // recomputes when a new user registers — otherwise a static key left a ghost
    // "pending" invitation showing for someone who had just signed up.
    queryKey: ['userInvitations', allUsers.length],
    queryFn: async () => {
      const allInvitations = await base44.entities.UserInvitation.list('-created_date');
      // Filter out invitations where user has already signed up
      const userEmails = new Set(allUsers.map(u => (u.email || '').toLowerCase()).filter(Boolean));
      return allInvitations.filter(inv => !userEmails.has((inv.email || '').toLowerCase()));
    },
    enabled: currentUser?.role === 'admin' && allUsers.length > 0,
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ userId, data }) => base44.entities.User.update(userId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allUsersManagement'] });
      setShowEditDialog(false);
      setSelectedUser(null);
    },
  });

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
      return base44.functions.invoke('resendInvitation', { invitation_id: invitationId });
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
      return base44.entities.UserInvitation.delete(invitationId);
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
    mutationFn: (data) => base44.functions.invoke('createUserWithTempPassword', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userInvitations'] });
      setShowUserSetupDialog(false);
      setSetupFormData({ email: '', full_name: '', role: 'user', staff_type: '' });
      toast.success('User invitation sent successfully!');
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
      // full_name is admin-managed and not writable via the standard SDK, so all
      // edits go through the service-role userManagement function.
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

  const confirmToggleActive = () => {
    if (!selectedUser) return;
    const newStatus = selectedUser.is_active === false ? true : false;
    logActivity(newStatus ? ActivityActions.USER_ENABLED : ActivityActions.USER_DISABLED, {
      user_email: selectedUser.email,
      user_name: selectedUser.full_name,
      entity_type: 'User',
      entity_id: selectedUser.id
    });
    updateUserMutation.mutate({
      userId: selectedUser.id,
      data: { is_active: newStatus }
    });
    setShowDisableDialog(false);
    setSelectedUser(null);
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

  // Filter users
  const filteredUsers = allUsers.filter(user => {
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
  });

  // Index activity by user in one pass instead of scanning all (up to 1000)
  // activities per table row on every render/keystroke (was O(users × activities)).
  // userActivities is fetched '-created_date', so the first row seen per email is
  // the most recent.
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

  // Stats
  const now = new Date();
  const pendingInvitations = invitations.filter(i => i.status === 'pending');
  const expiredInvitations = invitations.filter(i => i.status === 'expired' || (i.status === 'pending' && new Date(i.expires_at) < now));
  const _expiringSoonInvitations = pendingInvitations.filter(i => {
    const expiresAt = new Date(i.expires_at);
    const hoursUntilExpiry = (expiresAt - now) / (1000 * 60 * 60);
    return hoursUntilExpiry > 0 && hoursUntilExpiry <= 24;
  });

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

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-12 text-center">
            <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Access Restricted</h2>
            <p className="text-slate-600 mb-4">
              Only administrators can access User Management.
            </p>
          </CardContent>
        </Card>
      </div>
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

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <Card className="modern-card">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-slate-500 truncate">Total Users</p>
                <p className="text-xl sm:text-2xl font-bold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="modern-card border-navy-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-navy-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-slate-500 truncate">Admins</p>
                <p className="text-xl sm:text-2xl font-bold text-navy-600">{stats.admins}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="modern-card border-blue-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-slate-500 truncate">Nurses</p>
                <p className="text-xl sm:text-2xl font-bold text-blue-600">{stats.nurses}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="modern-card border-emerald-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-slate-500 truncate">Active</p>
                <p className="text-xl sm:text-2xl font-bold text-emerald-600">{stats.active}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="modern-card border-red-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <UserX className="w-4 h-4 sm:w-5 sm:h-5 text-red-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-slate-500 truncate">Inactive</p>
                <p className="text-xl sm:text-2xl font-bold text-red-600">{stats.inactive}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters & Add User Button */}
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

      {/* Pending Invitations */}
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

      {/* Expired Invitations */}
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
                        {invitation.resend_count > 0 && (
                          <span>Previously sent {invitation.resend_count}x</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resendInvitationMutation.mutate(invitation.id)}
                        disabled={resendInvitationMutation.isPending}
                        className="flex items-center gap-2 min-h-[44px] flex-1 sm:flex-none text-orange-600 hover:text-orange-700 hover:bg-orange-50"
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

      {/* Users Table */}
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
            <div className="text-center py-8 sm:py-12 text-sm sm:text-base text-slate-500">No users found</div>
          ) : (
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
                  {filteredUsers.map((user) => {
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
                              className="text-orange-600 hover:text-orange-700 min-h-[44px] w-10 sm:w-auto p-2"
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
                              title={isActive ? 'Disable user' : 'Enable user'}
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
          )}
        </CardContent>
      </Card>

      {/* Edit User Dialog */}
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
                    <SelectItem value="manager">Manager</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Alert>
                <Shield className="w-4 h-4" />
                <AlertDescription className="text-sm">
                  <strong>Admin:</strong> Full access to all features and settings.<br/>
                  <strong>Manager:</strong> Access to reports and user management.<br/>
                  <strong>Nurse:</strong> Access to patient care and documentation.
                </AlertDescription>
              </Alert>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveUser} disabled={isSavingUser} className="bg-navy-600 hover:bg-navy-700">
              {isSavingUser ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable/Enable User Dialog */}
      <AlertDialog open={showDisableDialog} onOpenChange={setShowDisableDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectedUser?.is_active === false ? 'Enable User' : 'Disable User'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectedUser?.is_active === false ? (
                <>
                  Are you sure you want to enable <strong>{selectedUser?.full_name}</strong>? 
                  They will be able to access the system again.
                </>
              ) : (
                <>
                  Are you sure you want to disable <strong>{selectedUser?.full_name}</strong>? 
                  They will no longer be able to access the system.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmToggleActive}
              className={selectedUser?.is_active === false ? 'bg-emerald-600' : 'bg-red-600'}
            >
              {selectedUser?.is_active === false ? 'Enable' : 'Disable'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete User Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              Delete User Permanently
            </AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-3">
                <p>
                  Are you sure you want to permanently delete <strong>{selectedUser?.full_name}</strong>?
                </p>
                <Alert className="bg-red-50 border-red-300">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <AlertDescription className="text-red-900 text-sm">
                    <strong>Warning:</strong> This action cannot be undone. The user will be completely removed from the system and can sign up again with the same email if needed.
                  </AlertDescription>
                </Alert>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteUser}
              disabled={deleteUserMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteUserMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete User
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Invitation Dialog */}
      <AlertDialog open={showDeleteInvitationDialog} onOpenChange={setShowDeleteInvitationDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              Delete Invitation
            </AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-3">
                <p>
                  Are you sure you want to delete the invitation for <strong>{selectedInvitation?.email}</strong>?
                </p>
                <Alert className="bg-red-50 border-red-300">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <AlertDescription className="text-red-900 text-sm">
                    This user will need to be invited again to sign up.
                  </AlertDescription>
                </Alert>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteInvitationMutation.mutate(selectedInvitation.id)}
              disabled={deleteInvitationMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteInvitationMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Invitation
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Password Dialog */}
      <AlertDialog open={showPasswordResetDialog} onOpenChange={setShowPasswordResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5 text-orange-600" />
              Reset User Password
            </AlertDialogTitle>
            <AlertDialogDescription>
              {!resetPasswordResult ? (
                <>
                  Are you sure you want to reset the password for <strong>{selectedUser?.full_name}</strong>?
                  <br/><br/>
                  A temporary password will be generated and sent to <strong>{selectedUser?.email}</strong>. 
                  The user will be able to log in with this temporary password and should change it immediately.
                </>
              ) : resetPasswordResult.success ? (
                <div className="space-y-3">
                  <Alert className="bg-emerald-50 border-emerald-300">
                    <AlertDescription className="text-emerald-900">
                      Password reset successfully! An email with the temporary password has been sent to the user.
                    </AlertDescription>
                  </Alert>
                  <div className="p-4 bg-slate-50 rounded-lg border">
                    <p className="text-sm text-slate-600 mb-2">Temporary Password:</p>
                    <p className="font-mono text-lg font-bold text-slate-900 bg-white p-3 rounded border select-all">
                      {resetPasswordResult.tempPassword}
                    </p>
                    <p className="text-xs text-slate-500 mt-2">
                      You can share this with the user if they didn't receive the email
                    </p>
                  </div>
                </div>
              ) : (
                <Alert className="bg-red-50 border-red-300">
                  <AlertDescription className="text-red-900">
                    Failed to reset password: {resetPasswordResult?.error || 'Unknown error'}
                  </AlertDescription>
                </Alert>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {!resetPasswordResult ? (
              <>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmResetPassword}
                  disabled={resetPasswordMutation.isPending}
                  className="bg-orange-600 hover:bg-orange-700"
                >
                  {resetPasswordMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    <>
                      <Key className="w-4 h-4 mr-2" />
                      Reset Password
                    </>
                  )}
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction
                onClick={() => {
                  setShowPasswordResetDialog(false);
                  setResetPasswordResult(null);
                  setSelectedUser(null);
                }}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Done
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add New User Dialog */}
      <Dialog open={showUserSetupDialog} onOpenChange={setShowUserSetupDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={setupFormData.email}
                onChange={(e) => setSetupFormData({ ...setupFormData, email: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="full_name">Full Name</Label>
              <Input
                id="full_name"
                placeholder="John Doe"
                value={setupFormData.full_name}
                onChange={(e) => setSetupFormData({ ...setupFormData, full_name: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="role">Role</Label>
              <Select value={setupFormData.role} onValueChange={(role) => setSetupFormData({ ...setupFormData, role })}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ zIndex: 9999 }}>
                  <SelectItem value="user">Nurse</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="staff_type">Staff Type (Optional)</Label>
              <Select value={setupFormData.staff_type || "none"} onValueChange={(staff_type) => setSetupFormData({ ...setupFormData, staff_type: staff_type === "none" ? "" : staff_type })}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select staff type" />
                </SelectTrigger>
                <SelectContent style={{ zIndex: 9999 }}>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="RN">RN</SelectItem>
                  <SelectItem value="LPN">LPN</SelectItem>
                  <SelectItem value="office_staff">Office Staff</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUserSetupDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateUser}
              disabled={createUserMutation.isPending}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {createUserMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Users className="w-4 h-4 mr-2" />
                  Create User
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}