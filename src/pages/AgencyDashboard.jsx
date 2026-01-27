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
import AgencyTrainingReport from "../components/training/AgencyTrainingReport";
import AgencyAnalyticsDashboard from "../components/agency/AgencyAnalyticsDashboard";
import AgencyPackageSelector from "../components/agency/AgencyPackageSelector";
import BillingHistoryView from "../components/agency/BillingHistoryView";
import EnterpriseWorkflowGuide from "../components/enterprise/EnterpriseWorkflowGuide";
import QuickAgencySetup from "../components/agency/QuickAgencySetup";

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
      <div className="p-8 max-w-3xl mx-auto">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Create Your Agency</h1>
          <p className="text-slate-600">
            Set up your agency to manage team members, features, and analytics
          </p>
        </div>
        
        <QuickAgencySetup 
          currentUser={currentUser}
          onAgencyCreated={() => {
            queryClient.invalidateQueries({ queryKey: ['myAgency'] });
            window.location.reload();
          }}
        />

        <div className="mt-6 text-center">
          <Button variant="outline" onClick={() => navigate('/')}>
            Go to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const monthlyBill = agencyUsers.length * agency.price_per_user;
  const utilizationPercent = (agencyUsers.length / agency.max_users) * 100;

  // Check if setup is incomplete
  const isSetupIncomplete = !agency.enabled_features || agency.enabled_features.length === 0 || agencyUsers.length === 0;

  return (
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full max-w-full overflow-x-hidden min-w-0 pb-20 sm:pb-6">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 flex items-center gap-2 sm:gap-3 break-words">
          <Building2 className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600 flex-shrink-0" />
          <span className="break-words">{agency.agency_name}</span>
        </h1>
        <p className="text-sm sm:text-base text-slate-600 mt-1">Agency Management Dashboard</p>
      </div>

      {/* Setup Guide - Show if setup is incomplete */}
      {isSetupIncomplete && (
        <div className="mb-4 sm:mb-6">
          <EnterpriseWorkflowGuide agency={agency} userRole={currentUser?.role} />
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
              <Badge>{agency.status}</Badge>
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-slate-900">{agencyUsers.length}</p>
            <p className="text-[10px] sm:text-xs text-slate-600">Active Users (of {agency.max_users} max)</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <DollarSign className="w-6 h-6 sm:w-8 sm:h-8 text-green-600" />
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-slate-900">${monthlyBill.toFixed(2)}</p>
            <p className="text-[10px] sm:text-xs text-slate-600">Current Monthly Bill</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-6 h-6 sm:w-8 sm:h-8 text-purple-600" />
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-slate-900">{utilizationPercent.toFixed(0)}%</p>
            <p className="text-[10px] sm:text-xs text-slate-600">Seat Utilization</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <Calendar className="w-6 h-6 sm:w-8 sm:h-8 text-amber-600" />
            </div>
            <p className="text-base sm:text-lg font-bold text-slate-900">
              {agency.next_billing_date ? format(new Date(agency.next_billing_date), 'MMM d') : 'N/A'}
            </p>
            <p className="text-[10px] sm:text-xs text-slate-600">Next Billing Date</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="users" className="space-y-4 sm:space-y-6 w-full">
        <div className="w-full overflow-x-auto">
          <TabsList className="flex w-max min-w-full gap-1 p-1">
            <TabsTrigger value="users" className="text-xs sm:text-sm px-2 sm:px-3 whitespace-nowrap shrink-0">👥 Users</TabsTrigger>
            <TabsTrigger value="billing" className="text-xs sm:text-sm px-2 sm:px-3 whitespace-nowrap shrink-0">💳 Billing</TabsTrigger>
            <TabsTrigger value="features" className="text-xs sm:text-sm px-2 sm:px-3 whitespace-nowrap shrink-0">⚙️ Features</TabsTrigger>
            <TabsTrigger value="training" className="text-xs sm:text-sm px-2 sm:px-3 whitespace-nowrap shrink-0">🎓 Training</TabsTrigger>
            <TabsTrigger value="settings" className="text-xs sm:text-sm px-2 sm:px-3 whitespace-nowrap shrink-0">⚙️ Settings</TabsTrigger>
            <TabsTrigger value="analytics" className="text-xs sm:text-sm px-2 sm:px-3 whitespace-nowrap shrink-0">📊 Analytics</TabsTrigger>
          </TabsList>
        </div>

        {/* Users Tab */}
        <TabsContent value="users" className="space-y-4 w-full">
          <AgencyInvitationManager agency={agency} />

          <Card className="w-full">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-base sm:text-lg">Agency Users ({agencyUsers.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0">
              <div className="space-y-2">
                {agencyUsers.map((user) => (
                  <div key={user.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 bg-slate-50 rounded-lg gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm sm:text-base break-words">{user.full_name || user.email}</p>
                      <p className="text-xs sm:text-sm text-slate-600 break-all">{user.email}</p>
                    </div>
                    <div className="text-left sm:text-right flex-shrink-0 w-full sm:w-auto">
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
          <AgencyPackageSelector agency={agency} />
          <BillingHistoryView agency={agency} />
        </TabsContent>

        {/* Features Tab */}
        <TabsContent value="features" className="space-y-4">
          <AgencyFeatureSettings agency={agency} />
          <AgencyRoleBasedAccess agency={agency} />
        </TabsContent>

        {/* Training Tab */}
        <TabsContent value="training" className="space-y-4">
          <AgencyTrainingReport agency={agency} />
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4">
          <AgencyGuidedSetup agency={agency} />
          <AgencyBrandingSettings agency={agency} />
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4">
          <AgencyAnalyticsDashboard agency={agency} />
        </TabsContent>
      </Tabs>
    </div>
  );
}