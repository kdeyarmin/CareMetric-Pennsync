import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Building2, Users, DollarSign, TrendingUp, UserPlus, Mail, Calendar, CreditCard, BarChart3, Settings } from "lucide-react";
import { format } from "date-fns";
import AgencyFeatureSettings from "../components/agency/AgencyFeatureSettings";
import AgencyGuidedSetup from "../components/agency/AgencyGuidedSetup";
import AgencyRoleBasedAccess from "../components/agency/AgencyRoleBasedAccess";
import AgencyInvitationManager from "../components/agency/AgencyInvitationManager";
import AgencyBrandingSettings from "../components/agency/AgencyBrandingSettings";

export default function AgencyDashboard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [inviteEmail, setInviteEmail] = useState("");

  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        base44.auth.redirectToLogin();
        return null;
      }
    }
  });

  // Get agency where user is admin
  const { data: agency, isLoading: agencyLoading } = useQuery({
    queryKey: ['myAgency', currentUser?.email],
    queryFn: async () => {
      const agencies = await base44.entities.Agency.filter({ 
        admin_email: currentUser.email 
      });
      return agencies[0];
    },
    enabled: !!currentUser?.email
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
    enabled: !!agency
  });

  const agencyUsers = allUsers.filter(u => u.agency_code === agency?.agency_code);

  const inviteUserMutation = useMutation({
    mutationFn: async (email) => {
      await base44.users.inviteUser(email, 'user');
      // Send them the agency code in the invitation email
      await base44.integrations.Core.SendEmail({
        to: email,
        subject: `Join ${agency.agency_name} on CareMetric AI`,
        body: `You've been invited to join ${agency.agency_name} on CareMetric AI.\n\nYour agency code is: ${agency.agency_code}\n\nAfter you sign up, go to Settings and enter this code to join the agency.\n\nGet started: ${window.location.origin}`
      });
    },
    onSuccess: () => {
      toast.success('Invitation sent!');
      setInviteEmail("");
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to send invitation');
    }
  });

  if (userLoading || agencyLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!agency) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No Agency Access</h3>
            <p className="text-slate-600 mb-4">
              You don't have agency admin access. If you believe this is an error, please contact support.
            </p>
            <Button onClick={() => navigate('/')}>Go to Dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const monthlyBill = agencyUsers.length * agency.price_per_user;
  const utilizationPercent = (agencyUsers.length / agency.max_users) * 100;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
          <Building2 className="w-8 h-8 text-blue-600" />
          {agency.agency_name}
        </h1>
        <p className="text-slate-600 mt-1">Agency Management Dashboard</p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-8 h-8 text-blue-600" />
              <Badge>{agency.status}</Badge>
            </div>
            <p className="text-3xl font-bold text-slate-900">{agencyUsers.length}</p>
            <p className="text-xs text-slate-600">Active Users (of {agency.max_users} max)</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <DollarSign className="w-8 h-8 text-green-600" />
            </div>
            <p className="text-3xl font-bold text-slate-900">${monthlyBill.toFixed(2)}</p>
            <p className="text-xs text-slate-600">Current Monthly Bill</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-8 h-8 text-purple-600" />
            </div>
            <p className="text-3xl font-bold text-slate-900">{utilizationPercent.toFixed(0)}%</p>
            <p className="text-xs text-slate-600">Seat Utilization</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Calendar className="w-8 h-8 text-amber-600" />
            </div>
            <p className="text-lg font-bold text-slate-900">
              {agency.next_billing_date ? format(new Date(agency.next_billing_date), 'MMM d') : 'N/A'}
            </p>
            <p className="text-xs text-slate-600">Next Billing Date</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="users" className="space-y-6">
        <TabsList>
          <TabsTrigger value="users">👥 Users</TabsTrigger>
          <TabsTrigger value="billing">💳 Billing</TabsTrigger>
          <TabsTrigger value="features">⚙️ Features</TabsTrigger>
          <TabsTrigger value="settings">⚙️ Settings</TabsTrigger>
          <TabsTrigger value="analytics">📊 Analytics</TabsTrigger>
        </TabsList>

        {/* Users Tab */}
        <TabsContent value="users" className="space-y-4">
          <AgencyInvitationManager agency={agency} />

          <Card>
            <CardHeader>
              <CardTitle>Agency Users ({agencyUsers.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {agencyUsers.map((user) => (
                  <div key={user.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div>
                      <p className="font-medium">{user.full_name || user.email}</p>
                      <p className="text-sm text-slate-600">{user.email}</p>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline">
                        {user.credential_type || user.provider_type || 'Provider'}
                      </Badge>
                      {user.joined_agency_date && (
                        <p className="text-xs text-slate-500 mt-1">
                          Joined: {format(new Date(user.joined_agency_date), 'MMM d, yyyy')}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                {agencyUsers.length === 0 && (
                  <p className="text-center text-slate-500 py-8">No users yet. Invite your first user above.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Billing Tab */}
        <TabsContent value="billing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5" />
                Billing Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-slate-600">Price Per User</p>
                  <p className="text-xl font-bold">${agency.price_per_user}/month</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Billing Cycle</p>
                  <p className="text-xl font-bold capitalize">{agency.billing_cycle}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Current Month Bill</p>
                  <p className="text-xl font-bold text-green-600">${monthlyBill.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Total Billed</p>
                  <p className="text-xl font-bold">${agency.total_billed_amount?.toFixed(2) || '0.00'}</p>
                </div>
              </div>

              {agency.stripe_customer_id && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-slate-600 mb-2">Stripe Customer ID</p>
                  <code className="text-xs bg-slate-100 px-2 py-1 rounded">{agency.stripe_customer_id}</code>
                </div>
              )}

              {agency.contact_email && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-slate-600">Billing Contact</p>
                  <p className="font-medium">{agency.contact_name}</p>
                  <p className="text-sm text-slate-600">{agency.contact_email}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Features Tab */}
        <TabsContent value="features" className="space-y-4">
          <AgencyFeatureSettings agency={agency} />
          <AgencyRoleBasedAccess agency={agency} />
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4">
          <AgencyGuidedSetup agency={agency} />
          <AgencyBrandingSettings agency={agency} />
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Usage Analytics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">Seat Utilization</span>
                    <span className="text-sm text-slate-600">{agencyUsers.length} / {agency.max_users}</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full"
                      style={{ width: `${Math.min(utilizationPercent, 100)}%` }}
                    ></div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4">
                  <div className="text-center p-4 bg-slate-50 rounded-lg">
                    <p className="text-2xl font-bold text-slate-900">{agencyUsers.length}</p>
                    <p className="text-xs text-slate-600">Total Users</p>
                  </div>
                  <div className="text-center p-4 bg-slate-50 rounded-lg">
                    <p className="text-2xl font-bold text-slate-900">
                      {agency.max_users - agencyUsers.length}
                    </p>
                    <p className="text-xs text-slate-600">Available Seats</p>
                  </div>
                </div>

                <p className="text-sm text-slate-600 text-center pt-4">
                  More detailed analytics coming soon
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}