import React, { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, CheckCircle, XCircle, Loader2 } from "lucide-react";

export default function InvitationAcceptBanner({ currentUser }) {
  const queryClient = useQueryClient();
  const [inviteToken, setInviteToken] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check URL for invite token
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite_token');
    if (token) {
      setInviteToken(token);
    }
  }, []);

  const acceptInvitationMutation = useMutation({
    mutationFn: async (token) => {
      const response = await base44.functions.invoke('acceptAgencyInvitation', {
        invitation_token: token
      });
      return response.data || response;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Welcome to ${data.agency_name}!`);
        queryClient.invalidateQueries({ queryKey: ['currentUser'] });
        setDismissed(true);
        // Remove token from URL
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        toast.error(data.message || 'Failed to accept invitation');
        setDismissed(true);
      }
    }
  });

  if (!inviteToken || dismissed || currentUser?.agency_code) {
    return null;
  }

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4">
      <Alert className="bg-blue-50 border-blue-300 shadow-lg">
        <Mail className="w-4 h-4 text-blue-600" />
        <AlertDescription>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="font-semibold text-blue-900">You've been invited to join an agency!</p>
              <p className="text-sm text-blue-700 mt-1">Click accept to join and get started.</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => acceptInvitationMutation.mutate(inviteToken)}
                disabled={acceptInvitationMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {acceptInvitationMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Accept
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDismissed(true)}
              >
                <XCircle className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}