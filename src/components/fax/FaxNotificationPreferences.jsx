import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Bell, Phone, Mail } from 'lucide-react';
import { toast } from 'sonner';

export default function FaxNotificationPreferences() {
  const [preferences, setPreferences] = useState({
    emailNotifications: true,
    smsNotifications: false,
    notifyOnDelivered: true,
    notifyOnFailed: true,
    phoneNumber: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleToggle = (key) => {
    setPreferences(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handlePhoneChange = (e) => {
    setPreferences(prev => ({ ...prev, phoneNumber: e.target.value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Save to user entity or user metadata
      await base44.auth.updateMe({
        fax_notification_preferences: preferences,
      });
      toast.success('Notification preferences saved');
    } catch (error) {
      console.error('Error saving preferences:', error);
      toast.error('Failed to save preferences');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="w-5 h-5" />
          Fax Status Notifications
        </CardTitle>
        <CardDescription>Get alerted when your faxes are delivered or fail</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Email Notifications */}
        <div className="space-y-3 border-b pb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-slate-600" />
              <div>
                <p className="font-medium text-sm">Email Notifications</p>
                <p className="text-xs text-slate-600">Send alerts to your email address</p>
              </div>
            </div>
            <Switch
              checked={preferences.emailNotifications}
              onCheckedChange={() => handleToggle('emailNotifications')}
            />
          </div>
        </div>

        {/* SMS Notifications */}
        <div className="space-y-3 border-b pb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-slate-600" />
              <div>
                <p className="font-medium text-sm">SMS Notifications</p>
                <p className="text-xs text-slate-600">Receive text message alerts</p>
              </div>
            </div>
            <Switch
              checked={preferences.smsNotifications}
              onCheckedChange={() => handleToggle('smsNotifications')}
            />
          </div>
          {preferences.smsNotifications && (
            <Input
              type="tel"
              placeholder="+1 (555) 000-0000"
              value={preferences.phoneNumber}
              onChange={handlePhoneChange}
              className="mt-2"
            />
          )}
        </div>

        {/* Alert Types */}
        <div className="space-y-3">
          <p className="font-medium text-sm">Alert Me When:</p>
          <div className="flex items-center justify-between pl-2">
            <label htmlFor="notify-on-delivered" className="text-sm text-slate-700 cursor-pointer">
              Fax is delivered
            </label>
            <Switch
              id="notify-on-delivered"
              checked={preferences.notifyOnDelivered}
              onCheckedChange={() => handleToggle('notifyOnDelivered')}
            />
          </div>
          <div className="flex items-center justify-between pl-2">
            <label htmlFor="notify-on-failed" className="text-sm text-slate-700 cursor-pointer">
              Fax fails to send
            </label>
            <Switch
              id="notify-on-failed"
              checked={preferences.notifyOnFailed}
              onCheckedChange={() => handleToggle('notifyOnFailed')}
            />
          </div>
        </div>

        {/* Save Button */}
        <div className="pt-4 border-t flex gap-2">
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {isSaving ? 'Saving...' : 'Save Preferences'}
          </Button>
          <p className="text-xs text-slate-500 flex items-center">
            Changes are saved to your profile
          </p>
        </div>
      </CardContent>
    </Card>
  );
}