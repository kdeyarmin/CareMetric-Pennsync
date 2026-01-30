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
      <Card className="w-full max-w-full overflow-hidden">
        <CardHeader className="p-3 sm:p-4">
          <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
            <UserPlus className="w-4 h-4 sm:w-5 sm:h-5" />
            User Management
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col gap-3 sm:gap-4 mb-4">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-11"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full">
              <Button
                onClick={downloadUserRoster}
                disabled={isDownloadingRoster}
                variant="outline"
                className="gap-2 touch-target flex-1 sm:flex-initial"
                size="sm"
              >
                {isDownloadingRoster ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                ) : (
                  <><Download className="w-4 h-4" /> <span className="hidden sm:inline">Export </span>Roster</>
                )}
              </Button>
              <Button
                onClick={() => setShowInviteDialog(true)}
                className="bg-blue-600 hover:bg-blue-700 touch-target flex-1 sm:flex-initial"
                size="sm"
              >
                <Mail className="w-4 h-4 mr-2" />
                Invite <span className="hidden sm:inline">New </span>User
              </Button>
            </div>
          </div>

          <Alert className="mb-3 sm:mb-4 bg-blue-50 border-blue-200">
            <Shield className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <AlertDescription className="text-blue-900 ml-2">
              <p className="font-semibold mb-1 text-xs sm:text-sm">User Management</p>
              <p className="text-xs sm:text-sm">Manage user roles, permissions, and care scope assignments. New users gain immediate access upon signup.</p>
            </AlertDescription>
          </Alert>

          {/* Pending Invitations Section */}
          {pendingInvitations.length > 0 && (
            <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <h3 className="font-semibold text-yellow-900 mb-2 sm:mb-3 flex items-center gap-2 text-xs sm:text-sm">
                <Clock className="w-4 h-4 flex-shrink-0" />
                Pending Invitations ({pendingInvitations.length})
              </h3>
              <div className="space-y-2">
                {pendingInvitations.map((invitation) => (
                  <div key={invitation.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-2 sm:p-3 bg-white rounded border border-yellow-100">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-xs sm:text-sm break-all">{invitation.email}</p>
                      <p className="text-[10px] sm:text-xs text-gray-500">
                        Invited {invitation.created_date ? format(new Date(invitation.created_date), 'MMM d, yyyy') : 'recently'}
                        {invitation.expires_at && ` • Expires ${format(new Date(invitation.expires_at), 'MMM d')}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <Badge variant="outline" className="border-yellow-300 text-yellow-700 text-xs whitespace-nowrap">
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
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Users Display */}
          <div className="w-full overflow-hidden">
            {filteredUsers.length === 0 ? (
              <Alert className="bg-gray-50 border-gray-200">
                <Users className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <AlertDescription className="ml-2">
                  <p className="font-semibold mb-1 text-xs sm:text-sm">No users found</p>
                  <p className="text-xs sm:text-sm text-gray-600">
                    {searchTerm ? 'Try adjusting your search term' : 'Invite your first user to get started'}
                  </p>
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {/* Desktop Table View */}
                <div className="hidden lg:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">User</TableHead>
                        <TableHead className="text-xs">Email</TableHead>
                        <TableHead className="text-xs">Phone</TableHead>
                        <TableHead className="text-xs">Credentials</TableHead>
                        <TableHead className="text-xs">Role</TableHead>
                        <TableHead className="text-xs">Care Scope</TableHead>
                        <TableHead className="text-xs">Profile</TableHead>
                        <TableHead className="text-xs">Subscription</TableHead>
                        <TableHead className="text-xs">Joined</TableHead>
                        <TableHead className="text-xs">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center flex-shrink-0">
                              <span className="text-white text-xs font-semibold">
                                {user.full_name?.substring(0, 2).toUpperCase() || 'U'}
                              </span>
                            </div>
                            <span className="font-medium text-sm">{user.full_name || 'Unknown'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{user.email}</TableCell>
                        <TableCell className="text-xs">{user.phone || 'Not set'}</TableCell>
                        <TableCell className="text-xs">
                          {user.credential_type ? (
                            <Badge variant="outline" className="text-xs">
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
                          <Badge className={`text-xs ${user.role === 'admin' ? 'bg-purple-500' : 'bg-blue-500'}`}>
                            {user.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {user.care_scope ? (
                            <Badge
                              variant="outline"
                              className={`text-xs whitespace-nowrap ${
                                user.care_scope === 'home_health'
                                  ? 'border-blue-300 text-blue-700'
                                  : user.care_scope === 'hospice'
                                  ? 'border-purple-300 text-purple-700'
                                  : 'border-green-300 text-green-700'
                              }`}
                            >
                              {user.care_scope === 'home_health' ? '🏠 Home' : user.care_scope === 'hospice' ? '💜 Hospice' : '🏥 Both'}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-red-300 text-red-700 text-xs">
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
                               <Badge variant="outline" className="border-gray-300 text-xs">
                                 Free
                               </Badge>
                             );
                           }
                           if (sub.status === 'lifetime_free') {
                             return (
                               <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs whitespace-nowrap">
                                 🎁 Lifetime
                               </Badge>
                             );
                           }
                           return (
                             <Badge className={`text-xs ${
                               sub.status === 'active' ? 'bg-green-500' :
                               sub.status === 'trialing' ? 'bg-blue-500' :
                               sub.status === 'past_due' ? 'bg-red-500' :
                               'bg-gray-500'
                             }`}>
                               {sub.plan_type || sub.status}
                             </Badge>
                           );
                         })()}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500 whitespace-nowrap">
                          {user.created_date ? format(new Date(user.created_date), 'MMM d, yyyy') : 'N/A'}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleViewUserDetails(user)}
                              title="View all details"
                              className="h-8 w-8 p-0"
                            >
                              <Eye className="w-3 h-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEditUser(user)}
                              title="Edit user"
                              className="h-8 w-8 p-0"
                            >
                              <Edit className="w-3 h-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleManageSubscription(user)}
                              title="Manage subscription"
                              className="h-8 w-8 p-0"
                            >
                              <CreditCard className="w-3 h-3" />
                            </Button>
                            {(() => {
                              const sub = getUserSubscription(user.email);
                              if (!sub || sub.status !== 'lifetime_free') {
                                return (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={async () => {
                                      if (confirm(`Grant ${user.full_name || user.email} lifetime free access?`)) {
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
                                    className="text-purple-600 hover:text-purple-700 hover:bg-purple-50 h-8 w-8 p-0"
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
                              className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0"
                              disabled={user.email === currentUser?.email}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile Card View */}
                <div className="lg:hidden space-y-3">
                  {filteredUsers.map((user) => {
                    const sub = getUserSubscription(user.email);
                    return (
                      <Card key={user.id} className="overflow-hidden">
                        <CardContent className="p-3">
                          <div className="flex items-start gap-3 mb-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center flex-shrink-0">
                              <span className="text-white text-xs font-semibold">
                                {user.full_name?.substring(0, 2).toUpperCase() || 'U'}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm truncate">{user.full_name || 'Unknown'}</p>
                              <p className="text-xs text-gray-600 break-all">{user.email}</p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                <Badge className={`text-xs ${user.role === 'admin' ? 'bg-purple-500' : 'bg-blue-500'}`}>
                                  {user.role}
                                </Badge>
                                {user.credential_type && (
                                  <Badge variant="outline" className="text-xs">
                                    {user.credential_type}
                                  </Badge>
                                )}
                                {sub && sub.status !== 'free' && (
                                  <Badge className={`text-xs ${
                                    sub.status === 'lifetime_free' ? 'bg-gradient-to-r from-purple-500 to-pink-500' :
                                    sub.status === 'active' ? 'bg-green-500' :
                                    sub.status === 'trialing' ? 'bg-blue-500' :
                                    'bg-gray-500'
                                  }`}>
                                    {sub.status === 'lifetime_free' ? '🎁' : sub.plan_type || sub.status}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                            <div>
                              <p className="text-gray-500">Phone</p>
                              <p className="font-medium truncate">{user.phone || 'Not set'}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Joined</p>
                              <p className="font-medium">
                                {user.created_date ? format(new Date(user.created_date), 'MMM d, yyyy') : 'N/A'}
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleViewUserDetails(user)}
                              className="w-full touch-target"
                            >
                              <Eye className="w-3 h-3 mr-1" />
                              View
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEditUser(user)}
                              className="w-full touch-target"
                            >
                              <Edit className="w-3 h-3 mr-1" />
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleManageSubscription(user)}
                              className="w-full touch-target"
                            >
                              <CreditCard className="w-3 h-3 mr-1" />
                              Sub
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDeleteUser(user)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50 w-full touch-target"
                              disabled={user.email === currentUser?.email}
                            >
                              <Trash2 className="w-3 h-3 mr-1" />
                              Delete
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle className="text-sm sm:text-base">Invite New User</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Send an invitation email to a new user. They will create their own account and password when they sign up.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 sm:space-y-4 py-3 sm:py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <Label htmlFor="inviteEmail" className="text-xs sm:text-sm">Email Address *</Label>
                <Input
                  id="inviteEmail"
                  type="email"
                  placeholder="user@example.com"
                  value={inviteData.email}
                  onChange={(e) => setInviteData({...inviteData, email: e.target.value})}
                  className="h-11"
                />
              </div>

              <div>
                <Label htmlFor="fullName" className="text-xs sm:text-sm">Full Name *</Label>
                <Input
                  id="fullName"
                  placeholder="John Doe"
                  value={inviteData.full_name}
                  onChange={(e) => setInviteData({...inviteData, full_name: e.target.value})}
                  className="h-11"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <Label htmlFor="phone" className="text-xs sm:text-sm">Phone Number</Label>
                <Input
                  id="phone"
                  placeholder="(555) 123-4567"
                  value={inviteData.phone}
                  onChange={(e) => setInviteData({...inviteData, phone: e.target.value})}
                  className="h-11"
                />
              </div>

              <div>
                <Label htmlFor="credentials" className="text-xs sm:text-sm">Credentials</Label>
                <Input
                  id="credentials"
                  placeholder="RN, LPN, MSW, etc."
                  value={inviteData.credentials}
                  onChange={(e) => setInviteData({...inviteData, credentials: e.target.value})}
                  className="h-11"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <Label htmlFor="inviteRole" className="text-xs sm:text-sm">Role *</Label>
                <Select value={inviteData.role} onValueChange={(value) => setInviteData({...inviteData, role: value})}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user" className="text-sm">User</SelectItem>
                    <SelectItem value="admin" className="text-sm">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="inviteCareScope" className="text-xs sm:text-sm">Care Scope *</Label>
                <Select value={inviteData.care_scope} onValueChange={(value) => setInviteData({...inviteData, care_scope: value})}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="home_health" className="text-sm">🏠 Home Health Only</SelectItem>
                    <SelectItem value="hospice" className="text-sm">💜 Hospice Only</SelectItem>
                    <SelectItem value="both" className="text-sm">🏥 Both Home Health & Hospice</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Alert className="bg-blue-50 border-blue-200">
              <Mail className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <AlertDescription className="text-blue-900 ml-2">
                <p className="font-semibold mb-1 text-xs sm:text-sm">What happens next:</p>
                <ul className="text-xs sm:text-sm space-y-1">
                  <li>✓ Invitation email sent to the user</li>
                  <li>✓ User creates their own account and password</li>
                  <li>✓ User gains immediate access upon signup</li>
                  <li>✓ Invitation expires in 7 days</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowInviteDialog(false)} className="w-full sm:w-auto touch-target">
              Cancel
            </Button>
            <Button
              onClick={handleCreateUser}
              disabled={createUserMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto touch-target"
            >
              {createUserMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</>
              ) : (
                <><Mail className="w-4 h-4 mr-2" /> Send Invitation</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="w-[95vw] sm:w-full max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm sm:text-base">Edit User Profile</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Update user information and permissions.
            </DialogDescription>
          </DialogHeader>

          {editingUser && (
            <div className="space-y-3 sm:space-y-4 py-3 sm:py-4">
              <div>
                <Label className="text-xs sm:text-sm">Full Name</Label>
                <Input
                  value={editingUser.full_name}
                  onChange={(e) => setEditingUser({...editingUser, full_name: e.target.value})}
                  className="h-11"
                />
              </div>

              <div>
                <Label className="text-xs sm:text-sm">Phone</Label>
                <Input
                  value={editingUser.phone}
                  onChange={(e) => setEditingUser({...editingUser, phone: e.target.value})}
                  placeholder="(555) 123-4567"
                  className="h-11"
                />
              </div>

              <div>
                <Label className="text-xs sm:text-sm">Credential Type</Label>
                <Select 
                  value={editingUser.credential_type} 
                  onValueChange={(value) => setEditingUser({...editingUser, credential_type: value})}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select credential type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RN" className="text-sm">RN - Registered Nurse</SelectItem>
                    <SelectItem value="LPN" className="text-sm">LPN - Licensed Practical Nurse</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs sm:text-sm">License Number</Label>
                <Input
                  value={editingUser.license_number}
                  onChange={(e) => setEditingUser({...editingUser, license_number: e.target.value})}
                  className="h-11"
                />
              </div>

              <div>
                <Label className="text-xs sm:text-sm">Role</Label>
                <Select value={editingUser.role} onValueChange={(value) => setEditingUser({...editingUser, role: value})}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user" className="text-sm">User</SelectItem>
                    <SelectItem value="admin" className="text-sm">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs sm:text-sm">Care Scope</Label>
                <Select value={editingUser.care_scope} onValueChange={(value) => setEditingUser({...editingUser, care_scope: value})}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="home_health" className="text-sm">🏠 Home Health Only</SelectItem>
                    <SelectItem value="hospice" className="text-sm">💜 Hospice Only</SelectItem>
                    <SelectItem value="both" className="text-sm">🏥 Both Home Health & Hospice</SelectItem>
                  </SelectContent>
                </Select>
              </div>


            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowEditDialog(false)} className="w-full sm:w-auto touch-target">
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateUserMutation.isLoading}
              className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto touch-target"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Subscription Dialog */}
      <Dialog open={showSubscriptionDialog} onOpenChange={setShowSubscriptionDialog}>
        <DialogContent className="w-[95vw] sm:w-full max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm sm:text-base">Manage Subscription</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Update subscription status and plan for {editingSubscription?.user_name}
            </DialogDescription>
          </DialogHeader>

          {editingSubscription && (
            <div className="space-y-3 sm:space-y-4 py-3 sm:py-4">
              <Alert className="bg-blue-50 border-blue-200">
                <CreditCard className="w-4 h-4 text-blue-600 flex-shrink-0" />
                <AlertDescription className="text-blue-900 ml-2">
                  <p className="font-semibold mb-1 text-xs sm:text-sm break-all">User: {editingSubscription.user_email}</p>
                  <p className="text-xs sm:text-sm">Current Status: {editingSubscription.status}</p>
                </AlertDescription>
              </Alert>

              <div>
                <Label className="text-xs sm:text-sm">Subscription Status</Label>
                <Select 
                  value={editingSubscription.status} 
                  onValueChange={(value) => setEditingSubscription({...editingSubscription, status: value})}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free" className="text-sm">Free (No Subscription)</SelectItem>
                    <SelectItem value="lifetime_free" className="text-sm">🎁 Lifetime Free Access</SelectItem>
                    <SelectItem value="trialing" className="text-sm">Trialing</SelectItem>
                    <SelectItem value="active" className="text-sm">Active (Paid)</SelectItem>
                    <SelectItem value="past_due" className="text-sm">Past Due</SelectItem>
                    <SelectItem value="canceled" className="text-sm">Canceled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs sm:text-sm">Plan Type</Label>
                <Select 
                  value={editingSubscription.plan_type} 
                  onValueChange={(value) => setEditingSubscription({...editingSubscription, plan_type: value})}
                  disabled={editingSubscription.status === 'free'}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free" className="text-sm">Free</SelectItem>
                    <SelectItem value="monthly" className="text-sm">Monthly ($39.99)</SelectItem>
                    <SelectItem value="quarterly" className="text-sm">Quarterly ($115)</SelectItem>
                    <SelectItem value="semi_annual" className="text-sm">6 Months ($210)</SelectItem>
                    <SelectItem value="annual" className="text-sm">Annual ($350)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {editingSubscription.status === 'trialing' && (
                <div>
                  <Label className="text-xs sm:text-sm">Trial End Date</Label>
                  <Input
                    type="date"
                    value={editingSubscription.trial_end_date ? editingSubscription.trial_end_date.split('T')[0] : ''}
                    onChange={(e) => setEditingSubscription({
                      ...editingSubscription, 
                      trial_end_date: e.target.value ? new Date(e.target.value).toISOString() : null
                    })}
                    className="h-11"
                  />
                </div>
              )}

              {(editingSubscription.status === 'active' || editingSubscription.status === 'past_due') && (
                <div>
                  <Label className="text-xs sm:text-sm">Next Billing Date</Label>
                  <Input
                    type="date"
                    value={editingSubscription.next_billing_date ? editingSubscription.next_billing_date.split('T')[0] : ''}
                    onChange={(e) => setEditingSubscription({
                      ...editingSubscription, 
                      next_billing_date: e.target.value ? new Date(e.target.value).toISOString() : null
                    })}
                    className="h-11"
                  />
                </div>
              )}

              <Alert className="bg-yellow-50 border-yellow-300">
                <AlertDescription className="text-yellow-900">
                  <p className="font-semibold mb-1 text-xs sm:text-sm">⚠️ Important Notes:</p>
                  <ul className="text-xs sm:text-sm space-y-1">
                    <li>• <strong>Free:</strong> User has no subscription access</li>
                    <li>• <strong>Lifetime Free:</strong> Permanent access to all features</li>
                    <li>• <strong>Trialing:</strong> User is in free trial period</li>
                    <li>• <strong>Active:</strong> User has paid subscription</li>
                    <li>• Changes take effect immediately</li>
                    <li>• This does not cancel Stripe subscriptions</li>
                  </ul>
                </AlertDescription>
              </Alert>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowSubscriptionDialog(false)} className="w-full sm:w-auto touch-target">
              Cancel
            </Button>
            <Button
              onClick={handleSaveSubscription}
              disabled={updateSubscriptionMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto touch-target"
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
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm sm:text-base">
              <Eye className="w-4 h-4 sm:w-5 sm:h-5" />
              Complete User Profile
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm break-words">
              View and manage all information for {viewingUser?.full_name || viewingUser?.email}
            </DialogDescription>
          </DialogHeader>

          {viewingUser && (
            <div className="space-y-4 sm:space-y-6 py-3 sm:py-4">
              {/* Basic Information */}
              <Card className="overflow-hidden">
                <CardHeader className="p-3 sm:p-4">
                  <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Basic Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 p-3 sm:p-4">
                  <div className="min-w-0">
                    <Label className="text-[10px] sm:text-xs text-gray-500">Full Name</Label>
                    <p className="font-medium text-xs sm:text-sm break-words">{viewingUser.full_name || 'Not set'}</p>
                  </div>
                  <div className="min-w-0">
                    <Label className="text-[10px] sm:text-xs text-gray-500">Email</Label>
                    <p className="font-medium text-xs sm:text-sm break-all">{viewingUser.email}</p>
                  </div>
                  <div className="min-w-0">
                    <Label className="text-[10px] sm:text-xs text-gray-500">Phone</Label>
                    <p className="font-medium text-xs sm:text-sm break-words">{viewingUser.phone || 'Not set'}</p>
                  </div>
                  <div className="min-w-0">
                    <Label className="text-[10px] sm:text-xs text-gray-500">Role</Label>
                    <Badge className={`text-xs ${viewingUser.role === 'admin' ? 'bg-purple-500' : 'bg-blue-500'}`}>
                      {viewingUser.role}
                    </Badge>
                  </div>
                  <div className="min-w-0">
                    <Label className="text-[10px] sm:text-xs text-gray-500">Credential Type</Label>
                    <p className="font-medium text-xs sm:text-sm break-words">{viewingUser.credential_type || 'Not set'}</p>
                  </div>
                  <div className="min-w-0">
                    <Label className="text-[10px] sm:text-xs text-gray-500">License Number</Label>
                    <p className="font-medium text-xs sm:text-sm break-words">{viewingUser.license_number || 'Not set'}</p>
                  </div>
                  <div className="min-w-0">
                    <Label className="text-[10px] sm:text-xs text-gray-500">Care Scope</Label>
                    <p className="font-medium text-xs sm:text-sm break-words">{viewingUser.care_scope || 'Not set'}</p>
                  </div>
                  <div className="min-w-0">
                    <Label className="text-[10px] sm:text-xs text-gray-500">Agency Code</Label>
                    <p className="font-medium text-xs sm:text-sm break-words">{viewingUser.agency_code || 'Not set'}</p>
                  </div>
                  <div className="min-w-0">
                    <Label className="text-[10px] sm:text-xs text-gray-500">User ID</Label>
                    <p className="font-mono text-[10px] sm:text-xs break-all">{viewingUser.id}</p>
                  </div>
                  <div className="min-w-0">
                    <Label className="text-[10px] sm:text-xs text-gray-500">Joined</Label>
                    <p className="font-medium text-xs sm:text-sm break-words">
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
                  <Card className="overflow-hidden">
                    <CardHeader className="p-3 sm:p-4">
                      <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                        <Activity className="w-4 h-4" />
                        Activity Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 sm:p-4">
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
                        <div className="bg-blue-50 p-2 sm:p-3 md:p-4 rounded-lg">
                          <p className="text-lg sm:text-xl md:text-2xl font-bold text-blue-600">{userDetails.patients?.length || 0}</p>
                          <p className="text-[10px] sm:text-xs md:text-sm text-gray-600">Patients</p>
                        </div>
                        <div className="bg-green-50 p-2 sm:p-3 md:p-4 rounded-lg">
                          <p className="text-lg sm:text-xl md:text-2xl font-bold text-green-600">{userDetails.visits?.length || 0}</p>
                          <p className="text-[10px] sm:text-xs md:text-sm text-gray-600">Visits</p>
                        </div>
                        <div className="bg-purple-50 p-2 sm:p-3 md:p-4 rounded-lg">
                          <p className="text-lg sm:text-xl md:text-2xl font-bold text-purple-600">{userDetails.noteConversions?.length || 0}</p>
                          <p className="text-[10px] sm:text-xs md:text-sm text-gray-600">AI Notes</p>
                        </div>
                        <div className="bg-orange-50 p-2 sm:p-3 md:p-4 rounded-lg">
                          <p className="text-lg sm:text-xl md:text-2xl font-bold text-orange-600">{userDetails.activity?.length || 0}</p>
                          <p className="text-[10px] sm:text-xs md:text-sm text-gray-600">Activities</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Recent Activity */}
                  {userDetails.activity && userDetails.activity.length > 0 && (
                    <Card className="overflow-hidden">
                      <CardHeader className="p-3 sm:p-4">
                        <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          Recent Activity (Last 10)
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-3 sm:p-4">
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {userDetails.activity.slice(0, 10).map((act) => (
                            <div key={act.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-2 p-2 bg-gray-50 rounded">
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-xs sm:text-sm break-words">{act.action}</p>
                                <p className="text-[10px] sm:text-xs text-gray-500 break-words">{act.page || 'N/A'}</p>
                              </div>
                              <p className="text-[10px] sm:text-xs text-gray-400 whitespace-nowrap self-end sm:self-center">
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
              <div className="flex flex-col sm:flex-row gap-2 pt-3 sm:pt-4 border-t">
                <Button
                  onClick={() => {
                    setShowUserDetailsDialog(false);
                    handleEditUser(viewingUser);
                  }}
                  className="bg-blue-600 hover:bg-blue-700 w-full sm:flex-1 touch-target"
                  size="sm"
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
                  className="w-full sm:flex-1 touch-target"
                  size="sm"
                >
                  <CreditCard className="w-4 h-4 mr-2" />
                  Subscription
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowUserDetailsDialog(false);
                    handleDeleteUser(viewingUser);
                  }}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 w-full sm:flex-1 touch-target"
                  disabled={viewingUser?.email === currentUser?.email}
                  size="sm"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUserDetailsDialog(false)} className="w-full sm:w-auto touch-target">
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