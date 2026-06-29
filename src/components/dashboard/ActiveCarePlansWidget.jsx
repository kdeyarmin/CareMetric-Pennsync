import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Target, CheckCircle2, AlertTriangle, Plus } from "lucide-react";
import { formatEastern } from "../utils/timezone";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function ActiveCarePlansWidget({ carePlans, _patientId, expanded = false }) {
  const [showAll, setShowAll] = useState(false);
  const isExpanded = expanded || showAll;
  const activeCarePlans = carePlans.filter(cp => cp.status === 'active');
  const metGoals = carePlans.filter(cp => cp.status === 'met').length;
  const totalGoals = carePlans.length;

  const getStatusColor = (status) => {
    switch (status) {
      case 'met': return 'bg-green-500';
      case 'active': return 'bg-blue-500';
      case 'revised': return 'bg-yellow-500';
      case 'not_met': return 'bg-red-500';
      default: return 'bg-slate-500';
    }
  };

  const displayPlans = isExpanded ? activeCarePlans : activeCarePlans.slice(0, 3);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="w-5 h-5 text-navy-600" />
            Active Care Plans
            <Badge className="bg-navy-600">{activeCarePlans.length}</Badge>
          </CardTitle>
          <Button size="sm" variant="outline" asChild>
            <Link to={createPageUrl('CarePlanManagement')}>
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {totalGoals > 0 && (
          <div className="mb-4 p-3 bg-navy-50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-slate-700">Overall Progress</p>
              <span className="text-sm font-semibold text-navy-700">
                {metGoals}/{totalGoals} goals met
              </span>
            </div>
            <Progress value={(metGoals / totalGoals) * 100} className="h-2" />
          </div>
        )}

        {displayPlans.length === 0 ? (
          <div className="text-center py-8">
            <Target className="w-12 h-12 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-500 text-sm">No active care plans</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayPlans.map((plan) => {
              const isOverdue = plan.target_date && new Date(plan.target_date) < new Date();
              
              return (
                <div key={plan.id} className="p-3 bg-white rounded-lg border border-slate-200 hover:border-navy-300 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <p className="font-semibold text-sm text-slate-900 mb-1">{plan.problem}</p>
                      <p className="text-xs text-slate-600 mb-2">{plan.goal}</p>
                      {plan.interventions?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {plan.interventions.slice(0, 2).map((intervention, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs">
                              {intervention}
                            </Badge>
                          ))}
                          {plan.interventions.length > 2 && (
                            <Badge variant="outline" className="text-xs">
                              +{plan.interventions.length - 2} more
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                    <Badge className={getStatusColor(plan.status)}>
                      {plan.status}
                    </Badge>
                  </div>
                  {plan.target_date && (
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      {isOverdue ? (
                        <AlertTriangle className="w-3 h-3 text-orange-500" />
                      ) : (
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                      )}
                      Target: {formatEastern(plan.target_date, 'MMM d, yyyy')}
                      {isOverdue && <span className="text-orange-600 font-medium ml-1">(Overdue)</span>}
                    </div>
                  )}
                </div>
              );
            })}
            
            {!isExpanded && activeCarePlans.length > 3 && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => setShowAll(true)}>
                View All {activeCarePlans.length} Care Plans
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}