import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PushNotificationManager({ userEmail }) {
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [permission, setPermission] = useState(Notification.permission);
  const queryClient = useQueryClient();

  // Check for urgent tasks
  const { data: urgentTasks = [] } = useQuery({
    queryKey: ['urgentTasks', userEmail],
    queryFn: async () => {
      return base44.entities.Task.filter({
        assigned_to: userEmail,
        priority: 'critical',
        status: 'pending'
      }, '-created_date', 10);
    },
    enabled: !!userEmail && notificationsEnabled,
    refetchInterval: 60000 // Check every minute
  });

  // Check for critical alerts
  const { data: criticalAlerts = [] } = useQuery({
    queryKey: ['criticalAlerts', userEmail],
    queryFn: async () => {
      return base44.entities.PatientAlert.filter({
        assigned_to: userEmail,
        severity: 'critical',
        status: 'active'
      }, '-created_date', 10);
    },
    enabled: !!userEmail && notificationsEnabled,
    refetchInterval: 60000
  });

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      toast.error('Notifications not supported on this device');
      return;
    }

    const result = await Notification.requestPermission();
    setPermission(result);
    
    if (result === 'granted') {
      setNotificationsEnabled(true);
      toast.success('Notifications enabled');
      
      // Show welcome notification
      new Notification('CareMetric AI Notifications', {
        body: 'You will now receive alerts for urgent tasks and patient alerts',
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        tag: 'welcome',
        requireInteraction: false
      });
    } else {
      toast.error('Notification permission denied');
    }
  };

  // Send notifications for new urgent items
  useEffect(() => {
    if (!notificationsEnabled || permission !== 'granted') return;

    // Notify for urgent tasks
    urgentTasks.forEach(task => {
      if (!sessionStorage.getItem(`notified_task_${task.id}`)) {
        const patient = task.patient_id; // Would need to fetch patient name
        new Notification('🚨 Urgent Task', {
          body: task.title,
          icon: '/icon-192.png',
          tag: `task_${task.id}`,
          requireInteraction: true,
          vibrate: [200, 100, 200]
        });
        
        // Vibrate
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        
        sessionStorage.setItem(`notified_task_${task.id}`, 'true');
      }
    });

    // Notify for critical alerts
    criticalAlerts.forEach(alert => {
      if (!sessionStorage.getItem(`notified_alert_${alert.id}`)) {
        new Notification('⚠️ Critical Patient Alert', {
          body: alert.message,
          icon: '/icon-192.png',
          tag: `alert_${alert.id}`,
          requireInteraction: true,
          vibrate: [300, 100, 300, 100, 300]
        });
        
        // Vibrate
        if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
        
        sessionStorage.setItem(`notified_alert_${alert.id}`, 'true');
      }
    });
  }, [urgentTasks, criticalAlerts, notificationsEnabled, permission]);

  // Subscribe to real-time task updates
  useEffect(() => {
    if (!notificationsEnabled || !userEmail) return;

    const unsubscribe = base44.entities.Task.subscribe((event) => {
      if (event.type === 'create' && 
          event.data.assigned_to === userEmail && 
          event.data.priority === 'critical') {
        
        if (permission === 'granted') {
          new Notification('🚨 New Urgent Task', {
            body: event.data.title,
            icon: '/icon-192.png',
            requireInteraction: true
          });
          if (navigator.vibrate) navigator.vibrate(200);
        }
        
        toast.error(`Urgent: ${event.data.title}`, {
          duration: 10000
        });
        
        queryClient.invalidateQueries({ queryKey: ['urgentTasks'] });
      }
    });

    return unsubscribe;
  }, [notificationsEnabled, userEmail, permission]);

  return (
    <Button
      size="icon"
      variant={notificationsEnabled ? "default" : "ghost"}
      onClick={notificationsEnabled ? 
        () => {
          setNotificationsEnabled(false);
          toast.info('Push notifications disabled');
        } : 
        requestNotificationPermission
      }
      className={`h-8 w-8 sm:h-9 sm:w-9 relative touch-target ${
        notificationsEnabled ? 'bg-blue-600 hover:bg-blue-700' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
      }`}
      title={notificationsEnabled ? 'Notifications enabled' : 'Enable push notifications'}
    >
      {notificationsEnabled ? (
        <>
          <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
          {(urgentTasks.length + criticalAlerts.length) > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold">
              {urgentTasks.length + criticalAlerts.length}
            </span>
          )}
        </>
      ) : (
        <BellOff className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-600 dark:text-slate-400" />
      )}
    </Button>
  );
}