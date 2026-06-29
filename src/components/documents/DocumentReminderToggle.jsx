import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bell, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function DocumentReminderToggle({ packageId, initialData }) {
  const queryClient = useQueryClient();
  const [autoReminderEnabled, setAutoReminderEnabled] = useState(
    initialData?.auto_reminder_enabled !== false
  );
  const [reminderDaysBefore, setReminderDaysBefore] = useState(
    initialData?.reminder_days_before || 3
  );

  const updateMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.entities.DocumentPackage.update(packageId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-package', packageId] });
      toast.success('Reminder settings updated');
    },
    onError: (error) => {
      toast.error(`Failed to update settings: ${error.message}`);
      // Revert changes on error
      setAutoReminderEnabled(initialData?.auto_reminder_enabled !== false);
      setReminderDaysBefore(initialData?.reminder_days_before || 3);
    },
  });

  const handleToggle = (checked) => {
    setAutoReminderEnabled(checked);
    updateMutation.mutate({ auto_reminder_enabled: checked });
  };

  const handleDaysChange = (value) => {
    const days = Math.max(0, Math.min(30, parseInt(value) || 0));
    setReminderDaysBefore(days);
    updateMutation.mutate({ reminder_days_before: days });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="w-4 h-4" />
          Automated Reminders
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border">
            <div className="flex-1">
              <Label className="text-sm font-medium cursor-pointer">
                Send Automated Reminders
              </Label>
              <p className="text-xs text-slate-600 mt-1">
                Email reminders will be automatically sent to the signer
              </p>
            </div>
            <Switch
              checked={autoReminderEnabled}
              onCheckedChange={handleToggle}
              disabled={updateMutation.isPending}
            />
          </div>

          {/* Days Before Setting */}
          {autoReminderEnabled && (
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <Label htmlFor="days-before" className="text-sm font-medium block mb-2">
                Send Reminder (days before due date)
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="days-before"
                  type="number"
                  min="0"
                  max="30"
                  value={reminderDaysBefore}
                  onChange={(e) => handleDaysChange(e.target.value)}
                  disabled={updateMutation.isPending}
                  className="w-20"
                />
                <span className="text-sm text-slate-600">days before due date</span>
              </div>
              <p className="text-xs text-slate-600 mt-2">
                Example: Set to 3 to send a reminder 3 days before the due date
              </p>
            </div>
          )}

          {/* Info Box */}
          <div className="flex gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800">
              <p className="font-medium">Reminder Details:</p>
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                <li>Reminders sent once per day</li>
                <li>Include document progress status</li>
                <li>Only sent while package is pending</li>
                <li>Additional reminders on due date and if overdue</li>
              </ul>
            </div>
          </div>

          {/* Last Reminder Info */}
          {initialData?.last_reminder_sent_at && (
            <div className="text-xs text-slate-600 p-2 bg-slate-50 rounded">
              Last reminder sent:{' '}
              {new Date(initialData.last_reminder_sent_at).toLocaleString()}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}