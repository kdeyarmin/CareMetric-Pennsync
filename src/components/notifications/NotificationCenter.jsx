import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Bell,
  Check,
  CheckCheck,
  Trash2,
  AlertCircle,
  Info,
  FileText,
  Shield,
  GraduationCap,
  X
} from "lucide-react";
import { formatEastern, formatRelativeEastern } from "@/components/utils/timezone";
import { Link } from "react-router-dom";

export default function NotificationCenter({ currentUser, onClose }) {
  const queryClient = useQueryClient();
  const [selectedNotification, setSelectedNotification] = useState(null);

  const { data: notificationEntities = [] } = useQuery({
    queryKey: ['notifications', currentUser?.email],
    queryFn: () => base44.entities.Notification.filter(
      { user_email: currentUser?.email },
      '-created_date',
      100
    ),
    initialData: [],
    enabled: !!currentUser?.email,
    refetchInterval: 30000,
  });

  const { data: chartedVisits = [] } = useQuery({
    queryKey: ['charted-visits', currentUser?.email],
    queryFn: () => base44.entities.Visit.filter(
      { created_by: currentUser?.email },
      '-visit_date',
      500
    ),
    initialData: [],
    enabled: !!currentUser?.email,
  });

  const { data: activeAlerts = [] } = useQuery({
    queryKey: ['active-alerts-nc', currentUser?.email, chartedVisits],
    queryFn: async () => {
      const chartedPatientIds = new Set(chartedVisits.map(v => v.patient_id));
      if (chartedPatientIds.size === 0) return [];

      const allAlerts = await base44.entities.PatientAlert.filter(
        { status: 'active' },
        '-created_date',
        50
      );
      return allAlerts.filter(a => chartedPatientIds.has(a.patient_id));
    },
    initialData: [],
    refetchInterval: 60000,
    enabled: !!currentUser?.email && chartedVisits.length > 0,
  });

  const { data: pendingTasks = [] } = useQuery({
    queryKey: ['pending-tasks-nc', currentUser?.email],
    queryFn: () => base44.entities.Task.filter(
      { status: 'pending', assigned_to: currentUser?.email },
      '-created_date',
      50
    ),
    initialData: [],
    refetchInterval: 60000,
    enabled: !!currentUser?.email,
  });

  // Combine all notifications
  const combinedNotifications = [
    ...notificationEntities.map(n => ({
      id: n.id,
      type: n.type || 'notification',
      title: n.title || 'Notification',
      message: n.message || n.title,
      created_date: n.created_date,
      is_read: n.is_read,
      priority: n.priority || 'medium'
    })),
    ...activeAlerts.map(a => ({
      id: a.id,
      type: 'patient_alert',
      title: 'Patient Alert',
      message: a.message || a.description,
      created_date: a.created_date,
      is_read: false,
      priority: a.severity || 'high',
      // Surfaced from a PatientAlert/Task, not a Notification row — its id is NOT
      // a Notification id, so it must be excluded from Notification.update calls.
      _synthetic: true
    })),
    ...pendingTasks.map(t => ({
      id: t.id,
      type: 'task_assigned',
      title: t.title || 'Task Assigned',
      message: t.description,
      created_date: t.created_date,
      is_read: false,
      priority: 'medium',
      _synthetic: true
    }))
  ].sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

  const notifications = combinedNotifications;

  const markAsReadMutation = useMutation({
    mutationFn: (notificationId) => base44.entities.Notification.update(notificationId, {
      is_read: true,
      read_at: new Date().toISOString()
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      // Only real Notification rows can be marked read (synthetic alert/task
      // items carry a non-Notification id). allSettled so one failure doesn't
      // short-circuit the rest.
      const unreadIds = notifications.filter(n => !n.is_read && !n._synthetic).map(n => n.id);
      await Promise.allSettled(unreadIds.map(id =>
        base44.entities.Notification.update(id, {
          is_read: true,
          read_at: new Date().toISOString()
        })
      ));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: (notificationId) => base44.entities.Notification.delete(notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setSelectedNotification(null);
    },
  });

  const unreadNotifications = notifications.filter(n => !n.is_read);
  const _readNotifications = notifications.filter(n => n.is_read);

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'report_ready':
        return <FileText className="w-5 h-5 text-blue-600" />;
      case 'compliance_alert':
        return <Shield className="w-5 h-5 text-orange-600" />;
      case 'critical_alert':
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      case 'patient_alert':
        return <AlertCircle className="w-5 h-5 text-navy-600" />;
      case 'task_assigned':
        return <Check className="w-5 h-5 text-green-600" />;
      case 'training_due':
        return <GraduationCap className="w-5 h-5 text-indigo-600" />;
      default:
        return <Info className="w-5 h-5 text-slate-600" />;
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'high':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  const handleNotificationClick = (notification) => {
    // Synthetic items (open PatientAlerts/Tasks surfaced here) carry an
    // alert/task id, not a Notification id — calling Notification.update with it
    // is a no-op error, so only mark real notifications read.
    if (!notification.is_read && !notification._synthetic) {
      markAsReadMutation.mutate(notification.id);
    }
    setSelectedNotification(notification);
  };

  const NotificationItem = ({ notification }) => (
    <div
      onClick={() => handleNotificationClick(notification)}
      className={`p-4 border-b hover:bg-slate-50 cursor-pointer transition-colors ${
        !notification.is_read ? 'bg-blue-50' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-1">
          {getNotificationIcon(notification.type)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className={`text-sm font-medium ${!notification.is_read ? 'text-slate-900' : 'text-slate-600'}`}>
              {notification.title}
            </p>
            {!notification.is_read && (
              <div className="w-2 h-2 bg-blue-600 rounded-full flex-shrink-0 mt-1.5"></div>
            )}
          </div>
          <p className="text-sm text-slate-600 line-clamp-2 mb-2">
            {notification.message}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500">
              {formatRelativeEastern(notification.created_date)}
            </span>
            {notification.priority !== 'low' && notification.priority !== 'medium' && (
              <Badge className={getPriorityColor(notification.priority)}>
                {notification.priority}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <Card className="w-full max-w-2xl h-[80vh] flex flex-col border-slate-200 bg-white">
        <CardHeader className="border-b border-slate-200 bg-slate-50/70 flex-shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-100 text-navy-600">
                <Bell className="w-4 h-4" />
              </span>
              Notifications
              {unreadNotifications.length > 0 && (
                <Badge variant="info">
                  {unreadNotifications.length} new
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              {unreadNotifications.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => markAllAsReadMutation.mutate()}
                  disabled={markAllAsReadMutation.isPending}
                >
                  <CheckCheck className="w-4 h-4 mr-1" />
                  Mark all read
                </Button>
              )}
              {onClose && (
                <Button variant="ghost" size="icon" onClick={onClose}>
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <div className="flex-1 overflow-hidden flex flex-col">
          <Tabs defaultValue="unread" className="h-full flex flex-col">
            <TabsList className="grid w-full grid-cols-2 h-auto rounded-none border-0 border-b border-slate-200 bg-white p-0 shadow-none flex-shrink-0">
              <TabsTrigger value="unread" className="rounded-none border-b-2 border-transparent bg-transparent py-3 text-slate-600 shadow-none ring-0 data-[state=active]:border-navy-600 data-[state=active]:bg-transparent data-[state=active]:text-navy-700 data-[state=active]:shadow-none data-[state=active]:ring-0">
                Unread ({unreadNotifications.length})
              </TabsTrigger>
              <TabsTrigger value="all" className="rounded-none border-b-2 border-transparent bg-transparent py-3 text-slate-600 shadow-none ring-0 data-[state=active]:border-navy-600 data-[state=active]:bg-transparent data-[state=active]:text-navy-700 data-[state=active]:shadow-none data-[state=active]:ring-0">
                All ({notifications.length})
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto">
              <TabsContent value="unread" className="m-0 h-full">
                {unreadNotifications.length > 0 ? (
                  unreadNotifications.map((notification) => (
                    <NotificationItem key={notification.id} notification={notification} />
                  ))
                ) : (
                  <div className="p-12 text-center text-slate-500">
                    <Bell className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p>No unread notifications</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="all" className="m-0 h-full">
                {notifications.length > 0 ? (
                  notifications.map((notification) => (
                    <NotificationItem key={notification.id} notification={notification} />
                  ))
                ) : (
                  <div className="p-12 text-center text-slate-500">
                    <Bell className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p>No notifications</p>
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </Card>

      {/* Notification Detail Dialog */}
      {selectedNotification && (
        <Dialog open={!!selectedNotification} onOpenChange={() => setSelectedNotification(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {getNotificationIcon(selectedNotification.type)}
                {selectedNotification.title}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-slate-600 mb-2">
                  {formatEastern(selectedNotification.created_date, 'PPpp')}
                </p>
                {selectedNotification.priority !== 'low' && selectedNotification.priority !== 'medium' && (
                  <Badge className={getPriorityColor(selectedNotification.priority)}>
                    {selectedNotification.priority} priority
                  </Badge>
                )}
              </div>
              <p className="text-slate-900">{selectedNotification.message}</p>
              <div className="flex gap-2 pt-4 border-t">
                {selectedNotification.action_url && (
                  <Link to={selectedNotification.action_url} onClick={() => setSelectedNotification(null)}>
                    <Button>
                      {selectedNotification.action_label || 'View'}
                    </Button>
                  </Link>
                )}
                {!selectedNotification.is_read && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      markAsReadMutation.mutate(selectedNotification.id);
                      setSelectedNotification(null);
                    }}
                  >
                    <Check className="w-4 h-4 mr-2" />
                    Mark as read
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => deleteNotificationMutation.mutate(selectedNotification.id)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}