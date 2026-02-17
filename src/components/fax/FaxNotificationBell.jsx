import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover, PopoverContent, PopoverTrigger
} from "@/components/ui/popover";
import {
  Bell, CheckCircle2, AlertCircle, Send, Check, Loader2
} from "lucide-react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

const STATUS_ICON = {
  sent: { icon: Send, color: "text-green-600", bg: "bg-green-50" },
  delivered: { icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50" },
  failed: { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50" },
};

export default function FaxNotificationBell({ userEmail }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: notifications = [] } = useQuery({
    queryKey: ['faxNotifications', userEmail],
    queryFn: () => base44.entities.FaxNotification.filter(
      { user_email: userEmail },
      '-created_date',
      20
    ),
    enabled: !!userEmail,
    refetchInterval: 15000
  });

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const markReadMutation = useMutation({
    mutationFn: async (id) => {
      await base44.entities.FaxNotification.update(id, { is_read: true });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['faxNotifications'] })
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const unread = notifications.filter(n => !n.is_read);
      for (const n of unread) {
        await base44.entities.FaxNotification.update(n.id, { is_read: true });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['faxNotifications'] })
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-4 w-4 text-slate-600" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-[9px] text-white flex items-center justify-center font-bold animate-pulse">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b">
          <span className="text-sm font-semibold text-slate-900">Fax Notifications</span>
          {unreadCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] gap-1"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
            >
              {markAllReadMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">No fax notifications yet</p>
          ) : (
            notifications.map(n => {
              const config = STATUS_ICON[n.status] || STATUS_ICON.sent;
              const Icon = config.icon;
              return (
                <div
                  key={n.id}
                  className={`flex items-start gap-2.5 p-3 border-b last:border-b-0 cursor-pointer hover:bg-slate-50 transition-colors ${!n.is_read ? 'bg-blue-50/40' : ''}`}
                  onClick={() => { if (!n.is_read) markReadMutation.mutate(n.id); }}
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${config.bg}`}>
                    <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs leading-relaxed ${!n.is_read ? 'font-medium text-slate-900' : 'text-slate-600'}`}>
                      {n.message}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-slate-400">
                        {n.created_date ? format(new Date(n.created_date), 'MMM d, h:mm a') : ''}
                      </span>
                      {n.channels_sent?.length > 0 && (
                        <div className="flex gap-1">
                          {n.channels_sent.map(ch => (
                            <Badge key={ch} className="text-[8px] px-1 py-0 bg-slate-100 text-slate-500">
                              {ch === 'in_app' ? 'App' : ch === 'email' ? 'Email' : 'SMS'}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {!n.is_read && <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-2" />}
                </div>
              );
            })
          )}
        </div>
        <div className="border-t p-2">
          <Link to={createPageUrl("FaxQueue")} onClick={() => setOpen(false)}>
            <Button variant="ghost" size="sm" className="w-full text-xs h-7">
              View Fax Queue
            </Button>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}