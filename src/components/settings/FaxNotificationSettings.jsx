import React from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Send, CheckCircle2, AlertCircle, Bell, Mail, MessageSquare } from "lucide-react";
import { toast } from "sonner";

export default function FaxNotificationSettings({ currentUser }) {
  const queryClient = useQueryClient();

  const prefs = currentUser?.fax_notification_preferences || {
    notify_on_sent: true,
    notify_on_delivered: true,
    notify_on_failed: true,
    channels: { in_app: true, email: true, sms: false }
  };

  const updatePrefs = async (newPrefs) => {
    try {
      await base44.auth.updateMe({ fax_notification_preferences: newPrefs });
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      toast.success("Fax notification preferences saved");
    } catch {
      toast.error("Failed to save preferences");
    }
  };

  const toggleEvent = (key) => {
    updatePrefs({ ...prefs, [key]: !prefs[key] });
  };

  const toggleChannel = (channel) => {
    const channels = { ...prefs.channels, [channel]: !prefs.channels?.[channel] };
    updatePrefs({ ...prefs, channels });
  };

  const events = [
    { key: "notify_on_sent", label: "Fax Sent", desc: "When a fax is successfully sent", icon: Send, color: "text-green-600" },
    { key: "notify_on_delivered", label: "Fax Delivered", desc: "When a fax is confirmed delivered", icon: CheckCircle2, color: "text-emerald-600" },
    { key: "notify_on_failed", label: "Fax Failed", desc: "When a fax fails to send", icon: AlertCircle, color: "text-red-600" },
  ];

  const channels = [
    { key: "in_app", label: "In-App", desc: "Notification bell in the header", icon: Bell },
    { key: "email", label: "Email", desc: "Send email notifications", icon: Mail },
    { key: "sms", label: "SMS", desc: "Text message alerts", icon: MessageSquare, requiresPhone: true },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
          <Send className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
          Fax Status Notifications
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Choose when and how to be notified about fax status changes
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Events */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase mb-3">Notify me when...</p>
          <div className="space-y-2">
            {events.map(e => {
              const Icon = e.icon;
              return (
                <div key={e.key} className="flex items-center justify-between p-3 rounded-lg border hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <Icon className={`w-4 h-4 ${e.color}`} />
                    <div>
                      <Label className="text-sm font-medium cursor-pointer">{e.label}</Label>
                      <p className="text-xs text-slate-500">{e.desc}</p>
                    </div>
                  </div>
                  <Switch checked={prefs[e.key] !== false} onCheckedChange={() => toggleEvent(e.key)} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Channels */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase mb-3">Notification channels</p>
          <div className="space-y-2">
            {channels.map(ch => {
              const Icon = ch.icon;
              const disabled = ch.requiresPhone && !currentUser?.phone_number;
              return (
                <div key={ch.key} className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${disabled ? 'opacity-50' : 'hover:bg-slate-50'}`}>
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4 text-slate-500" />
                    <div>
                      <Label className="text-sm font-medium cursor-pointer">{ch.label}</Label>
                      <p className="text-xs text-slate-500">{ch.desc}</p>
                      {disabled && (
                        <Badge className="text-[9px] bg-amber-100 text-amber-700 mt-1">Add phone number in profile</Badge>
                      )}
                    </div>
                  </div>
                  <Switch
                    checked={prefs.channels?.[ch.key] !== false && !disabled}
                    onCheckedChange={() => toggleChannel(ch.key)}
                    disabled={disabled}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}