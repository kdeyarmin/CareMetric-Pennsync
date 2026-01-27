import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Trash2,
  Mail,
  Phone,
  Shield,
  Search,
  CheckCircle2,
  XCircle,
  Users,
  Loader2,
  Clock,
  Download,
  CreditCard,
  Eye,
  FileText,
  Activity,
  AlertCircle
} from "lucide-react";
import { format } from "date-fns";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";

export default function UserManagement({ users, currentUser }) {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showSubscriptionDialog, setShowSubscriptionDialog] = useState(false);
  const [showUserDetailsDialog, setShowUserDetailsDialog] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [editingSubscription, setEditingSubscription] = useState(null);
  const [viewingUser, setViewingUser] = useState(null);
  const [isDownloadingRoster, setIsDownloadingRoster] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);
  
  const [inviteData, setInviteData] = useState({
    email: "",
    full_name: "",
    role: "user",
    care_scope: "home_health",
    phone: "",
    credentials: ""
  });

  // Fetch all subscriptions
  const { data: subscriptions = [] } = useQuery({
    queryKey: ['allSubscriptions'],
    queryFn: () => base44.entities.Subscription.list(),
    initialData: [],
  });

  // Fetch pending invitations
  const { data: pendingInvitations = [] } = useQuery({
    queryKey: ['userInvitations'],
    queryFn: async () => {
      try {
        return await base44.entities.UserInvitation.list() || [];
      } catch (error) {
        console.error('Error fetching invitations:', error);
        return [];
      }
    },
    initialData: [],
  });

  // Fetch user details (patients, visits, activity)
  const { data: userDetails, isLoading: userDetailsLoading } = useQuery({
    queryKey: ['userDetails', viewingUser?.id],
    queryFn: async () => {
      if (!viewingUser) return null;
      
      const [patients, visits, activity, noteConversions] = await Promise.all([
        base44.entities.Patient.filter({ created_by: viewingUser.email }).catch(() => []),
        base44.entities.Visit.filter({ created_by: viewingUser.email }).catch(() => []),
        base44.entities.UserActivity.filter({ user_email: viewingUser.email }).catch(() => []),
        base44.entities.NoteConversion.filter({ nurse_email: viewingUser.email }).catch(() => [])
      ]);

      return { patients, visits, activity, noteConversions };
    },
    enabled: !!viewingUser
  });

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: ({ userId, data }) => base44.entities.User.update(userId, data),
    onSuccess: async (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['allUsers'] });
      
      // Log activity
      await logActivity('user_updated', {
        entity_type: 'User',
        entity_id: variables.userId,
        updated_fields: Object.keys(variables.data),
        page: 'UserManagement'
      });
      
      setShowEditDialog(false);
      setEditingUser(null);
      alert('User updated successfully');
    },
    onError: (error) => {
      alert('Failed to update user: ' + error.message);
    }
  });

  // Update subscription mutation
  const updateSubscriptionMutation = useMutation({
    mutationFn: async ({ subscriptionId, data }) => {
      if (subscriptionId) {
        return await base44.entities.Subscription.update(subscriptionId, data);
      } else {
        return await base44.entities.Subscription.create(data);
      }
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['allSubscriptions'] });
      
      await logActivity('subscription_updated', {
        entity_type: 'Subscription',
        page: 'UserManagement'
      });
      
      setShowSubscriptionDialog(false);
      setEditingSubscription(null);
      alert('Subscription updated successfully');
    },
    onError: (error) => {
      alert('Failed to update subscription: ' + error.message);
    }
  });

  // Create user invitation mutation
  const createUserMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.functions.invoke('createUserWithTempPassword', data);
    },
    onSuccess: async (data) => {
      // Log activity
      await logActivity('user_invited', {
        entity_type: 'UserInvitation',
        user_email: inviteData.email,
        user_role: inviteData.role,
        page: 'UserManagement'
      });
      
      alert(`Invitation sent successfully to ${inviteData.email}!\n\nThe user will receive an email with instructions to create their account.\n\nInvitation expires in 7 days.`);
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
      alert('Failed to send invitation: ' + error.message);
    }
  });

  // Delete invitation mutation
  const deleteInvitationMutation = useMutation({
    mutationFn: async (invitationId) => {
      await base44.entities.UserInvitation.delete(invitationId);
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['userInvitations'] });
      
      await logActivity('invitation_deleted', {
        entity_type: 'UserInvitation',
        page: 'UserManagement'
      });
      
      alert('Invitation deleted successfully');
    },
    onError: (error) => {
      console.error('Failed to delete invitation:', error);
      alert('Failed to delete invitation: ' + error.message);
    }
  });

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: async ({ userId, userEmail }) => {
      const response = await base44.functions.invoke('deleteUser', {
        user_id: userId,
        user_email: userEmail
      });
      return response.data || response;
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['allUsers'] });
      queryClient.invalidateQueries({ queryKey: ['allSubscriptions'] });
      
      await logActivity('user_deleted', {
        entity_type: 'User',
        entity_id: userToDelete?.id,
        deleted_user_email: userToDelete?.email,
        page: 'UserManagement'
      });
      
      setShowDeleteDialog(false);
      setUserToDelete(null);
      alert('User deleted successfully');
    },
    onError: (error) => {
      console.error('Failed to delete user:', error);
      alert('Failed to delete user: ' + error.message);
    }
  });

  const handleDeleteUser = (user) => {
    setUserToDelete(user);
    setShowDeleteDialog(true);
  };

  const confirmDeleteUser = () => {
    if (!userToDelete) return;
    deleteUserMutation.mutate({
      userId: userToDelete.id,
      userEmail: userToDelete.email
    });
  };

  const handleCreateUser = () => {
    if (!inviteData.email || !inviteData.full_name) {
      alert('Please enter email and full name');
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
      is_approved: user.is_approved ?? false
    });
    setShowEditDialog(true);
  };

  const handleSaveEdit = () => {
    if (!editingUser) return;
    
    const { id, ...userData } = editingUser;
    updateUserMutation.mutate({ userId: id, data: userData });
  };

  const handleManageSubscription = (user) => {
    const userSub = subscriptions.find(s => s.user_email === user.email);
    setEditingSubscription({
      user_email: user.email,
      user_name: user.full_name,
      subscriptionId: userSub?.id || null,
      status: userSub?.status || 'free',
      plan_type: userSub?.plan_type || 'free',
      trial_end_date: userSub?.trial_end_date || null,
      next_billing_date: userSub?.next_billing_date || null
    });
    setShowSubscriptionDialog(true);
  };

  const handleSaveSubscription = () => {
    if (!editingSubscription) return;
    
    const { subscriptionId, user_email, user_name, ...subData } = editingSubscription;
    
    updateSubscriptionMutation.mutate({
      subscriptionId,
      data: {
        user_email,
        ...subData,
        updated_date: new Date().toISOString()
      }
    });
  };

  const handleApproveUser = async (userId) => {
    if (confirm('Approve this user to access the system?')) {
      updateUserMutation.mutate({ userId, data: { is_approved: true } });
      
      // Log approval
      await logActivity('user_approved', {
        entity_type: 'User',
        entity_id: userId,
        page: 'UserManagement'
      });
    }
  };

  const handleRevokeAccess = async (userId) => {
    if (confirm('Revoke access for this user? They will no longer be able to use the system.')) {
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

  const getUserSubscription = (userEmail) => {
    return subscriptions.find(s => s.user_email === userEmail);
  };

  const pendingUsers = users.filter(u => !u.is_approved && u.role !== 'admin');
  const approvedUsers = users.filter(u => u.is_approved || u.role === 'admin');

  const handleViewUserDetails = (user) => {
    setViewingUser(user);
    setShowUserDetailsDialog(true);
  };

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
      alert('Failed to generate roster PDF');
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
          <div className="flex justify-between items-center mb-4">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={downloadUserRoster}
                disabled={isDownloadingRoster}
                variant="outline"
                className="gap-2"
              >
                {isDownloadingRoster ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                ) : (
                  <><Download className="w-4 h-4" /> Export Roster</>
                )}
              </Button>
              <Button
                onClick={() => setShowInviteDialog(true)}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Mail className="w-4 h-4 mr-2" />
                Invite New User
              </Button>
            </div>
          </div>

          <Alert className="mb-4 bg-blue-50 border-blue-200">
            <Shield className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              <p className="font-semibold mb-1">User Management</p>
              <p className="text-sm">Manage user roles, permissions, and care scope assignments. New users gain immediate access upon signup.</p>
            </AlertDescription>
          </Alert>

          {/* Pending Invitations Section */}
          {pendingInvitations.length > 0 && (
            <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <h3 className="font-semibold text-yellow-900 mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Pending Invitations ({pendingInvitations.length})
              </h3>
              <div className="space-y-2">
                {pendingInvitations.map((invitation) => (
                  <div key={invitation.id} className="flex items-center justify-between p-2 bg-white rounded border border-yellow-100">
                    <div>
                      <p className="font-medium text-sm">{invitation.email}</p>
                      <p className="text-xs text-gray-500">
                        Invited {invitation.created_date ? format(new Date(invitation.created_date), 'MMM d, yyyy') : 'recently'}
                        {invitation.expires_at && ` • Expires ${format(new Date(invitation.expires_at), 'MMM d, yyyy')}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-yellow-300 text-yellow-700">
                        Pending
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete invitation for ${invitation.email}?`)) {
                            deleteInvitationMutation.mutate(invitation.id);
                          }
                        }}
                        disabled={deleteInvitationMutation.isPending}
                        title="Delete invitation"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Users Table */}
          <div className="overflow-x-auto">
            {filteredUsers.length === 0 ? (
              <Alert className="bg-gray-50 border-gray-200">
                <Users className="w-4 h-4 text-gray-400" />
                <AlertDescription>
                  <p className="font-semibold mb-1">No users found</p>
                  <p className="text-sm text-gray-600">
                    {searchTerm ? 'Try adjusting your search term' : 'Invite your first user to get started'}
                  </p>
                </AlertDescription>
              </Alert>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Credentials</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Care Scope</TableHead>
                    <TableHead>Profile</TableHead>
                    <TableHead>Subscription</TableHead>
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
                        <span className="text-gray-400">Not set</span>
                      )}
                      {user.license_number && (
                        <div className="text-xs text-gray-500 mt-1">Lic: {user.license_number}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={user.role === 'admin' ? 'bg-purple-500' : 'bg-blue-500'}>
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
                              ? 'border-purple-300 text-purple-700'
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
                      {user.phone && user.credentials && user.care_scope ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      ) : (
                        <XCircle className="w-5 h-5 text-yellow-600" title="Incomplete profile" />
                      )}
                    </TableCell>
                    <TableCell>
                     {(() => {
                       const sub = getUserSubscription(user.email);
                       if (!sub || sub.status === 'free') {
                         return (
                           <Badge variant="outline" className="border-gray-300">
                             Free
                           </Badge>
                         );
                       }
                       if (sub.status === 'lifetime_free') {
                         return (
                           <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white">
                             🎁 Lifetime Free
                           </Badge>
                         );
                       }
                       return (
                         <Badge className={
                           sub.status === 'active' ? 'bg-green-500' :
                           sub.status === 'trialing' ? 'bg-blue-500' :
                           sub.status === 'past_due' ? 'bg-red-500' :
                           'bg-gray-500'
                         }>
                           {sub.plan_type || sub.status}
                         </Badge>
                       );
                     })()}
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {user.created_date ? format(new Date(user.created_date), 'MMM d, yyyy') : 'N/A'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleViewUserDetails(user)}
                          title="View all details"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditUser(user)}
                          title="Edit user"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleManageSubscription(user)}
                          title="Manage subscription"
                        >
                          <CreditCard className="w-4 h-4" />
                        </Button>
                        {(() => {
                          const sub = getUserSubscription(user.email);
                          if (!sub || sub.status !== 'lifetime_free') {
                            return (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  if (confirm(`Grant ${user.full_name || user.email} lifetime free access to all features?`)) {
                                    const existingSub = getUserSubscription(user.email);
                                    if (existingSub) {
                                      await updateSubscriptionMutation.mutateAsync({
                                        subscriptionId: existingSub.id,
                                        data: { status: 'lifetime_free', plan_type: 'lifetime_free' }
                                      });
                                    } else {
                                      await updateSubscriptionMutation.mutateAsync({
                                        subscriptionId: null,
                                        data: { 
                                          user_email: user.email,
                                          status: 'lifetime_free', 
                                          plan_type: 'lifetime_free' 
                                        }
                                      });
                                    }
                                  }
                                }}
                                title="Grant lifetime free access"
                                className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                              >
                                🎁
                              </Button>
                            );
                          }
                          return null;
                        })()}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeleteUser(user)}
                          title="Delete user"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          disabled={user.email === currentUser?.email}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Delete User Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              Delete User
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete the user account and all associated data.
            </DialogDescription>
          </DialogHeader>

          {userToDelete && (
            <Alert className="bg-red-50 border-red-300">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-red-900">
                <p className="font-semibold mb-2">You are about to delete:</p>
                <div className="space-y-1 text-sm">
                  <p><strong>Name:</strong> {userToDelete.full_name || 'N/A'}</p>
                  <p><strong>Email:</strong> {userToDelete.email}</p>
                  <p><strong>Role:</strong> {userToDelete.role}</p>
                </div>
                <p className="mt-3 text-sm font-semibold">
                  This will delete:
                </p>
                <ul className="text-sm space-y-1 mt-1">
                  <li>• User account and profile</li>
                  <li>• Associated subscription records</li>
                  <li>• Activity logs will be preserved for audit purposes</li>
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowDeleteDialog(false);
                setUserToDelete(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmDeleteUser}
              disabled={deleteUserMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteUserMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Deleting...</>
              ) : (
                <><Trash2 className="w-4 h-4 mr-2" /> Delete User</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  <li>✓ User gains immediate access upon signup</li>
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


            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateUserMutation.isLoading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Subscription Dialog */}
      <Dialog open={showSubscriptionDialog} onOpenChange={setShowSubscriptionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Subscription</DialogTitle>
            <DialogDescription>
              Update subscription status and plan for {editingSubscription?.user_name}
            </DialogDescription>
          </DialogHeader>

          {editingSubscription && (
            <div className="space-y-4 py-4">
              <Alert className="bg-blue-50 border-blue-200">
                <CreditCard className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-900">
                  <p className="font-semibold mb-1">User: {editingSubscription.user_email}</p>
                  <p className="text-sm">Current Status: {editingSubscription.status}</p>
                </AlertDescription>
              </Alert>

              <div>
                <Label>Subscription Status</Label>
                <Select 
                  value={editingSubscription.status} 
                  onValueChange={(value) => setEditingSubscription({...editingSubscription, status: value})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free (No Subscription)</SelectItem>
                    <SelectItem value="lifetime_free">🎁 Lifetime Free Access</SelectItem>
                    <SelectItem value="trialing">Trialing</SelectItem>
                    <SelectItem value="active">Active (Paid)</SelectItem>
                    <SelectItem value="past_due">Past Due</SelectItem>
                    <SelectItem value="canceled">Canceled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Plan Type</Label>
                <Select 
                  value={editingSubscription.plan_type} 
                  onValueChange={(value) => setEditingSubscription({...editingSubscription, plan_type: value})}
                  disabled={editingSubscription.status === 'free'}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="monthly">Monthly ($39.99)</SelectItem>
                    <SelectItem value="quarterly">Quarterly ($115)</SelectItem>
                    <SelectItem value="semi_annual">6 Months ($210)</SelectItem>
                    <SelectItem value="annual">Annual ($350)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {editingSubscription.status === 'trialing' && (
                <div>
                  <Label>Trial End Date</Label>
                  <Input
                    type="date"
                    value={editingSubscription.trial_end_date ? editingSubscription.trial_end_date.split('T')[0] : ''}
                    onChange={(e) => setEditingSubscription({
                      ...editingSubscription, 
                      trial_end_date: e.target.value ? new Date(e.target.value).toISOString() : null
                    })}
                  />
                </div>
              )}

              {(editingSubscription.status === 'active' || editingSubscription.status === 'past_due') && (
                <div>
                  <Label>Next Billing Date</Label>
                  <Input
                    type="date"
                    value={editingSubscription.next_billing_date ? editingSubscription.next_billing_date.split('T')[0] : ''}
                    onChange={(e) => setEditingSubscription({
                      ...editingSubscription, 
                      next_billing_date: e.target.value ? new Date(e.target.value).toISOString() : null
                    })}
                  />
                </div>
              )}

              <Alert className="bg-yellow-50 border-yellow-300">
                <AlertDescription className="text-yellow-900">
                  <p className="font-semibold mb-1">⚠️ Important Notes:</p>
                  <ul className="text-sm space-y-1">
                    <li>• <strong>Free:</strong> User has no subscription access</li>
                    <li>• <strong>Lifetime Free:</strong> User has permanent access to all features (special grant)</li>
                    <li>• <strong>Trialing:</strong> User is in free trial period</li>
                    <li>• <strong>Active:</strong> User has paid subscription</li>
                    <li>• Changes take effect immediately for the user</li>
                    <li>• This does not cancel Stripe subscriptions - handle that separately</li>
                  </ul>
                </AlertDescription>
              </Alert>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubscriptionDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveSubscription}
              disabled={updateSubscriptionMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {updateSubscriptionMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User Details Dialog */}
      <Dialog open={showUserDetailsDialog} onOpenChange={setShowUserDetailsDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              Complete User Profile
            </DialogTitle>
            <DialogDescription>
              View and manage all information for {viewingUser?.full_name || viewingUser?.email}
            </DialogDescription>
          </DialogHeader>

          {viewingUser && (
            <div className="space-y-6 py-4">
              {/* Basic Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Basic Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-gray-500">Full Name</Label>
                    <p className="font-medium">{viewingUser.full_name || 'Not set'}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500">Email</Label>
                    <p className="font-medium">{viewingUser.email}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500">Phone</Label>
                    <p className="font-medium">{viewingUser.phone || 'Not set'}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500">Role</Label>
                    <Badge className={viewingUser.role === 'admin' ? 'bg-purple-500' : 'bg-blue-500'}>
                      {viewingUser.role}
                    </Badge>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500">Credential Type</Label>
                    <p className="font-medium">{viewingUser.credential_type || 'Not set'}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500">License Number</Label>
                    <p className="font-medium">{viewingUser.license_number || 'Not set'}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500">Care Scope</Label>
                    <p className="font-medium">{viewingUser.care_scope || 'Not set'}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500">Agency Code</Label>
                    <p className="font-medium">{viewingUser.agency_code || 'Not set'}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500">User ID</Label>
                    <p className="font-mono text-xs">{viewingUser.id}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500">Joined</Label>
                    <p className="font-medium">
                      {viewingUser.created_date ? format(new Date(viewingUser.created_date), 'MMM d, yyyy h:mm a') : 'N/A'}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Activity Stats */}
              {userDetailsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : userDetails && (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Activity className="w-4 h-4" />
                        Activity Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-4 gap-4">
                        <div className="bg-blue-50 p-4 rounded-lg">
                          <p className="text-2xl font-bold text-blue-600">{userDetails.patients?.length || 0}</p>
                          <p className="text-sm text-gray-600">Patients Created</p>
                        </div>
                        <div className="bg-green-50 p-4 rounded-lg">
                          <p className="text-2xl font-bold text-green-600">{userDetails.visits?.length || 0}</p>
                          <p className="text-sm text-gray-600">Visits Documented</p>
                        </div>
                        <div className="bg-purple-50 p-4 rounded-lg">
                          <p className="text-2xl font-bold text-purple-600">{userDetails.noteConversions?.length || 0}</p>
                          <p className="text-sm text-gray-600">AI Notes Generated</p>
                        </div>
                        <div className="bg-orange-50 p-4 rounded-lg">
                          <p className="text-2xl font-bold text-orange-600">{userDetails.activity?.length || 0}</p>
                          <p className="text-sm text-gray-600">Total Activities</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Recent Activity */}
                  {userDetails.activity && userDetails.activity.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          Recent Activity (Last 10)
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {userDetails.activity.slice(0, 10).map((act) => (
                            <div key={act.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                              <div>
                                <p className="font-medium text-sm">{act.action}</p>
                                <p className="text-xs text-gray-500">{act.page || 'N/A'}</p>
                              </div>
                              <p className="text-xs text-gray-400">
                                {act.created_date ? format(new Date(act.created_date), 'MMM d, h:mm a') : 'N/A'}
                              </p>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}

              {/* Quick Actions */}
              <div className="flex gap-2 pt-4 border-t">
                <Button
                  onClick={() => {
                    setShowUserDetailsDialog(false);
                    handleEditUser(viewingUser);
                  }}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Edit User
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowUserDetailsDialog(false);
                    handleManageSubscription(viewingUser);
                  }}
                >
                  <CreditCard className="w-4 h-4 mr-2" />
                  Manage Subscription
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowUserDetailsDialog(false);
                    handleDeleteUser(viewingUser);
                  }}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  disabled={viewingUser?.email === currentUser?.email}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete User
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUserDetailsDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              Delete User
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete the user account and all associated data.
            </DialogDescription>
          </DialogHeader>

          {userToDelete && (
            <Alert className="bg-red-50 border-red-300">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-red-900">
                <p className="font-semibold mb-2">You are about to delete:</p>
                <div className="space-y-1 text-sm">
                  <p><strong>Name:</strong> {userToDelete.full_name || 'N/A'}</p>
                  <p><strong>Email:</strong> {userToDelete.email}</p>
                  <p><strong>Role:</strong> {userToDelete.role}</p>
                </div>
                <p className="mt-3 text-sm font-semibold">
                  This will delete:
                </p>
                <ul className="text-sm space-y-1 mt-1">
                  <li>• User account and profile</li>
                  <li>• Associated subscription records</li>
                  <li>• Activity logs will be preserved for audit purposes</li>
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowDeleteDialog(false);
                setUserToDelete(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmDeleteUser}
              disabled={deleteUserMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteUserMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Deleting...</>
              ) : (
                <><Trash2 className="w-4 h-4 mr-2" /> Delete User</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}