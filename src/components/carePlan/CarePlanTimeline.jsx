import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  CheckCircle, 
  Circle, 
  Clock,
  TrendingUp,
  Calendar
} from 'lucide-react';

export default function CarePlanTimeline({ carePlanId }) {
  const { data: carePlan } = useQuery({
    queryKey: ['care-plan', carePlanId],
    queryFn: () => base44.entities.CarePlan.get(carePlanId)
  });

  const { data: progress } = useQuery({
    queryKey: ['care-plan-progress', carePlanId],
    queryFn: () => base44.entities.CarePlanProgress.filter({ care_plan_id: carePlanId }),
    enabled: !!carePlanId
  });

  if (!carePlan) return null;

  const goals = carePlan.goals || [];
  const completedGoals = progress?.filter(p => p.status === 'achieved').length || 0;
  const overallProgress = goals.length > 0 ? (completedGoals / goals.length) * 100 : 0;

  const timelineEvents = [
    {
      date: carePlan.start_date,
      title: 'Care Plan Started',
      type: 'start',
      icon: Calendar
    },
    ...(progress || []).map(p => ({
      date: p.updated_date || p.created_date,
      title: p.goal_description,
      type: p.status,
      progress: p.progress_percentage,
      notes: p.notes,
      icon: p.status === 'achieved' ? CheckCircle : 
            p.status === 'in_progress' ? Clock : Circle
    })),
    ...(carePlan.end_date ? [{
      date: carePlan.end_date,
      title: 'Care Plan Completed',
      type: 'end',
      icon: CheckCircle
    }] : [])
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Care Plan Timeline
          </CardTitle>
          <Badge variant={carePlan.status === 'active' ? 'default' : 'outline'}>
            {carePlan.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Overall Progress */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Overall Progress</span>
            <span className="text-sm font-bold">{Math.round(overallProgress)}%</span>
          </div>
          <Progress value={overallProgress} className="h-2" />
          <p className="text-xs text-slate-600 mt-1">
            {completedGoals} of {goals.length} goals achieved
          </p>
        </div>

        {/* Timeline */}
        <div className="relative">
          <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-slate-200" />
          
          <div className="space-y-6">
            {timelineEvents.map((event, idx) => {
              const Icon = event.icon;
              const isCompleted = event.type === 'achieved' || event.type === 'start';
              
              return (
                <div key={idx} className="relative flex gap-4">
                  <div className={`relative z-10 flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
                    isCompleted ? 'bg-green-100' : 'bg-slate-100'
                  }`}>
                    <Icon className={`h-5 w-5 ${
                      isCompleted ? 'text-green-600' : 'text-slate-600'
                    }`} />
                  </div>
                  
                  <div className="flex-1 pb-6">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm">{event.title}</span>
                      {event.type === 'in_progress' && event.progress && (
                        <Badge variant="outline" className="text-xs">
                          {event.progress}% Complete
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-600">
                      {new Date(event.date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </p>
                    {event.notes && (
                      <p className="text-sm text-slate-700 mt-2">{event.notes}</p>
                    )}
                    {event.type === 'in_progress' && event.progress && (
                      <Progress value={event.progress} className="h-1 mt-2" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Next Review */}
        {carePlan.next_review_date && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-blue-900">Next Review Scheduled</p>
                <p className="text-xs text-blue-700">
                  {new Date(carePlan.next_review_date).toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}