import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  GraduationCap,
  Brain,
  Target,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronRight,
  Play,
  Sparkles
} from "lucide-react";
import { formatEastern } from "../utils/timezone";
import AIInsightFeedbackWidget from "../feedback/AIInsightFeedbackWidget";

export default function AITrainingRecommendations({ userId, userEmail }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [recommendations, setRecommendations] = useState(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const queryClient = useQueryClient();

  // Fetch user's training history
  const { data: completedTraining = [] } = useQuery({
    queryKey: ['trainingCompletions', userEmail],
    queryFn: () => base44.entities.TrainingCompletion.filter({ nurse_email: userEmail }),
    enabled: !!userEmail,
  });

  // Fetch training recommendations
  const { data: trainingRecommendations = [] } = useQuery({
    queryKey: ['trainingRecommendations', userEmail],
    queryFn: () => base44.entities.TrainingRecommendation.filter({ nurse_email: userEmail, addressed: false }),
    enabled: !!userEmail,
  });

  // Fetch compliance audits
  const { data: complianceAudits = [] } = useQuery({
    queryKey: ['userComplianceAudits', userEmail],
    queryFn: () => base44.entities.ComplianceAudit.filter({ nurse_email: userEmail }, '-audit_date', 10),
    enabled: !!userEmail,
  });

  // Fetch available training modules
  const { data: availableModules = [] } = useQuery({
    queryKey: ['trainingModules'],
    queryFn: () => base44.entities.TrainingModule.filter({ is_active: true }),
  });

  // Analyze and generate recommendations
  const analyzeTrainingNeeds = async () => {
    setAnalyzing(true);
    try {
      // Get common compliance issues from recent audits
      const recentIssues = complianceAudits
        .flatMap(audit => audit.issues || [])
        .slice(0, 20);

      const issueCategories = recentIssues.reduce((acc, issue) => {
        const category = issue.element || 'general';
        acc[category] = (acc[category] || 0) + 1;
        return acc;
      }, {});

      // Get recommendation context
      const recentRecommendations = trainingRecommendations.slice(0, 10);

      const prompt = `Analyze this nurse's performance and recommend personalized training modules.

NURSE PERFORMANCE DATA:
- Recent Compliance Audits: ${complianceAudits.length}
- Average Compliance Score: ${(complianceAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / complianceAudits.length).toFixed(1)}%
- Total Flagged Issues: ${recentIssues.length}

COMMON ISSUE CATEGORIES:
${Object.entries(issueCategories).map(([cat, count]) => `- ${cat}: ${count} occurrences`).join('\n')}

RECENT ISSUES:
${recentIssues.slice(0, 5).map(issue => `
- Element: ${issue.element}
- Severity: ${issue.severity}
- Problem: ${issue.problem}
- Suggestion: ${issue.suggestion}
`).join('\n')}

EXISTING RECOMMENDATIONS:
${recentRecommendations.map(r => `- ${r.recommendation_type}: ${r.recommendation_text}`).join('\n')}

COMPLETED TRAINING:
${completedTraining.filter(t => t.status === 'completed').length} modules completed

AVAILABLE TRAINING MODULES:
${availableModules.map(m => `- ${m.title} (${m.category}): ${m.description}`).join('\n')}

Based on this analysis, generate 3-5 personalized training recommendations:

For each recommendation:
1. Identify the specific skill gap or compliance issue
2. Explain WHY this training is needed (cite specific issues)
3. Recommend the most relevant training module from available modules
4. Set priority level (critical/high/medium/low)
5. Estimate impact on compliance scores
6. Suggest realistic completion timeline

Format recommendations to be actionable and motivating. Focus on improvement, not criticism.`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            overall_assessment: { type: "string" },
            priority_areas: {
              type: "array",
              items: { type: "string" }
            },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  skill_gap: { type: "string" },
                  rationale: { type: "string" },
                  module_title: { type: "string" },
                  priority: { type: "string" },
                  estimated_impact: { type: "string" },
                  timeline: { type: "string" },
                  related_issues: {
                    type: "array",
                    items: { type: "string" }
                  }
                }
              }
            }
          }
        }
      });

      setRecommendations(result);

      // Auto-assign high priority recommendations as training tasks
      const highPriorityRecs = result.recommendations.filter(r => 
        r.priority === 'critical' || r.priority === 'high'
      );

      for (const rec of highPriorityRecs) {
        // Find matching module
        const matchingModule = availableModules.find(m => 
          m.title.toLowerCase().includes(rec.module_title.toLowerCase()) ||
          rec.module_title.toLowerCase().includes(m.title.toLowerCase())
        );

        if (matchingModule) {
          // Check if already assigned
          const existing = completedTraining.find(t => 
            t.training_module_id === matchingModule.id && 
            t.status !== 'completed'
          );

          if (!existing) {
            await base44.entities.TrainingCompletion.create({
              nurse_email: userEmail,
              training_module_id: matchingModule.id,
              status: 'assigned',
              due_date: getDueDate(rec.timeline)
            });
          }
        }

        // Save recommendation
        await base44.entities.TrainingRecommendation.create({
          nurse_email: userEmail,
          recommendation_type: 'documentation',
          recommendation_text: `${rec.skill_gap}: ${rec.rationale}`,
          source: 'ai_documentation_suggester',
          severity: rec.priority,
          addressed: false,
          context_data: {
            module_title: rec.module_title,
            estimated_impact: rec.estimated_impact,
            timeline: rec.timeline,
            related_issues: rec.related_issues
          }
        });
      }

      queryClient.invalidateQueries({ queryKey: ['trainingCompletions', userEmail] });
      queryClient.invalidateQueries({ queryKey: ['trainingRecommendations', userEmail] });
    } catch (error) {
      console.error("Error analyzing training needs:", error);
    }
    setAnalyzing(false);
  };

  const getDueDate = (timeline) => {
    const days = timeline.toLowerCase().includes('week') ? 7 : 
                  timeline.toLowerCase().includes('month') ? 30 : 14;
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  };

  // Mark training as started
  const startTrainingMutation = useMutation({
    mutationFn: async (trainingId) => {
      await base44.entities.TrainingCompletion.update(trainingId, { 
        status: 'in_progress' 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trainingCompletions', userEmail] });
    }
  });

  // Get pending/assigned training
  const pendingTraining = completedTraining.filter(t => 
    t.status === 'assigned' || t.status === 'in_progress'
  );

  const completedCount = completedTraining.filter(t => t.status === 'completed').length;
  const totalAssigned = completedTraining.length;
  const completionRate = totalAssigned > 0 ? Math.round((completedCount / totalAssigned) * 100) : 0;

  useEffect(() => {
    if (userEmail && complianceAudits.length > 0 && !recommendations) {
      analyzeTrainingNeeds();
    }
  }, [userEmail, complianceAudits.length]);

  const getPriorityColor = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  return (
    <Card className="border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-white">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-600" />
            AI Training Recommendations
            <Badge className="bg-purple-600 text-white">Personalized</Badge>
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={analyzeTrainingNeeds}
            disabled={analyzing}
            className="gap-2"
          >
            {analyzing ? (
              <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600" /> Analyzing...</>
            ) : (
              <><Sparkles className="w-4 h-4" /> Re-analyze</>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Completion Progress */}
        <div className="bg-white p-4 rounded-lg border border-purple-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Training Progress</span>
            <span className="text-sm font-bold text-purple-600">{completedCount} / {totalAssigned}</span>
          </div>
          <Progress value={completionRate} className="h-2" />
          <p className="text-xs text-gray-500 mt-1">{completionRate}% completed</p>
        </div>

        {/* AI Analysis */}
        {recommendations && (
          <Alert className="bg-purple-50 border-purple-200">
            <Brain className="w-4 h-4 text-purple-600" />
            <AlertDescription className="text-purple-900 text-sm">
              <strong>AI Assessment:</strong> {recommendations.overall_assessment}
            </AlertDescription>
          </Alert>
        )}

        {/* Priority Training Modules */}
        {pendingTraining.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Target className="w-4 h-4 text-purple-600" />
              Assigned Training ({pendingTraining.length})
            </h4>
            {pendingTraining.slice(0, 3).map((training) => {
              const module = availableModules.find(m => m.id === training.training_module_id);
              if (!module) return null;

              return (
                <div key={training.id} className="bg-white p-3 rounded-lg border border-purple-200">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h5 className="font-medium text-gray-900 text-sm">{module.title}</h5>
                      <p className="text-xs text-gray-600 mt-1">{module.description}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="outline" className="text-xs">
                          {module.category}
                        </Badge>
                        {module.duration_minutes && (
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {module.duration_minutes} min
                          </span>
                        )}
                        {training.due_date && (
                          <span className="text-xs text-orange-600 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            Due {formatEastern(training.due_date, 'MMM d')}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        startTrainingMutation.mutate(training.id);
                        window.location.href = '/staff-training-hub';
                      }}
                      className="bg-purple-600 hover:bg-purple-700 gap-1"
                    >
                      {training.status === 'in_progress' ? (
                        <><Play className="w-3 h-3" /> Continue</>
                      ) : (
                        <><Play className="w-3 h-3" /> Start</>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
            {pendingTraining.length > 3 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.location.href = '/staff-training-hub'}
                className="w-full text-purple-600"
              >
                View All Training ({pendingTraining.length})
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        )}

        {/* AI Recommendations */}
        {recommendations?.recommendations && recommendations.recommendations.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-600" />
              Recommended for You
            </h4>
            {recommendations.recommendations.slice(0, 2).map((rec, idx) => (
              <div key={idx} className={`p-3 rounded-lg border ${getPriorityColor(rec.priority)}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className="text-xs">{rec.priority}</Badge>
                      <h5 className="font-semibold text-sm">{rec.skill_gap}</h5>
                    </div>
                    <p className="text-xs mb-2">{rec.rationale}</p>
                    <div className="flex items-center gap-2 text-xs">
                      <GraduationCap className="w-3 h-3" />
                      <span className="font-medium">{rec.module_title}</span>
                      <span className="text-gray-600">• {rec.timeline}</span>
                    </div>
                    {rec.estimated_impact && (
                      <p className="text-xs mt-2 text-gray-700">
                        <strong>Expected Impact:</strong> {rec.estimated_impact}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {pendingTraining.length === 0 && !recommendations && !analyzing && (
          <div className="text-center py-8">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-900">All Caught Up!</p>
            <p className="text-xs text-gray-500 mt-1">No pending training at this time</p>
          </div>
        )}

        {/* Loading State */}
        {analyzing && !recommendations && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-3" />
            <p className="text-sm text-gray-600">Analyzing your performance...</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}