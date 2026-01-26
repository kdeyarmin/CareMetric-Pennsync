import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Sparkles, 
  Loader2, 
  Target, 
  AlertTriangle, 
  TrendingUp, 
  BookOpen,
  CheckCircle2,
  ArrowRight,
  Brain,
  Clock,
  Zap
} from 'lucide-react';
import { toast } from 'sonner';

export default function AITrainingRecommendations({ userEmail, skillGaps, completions, trainingModules }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [recommendations, setRecommendations] = useState(null);
  const queryClient = useQueryClient();

  // Get performance data for analysis
  const { data: violations = [] } = useQuery({
    queryKey: ['userViolations', userEmail],
    queryFn: () => base44.entities.ComplianceViolation.filter({ user_email: userEmail }),
    enabled: !!userEmail,
    initialData: []
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['userVisits', userEmail],
    queryFn: () => base44.entities.Visit.filter({ nurse_email: userEmail }, '-created_date', 50),
    enabled: !!userEmail,
    initialData: []
  });

  const assignTrainingMutation = useMutation({
    mutationFn: (moduleId) => base44.entities.TrainingCompletion.create({
      nurse_email: userEmail,
      training_module_id: moduleId,
      status: 'assigned',
      due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['myCompletions', userEmail]);
      toast.success('Training assigned successfully');
    }
  });

  const generateRecommendations = async () => {
    setIsGenerating(true);
    try {
      // Prepare context for AI
      const completedModuleIds = completions
        .filter(c => c.status === 'completed')
        .map(c => c.training_module_id);
      
      const completedModules = trainingModules
        .filter(m => completedModuleIds.includes(m.id))
        .map(m => m.title);

      const availableModules = trainingModules
        .filter(m => !completedModuleIds.includes(m.id))
        .map(m => ({
          id: m.id,
          title: m.title,
          category: m.category,
          difficulty: m.difficulty_level,
          duration: m.duration_minutes,
          skills: m.related_skills || []
        }));

      const activeSkillGaps = skillGaps
        .filter(g => g.status === 'identified' || g.status === 'in_progress')
        .map(g => ({
          area: g.skill_area,
          type: g.gap_type,
          severity: g.severity,
          reasoning: g.ai_reasoning
        }));

      const recentViolations = violations
        .slice(0, 10)
        .map(v => ({
          rule: v.rule_name,
          category: v.rule_category,
          severity: v.severity
        }));

      const visitStats = {
        totalVisits: visits.length,
        avgQualityScore: visits.length > 0 
          ? Math.round(visits.reduce((sum, v) => sum + (v.documentation_quality_score || 0), 0) / visits.length)
          : 0
      };

      const prompt = `You are an AI training advisor for healthcare staff. Analyze this user's performance data and recommend personalized training.

USER PROFILE:
- Completed ${completedModules.length} training modules: ${completedModules.slice(0, 5).join(', ')}
- Recent visits: ${visitStats.totalVisits}, Average documentation quality: ${visitStats.avgQualityScore}%

IDENTIFIED SKILL GAPS:
${activeSkillGaps.length > 0 ? activeSkillGaps.map(g => `- ${g.area} (${g.severity}): ${g.reasoning}`).join('\n') : 'None identified'}

RECENT COMPLIANCE ISSUES:
${recentViolations.length > 0 ? recentViolations.map(v => `- ${v.rule} (${v.category}, ${v.severity})`).join('\n') : 'None'}

AVAILABLE TRAINING MODULES:
${availableModules.slice(0, 15).map(m => `- ${m.title} [${m.category}] - ${m.difficulty}, ${m.duration}min`).join('\n')}

Based on this analysis, provide personalized training recommendations in the following JSON format:
{
  "priority_modules": [{"module_id": "id", "title": "title", "reason": "why recommended", "urgency": "high/medium/low"}],
  "skill_development_path": [{"step": 1, "focus_area": "area", "modules": ["module titles"], "expected_outcome": "outcome"}],
  "compliance_training": [{"module_title": "title", "addresses": "what compliance issue"}],
  "performance_insights": {
    "strengths": ["list of strengths"],
    "improvement_areas": ["areas needing work"],
    "recommended_focus": "main focus area"
  },
  "learning_tips": ["personalized tips for effective learning"]
}`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            priority_modules: { type: "array", items: { type: "object" } },
            skill_development_path: { type: "array", items: { type: "object" } },
            compliance_training: { type: "array", items: { type: "object" } },
            performance_insights: { type: "object" },
            learning_tips: { type: "array", items: { type: "string" } }
          }
        }
      });

      setRecommendations(response);
      toast.success('AI recommendations generated successfully');
    } catch (error) {
      console.error('Error generating recommendations:', error);
      toast.error('Failed to generate recommendations');
    } finally {
      setIsGenerating(false);
    }
  };

  const getModuleByTitle = (title) => {
    return trainingModules.find(m => 
      m.title.toLowerCase().includes(title.toLowerCase()) ||
      title.toLowerCase().includes(m.title.toLowerCase())
    );
  };

  const isModuleAssigned = (moduleId) => {
    return completions.some(c => c.training_module_id === moduleId && c.status !== 'completed');
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="bg-gradient-to-r from-purple-50 via-blue-50 to-indigo-50 dark:from-purple-950 dark:via-blue-950 dark:to-indigo-950 border-purple-200 dark:border-purple-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-purple-900 dark:text-purple-100">
            <Brain className="w-6 h-6" />
            AI-Powered Training Recommendations
          </CardTitle>
          <CardDescription className="text-purple-700 dark:text-purple-300">
            Get personalized training suggestions based on your performance analytics and identified skill gaps
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!recommendations ? (
            <Button 
              onClick={generateRecommendations} 
              disabled={isGenerating}
              className="w-full bg-purple-600 hover:bg-purple-700"
              size="lg"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Analyzing Your Performance...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 mr-2" />
                  Generate My Personalized Recommendations
                </>
              )}
            </Button>
          ) : (
            <Button 
              onClick={() => setRecommendations(null)} 
              variant="outline"
              className="w-full"
            >
              Refresh Recommendations
            </Button>
          )}
        </CardContent>
      </Card>

      {recommendations && (
        <>
          {/* Performance Insights */}
          {recommendations.performance_insights && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                  Your Performance Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Strengths */}
                  <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
                    <h4 className="font-semibold text-green-800 dark:text-green-200 mb-2 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      Your Strengths
                    </h4>
                    <ul className="space-y-1">
                      {recommendations.performance_insights.strengths?.map((strength, idx) => (
                        <li key={idx} className="text-sm text-green-700 dark:text-green-300 flex items-start gap-2">
                          <span className="text-green-500 mt-1">✓</span>
                          {strength}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Improvement Areas */}
                  <div className="p-4 bg-amber-50 dark:bg-amber-950 rounded-lg border border-amber-200 dark:border-amber-800">
                    <h4 className="font-semibold text-amber-800 dark:text-amber-200 mb-2 flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      Areas for Improvement
                    </h4>
                    <ul className="space-y-1">
                      {recommendations.performance_insights.improvement_areas?.map((area, idx) => (
                        <li key={idx} className="text-sm text-amber-700 dark:text-amber-300 flex items-start gap-2">
                          <span className="text-amber-500 mt-1">→</span>
                          {area}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {recommendations.performance_insights.recommended_focus && (
                  <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      <strong>Recommended Focus:</strong> {recommendations.performance_insights.recommended_focus}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Priority Modules */}
          {recommendations.priority_modules?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-600" />
                  Priority Training Modules
                </CardTitle>
                <CardDescription>These modules address your most pressing learning needs</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recommendations.priority_modules.map((rec, idx) => {
                    const module = getModuleByTitle(rec.title);
                    const isAssigned = module && isModuleAssigned(module.id);

                    return (
                      <div 
                        key={idx} 
                        className={`p-4 rounded-lg border ${
                          rec.urgency === 'high' 
                            ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800' 
                            : rec.urgency === 'medium'
                            ? 'bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800'
                            : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-semibold text-slate-900 dark:text-slate-100">{rec.title}</h4>
                              <Badge className={
                                rec.urgency === 'high' ? 'bg-red-100 text-red-800' :
                                rec.urgency === 'medium' ? 'bg-amber-100 text-amber-800' :
                                'bg-slate-100 text-slate-800'
                              }>
                                {rec.urgency} priority
                              </Badge>
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">{rec.reason}</p>
                          </div>
                          {module && (
                            <Button 
                              size="sm"
                              onClick={() => assignTrainingMutation.mutate(module.id)}
                              disabled={isAssigned || assignTrainingMutation.isPending}
                              className={isAssigned ? 'bg-slate-400' : ''}
                            >
                              {isAssigned ? 'Assigned' : 'Enroll'}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Skill Development Path */}
          {recommendations.skill_development_path?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ArrowRight className="w-5 h-5 text-indigo-600" />
                  Your Learning Path
                </CardTitle>
                <CardDescription>A structured approach to developing your skills</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {recommendations.skill_development_path.map((step, idx) => (
                    <div key={idx} className="flex gap-4">
                      <div className="flex-shrink-0 w-8 h-8 bg-indigo-100 dark:bg-indigo-900 rounded-full flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-bold text-sm">
                        {step.step || idx + 1}
                      </div>
                      <div className="flex-1 pb-4 border-b border-slate-200 dark:border-slate-700 last:border-0">
                        <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
                          {step.focus_area}
                        </h4>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {step.modules?.map((mod, mIdx) => (
                            <Badge key={mIdx} variant="outline" className="text-xs">
                              {mod}
                            </Badge>
                          ))}
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          <strong>Expected Outcome:</strong> {step.expected_outcome}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Learning Tips */}
          {recommendations.learning_tips?.length > 0 && (
            <Card className="bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950 dark:to-cyan-950 border-blue-200 dark:border-blue-800">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-blue-900 dark:text-blue-100">
                  <BookOpen className="w-5 h-5" />
                  Personalized Learning Tips
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {recommendations.learning_tips.map((tip, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-blue-800 dark:text-blue-200">
                      <span className="text-blue-500 mt-1">💡</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}