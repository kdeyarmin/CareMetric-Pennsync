import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  TrendingUp,
  Users,
  Bell
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function ActionableInsightsWidget() {
  const { data: referrals = [] } = useQuery({
    queryKey: ['actionable-referrals'],
    queryFn: () => base44.entities.Referral.filter({ status: 'new' }, '-created_date', 10),
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['actionable-alerts'],
    queryFn: () => base44.entities.PatientAlert.filter({ status: 'active' }, '-created_date', 10),
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['actionable-tasks'],
    queryFn: () => base44.entities.Task.filter({ status: 'pending', source: 'ai_generated' }, '-created_date', 10),
  });

  const insights = [
    {
      id: 'urgent-referrals',
      title: `${referrals.filter(r => r.priority === 'urgent').length} Urgent Referrals`,
      description: 'Require immediate processing',
      icon: AlertTriangle,
      iconColor: 'text-red-600',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200',
      action: 'Process Now',
      link: createPageUrl('ReferralIntake'),
      count: referrals.filter(r => r.priority === 'urgent').length,
      priority: 'critical'
    },
    {
      id: 'high-risk-alerts',
      title: `${alerts.filter(a => a.severity === 'critical' || a.severity === 'high').length} High-Risk Alerts`,
      description: 'Patients requiring immediate attention',
      icon: Bell,
      iconColor: 'text-orange-600',
      bgColor: 'bg-orange-50',
      borderColor: 'border-orange-200',
      action: 'Review Alerts',
      link: createPageUrl('Incidents'),
      count: alerts.filter(a => a.severity === 'critical' || a.severity === 'high').length,
      priority: 'high'
    },
    {
      id: 'ai-tasks',
      title: `${tasks.length} AI-Generated Tasks`,
      description: 'Smart recommendations for patient care',
      icon: TrendingUp,
      iconColor: 'text-blue-600',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
      action: 'View Tasks',
      link: createPageUrl('Dashboard'),
      count: tasks.length,
      priority: 'medium'
    },
    {
      id: 'manual-review',
      title: `${referrals.filter(r => r.requires_manual_review).length} Referrals Need Review`,
      description: 'Patient matching requires verification',
      icon: Users,
      iconColor: 'text-navy-600',
      bgColor: 'bg-navy-50',
      borderColor: 'border-navy-200',
      action: 'Review Matches',
      link: createPageUrl('ReferralIntake'),
      count: referrals.filter(r => r.requires_manual_review).length,
      priority: 'medium'
    }
  ].filter(insight => insight.count > 0);

  if (insights.length === 0) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="p-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
            <div>
              <h3 className="font-semibold text-green-900">All Caught Up!</h3>
              <p className="text-sm text-green-700">No urgent items requiring attention</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          AI Insights & Actions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {insights.map((insight) => {
          const Icon = insight.icon;
          return (
            <div
              key={insight.id}
              className={`${insight.bgColor} ${insight.borderColor} border rounded-lg p-4 transition-all hover:shadow-md`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <div className={`${insight.bgColor} p-2 rounded-lg`}>
                    <Icon className={`w-5 h-5 ${insight.iconColor}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-slate-900">{insight.title}</h4>
                      {insight.priority === 'critical' && (
                        <Badge className="bg-red-600 text-white text-xs">Urgent</Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-600">{insight.description}</p>
                  </div>
                </div>
                <Link to={insight.link}>
                  <Button size="sm" variant="outline" className="ml-2">
                    {insight.action}
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}