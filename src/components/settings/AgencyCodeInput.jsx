import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Building2, Loader2, CheckCircle, LogIn } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function AgencyCodeInput({ currentUser }) {
  const [agencyCode, setAgencyCode] = useState("");
  const [joining, setJoining] = useState(false);
  const queryClient = useQueryClient();

  const handleJoinAgency = async () => {
    if (!agencyCode.trim()) {
      toast.error('Please enter an agency code');
      return;
    }

    setJoining(true);
    try {
      const { joinAgency } = await import('@/functions/joinAgency');
      const result = await joinAgency({
        agency_code: agencyCode.trim().toUpperCase()
      });

      toast.success(`Successfully joined ${result.data.agency_name}!`);
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      setAgencyCode("");
    } catch (error) {
      console.error('Error joining agency:', error);
      if (error.message?.includes('Invalid')) {
        toast.error('Invalid agency code. Please check and try again.');
      } else {
        toast.error('Failed to join agency');
      }
    } finally {
      setJoining(false);
    }
  };

  const isLinkedToAgency = currentUser?.agency_id;

  return (
    <Card className="border-purple-200 bg-purple-50 dark:bg-purple-950">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-purple-600" />
          Agency Membership
        </CardTitle>
        <CardDescription>
          {isLinkedToAgency 
            ? "You're connected to an enterprise agency" 
            : "Join your agency to access shared resources and analytics"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLinkedToAgency ? (
          <Alert className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-900 dark:text-green-100">
              <div className="space-y-1">
                <p className="font-semibold">Connected to Agency</p>
                <p className="text-sm">Agency Code: <span className="font-mono font-bold">{currentUser.agency_code}</span></p>
                <p className="text-xs text-green-700 dark:text-green-300 mt-2">
                  Your performance data is now visible to your agency administrators and contributes to agency-wide AI learning.
                </p>
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Alert>
              <Building2 className="w-4 h-4" />
              <AlertDescription>
                Enter the agency code provided by your administrator to link your account and access enterprise features.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="agency-code">Agency Code</Label>
              <Input
                id="agency-code"
                value={agencyCode}
                onChange={(e) => setAgencyCode(e.target.value.toUpperCase())}
                placeholder="Enter 8-character code"
                maxLength={8}
                className="font-mono text-lg"
              />
            </div>

            <Button 
              onClick={handleJoinAgency} 
              disabled={joining || !agencyCode.trim()}
              className="w-full bg-purple-600 hover:bg-purple-700"
            >
              {joining ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Joining...
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4 mr-2" />
                  Join Agency
                </>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}