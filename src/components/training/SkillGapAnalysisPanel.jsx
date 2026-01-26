import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Target, 
  AlertTriangle, 
  TrendingUp, 
  BookOpen,
  CheckCircle2,
  Sparkles,
  Loader2,
  ArrowRight,
  Brain,
  Zap
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const getSeverityColor = (severity) => {
  switch (severity) {
    case 'critical': return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900 dark:text-red-200 dark:border-red-800';
    case 'high': return 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900 dark:text-orange-200 dark:border-orange-800';
    case 'medium': return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900 dark:text-amber-200 dark:border-amber-800';
    case 'low': return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-800';
    default: return 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700';
  }
};

const getGapTypeIcon = (type) => {
  switch (type) {
    case 'documentation': return '📝';
    case 'compliance': return '⚖️';
    case 'clinical_knowledge': return '🏥';
    case 'oasis': return '📋';
    case 'terminology': return '📚';
    case 'assessment': return '🔍';
    default: return '💡';
  }
};

export default function SkillGapAnalysisPanel({ userEmail, skillGaps, trainingModules }) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const queryClient = useQueryClient();

  const { data: violations = [] } = useQuery({
    queryKey: ['userViolations', userEmail],
    queryFn: () => base44.entities.ComplianceViolation.filter({ user_email: userEmail }),
    enabled: !!userEmail,
    initialData: []
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['userVisits', userEmail],
    queryFn: () => base44.entities.Visit.filter({ nurse_email: userEmail }, '-created_date', 30),
    enabled: !!userEmail,
    initialData: []
  });

  const updateGapMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.SkillGap.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['mySkillGaps', userEmail]);
      toast.success('Skill gap status updated');
    }
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
      toast.success('Training enrolled');
    }
  });

  const analyzeSkillGaps = async () => {
    setIsAnalyzing(true);
    try {
      // Analyze recent performance to identify gaps
      const recentViolations = violations.slice(0, 20).map(v => ({
        rule: v.rule_name,
        category: v.rule_category,
        severity: v.severity,
        description: v.violation_description
      }));

      const visitStats = {
        total: visits.length,
        avgQuality: visits.length > 0
          ? Math.round(visits.reduce((sum, v) => sum + (v.documentation_quality_score || 0), 0) / visits.length)
          : 0
      };

      const prompt = `Analyze this healthcare provider's performance data and identify skill gaps that need to be addressed through training.

RECENT COMPLIANCE VIOLATIONS:
${recentViolations.length > 0 ? recentViolations.map(v => `- ${v.rule} (${v.category}, ${v.severity}): ${v.description}`).join('\n') : 'None'}

VISIT STATISTICS:
- Total recent visits: ${visitStats.total}
- Average documentation quality: ${visitStats.avgQuality}%

Based on this analysis, identify up to 5 skill gaps. For each gap, provide:
1. The skill area name
2. The type (documentation, compliance, clinical_knowledge, oasis, terminology, or assessment)
3. Severity level (critical, high, medium, low)
4. Detailed reasoning for why this gap was identified
5. Specific recommended training topics

Return as JSON:
{
  "skill_gaps": [
    {
      "skill_area": "area name",
      "gap_type": "type",
      "severity": "level",
      "ai_reasoning": "detailed explanation",
      "recommended_training": ["topic 1", "topic 2"]
    }
  ],
  "overall_assessment": "brief summary of the provider's learning needs"
}`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            skill_gaps: { type: "array", items: { type: "object" } },
            overall_assessment: { type: "string" }
          }
        }
      });

      // Create new skill gap records
      if (response.skill_gaps?.length > 0) {
        for (const gap of response.skill_gaps) {
          await base44.entities.SkillGap.create({
            user_email: userEmail,
            skill_area: gap.skill_area,
            gap_type: gap.gap_type,
            severity: gap.severity,
            ai_reasoning: gap.ai_reasoning,
            status: 'identified',
            identified_date: new Date().toISOString(),
            last_detected: new Date().toISOString()
          });
        }
        queryClient.invalidateQueries(['mySkillGaps', userEmail]);
        toast.success(`Identified ${response.skill_gaps.length} skill gaps`);
      } else {
        toast.success('No new skill gaps identified - great job!');
      }
    } catch (error) {
      console.error('Error analyzing skill gaps:', error);
      toast.error('Failed to analyze skill gaps');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const activeGaps = skillGaps.filter(g => g.status === 'identified' || g.status === 'in_progress');
  const addressedGaps = skillGaps.filter(g => g.status === 'addressed');

  // Group gaps by type
  const gapsByType = activeGaps.reduce((acc, gap) => {
    if (!acc[gap.gap_type]) acc[gap.gap_type] = [];
    acc[gap.gap_type].push(gap);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="bg-gradient-to-r from-orange-50 via-amber-50 to-yellow-50 dark:from-orange-950 dark:via-amber-950 dark:to-yellow-950 border-orange-200 dark:border-orange-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-900 dark:text-orange-100">
            <Target className="w-6 h-6" />
            Skill Gap Analysis
          </CardTitle>
          <CardDescription className="text-orange-700 dark:text-orange-300">
            AI-powered analysis of your performance to identify areas for improvement
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={analyzeSkillGaps} 
            disabled={isAnalyzing}
            className="w-full bg-orange-600 hover:bg-orange-700"
            size="lg"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Analyzing Your Performance...
              </>
            ) : (
              <>
                <Brain className="w-5 h-5 mr-2" />
                Run AI Skill Gap Analysis
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-orange-600">{activeGaps.length}</p>
            <p className="text-xs text-slate-500">Active Gaps</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-600">
              {activeGaps.filter(g => g.severity === 'critical' || g.severity === 'high').length}
            </p>
            <p className="text-xs text-slate-500">High Priority</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">
              {activeGaps.filter(g => g.status === 'in_progress').length}
            </p>
            <p className="text-xs text-slate-500">In Progress</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{addressedGaps.length}</p>
            <p className="text-xs text-slate-500">Addressed</p>
          </CardContent>
        </Card>
      </div>

      {/* Active Skill Gaps */}
      {activeGaps.length > 0 ? (
        <div className="space-y-4">
          {Object.entries(gapsByType).map(([type, gaps]) => (
            <Card key={type}>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <span>{getGapTypeIcon(type)}</span>
                  {type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  <Badge variant="outline">{gaps.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {gaps.map((gap) => (
                    <div 
                      key={gap.id} 
                      className={`p-4 rounded-lg border ${getSeverityColor(gap.severity)}`}
                    >
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold">{gap.skill_area}</h4>
                            <Badge className={getSeverityColor(gap.severity)}>
                              {gap.severity}
                            </Badge>
                            {gap.status === 'in_progress' && (
                              <Badge className="bg-blue-100 text-blue-800">In Progress</Badge>
                            )}
                          </div>
                          <p className="text-sm opacity-80">{gap.ai_reasoning}</p>
                        </div>
                      </div>

                      {gap.frequency_count > 1 && (
                        <p className="text-xs opacity-70 mb-2">
                          Detected {gap.frequency_count} times • Last: {gap.last_detected ? format(new Date(gap.last_detected), 'MMM d, yyyy') : 'N/A'}
                        </p>
                      )}

                      {/* Recommended Modules */}
                      {gap.recommended_modules?.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-current/20">
                          <p className="text-xs font-semibold mb-2">Recommended Training:</p>
                          <div className="flex flex-wrap gap-2">
                            {gap.recommended_modules.map((moduleId, idx) => {
                              const module = trainingModules.find(m => m.id === moduleId);
                              if (!module) return null;
                              return (
                                <Button 
                                  key={idx}
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => assignTrainingMutation.mutate(moduleId)}
                                  disabled={assignTrainingMutation.isPending}
                                >
                                  <BookOpen className="w-3 h-3 mr-1" />
                                  {module.title}
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2 mt-3">
                        {gap.status === 'identified' && (
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => updateGapMutation.mutate({ 
                              id: gap.id, 
                              data: { status: 'in_progress' } 
                            })}
                          >
                            <Zap className="w-3 h-3 mr-1" />
                            Start Addressing
                          </Button>
                        )}
                        {gap.status === 'in_progress' && (
                          <Button 
                            size="sm" 
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() => updateGapMutation.mutate({ 
                              id: gap.id, 
                              data: { status: 'addressed', addressed_date: new Date().toISOString() } 
                            })}
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Mark Addressed
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h3 className="font-semibold text-lg text-slate-900 dark:text-slate-100 mb-2">
              No Active Skill Gaps
            </h3>
            <p className="text-slate-600 dark:text-slate-400 mb-4">
              Great job! Run an analysis to check for any new areas of improvement.
            </p>
            <Button onClick={analyzeSkillGaps} disabled={isAnalyzing}>
              <Sparkles className="w-4 h-4 mr-2" />
              Run Analysis
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Addressed Gaps */}
      {addressedGaps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-300">
              <CheckCircle2 className="w-5 h-5" />
              Recently Addressed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {addressedGaps.slice(0, 5).map((gap) => (
                <div 
                  key={gap.id} 
                  className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-100">{gap.skill_area}</p>
                      <p className="text-xs text-slate-500">
                        {gap.gap_type.replace('_', ' ')} • Addressed {gap.addressed_date ? format(new Date(gap.addressed_date), 'MMM d, yyyy') : 'recently'}
                      </p>
                    </div>
                  </div>
                  <Badge className="bg-green-100 text-green-800">Addressed</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}