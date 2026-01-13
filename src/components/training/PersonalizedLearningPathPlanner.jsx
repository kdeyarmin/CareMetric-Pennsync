import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lightbulb, CheckCircle2, Clock, TrendingUp, BookOpen } from "lucide-react";

export default function PersonalizedLearningPathPlanner({ providerEmail, providerType }) {
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: learningPath } = useQuery({
    queryKey: ['learningPath', providerEmail],
    queryFn: () => base44.entities.PersonalizedLearningPath.filter({ provider_email: providerEmail }),
    select: (data) => data[0]
  });

  const generatePathMutation = useMutation({
    mutationFn: async () => {
      setIsGenerating(true);
      try {
        const response = await base44.functions.invoke('generatePersonalizedLearningPath', {
          provider_email: providerEmail,
          provider_type: providerType
        });
        return response.data;
      } finally {
        setIsGenerating(false);
      }
    }
  });

  const handleGeneratePath = async () => {
    await generatePathMutation.mutateAsync();
  };

  if (!learningPath) {
    return (
      <Card>
        <CardContent className="p-6 space-y-4">
          <Alert className="bg-blue-50 border-blue-200">
            <Lightbulb className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              Get a personalized learning path based on your role, skill gaps, and usage patterns.
            </AlertDescription>
          </Alert>
          <Button
            onClick={handleGeneratePath}
            disabled={isGenerating}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {isGenerating ? 'Analyzing Your Profile...' : 'Generate My Learning Path'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-xl">{learningPath.path_name}</CardTitle>
              <p className="text-gray-600 text-sm mt-1">{learningPath.path_description}</p>
            </div>
            <Badge className="bg-green-100 text-green-800 flex-shrink-0">
              {learningPath.completion_percentage}% Complete
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Progress Overview */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium">Overall Progress</span>
              <span className="text-2xl font-bold">{learningPath.completion_percentage}%</span>
            </div>
            <Progress value={learningPath.completion_percentage} className="h-3" />
          </div>

          {/* Path Info */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <Clock className="w-5 h-5 mx-auto text-blue-600 mb-1" />
              <p className="text-sm font-medium">{learningPath.estimated_hours} hours</p>
              <p className="text-xs text-gray-600">Estimated time</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <BookOpen className="w-5 h-5 mx-auto text-green-600 mb-1" />
              <p className="text-sm font-medium">{learningPath.modules?.length || 0}</p>
              <p className="text-xs text-gray-600">Total modules</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <TrendingUp className="w-5 h-5 mx-auto text-purple-600 mb-1" />
              <p className="text-sm font-medium">{learningPath.modules?.filter(m => m.status === 'completed').length || 0}</p>
              <p className="text-xs text-gray-600">Completed</p>
            </div>
          </div>

          {/* Skill Gaps */}
          {learningPath.skill_gaps?.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h4 className="font-medium text-yellow-900 mb-2">Identified Skill Gaps</h4>
              <div className="flex flex-wrap gap-2">
                {learningPath.skill_gaps.map((gap, idx) => (
                  <Badge key={idx} className="bg-yellow-100 text-yellow-800">
                    {gap}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Modules List */}
          {learningPath.modules && learningPath.modules.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium">Your Learning Path</h4>
              {learningPath.modules.map((module, idx) => (
                <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  {module.status === 'completed' ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-gray-300 flex items-center justify-center text-xs font-bold text-gray-300 flex-shrink-0">
                      {idx + 1}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">Module {idx + 1}</p>
                    {module.score && <p className="text-xs text-gray-600">Score: {module.score}%</p>}
                  </div>
                  <Badge variant={module.status === 'completed' ? 'default' : 'outline'}>
                    {module.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {learningPath.next_recommended_module && (
            <Button className="w-full bg-blue-600 hover:bg-blue-700">
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Start Next Module
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}