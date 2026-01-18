import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Settings, Calendar, Trash2, Bell, Loader2 } from "lucide-react";

export default function InvitationSettings() {
  const queryClient = useQueryClient();
  const [expiryDays, setExpiryDays] = useState(7);
  const [cleanupAfterDays, setCleanupAfterDays] = useState(30);
  const [notifyBeforeCleanup, setNotifyBeforeCleanup] = useState(true);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['invitationSettings'],
    queryFn: async () => {
      const result = await base44.entities.InvitationSettings.list();
      if (result.length > 0) {
        const s = result[0];
        setExpiryDays(s.expiry_days || 7);
        setCleanupAfterDays(s.cleanup_after_days || 30);
        setNotifyBeforeCleanup(s.notify_before_cleanup !== false);
        return s;
      }
      return null;
    }
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data) => {
      if (settings) {
        return await base44.entities.InvitationSettings.update(settings.id, data);
      } else {
        return await base44.entities.InvitationSettings.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitationSettings'] });
      alert('✅ Settings saved successfully');
    },
    onError: (error) => {
      alert('Failed to save settings: ' + error.message);
    }
  });

  const handleSave = () => {
    if (expiryDays < 1 || expiryDays > 365) {
      alert('Expiry days must be between 1 and 365');
      return;
    }
    if (cleanupAfterDays < 1 || cleanupAfterDays > 365) {
      alert('Cleanup days must be between 1 and 365');
      return;
    }

    updateSettingsMutation.mutate({
      expiry_days: expiryDays,
      cleanup_after_days: cleanupAfterDays,
      notify_before_cleanup: notifyBeforeCleanup
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Invitation Settings
        </CardTitle>
        <CardDescription>
          Configure how invitations work in your system
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label htmlFor="expiryDays" className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Invitation Expiry (days)
          </Label>
          <Input
            id="expiryDays"
            type="number"
            min="1"
            max="365"
            value={expiryDays}
            onChange={(e) => setExpiryDays(parseInt(e.target.value) || 7)}
            className="mt-2"
          />
          <p className="text-xs text-gray-500 mt-1">
            How many days until new invitations expire (1-365 days)
          </p>
        </div>

        <div>
          <Label htmlFor="cleanupDays" className="flex items-center gap-2">
            <Trash2 className="w-4 h-4" />
            Auto-cleanup after (days)
          </Label>
          <Input
            id="cleanupDays"
            type="number"
            min="1"
            max="365"
            value={cleanupAfterDays}
            onChange={(e) => setCleanupAfterDays(parseInt(e.target.value) || 30)}
            className="mt-2"
          />
          <p className="text-xs text-gray-500 mt-1">
            Expired/revoked invitations will be deleted {cleanupAfterDays} days after expiry
          </p>
        </div>

        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-gray-600" />
            <div>
              <Label htmlFor="notifyCleanup" className="font-medium">
                Notify before cleanup
              </Label>
              <p className="text-xs text-gray-500">
                Send email notifications when invitations are auto-deleted
              </p>
            </div>
          </div>
          <Switch
            id="notifyCleanup"
            checked={notifyBeforeCleanup}
            onCheckedChange={setNotifyBeforeCleanup}
          />
        </div>

        <Alert className="bg-blue-50 border-blue-200">
          <AlertDescription className="text-blue-900 text-sm">
            <strong>Note:</strong> These settings apply to all new and resent invitations. 
            Existing invitations will keep their original expiry dates.
          </AlertDescription>
        </Alert>

        <Button
          onClick={handleSave}
          disabled={updateSettingsMutation.isPending}
          className="w-full sm:w-auto"
        >
          {updateSettingsMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Settings'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}