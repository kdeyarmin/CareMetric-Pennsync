import React, { useState } from "react";
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
  Trash2
} from "lucide-react";
import { format } from "date-fns";
import { formatEastern } from "@/components/utils/timezone";

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
    queryKey: ['userInvitations'],
    queryFn: async () => {
      const allInvitations = await base44.entities.UserInvitation.list('-created_date');
      // Filter out invitations where user has already signed up
      const userEmails = new Set(allUsers.map(u => u.email.toLowerCase()));
      return allInvitations.filter(inv => !userEmails.has(inv.email.toLowerCase()));
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
    mutationFn: (invitationId) => base44.functions.invoke('resendInvitation', { invitation_id: invitationId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userInvitations'] });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (userEmail) => base44.functions.invoke('resetUserPassword', { userEmail }),
    onSuccess: (data) => {
      setResetPasswordResult(data);
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

  const handleEditUser = (user) => {
    setSelectedUser(user);
    setEditedRole(user.role);
    setShowEditDialog(true);
  };

  const handleSaveUser = () => {
    if (!selectedUser) return;
    updateUserMutation.mutate({
      userId: selectedUser.id,
      data: { role: editedRole }
    });
  };

  const handleToggleActive = (user) => {
    setSelectedUser(user);
    setShowDisableDialog(true);
  };

  const confirmToggleActive = () => {
    if (!selectedUser) return;
    const newStatus = selectedUser.is_active === false ? true : false;
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
    resetPasswordMutation.mutate(selectedUser.email);
  };

  const handleDeleteUser = (user) => {
    setSelectedUser(user);
    setShowDeleteDialog(true);
  };

  const confirmDeleteUser = () => {
    if (!selectedUser) return;
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

  // Calculate user activity stats
  const getUserActivityCount = (email) => {
    return userActivities.filter(a => a.user_email === email).length;
  };

  const getUserLastActivity = (email) => {
    const activities = userActivities.filter(a => a.user_email === email);
    if (activities.length === 0) return null;
    return activities[0].created_date;
  };

  // Stats
  const now = new Date();
  const pendingInvitations = invitations.filter(i => i.status === 'pending');
  const expiredInvitations = invitations.filter(i => i.status === 'expired' || (i.status === 'pending' && new Date(i.expires_at) < now));
  const expiringSoonInvitations = pendingInvitations.filter(i => {
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
      admin: 'bg-purple-100 text-purple-800 border-purple-300',
      user: 'bg-blue-100 text-blue-800 border-blue-300',
      manager: 'bg-green-100 text-green-800 border-green-300'
    };
    const labels = {
      admin: 'Admin',
      user: 'Nurse',
      manager: 'Manager'
    };
    return (
      <Badge className={colors[role] || 'bg-gray-100 text-gray-800'}>
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
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
            <p className="text-gray-600 mb-4">
              Only administrators can access User Management.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-xl flex items-center justify-center">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
            <p className="text-sm text-gray-600">Manage user accounts, roles, and permissions</p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-gray-500" />
              <div>
                <p className="text-xs text-gray-500">Total Users</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-purple-500" />
              <div>
                <p className="text-xs text-gray-500">Admins</p>
                <p className="text-2xl font-bold text-purple-600">{stats.admins}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-500" />
              <div>
                <p className="text-xs text-gray-500">Nurses</p>
                <p className="text-2xl font-bold text-blue-600">{stats.nurses}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-green-500" />
              <div>
                <p className="text-xs text-gray-500">Active</p>
                <p className="text-2xl font-bold text-green-600">{stats.active}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <UserX className="w-5 h-5 text-red-500" />
              <div>
                <p className="text-xs text-gray-500">Inactive</p>
                <p className="text-2xl font-bold text-red-600">{stats.inactive}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium">Filters:</span>
            </div>
            <div className="relative flex-1 max-w-xs">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-40">
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
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Pending Invitations */}
      {pendingInvitations.length > 0 && (
        <Card className="mb-6 border-yellow-200 bg-yellow-50">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-lg">
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-yellow-600" />
                <span>Pending Invitations ({pendingInvitations.length})</span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingInvitations.map((invitation) => {
                const expiresAt = new Date(invitation.expires_at);
                const isExpired = now > expiresAt;
                const hoursUntilExpiry = (expiresAt - now) / (1000 * 60 * 60);
                const isExpiringSoon = hoursUntilExpiry > 0 && hoursUntilExpiry <= 24;
                
                return (
                  <div key={invitation.id} className="flex items-center justify-between p-3 bg-white rounded-lg border">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">{invitation.full_name}</p>
                        <Badge className="text-xs">{invitation.role}</Badge>
                        {isExpiringSoon && (
                          <Badge className="bg-orange-100 text-orange-800 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Expiring Soon
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">{invitation.email}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Expires: {format(expiresAt, 'MMM d, yyyy')}
                        </span>
                        {invitation.resend_count > 0 && (
                          <span>Resent {invitation.resend_count}x</span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => resendInvitationMutation.mutate(invitation.id)}
                      disabled={resendInvitationMutation.isPending}
                      className="flex items-center gap-2"
                    >
                      <Send className="w-4 h-4" />
                      Resend
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Expired Invitations Alert */}
      {expiredInvitations.length > 0 && (
        <Alert className="mb-6 border-red-200 bg-red-50">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-900">
            <strong>{expiredInvitations.length} invitation{expiredInvitations.length > 1 ? 's have' : ' has'} expired.</strong>
            {' '}These users will need new invitations to sign up.
          </AlertDescription>
        </Alert>
      )}

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Users ({filteredUsers.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12 text-gray-500">Loading users...</div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No users found</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead>Last Active</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => {
                    const activityCount = getUserActivityCount(user.email);
                    const lastActivity = getUserLastActivity(user.email);
                    const isActive = user.is_active !== false;
                    
                    return (
                      <TableRow key={user.id} className={!isActive ? 'opacity-50' : ''}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
                              {user.full_name?.charAt(0) || 'U'}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{user.full_name}</p>
                              {currentUser.email === user.email && (
                                <Badge className="text-xs bg-blue-500 text-white">You</Badge>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-gray-600">
                            <Mail className="w-3 h-3" />
                            {user.email}
                          </div>
                        </TableCell>
                        <TableCell>{getRoleBadge(user.role)}</TableCell>
                        <TableCell>
                          <Badge className={isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                            {isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {activityCount > 0 ? `${activityCount} actions` : 'No activity'}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
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
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditUser(user)}
                              disabled={currentUser.email === user.email}
                              title="Edit user role"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleResetPassword(user)}
                              className="text-orange-600 hover:text-orange-700"
                              title="Reset password"
                            >
                              <Key className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleActive(user)}
                              disabled={currentUser.email === user.email}
                              className={isActive ? 'text-red-600 hover:text-red-700' : 'text-green-600 hover:text-green-700'}
                              title={isActive ? 'Disable user' : 'Enable user'}
                            >
                              {isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteUser(user)}
                              disabled={currentUser.email === user.email}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="Delete user permanently"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
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
                <Label className="text-sm text-gray-600">User</Label>
                <p className="font-medium">{selectedUser.full_name}</p>
                <p className="text-sm text-gray-500">{selectedUser.email}</p>
              </div>
              <div>
                <Label>Role</Label>
                <Select value={editedRole} onValueChange={setEditedRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
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
            <Button onClick={handleSaveUser} className="bg-purple-600 hover:bg-purple-700">
              Save Changes
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
              className={selectedUser?.is_active === false ? 'bg-green-600' : 'bg-red-600'}
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
                  <Alert className="bg-green-50 border-green-300">
                    <AlertDescription className="text-green-900">
                      ✅ Password reset successfully! An email with the temporary password has been sent to the user.
                    </AlertDescription>
                  </Alert>
                  <div className="p-4 bg-gray-50 rounded-lg border">
                    <p className="text-sm text-gray-600 mb-2">Temporary Password:</p>
                    <p className="font-mono text-lg font-bold text-gray-900 bg-white p-3 rounded border select-all">
                      {resetPasswordResult.tempPassword}
                    </p>
                    <p className="text-xs text-gray-500 mt-2">
                      💡 You can share this with the user if they didn't receive the email
                    </p>
                  </div>
                </div>
              ) : (
                <Alert className="bg-red-50 border-red-300">
                  <AlertDescription className="text-red-900">
                    ❌ Failed to reset password: {resetPasswordResult?.error || 'Unknown error'}
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
    </div>
  );
}