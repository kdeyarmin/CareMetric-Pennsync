import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, CheckCircle, AlertCircle, Loader2, LogOut } from "lucide-react";

export default function AgencyCodeManager({ currentUser }) {
  const queryClient = useQueryClient();
  const [agencyCode, setAgencyCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  const joinAgencyMutation = useMutation({
    mutationFn: async (code) => {
      const response = await base44.functions.invoke('joinAgency', { agency_code: code });
      return response.data || response;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Successfully joined ${data.agency_name}!`);
        queryClient.invalidateQueries({ queryKey: ['currentUser'] });
        setAgencyCode("");
      } else {
        toast.error(data.message || 'Failed to join agency');
      }
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to join agency');
    }
  });

  const leaveAgencyMutation = useMutation({
    mutationFn: async () => {
      await base44.auth.updateMe({
        agency_code: null,
        agency_name: null,
        joined_agency_date: null
      });
    },
    onSuccess: () => {
      toast.success('Left agency successfully');
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    }
  });

  const handleJoinAgency = () => {
    if (!agencyCode.trim()) {
      toast.error('Please enter an agency code');
      return;
    }
    joinAgencyMutation.mutate(agencyCode.trim().toUpperCase());
  };

  const isInAgency = currentUser?.agency_code;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-blue-600" />
          Agency Membership
        </CardTitle>
        <CardDescription>
          Join an enterprise agency to get access without individual billing
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isInAgency ? (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <AlertDescription>
              <div className="space-y-2">
                <p className="text-green-900 font-medium">
                  You're a member of <strong>{currentUser.agency_name}</strong>
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">{currentUser.agency_code}</Badge>
                  {currentUser.joined_agency_date && (
                    <span className="text-xs text-green-700">
                      Joined: {new Date(currentUser.joined_agency_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <p className="text-sm text-green-700 mt-2">
                  Your subscription is managed by your agency. You won't be billed individually.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (confirm('Are you sure you want to leave this agency? You will need to manage your own subscription.')) {
                      leaveAgencyMutation.mutate();
                    }
                  }}
                  className="mt-2"
                >
                  <LogOut className="w-3 h-3 mr-2" />
                  Leave Agency
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Alert>
              <AlertCircle className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-slate-700">
                If you're part of an enterprise agency, enter your agency code below to join and get access without individual billing.
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              <div>
                <Label>Agency Code</Label>
                <Input
                  value={agencyCode}
                  onChange={(e) => setAgencyCode(e.target.value.toUpperCase())}
                  placeholder="Enter 6-character code (e.g., AGXYZ123)"
                  maxLength={8}
                  className="font-mono"
                />
              </div>

              <Button
                onClick={handleJoinAgency}
                disabled={!agencyCode.trim() || joinAgencyMutation.isPending}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {joinAgencyMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <Building2 className="w-4 h-4 mr-2" />
                    Join Agency
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}