import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Bell, AlertCircle, FileText, Calendar, ExternalLink, CheckCircle2 } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";

export default function RegulatoryAlertsDashboard() {
  const [expandedAlert, setExpandedAlert] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: alerts, isLoading } = useQuery({
    queryKey: ['regulatoryAlerts', currentUser?.provider_type],
    queryFn: async () => {
      const allAlerts = await base44.entities.RegulatoryUpdate.list('-created_date', 20);
      
      // Filter alerts relevant to user's provider type
      return allAlerts.filter(alert => {
        if (!alert.affected_provider_types || alert.affected_provider_types.length === 0) {
          return true; // Show general alerts to everyone
        }
        return alert.affected_provider_types.includes(currentUser?.provider_type);
      });
    },
    enabled: !!currentUser
  });

  const markAsRead = async (alertId) => {
    try {
      const alert = alerts.find(a => a.id === alertId);
      const readBy = alert.read_by || [];
      
      if (!readBy.includes(currentUser?.email)) {
        await base44.entities.RegulatoryUpdate.update(alertId, {
          read_by: [...readBy, currentUser?.email]
        });
      }
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  const unreadAlerts = alerts?.filter(a => 
    !a.read_by?.includes(currentUser?.email)
  ) || [];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-600" />
            Regulatory Updates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-gray-200 rounded"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-600" />
            Regulatory Updates
            {unreadAlerts.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {unreadAlerts.length} New
              </Badge>
            )}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {alerts?.length > 0 ? (
          alerts.map((alert) => {
            const isRead = alert.read_by?.includes(currentUser?.email);
            const isExpanded = expandedAlert === alert.id;

            return (
              <Card 
                key={alert.id} 
                className={`border-2 transition-all ${
                  isRead ? 'opacity-70' : ''
                } ${getSeverityColor(alert.severity)}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        {!isRead && (
                          <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></div>
                        )}
                        <h4 className="font-semibold text-sm">{alert.title}</h4>
                        <Badge variant="outline" className="text-xs">
                          {alert.severity}
                        </Badge>
                      </div>
                      
                      <div className="flex items-center gap-4 text-xs text-gray-600 mb-2">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatInTimeZone(new Date(alert.effective_date), 'America/New_York', 'MMM d, yyyy')}
                        </span>
                        {alert.regulation_source && (
                          <span className="flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            {alert.regulation_source}
                          </span>
                        )}
                      </div>

                      <p className="text-sm text-gray-700 mb-2">
                        {alert.summary}
                      </p>

                      {alert.affected_provider_types?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {alert.affected_provider_types.map((type, idx) => (
                            <Badge key={idx} variant="secondary" className="text-xs">
                              {type}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t space-y-3">
                          {alert.detailed_description && (
                            <div>
                              <p className="text-xs font-medium mb-1">Details:</p>
                              <p className="text-sm text-gray-700">{alert.detailed_description}</p>
                            </div>
                          )}

                          {alert.action_required && (
                            <Alert>
                              <AlertCircle className="w-4 h-4" />
                              <AlertDescription className="text-xs">
                                <span className="font-medium">Action Required:</span> {alert.action_required}
                              </AlertDescription>
                            </Alert>
                          )}

                          {alert.compliance_deadline && (
                            <div className="text-xs">
                              <span className="font-medium">Compliance Deadline:</span>{' '}
                              {formatInTimeZone(new Date(alert.compliance_deadline), 'America/New_York', 'MMM d, yyyy')}
                            </div>
                          )}

                          {alert.reference_url && (
                            <a
                              href={alert.reference_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                            >
                              View Official Documentation
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => setExpandedAlert(isExpanded ? null : alert.id)}
                      variant="outline"
                      size="sm"
                      className="text-xs"
                    >
                      {isExpanded ? 'Show Less' : 'Show More'}
                    </Button>
                    {!isRead && (
                      <Button
                        onClick={() => markAsRead(alert.id)}
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                      >
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Mark as Read
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <div className="text-center py-8 text-gray-500">
            <Bell className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No regulatory updates at this time</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}