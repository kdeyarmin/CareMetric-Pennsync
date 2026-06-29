import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, differenceInDays, parseISO, isAfter } from "date-fns";
import {
  Target,
  CheckCircle2,
  Clock,
  AlertCircle,
  TrendingUp
} from "lucide-react";

export default function CarePlanTimeline({ carePlans = [], _patient }) {
  if (!carePlans || carePlans.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-slate-500">
          <Target className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p>No care plans to display</p>
        </CardContent>
      </Card>
    );
  }

  // Sort care plans by target date
  const sortedPlans = [...carePlans].sort((a, b) => {
    if (!a.target_date) return 1;
    if (!b.target_date) return -1;
    return new Date(a.target_date) - new Date(b.target_date);
  });

  // Calculate timeline bounds
  const today = new Date();
  const dates = sortedPlans
    .filter(p => p.target_date)
    .map(p => parseISO(p.target_date));
  
  const earliestDate = dates.length > 0 ? new Date(Math.min(...dates)) : today;
  const latestDate = dates.length > 0 ? new Date(Math.max(...dates)) : today;
  const totalDays = differenceInDays(latestDate, earliestDate) || 30;

  const getPositionPercentage = (targetDate) => {
    if (!targetDate) return 0;
    const date = parseISO(targetDate);
    const daysFromStart = differenceInDays(date, earliestDate);
    return (daysFromStart / totalDays) * 100;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'met': return 'bg-blue-500';
      case 'not_met': return 'bg-red-500';
      case 'revised': return 'bg-yellow-500';
      default: return 'bg-slate-500';
    }
  };

  const getStatusIcon = (status, targetDate) => {
    if (status === 'met') return <CheckCircle2 className="w-4 h-4" />;
    if (status === 'not_met') return <AlertCircle className="w-4 h-4" />;
    
    if (targetDate) {
      const date = parseISO(targetDate);
      if (isAfter(today, date)) return <AlertCircle className="w-4 h-4" />;
      if (differenceInDays(date, today) <= 7) return <Clock className="w-4 h-4" />;
    }
    
    return <Target className="w-4 h-4" />;
  };

  const getDaysRemaining = (targetDate) => {
    if (!targetDate) return null;
    const days = differenceInDays(parseISO(targetDate), today);
    if (days < 0) return { text: `${Math.abs(days)}d overdue`, color: 'text-red-600' };
    if (days === 0) return { text: 'Due today', color: 'text-orange-600' };
    if (days <= 7) return { text: `${days}d left`, color: 'text-yellow-600' };
    return { text: `${days}d remaining`, color: 'text-green-600' };
  };

  return (
    <Card className="border-2 border-blue-300">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          Care Plan Timeline
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        {/* Timeline Header */}
        <div className="mb-6 pb-4 border-b">
          <div className="flex justify-between items-center text-sm">
            <div className="text-slate-600">
              <strong>Timeline:</strong> {format(earliestDate, 'MMM d, yyyy')} - {format(latestDate, 'MMM d, yyyy')}
            </div>
            <div className="text-slate-600">
              <strong>Duration:</strong> {totalDays} days
            </div>
          </div>
        </div>

        {/* Timeline Visualization */}
        <div className="relative">
          {/* Timeline Bar with Today Marker */}
          <div className="relative h-3 bg-slate-200 rounded-full mb-8">
            {/* Today Indicator */}
            <div 
              className="absolute top-0 bottom-0 w-0.5 bg-blue-600 z-10"
              style={{ 
                left: `${getPositionPercentage(format(today, 'yyyy-MM-dd'))}%`
              }}
            >
              <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 text-xs font-medium text-blue-600 whitespace-nowrap">
                Today
              </div>
            </div>

            {/* Progress indicators on timeline */}
            {sortedPlans.map((plan, idx) => {
              if (!plan.target_date) return null;
              const position = getPositionPercentage(plan.target_date);
              const status = plan.status;
              
              return (
                <div
                  key={idx}
                  className={`absolute top-0 w-3 h-3 rounded-full ${getStatusColor(status)} border-2 border-white shadow-md cursor-pointer hover:scale-125 transition-transform`}
                  style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
                  title={`${plan.problem} - ${format(parseISO(plan.target_date), 'MMM d')}`}
                />
              );
            })}
          </div>

          {/* Care Plans List with Timeline Context */}
          <div className="space-y-3">
            {sortedPlans.map((plan, _idx) => {
              const daysInfo = getDaysRemaining(plan.target_date);
              const isOverdue = plan.target_date && isAfter(today, parseISO(plan.target_date)) && plan.status === 'active';
              
              return (
                <Card 
                  key={plan.id} 
                  className={`border-l-4 ${
                    isOverdue ? 'border-l-red-500 bg-red-50' :
                    plan.status === 'met' ? 'border-l-blue-500 bg-blue-50' :
                    plan.status === 'active' ? 'border-l-green-500' :
                    'border-l-slate-300'
                  }`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1">
                        <div className={`mt-1 ${
                          plan.status === 'met' ? 'text-blue-600' :
                          isOverdue ? 'text-red-600' :
                          'text-green-600'
                        }`}>
                          {getStatusIcon(plan.status, plan.target_date)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge className={getStatusColor(plan.status)}>
                              {plan.status.replace('_', ' ')}
                            </Badge>
                            {plan.target_date && daysInfo && (
                              <Badge variant="outline" className={daysInfo.color}>
                                {daysInfo.text}
                              </Badge>
                            )}
                            {plan.target_date && (
                              <span className="text-xs text-slate-500">
                                Target: {format(parseISO(plan.target_date), 'MMM d, yyyy')}
                              </span>
                            )}
                          </div>
                          
                          <h4 className="font-semibold text-slate-900 mb-1">{plan.problem}</h4>
                          <p className="text-sm text-slate-700 mb-2">{plan.goal}</p>

                          {plan.interventions && plan.interventions.length > 0 && (
                            <div className="mt-2">
                              <p className="text-xs font-medium text-slate-600 mb-1">Interventions:</p>
                              <ul className="list-disc ml-5 text-xs text-slate-600 space-y-0.5">
                                {plan.interventions.map((intervention, i) => (
                                  <li key={i}>{intervention}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <div className="flex gap-4 mt-2 text-xs text-slate-500">
                            {plan.frequency && <span><strong>Frequency:</strong> {plan.frequency}</span>}
                            {plan.baseline_measurement && <span><strong>Baseline:</strong> {plan.baseline_measurement}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      {plan.target_date && plan.status === 'active' && (
                        <div className="w-24 shrink-0">
                          <p className="text-xs text-slate-500 mb-1 text-center">Progress</p>
                          <div className="relative">
                            {(() => {
                              const created = parseISO(plan.created_date);
                              const target = parseISO(plan.target_date);
                              const totalPlanDays = differenceInDays(target, created);
                              const daysElapsed = differenceInDays(today, created);
                              // Guard a zero/invalid span (same-day target, or an
                              // unparseable date -> NaN) so progress doesn't render "NaN%".
                              const progress = Number.isFinite(totalPlanDays) && totalPlanDays > 0 && Number.isFinite(daysElapsed)
                                ? Math.min(Math.max((daysElapsed / totalPlanDays) * 100, 0), 100)
                                : 0;
                              
                              return (
                                <>
                                  <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                    <div 
                                      className={`h-full ${isOverdue ? 'bg-red-500' : 'bg-green-500'} transition-all`}
                                      style={{ width: `${progress}%` }}
                                    />
                                  </div>
                                  <p className="text-xs text-center mt-1 text-slate-600">
                                    {Math.round(progress)}%
                                  </p>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-6 pt-4 border-t">
          <p className="text-xs font-medium text-slate-600 mb-2">Status Legend:</p>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-xs text-slate-600">Active</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-xs text-slate-600">Met</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-xs text-slate-600">Not Met</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <span className="text-xs text-slate-600">Revised</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}