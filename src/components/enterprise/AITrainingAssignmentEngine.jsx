import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Brain, Zap, CheckCircle2, AlertTriangle, GraduationCap, Loader2, Target } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function AITrainingAssignmentEngine({ agencyCode }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [recommendations, setRecommendations] = useState(null);
  const queryClient = useQueryClient();

  const { data: providers = [] } = useQuery({
    queryKey: ['agencyProviders', agencyCode],
    queryFn: async () => {
      const allUsers = await base44.asServiceRole.entities.User.list();
      return allUsers.filter(u => u.agency_code === agencyCode);
    },
    enabled: !!agencyCode
  });

  const { data: violations = [] } = useQuery({
    queryKey: ['agencyViolations', agencyCode],
    queryFn: async () => {
      const allViolations = await base44.entities.ComplianceViolation.list('-created_date', 200);
      const providerEmails = providers.map(p => p.email);
      return allViolations.filter(v => providerEmails.includes(v.user_email));
    },
    enabled: providers.length > 0
  });

  const { data: trainingModules = [] } = useQuery({
    queryKey: ['trainingModules'],
    queryFn: () => base44.entities.TrainingModule.list()
  });

  const assignTrainingMutation = useMutation({
    mutationFn: async ({ providerEmail, moduleId, reason }) => {
      const module = trainingModules.find(m => m.id === moduleId);
      return base44.entities.TrainingCompletion.create({
        nurse_email: providerEmail,
        module_title: module?.title || 'Training Module',
        module_id: moduleId,
        status: 'assigned',
        assigned_date: new Date().toISOString(),
        assignment_reason: reason,
        source: 'ai_auto_assignment'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trainingCompletions'] });
      toast.success('Training module assigned successfully');
    }
  });

  const analyzeAndAssign = async () => {
    setAnalyzing(true);
    try {
      // Analyze skill gaps and compliance issues using AI
      const providerAnalysis = await Promise.all(providers.map(async (provider) => {
        const providerViolations = violations.filter(v => v.user_email === provider.email && v.status === 'open');
        
        // Get recent audits
        const audits = await base44.entities.ComplianceAudit.filter(
          { nurse_email: provider.email },
          '-audit_date',
          10
        );

        const avgScore = audits.length > 0
          ? audits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / audits.length
          : 0;

        // Count violations by category
        const violationsByCategory = providerViolations.reduce((acc, v) => {
          acc[v.rule_category] = (acc[v.rule_category] || 0) + 1;
          return acc;
        }, {});

        return {
          provider,
          avgScore,
          violationsCount: providerViolations.length,
          violationsByCategory,
          topIssue: Object.entries(violationsByCategory).sort((a, b) => b[1] - a[1])[0]
        };
      }));

      // Use AI to match skill gaps with training modules
      const aiPrompt = `Analyze these provider performance data and compliance issues, then recommend specific training modules for each provider.

Provider Analysis:
${providerAnalysis.map(p => `
- ${p.provider.full_name} (${p.provider.email}):
  - Avg Compliance Score: ${p.avgScore.toFixed(1)}%
  - Open Violations: ${p.violationsCount}
  - Top Issue Category: ${p.topIssue?.[0] || 'None'} (${p.topIssue?.[1] || 0} violations)
`).join('\n')}

Available Training Modules:
${trainingModules.map(m => `- ${m.title} (Category: ${m.category})`).join('\n')}

Provide training assignments in this exact JSON format:
{
  "assignments": [
    {
      "provider_email": "email",
      "provider_name": "name",
      "recommended_modules": ["module_title_1", "module_title_2"],
      "priority": "high|medium|low",
      "reason": "specific reason based on their gaps"
    }
  ]
}`;

      const aiResponse = await base44.integrations.Core.InvokeLLM({
        prompt: aiPrompt,
        response_json_schema: {
          type: "object",
          properties: {
            assignments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  provider_email: { type: "string" },
                  provider_name: { type: "string" },
                  recommended_modules: { type: "array", items: { type: "string" } },
                  priority: { type: "string" },
                  reason: { type: "string" }
                }
              }
            }
          }
        }
      });

      setRecommendations(aiResponse.assignments);
      toast.success('AI analysis complete! Review recommendations below.');
    } catch (error) {
      toast.error('Failed to analyze training needs');
      console.error(error);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleBulkAssign = async () => {
    if (!recommendations) return;

    const assignmentPromises = [];
    for (const rec of recommendations) {
      for (const moduleTitle of rec.recommended_modules) {
        const module = trainingModules.find(m => m.title === moduleTitle);
        if (module) {
          assignmentPromises.push(
            assignTrainingMutation.mutateAsync({
              providerEmail: rec.provider_email,
              moduleId: module.id,
              reason: rec.reason
            })
          );
        }
      }
    }

    try {
      await Promise.all(assignmentPromises);
      toast.success(`Assigned ${assignmentPromises.length} training modules across ${recommendations.length} providers`);
      setRecommendations(null);
    } catch (error) {
      toast.error('Some assignments failed. Please review and try again.');
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <Card className="border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-purple-100">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-600" />
          AI Training Assignment Engine
        </CardTitle>
        <CardDescription>
          Automatically identify skill gaps and assign personalized training modules to providers
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="bg-purple-50 border-purple-200">
          <Brain className="w-4 h-4 text-purple-600" />
          <AlertDescription className="text-purple-900">
            AI analyzes compliance violations, audit scores, and documentation patterns to recommend targeted training for each provider.
          </AlertDescription>
        </Alert>

        <div className="flex items-center justify-between p-4 bg-white rounded-lg border">
          <div>
            <p className="font-semibold text-slate-900">Agency Providers</p>
            <p className="text-sm text-slate-600">{providers.length} total • {violations.length} open violations</p>
          </div>
          <Button
            onClick={analyzeAndAssign}
            disabled={analyzing || providers.length === 0}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                Analyze & Recommend
              </>
            )}
          </Button>
        </div>

        {/* Recommendations */}
        {recommendations && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-purple-600" />
                AI Training Recommendations
              </h3>
              <Button onClick={handleBulkAssign} className="bg-green-600 hover:bg-green-700">
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Assign All
              </Button>
            </div>

            <div className="space-y-3">
              {recommendations.map((rec, idx) => (
                <Card key={idx} className="bg-white">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="font-semibold text-slate-900">{rec.provider_name}</p>
                          <Badge className={getPriorityColor(rec.priority)}>
                            {rec.priority} priority
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-600 mb-3">{rec.reason}</p>
                        <div className="flex flex-wrap gap-2">
                          {rec.recommended_modules.map((module, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              <GraduationCap className="w-3 h-3 mr-1" />
                              {module}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={async () => {
                          for (const moduleTitle of rec.recommended_modules) {
                            const module = trainingModules.find(m => m.title === moduleTitle);
                            if (module) {
                              await assignTrainingMutation.mutateAsync({
                                providerEmail: rec.provider_email,
                                moduleId: module.id,
                                reason: rec.reason
                              });
                            }
                          }
                        }}
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        Assign
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}