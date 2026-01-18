import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell, AlertCircle, CheckCircle2, Clock, Users, FileText,
  Target, Shield, TrendingUp, X, Check, Filter, CheckCheck, Circle
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { toast } from "sonner";

export default function NotificationCenter() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all"); // all, unread, critical
  const [selectedNotifications, setSelectedNotifications] = useState([]);
  const [bulkMode, setBulkMode] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  // Fetch all notification sources
  const { data: patientAlerts = [] } = useQuery({
    queryKey: ['myPatientAlerts', currentUser?.email],
    queryFn: () => base44.entities.PatientAlert.filter({ assigned_to: currentUser?.email }),
    enabled: !!currentUser?.email,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['myTasks', currentUser?.email],
    queryFn: () => base44.entities.Task.filter({ 
      assigned_to: currentUser?.email, 
      status: 'pending' 
    }),
    enabled: !!currentUser?.email,
  });

  const { data: complianceAudits = [] } = useQuery({
    queryKey: ['myComplianceAudits', currentUser?.email],
    queryFn: () => base44.entities.ComplianceAudit.filter({ 
      nurse_email: currentUser?.email,
      status: 'flagged'
    }, '-audit_date', 10),
    enabled: !!currentUser?.email,
  });

  const { data: trainingRecommendations = [] } = useQuery({
    queryKey: ['myTrainingRecommendations', currentUser?.email],
    queryFn: () => base44.entities.TrainingRecommendation.filter({ 
      nurse_email: currentUser?.email,
      addressed: false
    }),
    enabled: !!currentUser?.email,
  });

  const { data: regulatoryUpdates = [] } = useQuery({
    queryKey: ['recentRegulatoryUpdates', currentUser?.credential_type, currentUser?.service_type],
    queryFn: async () => {
      const updates = await base44.entities.RegulatoryUpdate.filter({ 
        status: { $in: ['pending_review', 'approved'] }
      }, '-created_date', 20);
      
      // Filter by provider type and care setting
      return updates.filter(update => {
        const affectedAreas = update.affected_areas || [];
        const isRelevantToProvider = affectedAreas.length === 0 || 
          affectedAreas.includes(currentUser?.credential_type) ||
          affectedAreas.includes('all');
        
        const careType = update.care_type || 'both';
        const isRelevantToCareType = careType === 'both' || 
          careType === currentUser?.service_type;
        
        return isRelevantToProvider && isRelevantToCareType;
      }).slice(0, 5);
    },
    enabled: !!currentUser?.credential_type,
  });

  const { data: announcements = [] } = useQuery({
    queryKey: ['activeAnnouncements'],
    queryFn: async () => {
      const all = await base44.entities.Announcement.filter({ is_active: true }, '-created_date', 10);
      return all.filter(a => {
        const expiryDate = a.expiry_date ? new Date(a.expiry_date) : null;
        return !expiryDate || expiryDate > new Date();
      });
    },
  });

  // Helper: Check if notification is relevant to provider type
  const isRelevantToProvider = (notificationType, providerType) => {
    if (!providerType) return true;

    // Notifications relevant to nursing roles (RN, LPN, NP)
    const nursingRoles = ['RN', 'LPN', 'NP'];
    const nursingNotifications = ['patient_alert', 'task', 'compliance'];

    // Therapist-specific (PT, OT, ST)
    const therapistRoles = ['PT', 'OT', 'ST'];
    const therapistNotifications = ['task', 'patient_alert'];

    // MSW-specific
    const mswNotifications = ['task', 'patient_alert', 'training'];

    // Physician
    const physicianNotifications = ['patient_alert', 'task', 'compliance'];

    // Training and regulatory updates are relevant to everyone
    if (['training', 'regulatory', 'announcement'].includes(notificationType)) return true;

    if (nursingRoles.includes(providerType)) {
      return nursingNotifications.includes(notificationType);
    }
    if (therapistRoles.includes(providerType)) {
      return therapistNotifications.includes(notificationType);
    }
    if (providerType === 'MSW') {
      return mswNotifications.includes(notificationType);
    }
    if (providerType === 'Physician') {
      return physicianNotifications.includes(notificationType);
    }

    return true;
  };

  // Aggregate notifications
  const notifications = useMemo(() => {
    const items = [];

    // Patient Alerts
    patientAlerts.forEach(alert => {
      items.push({
        id: `alert-${alert.id}`,
        type: 'patient_alert',
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        time: alert.created_date,
        icon: AlertCircle,
        color: alert.severity === 'critical' ? 'red' : alert.severity === 'high' ? 'orange' : 'yellow',
        link: createPageUrl(`PatientDetails?id=${alert.patient_id}`),
        read: alert.status !== 'active'
      });
    });

    // Tasks
    tasks.forEach(task => {
      const isOverdue = task.due_date && new Date(task.due_date) < new Date();
      items.push({
        id: `task-${task.id}`,
        type: 'task',
        severity: task.priority === 'critical' ? 'critical' : isOverdue ? 'high' : 'medium',
        title: task.title,
        message: task.description || 'Task pending',
        time: task.created_date,
        icon: CheckCircle2,
        color: isOverdue ? 'red' : task.priority === 'high' ? 'orange' : 'blue',
        link: createPageUrl('Tasks'),
        read: false
      });
    });

    // Compliance Issues
    complianceAudits.forEach(audit => {
      items.push({
        id: `compliance-${audit.id}`,
        type: 'compliance',
        severity: 'high',
        title: 'Compliance Issue Flagged',
        message: `Documentation quality score: ${audit.compliance_score}%`,
        time: audit.audit_date,
        icon: Shield,
        color: 'red',
        link: createPageUrl('ComplianceDashboard'),
        read: false
      });
    });

    // Training Recommendations
    trainingRecommendations.forEach(rec => {
      items.push({
        id: `training-${rec.id}`,
        type: 'training',
        severity: rec.severity,
        title: `Training Recommended: ${rec.recommendation_type}`,
        message: rec.recommendation_text,
        time: rec.created_date,
        icon: TrendingUp,
        color: rec.severity === 'critical' ? 'red' : 'blue',
        link: createPageUrl('StaffTrainingHub'),
        read: rec.addressed
      });
    });

    // Regulatory Updates
    regulatoryUpdates.forEach(update => {
      items.push({
        id: `regulatory-${update.id}`,
        type: 'regulatory',
        severity: update.impact_level,
        title: `New Regulation: ${update.title}`,
        message: update.summary,
        time: update.created_date,
        icon: FileText,
        color: update.impact_level === 'critical' ? 'red' : 'purple',
        link: createPageUrl('RegulatoryCompliance'),
        read: false
      });
    });

    // Announcements
    announcements.forEach(announcement => {
      items.push({
        id: `announcement-${announcement.id}`,
        type: 'announcement',
        severity: announcement.priority,
        title: announcement.title,
        message: announcement.message,
        time: announcement.created_date,
        icon: Bell,
        color: 'blue',
        read: false
      });
    });

    // Filter by provider type relevance
    const filtered = items.filter(item => isRelevantToProvider(item.type, currentUser?.credential_type));
    
    // Sort by time (newest first)
    return filtered.sort((a, b) => new Date(b.time) - new Date(a.time));
  }, [patientAlerts, tasks, complianceAudits, trainingRecommendations, regulatoryUpdates, announcements, currentUser?.credential_type]);

  const filteredNotifications = useMemo(() => {
    if (filter === 'unread') {
      return notifications.filter(n => !n.read);
    }
    if (filter === 'critical') {
      return notifications.filter(n => n.severity === 'critical' || n.severity === 'high');
    }
    return notifications;
  }, [notifications, filter]);

  const unreadCount = notifications.filter(n => !n.read).length;
  const criticalCount = notifications.filter(n => n.severity === 'critical').length;

  const toggleNotificationSelection = (notifId) => {
    setSelectedNotifications(prev => 
      prev.includes(notifId) 
        ? prev.filter(id => id !== notifId)
        : [...prev, notifId]
    );
  };

  const selectAll = () => {
    setSelectedNotifications(filteredNotifications.map(n => n.id));
  };

  const deselectAll = () => {
    setSelectedNotifications([]);
  };

  const bulkMarkAsRead = async () => {
    const selectedItems = notifications.filter(n => selectedNotifications.includes(n.id));
    
    try {
      // Update each entity type accordingly
      const alertIds = selectedItems.filter(n => n.type === 'patient_alert').map(n => n.id.replace('alert-', ''));
      const trainingIds = selectedItems.filter(n => n.type === 'training').map(n => n.id.replace('training-', ''));
      
      // Update patient alerts to acknowledged status
      for (const id of alertIds) {
        await base44.entities.PatientAlert.update(id, { status: 'acknowledged' });
      }
      
      // Update training recommendations to addressed
      for (const id of trainingIds) {
        await base44.entities.TrainingRecommendation.update(id, { addressed: true });
      }

      queryClient.invalidateQueries();
      setSelectedNotifications([]);
      setBulkMode(false);
      toast.success(`${selectedItems.length} notifications marked as read`);
    } catch (error) {
      console.error('Error marking notifications as read:', error);
      toast.error('Failed to update notifications');
    }
  };

  const bulkMarkAsUnread = async () => {
    const selectedItems = notifications.filter(n => selectedNotifications.includes(n.id));
    
    try {
      const alertIds = selectedItems.filter(n => n.type === 'patient_alert').map(n => n.id.replace('alert-', ''));
      const trainingIds = selectedItems.filter(n => n.type === 'training').map(n => n.id.replace('training-', ''));
      
      // Update patient alerts back to active status
      for (const id of alertIds) {
        await base44.entities.PatientAlert.update(id, { status: 'active' });
      }
      
      // Update training recommendations back to unaddressed
      for (const id of trainingIds) {
        await base44.entities.TrainingRecommendation.update(id, { addressed: false });
      }

      queryClient.invalidateQueries();
      setSelectedNotifications([]);
      setBulkMode(false);
      toast.success(`${selectedItems.length} notifications marked as unread`);
    } catch (error) {
      console.error('Error marking notifications as unread:', error);
      toast.error('Failed to update notifications');
    }
  };

  const markAllAsRead = async () => {
    const itemsToMark = filteredNotifications.filter(n => !n.read);
    
    if (itemsToMark.length === 0) {
      toast.info('No unread notifications to mark');
      return;
    }

    try {
      const alertIds = itemsToMark.filter(n => n.type === 'patient_alert').map(n => n.id.replace('alert-', ''));
      const trainingIds = itemsToMark.filter(n => n.type === 'training').map(n => n.id.replace('training-', ''));
      const taskIds = itemsToMark.filter(n => n.type === 'task').map(n => n.id.replace('task-', ''));
      const complianceIds = itemsToMark.filter(n => n.type === 'compliance').map(n => n.id.replace('compliance-', ''));
      const regulatoryIds = itemsToMark.filter(n => n.type === 'regulatory').map(n => n.id.replace('regulatory-', ''));
      const announcementIds = itemsToMark.filter(n => n.type === 'announcement').map(n => n.id.replace('announcement-', ''));
      
      // Update patient alerts to acknowledged status
      for (const id of alertIds) {
        await base44.entities.PatientAlert.update(id, { status: 'acknowledged' });
      }
      
      // Update training recommendations to addressed
      for (const id of trainingIds) {
        await base44.entities.TrainingRecommendation.update(id, { addressed: true });
      }

      // Update tasks to completed
      for (const id of taskIds) {
        await base44.entities.Task.update(id, { status: 'completed' });
      }

      // Update compliance audits status
      for (const id of complianceIds) {
        await base44.entities.ComplianceAudit.update(id, { status: 'resolved' });
      }

      // Update regulatory updates status
      for (const id of regulatoryIds) {
        await base44.entities.RegulatoryUpdate.update(id, { status: 'reviewed' });
      }

      // Mark announcements as read by updating or filtering
      for (const id of announcementIds) {
        await base44.entities.Announcement.update(id, { is_active: false });
      }

      queryClient.invalidateQueries();
      toast.success(`All ${itemsToMark.length} notifications dismissed`);
    } catch (error) {
      console.error('Error dismissing all notifications:', error);
      toast.error('Failed to dismiss notifications');
    }
  };

  const getColorClass = (color) => {
    const classes = {
      red: 'bg-red-100 text-red-800 border-red-200',
      orange: 'bg-orange-100 text-orange-800 border-orange-200',
      yellow: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      blue: 'bg-blue-100 text-blue-800 border-blue-200',
      purple: 'bg-purple-100 text-purple-800 border-purple-200',
    };
    return classes[color] || classes.blue;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 bg-red-600 text-white text-xs">
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[95vw] sm:w-96 p-0" align="end" sideOffset={5}>
        <div className="border-b p-3 sm:p-4">
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold text-base sm:text-lg">Notifications</h3>
              <p className="text-xs sm:text-sm text-gray-600 truncate">
                {unreadCount} unread • {criticalCount} critical
              </p>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={markAllAsRead}
                disabled={unreadCount === 0}
                className="text-xs h-8 px-2 sm:px-3"
              >
                <CheckCheck className="w-3 h-3 sm:w-4 sm:h-4 sm:mr-1" />
                <span className="hidden sm:inline">Dismiss All</span>
                <span className="sm:hidden">Dismiss</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} className="h-8 w-8">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
          
          {/* Bulk Actions Bar */}
          {filteredNotifications.length > 0 && (
            <div className="flex items-center gap-1 sm:gap-2 mt-3 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBulkMode(!bulkMode);
                  setSelectedNotifications([]);
                }}
                className="h-7 text-xs"
              >
                {bulkMode ? 'Cancel' : 'Select'}
              </Button>
              
              {bulkMode && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={selectAll}
                    disabled={selectedNotifications.length === filteredNotifications.length}
                    className="h-7 text-xs"
                  >
                    Select All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={deselectAll}
                    disabled={selectedNotifications.length === 0}
                    className="h-7 text-xs"
                  >
                    Clear
                  </Button>
                  
                  {selectedNotifications.length > 0 && (
                    <>
                      <div className="hidden sm:flex flex-1" />
                      <Badge variant="outline" className="text-xs">{selectedNotifications.length}</Badge>
                      <Button
                        size="sm"
                        onClick={bulkMarkAsRead}
                        className="bg-green-600 hover:bg-green-700 h-7 text-xs px-2"
                      >
                        <CheckCheck className="w-3 h-3" />
                        <span className="hidden sm:inline ml-1">Read</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={bulkMarkAsUnread}
                        className="h-7 text-xs px-2"
                      >
                        <Circle className="w-3 h-3" />
                        <span className="hidden sm:inline ml-1">Unread</span>
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <Tabs defaultValue="all" className="w-full">
          <TabsList className="w-full grid grid-cols-3 rounded-none border-b">
            <TabsTrigger value="all" onClick={() => setFilter('all')}>
              All ({notifications.length})
            </TabsTrigger>
            <TabsTrigger value="unread" onClick={() => setFilter('unread')}>
              Unread ({unreadCount})
            </TabsTrigger>
            <TabsTrigger value="critical" onClick={() => setFilter('critical')}>
              Critical ({criticalCount})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="m-0">
            <ScrollArea className="h-[50vh] sm:h-[400px]">
              {filteredNotifications.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <Bell className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No notifications</p>
                </div>
              ) : (
                <div className="divide-y">
                  {filteredNotifications.map((notif) => (
                    <div
                      key={notif.id}
                      className={`p-3 sm:p-4 hover:bg-gray-50 transition-colors ${!notif.read ? 'bg-blue-50/30' : ''} ${selectedNotifications.includes(notif.id) ? 'bg-indigo-50 border-l-4 border-indigo-600' : ''}`}
                    >
                      <div className="flex gap-2 sm:gap-3">
                        {bulkMode && (
                          <div 
                            className="flex items-center pt-1 cursor-pointer"
                            onClick={() => toggleNotificationSelection(notif.id)}
                          >
                            {selectedNotifications.includes(notif.id) ? (
                              <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                            ) : (
                              <Circle className="w-5 h-5 text-gray-400" />
                            )}
                          </div>
                        )}
                        <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center flex-shrink-0 ${getColorClass(notif.color)}`}>
                          <notif.icon className="w-4 h-4 sm:w-5 sm:h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <h4 className="font-medium text-xs sm:text-sm text-gray-900 line-clamp-1">
                              {notif.title}
                            </h4>
                            {!notif.read && (
                              <div className="w-2 h-2 bg-blue-600 rounded-full flex-shrink-0" />
                            )}
                          </div>
                          <p className="text-xs sm:text-sm text-gray-600 line-clamp-2 mb-2">
                            {notif.message}
                          </p>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-gray-500 truncate">
                              {formatDistanceToNow(new Date(notif.time), { addSuffix: true })}
                            </span>
                            {notif.link && (
                              <Link to={notif.link} onClick={() => setOpen(false)}>
                                <Button variant="ghost" size="sm" className="h-6 sm:h-7 text-xs px-2 flex-shrink-0">
                                  View
                                </Button>
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="unread" className="m-0">
            <ScrollArea className="h-[50vh] sm:h-[400px]">
              {filteredNotifications.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-400" />
                  <p>All caught up!</p>
                </div>
              ) : (
                <div className="divide-y">
                  {filteredNotifications.map((notif) => (
                    <div
                      key={notif.id}
                      className={`p-3 sm:p-4 hover:bg-gray-50 transition-colors bg-blue-50/30 ${selectedNotifications.includes(notif.id) ? 'bg-indigo-50 border-l-4 border-indigo-600' : ''}`}
                    >
                      <div className="flex gap-2 sm:gap-3">
                        {bulkMode && (
                          <div 
                            className="flex items-center pt-1 cursor-pointer"
                            onClick={() => toggleNotificationSelection(notif.id)}
                          >
                            {selectedNotifications.includes(notif.id) ? (
                              <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                            ) : (
                              <Circle className="w-5 h-5 text-gray-400" />
                            )}
                          </div>
                        )}
                        <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center flex-shrink-0 ${getColorClass(notif.color)}`}>
                          <notif.icon className="w-4 h-4 sm:w-5 sm:h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <h4 className="font-medium text-xs sm:text-sm text-gray-900 line-clamp-1">
                              {notif.title}
                            </h4>
                            <div className="w-2 h-2 bg-blue-600 rounded-full flex-shrink-0" />
                          </div>
                          <p className="text-xs sm:text-sm text-gray-600 line-clamp-2 mb-2">
                            {notif.message}
                          </p>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-gray-500 truncate">
                              {formatDistanceToNow(new Date(notif.time), { addSuffix: true })}
                            </span>
                            {notif.link && (
                              <Link to={notif.link} onClick={() => setOpen(false)}>
                                <Button variant="ghost" size="sm" className="h-6 sm:h-7 text-xs px-2 flex-shrink-0">
                                  View
                                </Button>
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="critical" className="m-0">
            <ScrollArea className="h-[50vh] sm:h-[400px]">
              {filteredNotifications.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <Shield className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No critical alerts</p>
                </div>
              ) : (
                <div className="divide-y">
                  {filteredNotifications.map((notif) => (
                    <div
                      key={notif.id}
                      className={`p-3 sm:p-4 hover:bg-gray-50 transition-colors ${selectedNotifications.includes(notif.id) ? 'bg-indigo-50 border-l-4 border-indigo-600' : ''}`}
                    >
                      <div className="flex gap-2 sm:gap-3">
                        {bulkMode && (
                          <div 
                            className="flex items-center pt-1 cursor-pointer"
                            onClick={() => toggleNotificationSelection(notif.id)}
                          >
                            {selectedNotifications.includes(notif.id) ? (
                              <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                            ) : (
                              <Circle className="w-5 h-5 text-gray-400" />
                            )}
                          </div>
                        )}
                        <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center flex-shrink-0 ${getColorClass(notif.color)}`}>
                          <notif.icon className="w-4 h-4 sm:w-5 sm:h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <h4 className="font-medium text-xs sm:text-sm text-gray-900 line-clamp-1">
                              {notif.title}
                            </h4>
                            <Badge className="bg-red-600 text-white text-xs flex-shrink-0">
                              {notif.severity}
                            </Badge>
                          </div>
                          <p className="text-xs sm:text-sm text-gray-600 line-clamp-2 mb-2">
                            {notif.message}
                          </p>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-gray-500 truncate">
                              {formatDistanceToNow(new Date(notif.time), { addSuffix: true })}
                            </span>
                            {notif.link && (
                              <Link to={notif.link} onClick={() => setOpen(false)}>
                                <Button variant="ghost" size="sm" className="h-6 sm:h-7 text-xs px-2 flex-shrink-0">
                                  View
                                </Button>
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}