import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useMyTrainingCompletions } from "@/hooks/useMyTrainingCompletions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Target,
  CheckCircle2,
  Clock,
  TrendingUp,
  Lightbulb,
  PlayCircle,
  Loader2,
  RefreshCw,
  Sparkles
} from "lucide-react";

export default function PersonalizedLearningPath({ nurseEmail, onStartModule }) {
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: learningPath, isLoading, refetch } = useQuery({
    queryKey: ['personalizedLearningPath', nurseEmail],
    queryFn: async () => {
      const response = await base44.functions.invoke('generatePersonalizedLearningPath', {
        nurse_email: nurseEmail
      });
      return response.data || response;
    },
    enabled: !!nurseEmail,
    staleTime: 1000 * 60 * 30 // 30 minutes
  });

  const { completedCourseIds } = useMyTrainingCompletions(nurseEmail);

  const handleRegeneratePath = async () => {
    setIsGenerating(true);
    await refetch();
    setIsGenerating(false);
  };

  // A path step's module is complete when its course has a passing
  // assignment/certificate for this nurse.
  const isModuleCompleted = (module) => !!module?.course_id && completedCourseIds.has(module.course_id);

  const getPriorityColor = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'critical': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-blue-500';
      default: return 'bg-slate-500';
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-slate-600">Generating your personalized learning path...</p>
        </CardContent>
      </Card>
    );
  }

  if (!learningPath) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-slate-500">
          <Target className="w-12 h-12 mx-auto mb-3 text-slate-400" />
          <p>Unable to generate learning path. Please try again.</p>
        </CardContent>
      </Card>
    );
  }

  const completedCount = learningPath.learning_path?.filter(item =>
    item.module && isModuleCompleted(item.module)
  ).length || 0;
  const totalCount = learningPath.learning_path?.length || 0;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-r from-navy-50 to-gold-50 border-navy-200">
        <CardContent className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-6 h-6 text-navy-600" />
                <h3 className="text-2xl font-bold text-slate-900">Your AI-Personalized Learning Path</h3>
              </div>
              <p className="text-slate-700 mb-3">{learningPath.motivation_message}</p>
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Target className="w-4 h-4" />
                <span className="font-medium">Goal:</span>
                <span>{learningPath.overall_goal}</span>
              </div>
            </div>
            <Button
              onClick={handleRegeneratePath}
              disabled={isGenerating}
              variant="outline"
              size="sm"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isGenerating ? 'animate-spin' : ''}`} />
              Regenerate
            </Button>
          </div>

          {/* Progress Overview */}
          <div className="grid md:grid-cols-3 gap-4 mt-4">
            <div className="bg-white rounded-lg p-4 border">
              <p className="text-sm text-slate-600 mb-1">Progress</p>
              <div className="flex items-center gap-3">
                <Progress value={progressPercent} className="flex-1" />
                <span className="text-lg font-bold text-navy-600">{completedCount}/{totalCount}</span>
              </div>
            </div>
            <div className="bg-white rounded-lg p-4 border">
              <p className="text-sm text-slate-600 mb-1">Est. Completion</p>
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-600" />
                <span className="text-lg font-bold">{learningPath.estimated_completion_weeks} weeks</span>
              </div>
            </div>
            <div className="bg-white rounded-lg p-4 border">
              <p className="text-sm text-slate-600 mb-1">Current Score</p>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-600" />
                <span className="text-lg font-bold">{learningPath.performance_summary?.compliance_score?.toFixed(0)}%</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Learning Path */}
      <div className="space-y-4">
        {learningPath.learning_path?.length > 0 ? learningPath.learning_path.map((item, idx) => {
          if (!item?.module) return null;
          
          const completed = isModuleCompleted(item.module);
          const isNext = !completed && idx > 0 && learningPath.learning_path.slice(0, idx).every(prev =>
            prev.module && isModuleCompleted(prev.module)
          );

          return (
            <Card 
              key={idx}
              className={`border-2 ${
                completed ? 'border-green-300 bg-green-50' :
                isNext ? 'border-navy-300 bg-navy-50' :
                'border-slate-200'
              }`}
            >
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  {/* Sequence Number */}
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                    completed ? 'bg-green-500 text-white' :
                    isNext ? 'bg-navy-500 text-white' :
                    'bg-slate-300 text-slate-600'
                  }`}>
                    {completed ? <CheckCircle2 className="w-6 h-6" /> : <span className="text-lg font-bold">{idx + 1}</span>}
                  </div>

                  {/* Content */}
                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="text-lg font-bold text-slate-900">{item.module.title}</h4>
                          <Badge className={getPriorityColor(item.priority)}>
                            {item.priority} priority
                          </Badge>
                          {isNext && <Badge className="bg-navy-500">Next Up</Badge>}
                        </div>
                        <p className="text-sm text-slate-600 mb-2">{item.module.description}</p>
                      </div>
                      <div className="text-right flex-shrink-0 ml-4">
                        <p className="text-sm text-slate-600">Est. Time</p>
                        <p className="text-lg font-bold text-slate-900">{item.estimated_days}d</p>
                      </div>
                    </div>

                    {/* Why Recommended */}
                    <Alert className="mb-3 bg-blue-50 border-blue-200">
                      <Lightbulb className="w-4 h-4 text-blue-600" />
                      <AlertDescription className="text-sm">
                        <strong>Why this matters:</strong> {item.why_recommended}
                      </AlertDescription>
                    </Alert>

                    {/* Learning Objectives */}
                    <div className="mb-3">
                      <p className="text-sm font-semibold text-slate-700 mb-2">Learning Objectives:</p>
                      <ul className="space-y-1">
                        {item.learning_objectives?.map((obj, objIdx) => (
                          <li key={objIdx} className="text-sm text-slate-600 flex items-start gap-2">
                            <span className="text-navy-600 mt-1">•</span>
                            <span>{obj}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Module Details */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      <Badge variant="outline">{item.module.content_type}</Badge>
                      <Badge variant="outline">{item.module.duration_minutes} min</Badge>
                      <Badge variant="outline" className="capitalize">{item.module.difficulty_level}</Badge>
                      <Badge variant="outline">{item.module.category}</Badge>
                    </div>

                    {/* Action Button */}
                    <Button
                      onClick={() => onStartModule(item.module)}
                      disabled={completed}
                      className={completed ? '' : isNext ? 'bg-navy-600 hover:bg-navy-700' : ''}
                    >
                      {completed ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Completed
                        </>
                      ) : (
                        <>
                          <PlayCircle className="w-4 h-4 mr-2" />
                          Start Module
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        }) : (
          <Card>
            <CardContent className="p-8 text-center text-slate-500">
              <Target className="w-12 h-12 mx-auto mb-3 text-slate-400" />
              <p>No learning modules available in your path yet.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}