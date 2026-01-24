import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, TrendingUp, Users } from "lucide-react";

export default function CommonIssuesAnalysis({ issues }) {
  if (!issues || issues.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Common Issues & Training Needs</CardTitle>
          <CardDescription>
            Agency-wide documentation and compliance issues
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              No common issues identified. Great work!
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const getSeverityColor = (severity) => {
    if (severity >= 70) return "bg-red-100 text-red-800 border-red-200";
    if (severity >= 40) return "bg-yellow-100 text-yellow-800 border-yellow-200";
    return "bg-blue-100 text-blue-800 border-blue-200";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Common Issues & Training Needs</CardTitle>
        <CardDescription>
          Recurring documentation issues across the agency
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {issues.map((issue, idx) => (
          <div key={idx} className="border rounded-lg p-4 bg-slate-50 dark:bg-slate-800">
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                    {issue.issue}
                  </h4>
                  <Badge className={getSeverityColor(issue.prevalence)}>
                    {issue.prevalence}% prevalence
                  </Badge>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                  {issue.description}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1 text-slate-600">
                <Users className="w-3 h-3" />
                <span>{issue.affectedProviders} providers affected</span>
              </div>
              <div className="flex items-center gap-1 text-blue-600">
                <TrendingUp className="w-3 h-3" />
                <span className="font-medium">Action: {issue.recommendation}</span>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}