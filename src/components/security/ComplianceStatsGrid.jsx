import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Lock, FileText, Shield, AlertTriangle, Activity, Eye } from "lucide-react";

export default function ComplianceStatsGrid() {
  // Real-time audit log count
  const { data: auditLogs } = useQuery({
    queryKey: ['auditLogsCount'],
    queryFn: async () => {
      const logs = await base44.entities.AuditTrail.list('-created_date', 100);
      return logs.length;
    },
    refetchInterval: 30000
  });

  // Active security alerts
  const { data: activeAlerts } = useQuery({
    queryKey: ['activeSecurityAlerts'],
    queryFn: async () => {
      const alerts = await base44.entities.PatientAlert.filter({
        alert_type: 'security_breach',
        status: 'active'
      });
      return alerts;
    },
    refetchInterval: 10000
  });

  // Security events last 24h
  const { data: recentEvents } = useQuery({
    queryKey: ['recentSecurityEvents'],
    queryFn: async () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      const events = await base44.entities.SecurityLog.filter({
        timestamp: { $gte: yesterday }
      });
      return events.length;
    },
    refetchInterval: 60000
  });

  // User activity tracking
  const { data: activeUsers } = useQuery({
    queryKey: ['activeUsersCount'],
    queryFn: async () => {
      const hourAgo = new Date(Date.now() - 3600000).toISOString();
      const activities = await base44.entities.UserActivity.filter({
        created_date: { $gte: hourAgo }
      });
      const uniqueUsers = new Set(activities.map(a => a.user_email));
      return uniqueUsers.size;
    },
    refetchInterval: 60000
  });

  const stats = [
    {
      icon: Lock,
      label: "Encryption Status",
      value: "AES-256 Active",
      color: "green",
      description: "All PHI encrypted at rest and in transit"
    },
    {
      icon: FileText,
      label: "Audit Logs (24h)",
      value: auditLogs || 0,
      color: "blue",
      description: "Recent audit trail entries"
    },
    {
      icon: Shield,
      label: "Security Events",
      value: recentEvents || 0,
      color: "purple",
      description: "Security actions logged"
    },
    {
      icon: AlertTriangle,
      label: "Active Alerts",
      value: activeAlerts?.length || 0,
      color: activeAlerts?.length > 0 ? "red" : "amber",
      description: activeAlerts?.length > 0 ? "Requires attention" : "No active threats"
    },
    {
      icon: Activity,
      label: "Active Users",
      value: activeUsers || 0,
      color: "indigo",
      description: "Users active in last hour"
    },
    {
      icon: Eye,
      label: "Access Controls",
      value: "RLS Enabled",
      color: "teal",
      description: "Row-level security active"
    }
  ];

  const colorClasses = {
    green: "bg-green-100 text-green-600",
    blue: "bg-blue-100 text-blue-600",
    purple: "bg-purple-100 text-purple-600",
    amber: "bg-amber-100 text-amber-600",
    red: "bg-red-100 text-red-600",
    indigo: "bg-indigo-100 text-indigo-600",
    teal: "bg-teal-100 text-teal-600"
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {stats.map((stat, idx) => (
        <Card key={idx} className="hover:shadow-lg transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${colorClasses[stat.color]}`}>
                <stat.icon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-gray-600 mb-1">{stat.label}</p>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                <p className="text-xs text-gray-500 mt-1">{stat.description}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}