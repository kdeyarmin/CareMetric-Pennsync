import { Card, CardContent } from "@/components/ui/card";
import {
  Activity,
  Calendar,
  Target,
  AlertTriangle
} from "lucide-react";
import { formatEastern, todayEastern } from "../utils/timezone";

export default function QuickStatsGrid({ visits, carePlans, alerts, incidents, _patient }) {
  // visit_date is a date-only string ("YYYY-MM-DD"); compare against today's
  // Eastern date string so a visit scheduled for today isn't dropped during the
  // workday (new Date("YYYY-MM-DD") parses as midnight UTC, which is in the past
  // by Eastern daytime).
  const today = todayEastern();
  const completedVisits = visits.filter(v => v.status === 'completed').length;
  const upcomingVisits = visits.filter(v =>
    v.status === 'scheduled' && v.visit_date >= today
  ).length;
  
  const activeCarePlans = carePlans.filter(cp => cp.status === 'active').length;
  const metGoals = carePlans.filter(cp => cp.status === 'met').length;
  
  const activeAlerts = alerts.filter(a => a.status === 'active').length;
  const criticalAlerts = alerts.filter(a => a.status === 'active' && a.severity === 'critical').length;
  
  const recentIncidents = incidents.filter(i => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return new Date(i.incident_date) >= thirtyDaysAgo;
  }).length;

  const lastVisit = visits.find(v => v.status === 'completed');
  const nextVisit = visits.find(v => v.status === 'scheduled' && v.visit_date >= today);

  const stats = [
    {
      icon: Calendar,
      label: "Total Visits",
      value: completedVisits,
      subtitle: `${upcomingVisits} upcoming`,
      color: "from-blue-500 to-blue-600",
      textColor: "text-blue-600"
    },
    {
      icon: Target,
      label: "Care Plans",
      value: activeCarePlans,
      subtitle: `${metGoals} goals met`,
      color: "from-navy-500 to-navy-600",
      textColor: "text-navy-600"
    },
    {
      icon: AlertTriangle,
      label: "Active Alerts",
      value: activeAlerts,
      subtitle: criticalAlerts > 0 ? `${criticalAlerts} critical` : 'No critical',
      color: activeAlerts > 0 ? "from-red-500 to-red-600" : "from-green-500 to-green-600",
      textColor: activeAlerts > 0 ? "text-red-600" : "text-green-600"
    },
    {
      icon: Activity,
      label: "Recent Incidents",
      value: recentIncidents,
      subtitle: "Last 30 days",
      color: recentIncidents > 2 ? "from-orange-500 to-orange-600" : "from-green-500 to-green-600",
      textColor: recentIncidents > 2 ? "text-orange-600" : "text-green-600"
    }
  ];

  return (
    <div className="space-y-4 mb-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, idx) => (
          <Card key={idx} className="overflow-hidden">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
              <p className="text-sm font-medium text-slate-600">{stat.label}</p>
              <p className="text-xs text-slate-500 mt-1">{stat.subtitle}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Last & Next Visit Quick Info */}
      <div className="grid md:grid-cols-2 gap-4">
        {lastVisit && (
          <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-slate-600">Last Visit</p>
              <p className="font-semibold text-slate-900">{formatEastern(lastVisit.visit_date, 'MMM d, yyyy')}</p>
              <p className="text-xs text-slate-600">{lastVisit.visit_type?.replace(/_/g, ' ')}</p>
            </CardContent>
          </Card>
        )}
        
        {nextVisit && (
          <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-slate-600">Next Visit</p>
              <p className="font-semibold text-slate-900">{formatEastern(nextVisit.visit_date, 'MMM d, yyyy')}</p>
              <p className="text-xs text-slate-600">{nextVisit.visit_type?.replace(/_/g, ' ')}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}