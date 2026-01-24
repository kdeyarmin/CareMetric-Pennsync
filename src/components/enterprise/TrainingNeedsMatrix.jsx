import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GraduationCap, Users, Target } from "lucide-react";

export default function TrainingNeedsMatrix({ trainingNeeds }) {
  if (!trainingNeeds || trainingNeeds.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Training Needs Analysis</CardTitle>
          <CardDescription>
            Recommended training based on performance gaps
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No specific training needs identified at this time.
          </p>
        </CardContent>
      </Card>
    );
  }

  const getPriorityColor = (priority) => {
    if (priority === "high") return "bg-red-100 text-red-800 border-red-200";
    if (priority === "medium") return "bg-yellow-100 text-yellow-800 border-yellow-200";
    return "bg-blue-100 text-blue-800 border-blue-200";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Training Needs Analysis</CardTitle>
        <CardDescription>
          Recommended training based on agency-wide performance gaps
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {trainingNeeds.map((need, idx) => (
          <div key={idx} className="border rounded-lg p-4 bg-slate-50 dark:bg-slate-800">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <GraduationCap className="w-4 h-4 text-blue-600" />
                  <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                    {need.topic}
                  </h4>
                  <Badge className={getPriorityColor(need.priority)}>
                    {need.priority} priority
                  </Badge>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {need.reason}
                </p>
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1 text-slate-600">
                  <Users className="w-3 h-3" />
                  <span>{need.providersNeeding} providers need this</span>
                </div>
                <div className="flex items-center gap-1 text-green-600">
                  <Target className="w-3 h-3" />
                  <span>Expected impact: +{need.expectedImpact}%</span>
                </div>
              </div>
              <Button size="sm" variant="outline">
                Assign Training
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}