import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Brain, TrendingUp, AlertCircle, Play, CheckCircle2, Loader2, Target, Zap, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { Progress } from '@/components/ui/progress';

export default function AITrainingRecommendationEngine({ currentUser, recommendations, skillGaps, completions }) {
  const [generatingRecommendations, setGeneratingRecommendations] = useState(false);
  const queryClient = useQueryClient();

  const { data: myPerformanceData } = useQuery({
    queryKey: ['myPerformance', currentUser?.email],
    queryFn: async () => {
      const noteConversions = await base44.entities.NoteConversion.filter({ 
        nurse_email: currentUser.email 
      });
      const complianceAudits = await base44.entities.ComplianceAudit.filter({ 
        nurse_email: currentUser.email 
      });
      return { noteConversions, complianceAudits };
    },
    enabled: !!currentUser?.email,
  });

  const generateRecommendationsMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('generateTrainingRecommendations', {
        user_email: currentUser.email,
        user_name: currentUser.full_name
      });
      return response.data || response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTrainingRecommendations'] });
      toast.success('AI recommendations generated successfully');
      setGeneratingRecommendations(false);
    },
    onError: (error) => {
      console.error('Error generating recommendations:', error);
      toast.error('Failed to generate recommendations');
      setGeneratingRecommendations(false);
    }
  });

  const startTrainingMutation = useMutation({
    mutationFn: async (moduleId) => {
      await base44.entities.TrainingCompletion.create({
        nurse_email: currentUser.email,
        module_id: moduleId,
        status: 'in_progress',
        started_date: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTrainingCompletions'] });
      toast.success('Training started! Good luck! 🎯');
    }
  });

  const dismissRecommendationMutation = useMutation({
    mutationFn: async (recId) => {
      await base44.entities.TrainingRecommendation.update(recId, {
        status: 'dismissed'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTrainingRecommendations'] });
      toast.success('Recommendation dismissed');
    }
  });

  const handleGenerateRecommendations = () => {
    setGeneratingRecommendations(true);
    generateRecommendationsMutation.mutate();
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-600';
      case 'medium': return 'bg-amber-600';
      case 'low': return 'bg-blue-600';
      default: return 'bg-gray-600';
    }
  };

  const performanceMetrics = myPerformanceData ? {
    avgQuality: myPerformanceData.noteConversions.length > 0
      ? Math.round(myPerformanceData.noteConversions.reduce((sum, n) => sum + (n.quality_score || 0), 0) / myPerformanceData.noteConversions.length)
      : 0,
    avgCompliance: myPerformanceData.complianceAudits.length > 0
      ? Math.round(myPerformanceData.complianceAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / myPerformanceData.complianceAudits.length)
      : 0,
    totalNotes: myPerformanceData.noteConversions.length,
    totalAudits: myPerformanceData.complianceAudits.length
  } : null;

  return (
    <div className="space-y-6">
      {/* AI Insights Header */}
      <Card className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <Brain className="w-12 h-12 flex-shrink-0" />
            <div className="flex-1">
              <h2 className="text-2xl font-bold mb-2">AI-Powered Learning Recommendations</h2>
              <p className="text-blue-100 mb-4">
                Our AI analyzes your performance data, compliance audits, and skill gaps to create personalized training paths that accelerate your professional growth.
              </p>
              <Button
                onClick={handleGenerateRecommendations}
                disabled={generatingRecommendations || generateRecommendationsMutation.isPending}
                className="bg-white text-blue-600 hover:bg-blue-50"
              >
                {generatingRecommendations || generateRecommendationsMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 mr-2" />
                    Generate New Recommendations
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Performance Summary */}
      {performanceMetrics && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              Your Performance Snapshot
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <p className="text-2xl font-bold text-blue-600">{performanceMetrics.avgQuality}%</p>
                <p className="text-xs text-gray-600">Avg Quality Score</p>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <p className="text-2xl font-bold text-green-600">{performanceMetrics.avgCompliance}%</p>
                <p className="text-xs text-gray-600">Avg Compliance</p>
              </div>
              <div className="text-center p-3 bg-purple-50 rounded-lg">
                <p className="text-2xl font-bold text-purple-600">{performanceMetrics.totalNotes}</p>
                <p className="text-xs text-gray-600">Total Notes</p>
              </div>
              <div className="text-center p-3 bg-amber-50 rounded-lg">
                <p className="text-2xl font-bold text-amber-600">{performanceMetrics.totalAudits}</p>
                <p className="text-xs text-gray-600">Audits Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Skill Gaps */}
      {skillGaps.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-amber-600" />
              Identified Skill Gaps
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {skillGaps.slice(0, 5).map((gap) => (
                <div key={gap.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-amber-200">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{gap.skill_name}</p>
                    <p className="text-xs text-gray-600">{gap.gap_description}</p>
                  </div>
                  <Badge className={getPriorityColor(gap.priority)}>
                    {gap.priority}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Recommendations */}
      {recommendations.length > 0 ? (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Brain className="w-5 h-5 text-blue-600" />
            Personalized Recommendations ({recommendations.length})
          </h3>
          
          {recommendations
            .sort((a, b) => {
              const priorityOrder = { high: 0, medium: 1, low: 2 };
              return priorityOrder[a.priority] - priorityOrder[b.priority];
            })
            .map((rec) => {
              const isStarted = completions.some(c => c.module_id === rec.recommended_module_id);
              
              return (
                <Card key={rec.id} className="border-2 hover:shadow-lg transition-shadow">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                        rec.priority === 'high' ? 'bg-red-100' : 
                        rec.priority === 'medium' ? 'bg-amber-100' : 'bg-blue-100'
                      }`}>
                        <Brain className={`w-6 h-6 ${
                          rec.priority === 'high' ? 'text-red-600' : 
                          rec.priority === 'medium' ? 'text-amber-600' : 'text-blue-600'
                        }`} />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h4 className="font-semibold text-gray-900 dark:text-white">
                            {rec.module_title}
                          </h4>
                          <Badge className={getPriorityColor(rec.priority)}>
                            {rec.priority} priority
                          </Badge>
                        </div>
                        
                        <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                          {rec.recommendation_reason}
                        </p>

                        {rec.expected_impact && (
                          <Alert className="mb-3 bg-blue-50 border-blue-200">
                            <TrendingUp className="w-4 h-4 text-blue-600" />
                            <AlertDescription className="text-sm">
                              <strong>Expected Impact:</strong> {rec.expected_impact}
                            </AlertDescription>
                          </Alert>
                        )}

                        {rec.related_skill_gaps && (
                          <div className="mb-3">
                            <p className="text-xs font-semibold text-gray-600 mb-1">Addresses:</p>
                            <div className="flex flex-wrap gap-1">
                              {rec.related_skill_gaps.map((gap, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs">
                                  {gap}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          {isStarted ? (
                            <Button variant="outline" disabled>
                              <CheckCircle2 className="w-4 h-4 mr-2 text-green-600" />
                              Already Started
                            </Button>
                          ) : (
                            <Button
                              onClick={() => startTrainingMutation.mutate(rec.recommended_module_id)}
                              className="bg-blue-600 hover:bg-blue-700"
                            >
                              <Play className="w-4 h-4 mr-2" />
                              Start Training
                            </Button>
                          )}
                          
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => dismissRecommendationMutation.mutate(rec.id)}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      ) : (
        <Card className="border-2 border-dashed border-gray-300">
          <CardContent className="p-12 text-center">
            <Brain className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Active Recommendations</h3>
            <p className="text-gray-600 mb-4">
              Generate personalized training recommendations based on your performance and skill gaps
            </p>
            <Button
              onClick={handleGenerateRecommendations}
              disabled={generatingRecommendations || generateRecommendationsMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {generatingRecommendations || generateRecommendationsMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing Your Performance...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Generate AI Recommendations
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* How It Works */}
      <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-purple-600" />
            How AI Recommendations Work
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold flex-shrink-0">1</div>
              <div>
                <p className="font-medium text-gray-900">Performance Analysis</p>
                <p className="text-sm text-gray-600">AI reviews your documentation quality, compliance scores, and audit results</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold flex-shrink-0">2</div>
              <div>
                <p className="font-medium text-gray-900">Skill Gap Detection</p>
                <p className="text-sm text-gray-600">Identifies specific areas where additional training would have the highest impact</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold flex-shrink-0">3</div>
              <div>
                <p className="font-medium text-gray-900">Personalized Path</p>
                <p className="text-sm text-gray-600">Creates a customized learning journey prioritized by your needs and goals</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold flex-shrink-0">4</div>
              <div>
                <p className="font-medium text-gray-900">Continuous Improvement</p>
                <p className="text-sm text-gray-600">Recommendations adapt as you complete training and improve your skills</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}