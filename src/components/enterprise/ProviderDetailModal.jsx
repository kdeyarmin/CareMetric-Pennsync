import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Award, BookOpen, TrendingUp, AlertCircle } from "lucide-react";

export default function ProviderDetailModal({ provider, performanceData, onClose }) {
  // Fetch detailed data
  const { data: audits = [] } = useQuery({
    queryKey: ['providerAudits', provider.email],
    queryFn: () => base44.entities.ComplianceAudit.filter(
      { nurse_email: provider.email },
      '-audit_date',
      100
    )
  });

  const { data: training = [] } = useQuery({
    queryKey: ['providerTraining', provider.email],
    queryFn: () => base44.entities.TrainingCompletion.filter(
      { nurse_email: provider.email },
      '-completion_date',
      100
    )
  });

  const { data: recommendations = [] } = useQuery({
    queryKey: ['providerRecommendations', provider.email],
    queryFn: () => base44.entities.TrainingRecommendation.filter(
      { nurse_email: provider.email },
      '-created_date',
      50
    )
  });

  // Get recurring issues
  const recurringIssues = audits.reduce((acc, audit) => {
    (audit.issues || []).forEach(issue => {
      const key = issue.element || 'Unknown';
      acc[key] = (acc[key] || 0) + 1;
    });
    return acc;
  }, {});

  const topIssues = Object.entries(recurringIssues)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {provider.full_name}
          </DialogTitle>
          <p className="text-sm text-slate-500">{provider.email}</p>
        </DialogHeader>

        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="compliance">Compliance</TabsTrigger>
            <TabsTrigger value="training">Training</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Compliance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-600">
                    {performanceData?.avgCompliance || 0}%
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Quality</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-purple-600">
                    {performanceData?.avgQuality || 0}%
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Productivity</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">
                    {performanceData?.productivity || 0}
                  </div>
                  <p className="text-xs text-slate-500">notes</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Training</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-amber-600">
                    {performanceData?.trainingCompleted || 0}
                  </div>
                  <p className="text-xs text-slate-500">completed</p>
                </CardContent>
              </Card>
            </div>

            {topIssues.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-red-600" />
                    Top Recurring Issues
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {topIssues.map(([issue, count]) => (
                      <div key={issue} className="flex justify-between items-center">
                        <span className="text-sm">{issue}</span>
                        <Badge variant="outline">{count} occurrences</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="compliance" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Recent Compliance Audits</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {audits.slice(0, 10).map((audit) => (
                    <div 
                      key={audit.id}
                      className="flex justify-between items-center p-3 border rounded-lg"
                    >
                      <div>
                        <div className="font-medium">
                          {new Date(audit.audit_date).toLocaleDateString()}
                        </div>
                        <div className="text-sm text-slate-500">
                          {audit.issues?.length || 0} issues found
                        </div>
                      </div>
                      <Badge className={
                        audit.status === 'passed' ? 'bg-green-100 text-green-800' :
                        audit.status === 'flagged' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }>
                        {audit.compliance_score}%
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="training" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-purple-600" />
                  Completed Training
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {training.filter(t => t.status === 'completed').slice(0, 10).map((t) => (
                    <div key={t.id} className="flex justify-between items-center p-2 border rounded">
                      <div className="flex-1">
                        <div className="text-sm font-medium">{t.training_module_id}</div>
                        <div className="text-xs text-slate-500">
                          {new Date(t.completion_date).toLocaleDateString()}
                        </div>
                      </div>
                      {t.score && (
                        <Badge variant="outline">{t.score}%</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Pending Recommendations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {recommendations.filter(r => !r.addressed).map((rec) => (
                    <div key={rec.id} className="p-3 border rounded-lg">
                      <div className="font-medium text-sm">{rec.recommendation_text}</div>
                      <Badge className="mt-1" variant="outline">
                        {rec.severity}
                      </Badge>
                    </div>
                  ))}
                  {recommendations.filter(r => !r.addressed).length === 0 && (
                    <p className="text-sm text-slate-500 text-center py-4">
                      No pending recommendations
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}