import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Target, ArrowRight, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function SkillGapWidget({ userEmail, compact = false }) {
  const { data: skillGaps = [] } = useQuery({
    queryKey: ['urgentSkillGaps', userEmail],
    queryFn: () => base44.entities.SkillGap.filter({ 
      user_email: userEmail,
      status: 'identified',
      severity: { "$in": ['critical', 'high'] }
    }, '-severity,-last_detected', 3),
    enabled: !!userEmail,
  });

  if (skillGaps.length === 0) return null;

  return (
    <Card className="border-l-4 border-l-orange-500">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Target className="w-5 h-5 text-orange-600" />
            Skill Development
          </CardTitle>
          <Link to={createPageUrl('PersonalizedLearningPath')}>
            <Button variant="ghost" size="sm">
              View All
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {skillGaps.map(gap => (
            <div key={gap.id} className="p-3 bg-orange-50 dark:bg-orange-950 rounded-lg border border-orange-200 dark:border-orange-800">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className={gap.severity === 'critical' ? 'bg-red-600' : 'bg-orange-500'}>
                      {gap.severity}
                    </Badge>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {gap.skill_area}
                    </p>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                    {gap.ai_reasoning}
                  </p>
                  {gap.frequency_count > 1 && (
                    <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                      Detected {gap.frequency_count} times
                    </p>
                  )}
                </div>
                <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0" />
              </div>
            </div>
          ))}
          <Link to={createPageUrl('PersonalizedLearningPath')}>
            <Button variant="outline" size="sm" className="w-full mt-2">
              Start Learning
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}