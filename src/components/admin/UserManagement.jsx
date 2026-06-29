import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMutationWithToast } from "@/hooks/useMutationWithToast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UserPlus,
  Edit,
  Mail,
  Shield,
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Download
} from "lucide-react";
import { format } from "date-fns";
import { logActivity } from "@/components/utils/activityLogger";
import { toast } from "sonner";

export default function UserManagement({ users }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [searchTerm, setSearchTerm] = useState("");
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [isDownloadingRoster, setIsDownloadingRoster] = useState(false);
  
  const [inviteData, setInviteData] = useState({
    email: "",
    full_name: "",
    role: "user",
    care_scope: "home_health",
    phone: "",
    credentials: ""
  });

  // Update user mutation
  // Adopts the shared useMutationWithToast helper: success toast + ['allUsers']
  // invalidation + error toast/telemetry are standardized; the page-specific
  // follow-up (activity log + closing the dialog) runs in onSuccess.
  const updateUserMutation = useMutationWithToast({
    mutationFn: ({ userId, data }) => base44.entities.User.update(userId, data),
    invalidateKeys: [['allUsers']],
    successMessage: 'User updated successfully',
    errorMessage: (error) => 'Failed to update user: ' + error.message,
    onSuccess: async (_, variables) => {
      await logActivity('user_updated', {
        entity_type: 'User',
        entity_id: variables.userId,
        updated_fields: Object.keys(variables.data),
        page: 'UserManagement'
      });
      setShowEditDialog(false);
      setEditingUser(null);
    },
  });

  // Create user invitation mutation
  const createUserMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.functions.invoke('createUserWithTempPassword', data);
    },
    onSuccess: async (_data) => {
      // Log activity
      await logActivity('user_invited', {
        entity_type: 'UserInvitation',
        user_email: inviteData.email,
        user_role: inviteData.role,
        page: 'UserManagement'
      });
      
      toast.success(`Invitation sent to ${inviteData.email}. The user will receive an email with instructions. Invitation expires in 7 days.`);
      queryClient.invalidateQueries({ queryKey: ['allUsers'] });
      queryClient.invalidateQueries({ queryKey: ['userInvitations'] });
      setShowInviteDialog(false);
      setInviteData({ 
        email: "", 
        full_name: "", 
        role: "user", 
        care_scope: "home_health",
        phone: "",
        credentials: ""
      });
    },
    onError: (error) => {
      console.error('Failed to send invitation:', error);
      toast.error('Failed to send invitation: ' + error.message);
    }
  });

  const handleCreateUser = () => {
    if (!inviteData.email || !inviteData.full_name) {
      toast.error('Please enter email and full name');
      return;
    }
    createUserMutation.mutate(inviteData);
  };

  const handleEditUser = (user) => {
    setEditingUser({
      id: user.id,
      full_name: user.full_name || '',
      phone: user.phone || '',
      credential_type: user.credential_type || '',
      license_number: user.license_number || '',
      care_scope: user.care_scope || 'home_health',
      role: user.role,
      is_approved: user.is_approved ?? false,
      is_manager: user.is_manager ?? false,
      manager_email: user.manager_email || ''
    });
    setShowEditDialog(true);
  };

  const handleSaveEdit = () => {
    if (!editingUser) return;

    const { id, ...userData } = editingUser;
    updateUserMutation.mutate({ userId: id, data: userData });
  };

  // Penn Sync is invite-only: there is no manual "approve" path. Access is
  // granted ONLY by sending an invitation (invited users are auto-approved on
  // signup). Admins can still revoke access for any approved user.
  const handleRevokeAccess = async (userId) => {
    if (await confirm({ title: "Revoke access?", description: "Revoke access for this user? They will no longer be able to use the system.", confirmText: "Revoke access", destructive: true })) {
      updateUserMutation.mutate({ userId, data: { is_approved: false } });
      
      // Log revocation
      await logActivity('user_revoked', {
        entity_type: 'User',
        entity_id: userId,
        page: 'UserManagement'
      });
    }
  };

  const filteredUsers = users.filter(user =>
    user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const pendingUsers = users.filter(u => !u.is_approved && u.role !== 'admin');


  const downloadUserRoster = async () => {
    setIsDownloadingRoster(true);
    try {
      const response = await base44.functions.invoke('generateUserRosterPDF');
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `User_Roster_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error('Error downloading roster:', error);
      toast.error('Failed to generate roster PDF');
    }
    setIsDownloadingRoster(false);
  };

  return (
    <>
      {/* Invite User Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            User Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                onClick={downloadUserRoster}
                disabled={isDownloadingRoster}
                variant="outline"
                className="gap-2 w-full sm:w-auto"
              >
                {isDownloadingRoster ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                ) : (
                  <><Download className="w-4 h-4" /> Export Roster</>
                )}
              </Button>
              <Button
                onClick={() => setShowInviteDialog(true)}
                className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
              >
                <Mail className="w-4 h-4 mr-2" />
                Invite New User
              </Button>
            </div>
          </div>

          <Alert className="mb-4 bg-blue-50 border-blue-200">
            <Shield className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              <p className="font-semibold mb-1">Penn Sync User Management</p>
              <p className="text-sm">Manage user roles, permissions, and care scope assignments. Care scope determines which Medicare compliance templates users see.</p>
            </AlertDescription>
          </Alert>

          {/* Unapproved/blocked accounts. Penn Sync is invite-only, so these
              accounts cannot be approved here — access is granted only via an
              invitation. They stay blocked until invited (or were revoked). */}
          {pendingUsers.length > 0 && (
            <Alert className="mb-4 bg-yellow-50 border-yellow-300">
              <Clock className="w-4 h-4 text-yellow-600" />
              <AlertDescription className="text-yellow-900">
                <p className="font-semibold">
                  {pendingUsers.length} unapproved account{pendingUsers.length > 1 ? 's' : ''} (blocked)
                </p>
                <p className="text-sm mt-1">Penn Sync is invite-only. These accounts can’t be approved here — to grant someone access, send them an invitation. You can still revoke access for any approved user.</p>
              </AlertDescription>
            </Alert>
          )}

          {/* Users Table */}
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Credentials</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Care Scope</TableHead>
                  <TableHead>Approval</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center">
                          <span className="text-white text-xs font-semibold">
                            {user.full_name?.substring(0, 2).toUpperCase() || 'U'}
                          </span>
                        </div>
                        <span className="font-medium">{user.full_name || 'Unknown'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{user.email}</TableCell>
                    <TableCell className="text-sm">{user.phone || 'Not set'}</TableCell>
                    <TableCell className="text-sm">
                      {user.credential_type ? (
                        <Badge variant="outline">
                          {user.credential_type}
                        </Badge>
                      ) : (
                        <span className="text-slate-400">Not set</span>
                      )}
                      {user.license_number && (
                        <div className="text-xs text-slate-500 mt-1">Lic: {user.license_number}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={user.role === 'admin' ? 'bg-navy-500' : 'bg-blue-500'}>
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.care_scope ? (
                        <Badge
                          variant="outline"
                          className={
                            user.care_scope === 'home_health'
                              ? 'border-blue-300 text-blue-700'
                              : user.care_scope === 'hospice'
                              ? 'border-navy-300 text-navy-700'
                              : 'border-green-300 text-green-700'
                          }
                        >
                          {user.care_scope === 'home_health' ? '🏠 Home Health' : user.care_scope === 'hospice' ? '💜 Hospice' : '🏥 Both'}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-red-300 text-red-700">
                          ⚠️ Not Set
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {user.is_approved || user.role === 'admin' ? (
                        <Badge className="bg-green-500">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Approved
                        </Badge>
                      ) : (
                        <Badge className="bg-yellow-500">
                          <Clock className="w-3 h-3 mr-1" />
                          Pending
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {user.phone && user.credentials && user.care_scope ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      ) : (
                        <XCircle className="w-5 h-5 text-yellow-600" title="Incomplete profile" />
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {user.created_date ? format(new Date(user.created_date), 'MMM d, yyyy') : 'N/A'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {user.is_approved && user.role !== 'admin' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRevokeAccess(user.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            title="Revoke access"
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditUser(user)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invite New User</DialogTitle>
            <DialogDescription>
              Send an invitation email to a new user. They will create their own account and password when they sign up.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="inviteEmail">Email Address *</Label>
                <Input
                  id="inviteEmail"
                  type="email"
                  placeholder="user@example.com"
                  value={inviteData.email}
                  onChange={(e) => setInviteData({...inviteData, email: e.target.value})}
                />
              </div>

              <div>
                <Label htmlFor="fullName">Full Name *</Label>
                <Input
                  id="fullName"
                  placeholder="John Doe"
                  value={inviteData.full_name}
                  onChange={(e) => setInviteData({...inviteData, full_name: e.target.value})}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  placeholder="(555) 123-4567"
                  value={inviteData.phone}
                  onChange={(e) => setInviteData({...inviteData, phone: e.target.value})}
                />
              </div>

              <div>
                <Label htmlFor="credentials">Credentials</Label>
                <Input
                  id="credentials"
                  placeholder="RN, LPN, MSW, etc."
                  value={inviteData.credentials}
                  onChange={(e) => setInviteData({...inviteData, credentials: e.target.value})}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="inviteRole">Role *</Label>
                <Select value={inviteData.role} onValueChange={(value) => setInviteData({...inviteData, role: value})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="inviteCareScope">Care Scope *</Label>
                <Select value={inviteData.care_scope} onValueChange={(value) => setInviteData({...inviteData, care_scope: value})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="home_health">🏠 Home Health Only</SelectItem>
                    <SelectItem value="hospice">💜 Hospice Only</SelectItem>
                    <SelectItem value="both">🏥 Both Home Health & Hospice</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Alert className="bg-blue-50 border-blue-200">
              <Mail className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-900">
                <p className="font-semibold mb-1">What happens next:</p>
                <ul className="text-sm space-y-1">
                  <li>✓ Invitation email sent to the user</li>
                  <li>✓ User creates their own account and password</li>
                  <li>✓ Account automatically approved upon signup</li>
                  <li>✓ Invitation expires in 7 days</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateUser}
              disabled={createUserMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {createUserMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending Invitation...</>
              ) : (
                <><Mail className="w-4 h-4 mr-2" /> Send Invitation</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User Profile</DialogTitle>
            <DialogDescription>
              Update user information and permissions.
            </DialogDescription>
          </DialogHeader>

          {editingUser && (
            <div className="space-y-4 py-4">
              <div>
                <Label>Full Name</Label>
                <Input
                  value={editingUser.full_name}
                  onChange={(e) => setEditingUser({...editingUser, full_name: e.target.value})}
                />
              </div>

              <div>
                <Label>Phone</Label>
                <Input
                  value={editingUser.phone}
                  onChange={(e) => setEditingUser({...editingUser, phone: e.target.value})}
                  placeholder="(555) 123-4567"
                />
              </div>

              <div>
                <Label>Credential Type</Label>
                <Select 
                  value={editingUser.credential_type} 
                  onValueChange={(value) => setEditingUser({...editingUser, credential_type: value})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select credential type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RN">RN - Registered Nurse</SelectItem>
                    <SelectItem value="LPN">LPN - Licensed Practical Nurse</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>License Number</Label>
                <Input
                  value={editingUser.license_number}
                  onChange={(e) => setEditingUser({...editingUser, license_number: e.target.value})}
                />
              </div>

              <div>
                <Label>Role</Label>
                <Select value={editingUser.role} onValueChange={(value) => setEditingUser({...editingUser, role: value})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Care Scope</Label>
                <Select value={editingUser.care_scope} onValueChange={(value) => setEditingUser({...editingUser, care_scope: value})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="home_health">🏠 Home Health Only</SelectItem>
                    <SelectItem value="hospice">💜 Hospice Only</SelectItem>
                    <SelectItem value="both">🏥 Both Home Health & Hospice</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="p-4 bg-emerald-50 rounded-lg space-y-3 border border-emerald-100">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-medium">Time-off approver</Label>
                    <p className="text-sm text-slate-600">Let this user approve their team's time-off requests</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={editingUser.is_manager ? 'bg-emerald-500' : 'bg-slate-400'}>
                      {editingUser.is_manager ? 'Approver' : 'Not an approver'}
                    </Badge>
                    <Button
                      size="sm"
                      variant={editingUser.is_manager ? 'outline' : 'default'}
                      onClick={() => setEditingUser({ ...editingUser, is_manager: !editingUser.is_manager })}
                      className={editingUser.is_manager ? '' : 'bg-emerald-600 hover:bg-emerald-700'}
                    >
                      {editingUser.is_manager ? 'Remove approver' : 'Make approver'}
                    </Button>
                  </div>
                </div>
                <div>
                  <Label className="text-sm">Reports to (approver for their requests)</Label>
                  <Select
                    value={editingUser.manager_email || 'none'}
                    onValueChange={(value) => setEditingUser({ ...editingUser, manager_email: value === 'none' ? '' : value })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="No manager (route to admins)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No manager (route to admins)</SelectItem>
                      {users
                        .filter((u) => u.email && u.id !== editingUser.id && (u.role === 'admin' || u.is_manager === true))
                        .map((u) => (
                          <SelectItem key={u.id} value={u.email}>
                            {u.full_name || u.email} {u.role === 'admin' ? '(Admin)' : ''}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {editingUser.role !== 'admin' && (
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                  <div>
                    <Label className="text-base font-medium">Account Approval</Label>
                    <p className="text-sm text-slate-600">
                      {editingUser.is_approved
                        ? 'Allow this user to access the system'
                        : 'Invite-only — access is granted only via an invitation, not here'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={editingUser.is_approved ? 'bg-green-500' : 'bg-yellow-500'}>
                      {editingUser.is_approved ? (
                        <>
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Approved
                        </>
                      ) : (
                        <>
                          <Clock className="w-3 h-3 mr-1" />
                          Blocked
                        </>
                      )}
                    </Badge>
                    {/* Invite-only: no manual approve. Revoke remains available. */}
                    {editingUser.is_approved && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingUser({...editingUser, is_approved: false})}
                      >
                        Revoke Access
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateUserMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}