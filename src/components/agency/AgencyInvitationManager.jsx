import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, Send, Trash2, Clock, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";

export default function AgencyInvitationManager({ agency }) {
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [showMessageField, setShowMessageField] = useState(false);

  const { data: invitations = [] } = useQuery({
    queryKey: ['agencyInvitations', agency.agency_code],
    queryFn: () => base44.entities.AgencyInvitation.filter({ 
      agency_code: agency.agency_code 
    }, '-created_date')
  });

  const sendInvitationMutation = useMutation({
    mutationFn: async ({ email, message }) => {
      const response = await base44.functions.invoke('sendAgencyInvitation', {
        invited_email: email,
        custom_message: message
      });
      return response.data || response;
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['agencyInvitations'] });
        queryClient.invalidateQueries({ queryKey: ['allUsers'] });
        toast.success('Invitation sent successfully!');
        setInviteEmail("");
        setCustomMessage("");
        setShowMessageField(false);
      } else {
        toast.error(data.message || 'Failed to send invitation');
      }
    }
  });

  const revokeInvitationMutation = useMutation({
    mutationFn: async (inviteId) => {
      await base44.entities.AgencyInvitation.update(inviteId, {
        status: 'revoked'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agencyInvitations'] });
      toast.success('Invitation revoked');
    }
  });

  const resendInvitationMutation = useMutation({
    mutationFn: async (invitation) => {
      const response = await base44.functions.invoke('sendAgencyInvitation', {
        invited_email: invitation.invited_email,
        custom_message: invitation.custom_message
      });
      return response.data || response;
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['agencyInvitations'] });
        toast.success('Invitation resent');
      } else {
        toast.error(data.message || 'Failed to resend');
      }
    }
  });

  const handleSendInvitation = () => {
    if (!inviteEmail) {
      toast.error('Please enter an email address');
      return;
    }
    sendInvitationMutation.mutate({ email: inviteEmail, message: customMessage });
  };

  const getStatusBadge = (status, expiresAt) => {
    const isExpired = new Date(expiresAt) < new Date();
    if (isExpired && status === 'pending') {
      return <Badge className="bg-orange-600"><Clock className="w-3 h-3 mr-1" />Expired</Badge>;
    }
    
    switch (status) {
      case 'pending': return <Badge className="bg-blue-600"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case 'accepted': return <Badge className="bg-green-600"><CheckCircle className="w-3 h-3 mr-1" />Accepted</Badge>;
      case 'expired': return <Badge className="bg-orange-600"><Clock className="w-3 h-3 mr-1" />Expired</Badge>;
      case 'revoked': return <Badge className="bg-red-600"><XCircle className="w-3 h-3 mr-1" />Revoked</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const pendingInvites = invitations.filter(i => i.status === 'pending' && new Date(i.expires_at) > new Date());
  const acceptedInvites = invitations.filter(i => i.status === 'accepted');
  const expiredInvites = invitations.filter(i => i.status === 'expired' || (i.status === 'pending' && new Date(i.expires_at) < new Date()));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-blue-600" />
          Invite Users to Your Agency
        </CardTitle>
        <CardDescription>
          Send personalized invitations with your agency code pre-filled
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Invite Form */}
        <div className="space-y-3 p-4 bg-slate-50 rounded-lg">
          <div>
            <Label>Email Address</Label>
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          
          {!showMessageField ? (
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={() => setShowMessageField(true)}
              className="text-blue-600"
            >
              + Add custom message
            </Button>
          ) : (
            <div>
              <Label>Custom Welcome Message (Optional)</Label>
              <Textarea
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="Welcome to our team! We're excited to have you..."
                rows={3}
              />
            </div>
          )}

          <Button
            onClick={handleSendInvitation}
            disabled={!inviteEmail || sendInvitationMutation.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {sendInvitationMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Send Invitation
              </>
            )}
          </Button>
        </div>

        {/* Pending Invitations */}
        {pendingInvites.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2">Pending Invitations ({pendingInvites.length})</h4>
            <div className="space-y-2">
              {pendingInvites.map((invite) => (
                <div key={invite.id} className="flex items-center justify-between p-3 bg-white border rounded-lg">
                  <div className="flex-1">
                    <p className="font-medium text-sm">{invite.invited_email}</p>
                    <p className="text-xs text-slate-500">
                      Sent {format(new Date(invite.created_date), 'MMM d, yyyy')} • 
                      Expires {format(new Date(invite.expires_at), 'MMM d')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(invite.status, invite.expires_at)}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => resendInvitationMutation.mutate(invite)}
                      disabled={resendInvitationMutation.isPending}
                    >
                      <Send className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => revokeInvitationMutation.mutate(invite.id)}
                      disabled={revokeInvitationMutation.isPending}
                    >
                      <Trash2 className="w-3 h-3 text-red-600" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Accepted Invitations */}
        {acceptedInvites.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2">Accepted ({acceptedInvites.length})</h4>
            <div className="space-y-2">
              {acceptedInvites.map((invite) => (
                <div key={invite.id} className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div>
                    <p className="font-medium text-sm">{invite.invited_email}</p>
                    <p className="text-xs text-slate-500">
                      Accepted {format(new Date(invite.accepted_at), 'MMM d, yyyy')}
                    </p>
                  </div>
                  {getStatusBadge(invite.status, invite.expires_at)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Expired/Revoked */}
        {expiredInvites.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2 text-slate-500">Expired/Revoked ({expiredInvites.length})</h4>
            <div className="space-y-2">
              {expiredInvites.slice(0, 3).map((invite) => (
                <div key={invite.id} className="flex items-center justify-between p-2 bg-slate-50 border rounded-lg opacity-60">
                  <p className="text-sm">{invite.invited_email}</p>
                  {getStatusBadge(invite.status, invite.expires_at)}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}