import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Clock, TrendingUp } from "lucide-react";
import { format } from "date-fns";

export default function TrainingProgressDashboard({ completions = [], certifications = [] }) {
  const earnedCerts = certifications.filter(c => c.status === 'earned');
  const inProgressCerts = certifications.filter(c => c.status === 'in_progress');
  const averageScore = completions.length > 0 
    ? Math.round(completions.reduce((sum, c) => sum + (c.score || 0), 0) / completions.length)
    : 0;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-600">Average Score</p>
              <TrendingUp className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-3xl font-bold">{averageScore}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-600">Certifications Earned</p>
              <CheckCircle2 className="w-4 h-4 text-green-600" />
            </div>
            <p className="text-3xl font-bold">{earnedCerts.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-600">In Progress</p>
              <Clock className="w-4 h-4 text-orange-600" />
            </div>
            <p className="text-3xl font-bold">{inProgressCerts.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Completions */}
      {completions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Module Completions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {completions.slice(0, 5).map((completion, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">Module {idx + 1}</p>
                  <p className="text-xs text-gray-600">
                    {format(new Date(completion.completion_date), 'MMM d, yyyy')}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-blue-600">{completion.score}%</p>
                  <Badge variant="outline" className="mt-1">Passed</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Certifications */}
      {(earnedCerts.length > 0 || inProgressCerts.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Certification Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {earnedCerts.map((cert) => (
              <div key={cert.id} className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-green-900">{cert.certification_name}</h4>
                  <Badge className="bg-green-600">Earned</Badge>
                </div>
                <p className="text-sm text-green-800">
                  Earned on {format(new Date(cert.earned_date), 'MMM d, yyyy')}
                </p>
              </div>
            ))}

            {inProgressCerts.map((cert) => (
              <div key={cert.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-gray-900">{cert.certification_name}</h4>
                  <Badge variant="outline">{cert.completion_percentage}%</Badge>
                </div>
                <Progress value={cert.completion_percentage} className="h-2" />
                <p className="text-xs text-gray-600">
                  Complete {cert.required_modules?.length || 0} modules to earn this certification
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}