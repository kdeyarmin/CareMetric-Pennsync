import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Bell, Mail, Clock, Check, Smartphone, Volume2 } from "lucide-react";
import { toast } from "sonner";

export default function NotificationPreferences({ currentUser }) {
  const queryClient = useQueryClient();
  const [saveMessage, setSaveMessage] = useState("");

  const { data: preferences, isLoading } = useQuery({
    queryKey: ['notificationPreferences', currentUser?.email],
    queryFn: async () => {
      const prefs = await base44.entities.NotificationPreference.filter({
        user_email: currentUser?.email
      });
      return prefs[0] || {
        user_email: currentUser?.email,
        email_notifications_enabled: true,
        in_app_notifications_enabled: true,
        push_notifications_enabled: false,
        preferences: {
          report_ready: { email: true, in_app: true, push: false },
          compliance_alert: { email: true, in_app: true, push: true },
          critical_alert: { email: true, in_app: true, push: true },
          patient_alert: { email: true, in_app: true, push: true },
          task_assigned: { email: true, in_app: true, push: false },
          task_due_soon: { email: true, in_app: true, push: true },
          new_referral: { email: true, in_app: true, push: true },
          referral_urgent: { email: true, in_app: true, push: true },
          training_due: { email: true, in_app: true, push: false },
          system_update: { email: false, in_app: true, push: false },
          message_received: { email: true, in_app: true, push: false },
          info: { email: false, in_app: true, push: false }
        },
        quiet_hours: {
          enabled: false,
          start_time: "22:00",
          end_time: "08:00"
        },
        digest_mode: "instant",
        sound_enabled: true
      };
    },
    enabled: !!currentUser?.email,
  });

  const savePreferencesMutation = useMutation({
    mutationFn: async (updatedPrefs) => {
      if (preferences?.id) {
        return await base44.entities.NotificationPreference.update(preferences.id, updatedPrefs);
      } else {
        return await base44.entities.NotificationPreference.create(updatedPrefs);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationPreferences'] });
      toast.success('Notification preferences saved');
      setSaveMessage("Preferences saved successfully!");
      setTimeout(() => setSaveMessage(""), 3000);
    },
    onError: (_error) => {
      toast.error('Failed to save preferences');
      setSaveMessage("Failed to save preferences. Please try again.");
    }
  });

  const handleToggle = (key, channel, value) => {
    const currentPref = preferences.preferences?.[key] || { email: true, in_app: true, push: false };
    const updatedPrefs = {
      ...preferences,
      preferences: {
        ...preferences.preferences,
        [key]: {
          ...currentPref,
          [channel]: value
        }
      }
    };
    savePreferencesMutation.mutate(updatedPrefs);
  };

  const handleMasterToggle = (value) => {
    const updatedPrefs = {
      ...preferences,
      email_notifications_enabled: value
    };
    savePreferencesMutation.mutate(updatedPrefs);
  };

  const handleDigestModeChange = (value) => {
    const updatedPrefs = {
      ...preferences,
      digest_mode: value
    };
    savePreferencesMutation.mutate(updatedPrefs);
  };

  const handleQuietHoursToggle = (value) => {
    const updatedPrefs = {
      ...preferences,
      quiet_hours: {
        ...preferences.quiet_hours,
        enabled: value
      }
    };
    savePreferencesMutation.mutate(updatedPrefs);
  };

  const handleQuietHoursChange = (field, value) => {
    const updatedPrefs = {
      ...preferences,
      quiet_hours: {
        ...preferences.quiet_hours,
        [field]: value
      }
    };
    savePreferencesMutation.mutate(updatedPrefs);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-slate-500">
          Loading preferences...
        </CardContent>
      </Card>
    );
  }

  const notificationTypes = [
    { key: 'critical_alert', label: 'Critical Alerts', description: 'Urgent patient or system alerts', priority: 'critical' },
    { key: 'patient_alert', label: 'Patient Alerts', description: 'Patient risk and monitoring alerts', priority: 'high' },
    { key: 'new_referral', label: 'New Referrals', description: 'When new patient referrals are received', priority: 'high' },
    { key: 'referral_urgent', label: 'Urgent Referrals', description: 'High-priority referrals requiring immediate attention', priority: 'critical' },
    { key: 'compliance_alert', label: 'Compliance Alerts', description: 'Documentation or regulatory compliance issues', priority: 'high' },
    { key: 'task_assigned', label: 'Task Assignments', description: 'When tasks are assigned to you', priority: 'medium' },
    { key: 'task_due_soon', label: 'Tasks Due Soon', description: 'Tasks approaching their due date', priority: 'medium' },
    { key: 'message_received', label: 'Messages', description: 'New messages from team members', priority: 'medium' },
    { key: 'report_ready', label: 'Report Generation', description: 'When AI-generated reports are ready', priority: 'low' },
    { key: 'training_due', label: 'Training Due', description: 'Upcoming or overdue training modules', priority: 'low' },
    { key: 'system_update', label: 'System Updates', description: 'Platform updates and new features', priority: 'low' },
    { key: 'info', label: 'General Information', description: 'Non-critical informational messages', priority: 'low' }
  ];

  return (
    <div className="space-y-6">
      {saveMessage && (
        <Alert className="bg-green-50 border-green-300">
          <Check className="w-4 h-4 text-green-600" />
          <AlertDescription className="text-green-900">{saveMessage}</AlertDescription>
        </Alert>
      )}

      {/* Master Toggles */}
      <Card>
        <CardHeader>
          <CardTitle>Notification Channels</CardTitle>
          <CardDescription>
            Control which channels you want to receive notifications through
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b">
            <div className="flex items-center gap-3">
              <Bell className="w-5 h-5 text-blue-600" />
              <div>
                <Label htmlFor="in-app-toggle" className="text-base font-medium">
                  In-App Notifications
                </Label>
                <p className="text-sm text-slate-500">
                  Show notifications in the app
                </p>
              </div>
            </div>
            <Switch
              id="in-app-toggle"
              checked={preferences?.in_app_notifications_enabled}
              onCheckedChange={(value) => {
                const updatedPrefs = { ...preferences, in_app_notifications_enabled: value };
                savePreferencesMutation.mutate(updatedPrefs);
              }}
            />
          </div>

          <div className="flex items-center justify-between py-3 border-b">
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-green-600" />
              <div>
                <Label htmlFor="email-toggle" className="text-base font-medium">
                  Email Notifications
                </Label>
                <p className="text-sm text-slate-500">
                  Receive notifications via email
                </p>
              </div>
            </div>
            <Switch
              id="email-toggle"
              checked={preferences?.email_notifications_enabled}
              onCheckedChange={handleMasterToggle}
            />
          </div>

          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <Smartphone className="w-5 h-5 text-navy-600" />
              <div>
                <Label htmlFor="push-toggle" className="text-base font-medium">
                  Push Notifications
                </Label>
                <p className="text-sm text-slate-500">
                  Browser push notifications (requires permission)
                </p>
              </div>
            </div>
            <Switch
              id="push-toggle"
              checked={preferences?.push_notifications_enabled}
              onCheckedChange={(value) => {
                const updatedPrefs = { ...preferences, push_notifications_enabled: value };
                savePreferencesMutation.mutate(updatedPrefs);
              }}
            />
          </div>

          <div className="flex items-center justify-between py-3 border-t">
            <div className="flex items-center gap-3">
              <Volume2 className="w-5 h-5 text-orange-600" />
              <div>
                <Label htmlFor="sound-toggle" className="text-base font-medium">
                  Notification Sounds
                </Label>
                <p className="text-sm text-slate-500">
                  Play sound for in-app notifications
                </p>
              </div>
            </div>
            <Switch
              id="sound-toggle"
              checked={preferences?.sound_enabled}
              onCheckedChange={(value) => {
                const updatedPrefs = { ...preferences, sound_enabled: value };
                savePreferencesMutation.mutate(updatedPrefs);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Notification Types */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Notification Preferences by Type
          </CardTitle>
          <CardDescription>
            Configure how you want to receive each type of notification
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium">Notification Type</th>
                  <th className="text-center px-2 py-2 font-medium">
                    <div className="flex items-center justify-center gap-1">
                      <Bell className="w-4 h-4" />
                      <span className="hidden sm:inline">In-App</span>
                    </div>
                  </th>
                  <th className="text-center px-2 py-2 font-medium">
                    <div className="flex items-center justify-center gap-1">
                      <Mail className="w-4 h-4" />
                      <span className="hidden sm:inline">Email</span>
                    </div>
                  </th>
                  <th className="text-center px-2 py-2 font-medium">
                    <div className="flex items-center justify-center gap-1">
                      <Smartphone className="w-4 h-4" />
                      <span className="hidden sm:inline">Push</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {notificationTypes.map((type) => {
                  const pref = preferences?.preferences?.[type.key] || { email: true, in_app: true, push: false };
                  return (
                    <tr key={type.key} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="py-3 pr-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{type.label}</span>
                            {type.priority === 'critical' && (
                              <Badge variant="destructive" className="text-[10px] px-1 py-0">Critical</Badge>
                            )}
                            {type.priority === 'high' && (
                              <Badge className="bg-orange-500 text-[10px] px-1 py-0">High</Badge>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">{type.description}</p>
                        </div>
                      </td>
                      <td className="text-center px-2">
                        <Switch
                          checked={pref.in_app !== false}
                          onCheckedChange={(value) => handleToggle(type.key, 'in_app', value)}
                          disabled={!preferences?.in_app_notifications_enabled}
                        />
                      </td>
                      <td className="text-center px-2">
                        <Switch
                          checked={pref.email !== false}
                          onCheckedChange={(value) => handleToggle(type.key, 'email', value)}
                          disabled={!preferences?.email_notifications_enabled}
                        />
                      </td>
                      <td className="text-center px-2">
                        <Switch
                          checked={pref.push === true}
                          onCheckedChange={(value) => handleToggle(type.key, 'push', value)}
                          disabled={!preferences?.push_notifications_enabled}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Digest Mode */}
      <Card>
        <CardHeader>
          <CardTitle>Email Delivery Frequency</CardTitle>
          <CardDescription>
            Choose how often to receive email notifications
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={preferences?.digest_mode}
            onValueChange={handleDigestModeChange}
            disabled={!preferences?.email_notifications_enabled}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="instant">Instant (as they happen)</SelectItem>
              <SelectItem value="hourly">Hourly Digest</SelectItem>
              <SelectItem value="daily">Daily Digest</SelectItem>
              <SelectItem value="weekly">Weekly Digest</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Quiet Hours */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Quiet Hours
          </CardTitle>
          <CardDescription>
            Set times when you don't want to receive email notifications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="quiet-hours-toggle">Enable Quiet Hours</Label>
            <Switch
              id="quiet-hours-toggle"
              checked={preferences?.quiet_hours?.enabled}
              onCheckedChange={handleQuietHoursToggle}
              disabled={!preferences?.email_notifications_enabled}
            />
          </div>

          {preferences?.quiet_hours?.enabled && (
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div>
                <Label htmlFor="start-time" className="text-sm">Start Time</Label>
                <Input
                  id="start-time"
                  type="time"
                  value={preferences?.quiet_hours?.start_time}
                  onChange={(e) => handleQuietHoursChange('start_time', e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="end-time" className="text-sm">End Time</Label>
                <Input
                  id="end-time"
                  type="time"
                  value={preferences?.quiet_hours?.end_time}
                  onChange={(e) => handleQuietHoursChange('end_time', e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}