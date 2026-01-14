import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, BookOpen, TrendingUp, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function SkillGapAnalyzer({ userEmail }) {
  const [analyzing, setAnalyzing] = useState(false);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: skillGaps, isLoading } = useQuery({
    queryKey: ['skillGaps', userEmail],
    queryFn: async () => {
      const response = await base44.functions.invoke('analyzeProviderSkillGaps', {
        providerEmail: userEmail || currentUser?.email
      });
      return response.data || response;
    },
    enabled: !!userEmail || !!currentUser?.email
  });

  const { data: recommendations } = useQuery({
    queryKey: ['trainingRecommendations', userEmail],
    queryFn: () => base44.entities.TrainingRecommendation.filter({
      provider_email: userEmail || currentUser?.email
    }),
    enabled: !!userEmail || !!currentUser?.email
  });

  const assignTrainingMutation = useMutation({
    mutationFn: async (gapArea) => {
      const response = await base44.functions.invoke('autoAssignTrainingByGap', {
        providerEmail: userEmail || currentUser?.email,
        gapArea
      });
      return response.data || response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['trainingRecommendations']);
      queryClient.invalidateQueries(['skillGaps']);
      toast.success('Training auto-assigned successfully');
    },
    onError: () => {
      toast.error('Failed to assign training');
    }
  });

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      await queryClient.invalidateQueries(['skillGaps']);
      toast.success('Analysis complete');
    } catch (error) {
      toast.error('Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default: return 'bg-blue-100 text-blue-800 border-blue-200';
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            Personalized Skill Development
          </CardTitle>
          <Button
            onClick={runAnalysis}
            disabled={analyzing}
            variant="outline"
            size="sm"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              'Run Analysis'
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {skillGaps?.gaps?.length > 0 ? (
          <>
            <div className="text-sm text-gray-600 mb-4">
              AI-identified areas for improvement based on your documentation patterns and compliance feedback
            </div>

            {skillGaps.gaps.map((gap, index) => (
              <Card key={index} className={`border ${getSeverityColor(gap.severity)}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4" />
                        <h4 className="font-semibold">{gap.area}</h4>
                        <Badge variant="outline" className="ml-2">
                          {gap.severity}
                        </Badge>
                      </div>
                      <p className="text-sm mb-2">{gap.description}</p>
                      <div className="text-xs text-gray-600">
                        <span className="font-medium">Evidence:</span> {gap.evidence}
                      </div>
                    </div>
                  </div>

                  {gap.recommendedModules?.length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-xs font-medium mb-2">Recommended Training:</p>
                      <div className="flex flex-wrap gap-2">
                        {gap.recommendedModules.map((module, idx) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            <BookOpen className="w-3 h-3 mr-1" />
                            {module}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <Button
                    onClick={() => assignTrainingMutation.mutate(gap.area)}
                    disabled={assignTrainingMutation.isPending}
                    className="w-full mt-2"
                    size="sm"
                  >
                    {assignTrainingMutation.isPending ? (
                      <>
                        <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                        Assigning...
                      </>
                    ) : (
                      <>
                        <BookOpen className="w-3 h-3 mr-2" />
                        Auto-Assign Training
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <div className="text-center py-8">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500" />
            <h4 className="font-semibold text-gray-900 mb-2">Excellent Work!</h4>
            <p className="text-sm text-gray-600">
              No significant skill gaps identified. Your documentation quality and compliance are strong.
            </p>
          </div>
        )}

        {recommendations?.length > 0 && (
          <div className="mt-6 pt-6 border-t">
            <h4 className="font-semibold mb-3 text-sm">Active Training Recommendations</h4>
            <div className="space-y-2">
              {recommendations.slice(0, 3).map((rec) => (
                <div key={rec.id} className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{rec.module_name}</p>
                    <p className="text-xs text-gray-600">{rec.reason}</p>
                  </div>
                  <Badge variant="outline" className="ml-2">
                    {rec.priority} priority
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}