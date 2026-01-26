import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Circle, Building2, Users, Settings, BarChart3, ChevronRight } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Link } from 'react-router-dom';

export default function EnterpriseWorkflowGuide({ agency, userRole, currentStep = 1 }) {
  const [expanded, setExpanded] = useState(true);

  const workflowSteps = [
    {
      title: "Set Up Your Agency",
      description: "Create agency profile, configure billing, and set branding",
      page: "AgencyDashboard",
      tab: "settings",
      icon: Building2,
      completed: agency && agency.agency_name && agency.agency_code,
      actions: ["Add agency name", "Set billing contact", "Configure branding"]
    },
    {
      title: "Configure Features & Access",
      description: "Enable features and set role-based permissions",
      page: "AgencyDashboard",
      tab: "features",
      icon: Settings,
      completed: agency && agency.enabled_features?.length > 0,
      actions: ["Select enabled features", "Configure provider access", "Set compliance rules"]
    },
    {
      title: "Invite Your Team",
      description: "Send invitations to providers and staff",
      page: "AgencyDashboard",
      tab: "users",
      icon: Users,
      completed: agency && agency.current_user_count > 0,
      actions: ["Send email invitations", "Share agency code", "Track acceptance"]
    },
    {
      title: "Monitor & Optimize",
      description: "Track performance, compliance, and training",
      page: "AgencyDashboard",
      tab: "analytics",
      icon: BarChart3,
      completed: false,
      actions: ["View team analytics", "Track compliance", "Review training needs"]
    }
  ];

  if (!expanded) {
    return (
      <Button
        variant="outline"
        onClick={() => setExpanded(true)}
        className="w-full justify-between"
      >
        <span>Show Setup Guide</span>
        <ChevronRight className="w-4 h-4" />
      </Button>
    );
  }

  return (
    <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-white">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600" />
            Enterprise Setup Guide
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpanded(false)}
          >
            Hide
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {workflowSteps.map((step, index) => {
          const StepIcon = step.icon;
          const isCompleted = step.completed;
          
          return (
            <div
              key={index}
              className={`p-4 rounded-lg border transition-all ${
                isCompleted 
                  ? 'bg-green-50 border-green-200' 
                  : 'bg-white border-slate-200 hover:border-blue-300'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isCompleted ? 'bg-green-600' : 'bg-blue-600'
                }`}>
                  {isCompleted ? (
                    <CheckCircle2 className="w-5 h-5 text-white" />
                  ) : (
                    <StepIcon className="w-5 h-5 text-white" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h4 className="font-semibold text-sm">{step.title}</h4>
                    {isCompleted && (
                      <Badge className="bg-green-600">Complete</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{step.description}</p>
                  
                  {!isCompleted && (
                    <>
                      <ul className="text-xs text-slate-600 space-y-1 mb-3 ml-4">
                        {step.actions.map((action, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <Circle className="w-2 h-2" />
                            {action}
                          </li>
                        ))}
                      </ul>
                      <Link to={createPageUrl(step.page)}>
                        <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                          Go to {step.title.split(' ')[0]}
                          <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}