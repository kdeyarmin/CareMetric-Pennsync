import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useMyTrainingCompletions } from "@/hooks/useMyTrainingCompletions";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Sparkles,
  Loader2,
  BookOpen,
  Clock,
  TrendingUp,
  Target,
  Zap,
  ChevronRight
} from "lucide-react";
import { toast } from 'sonner';

export default function TrainingRecommendations({ nurseEmail, onEnroll }) {
  const [recommendations, setRecommendations] = useState(null);
  const ai = useAICall();

  const { data: skills = [] } = useQuery({
    queryKey: ['nurseSkills', nurseEmail],
    queryFn: () => base44.entities.NurseSkill.filter({ nurse_email: nurseEmail }).catch(() => []),
    enabled: !!nurseEmail
  });

  const { completedCourseIds } = useMyTrainingCompletions(nurseEmail);

  const { data: modules = [] } = useQuery({
    queryKey: ['trainingModules'],
    queryFn: () => base44.entities.TrainingModule.filter({}).catch(() => [])
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['nurseTasks'],
    queryFn: () => base44.entities.Task.filter({}, '-created_date', 50).catch(() => [])
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000).catch(() => [])
  });

  const analyzeAndRecommend = async () => {
    try {
      const skillsList = skills.map(s => `${s.skill_name} (${s.proficiency_level})`).join(', ');
      const availableModules = modules.filter(m => !(m.course_id && completedCourseIds.has(m.course_id)));
      
      const diagnoses = [...new Set(patients.map(p => p.primary_diagnosis).filter(Boolean))];
      const taskTypes = tasks.slice(0, 20).map(t => `${t.type}: ${t.title}`).join('\n');

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an AI training coordinator for home health nurses. Analyze this nurse's profile and recommend personalized training.

NURSE'S CURRENT SKILLS:
${skillsList || 'No skills recorded yet'}

AVAILABLE TRAINING MODULES:
${availableModules.map(m => `- ${m.title} (${m.category}, ${m.difficulty_level}, ${m.duration_minutes}min): ${m.description || 'No description'}`).join('\n') || 'No modules available'}

PATIENT DIAGNOSES BEING MANAGED:
${diagnoses.join(', ') || 'No patients assigned'}

RECENT TASK PATTERNS:
${taskTypes || 'No recent tasks'}

Based on this analysis, recommend:
1. HIGH PRIORITY training that addresses skill gaps related to current patient population
2. SKILL DEVELOPMENT opportunities to advance from current proficiency levels
3. CAREER GROWTH recommendations for specialty certifications

Return JSON:
{
  "analysis_summary": "Brief summary of nurse's current skill profile and gaps",
  "high_priority_recommendations": [
    {
      "module_title": "Exact module title from available list OR suggested new topic",
      "reason": "Why this is important now",
      "urgency": "immediate" | "soon" | "recommended",
      "skill_gap_addressed": "What gap this fills"
    }
  ],
  "skill_development": [
    {
      "current_skill": "Skill to develop",
      "current_level": "Current proficiency",
      "target_level": "Target proficiency",
      "recommended_training": "Training or practice recommendation",
      "timeline": "Suggested timeline"
    }
  ],
  "career_growth": [
    {
      "certification": "Suggested certification",
      "benefit": "How this helps career",
      "prerequisites": "What's needed first"
    }
  ],
  "quick_wins": ["Easy training to complete this week"]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            analysis_summary: { type: "string" },
            high_priority_recommendations: { type: "array", items: { type: "object" } },
            skill_development: { type: "array", items: { type: "object" } },
            career_growth: { type: "array", items: { type: "object" } },
            quick_wins: { type: "array", items: { type: "string" } }
          }
        }
      });

      setRecommendations(result);
    } catch (error) {
      console.error("Error analyzing:", error);
      toast.error("Error generating recommendations. Please try again.");
    }
  };

  const getUrgencyColor = (urgency) => {
    const colors = {
      immediate: 'bg-red-100 text-red-800',
      soon: 'bg-yellow-100 text-yellow-800',
      recommended: 'bg-blue-100 text-blue-800'
    };
    return colors[urgency] || 'bg-slate-100 text-slate-800';
  };

  return (
    <Card className="border-navy-200">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-gold-50">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-navy-600" />
          AI Training Recommendations
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {!recommendations ? (
          <div className="text-center py-6">
            <Sparkles className="w-12 h-12 text-navy-300 mx-auto mb-3" />
            <p className="text-slate-600 mb-4">
              Get personalized training recommendations based on your skills, patient population, and career goals
            </p>
            <Button
              onClick={analyzeAndRecommend}
              disabled={ai.loading}
              className="bg-navy-600 hover:bg-navy-700"
            >
              {ai.loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Get Recommendations</>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary */}
            <Alert className="bg-navy-50 border-navy-200">
              <Sparkles className="w-4 h-4 text-navy-600" />
              <AlertDescription className="text-navy-900">
                {recommendations.analysis_summary}
              </AlertDescription>
            </Alert>

            {/* High Priority */}
            {recommendations.high_priority_recommendations?.length > 0 && (
              <div>
                <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-red-600" /> High Priority Training
                </h4>
                <div className="space-y-2">
                  {recommendations.high_priority_recommendations.map((rec, idx) => (
                    <div key={idx} className="p-3 bg-white border rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">{rec.module_title}</span>
                        <Badge className={getUrgencyColor(rec.urgency)}>{rec.urgency}</Badge>
                      </div>
                      <p className="text-sm text-slate-600">{rec.reason}</p>
                      <p className="text-xs text-navy-600 mt-1">Addresses: {rec.skill_gap_addressed}</p>
                      {onEnroll && (
                        <Button size="sm" className="mt-2" onClick={() => onEnroll(rec.module_title)}>
                          Enroll <ChevronRight className="w-3 h-3 ml-1" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Skill Development */}
            {recommendations.skill_development?.length > 0 && (
              <div>
                <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-600" /> Skill Development Path
                </h4>
                <div className="space-y-2">
                  {recommendations.skill_development.map((dev, idx) => (
                    <div key={idx} className="p-3 bg-green-50 border border-green-200 rounded-lg">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{dev.current_skill}</span>
                        <Badge variant="outline">{dev.current_level} → {dev.target_level}</Badge>
                      </div>
                      <p className="text-sm text-slate-600">{dev.recommended_training}</p>
                      <p className="text-xs text-green-600 mt-1">
                        <Clock className="w-3 h-3 inline mr-1" /> {dev.timeline}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Career Growth */}
            {recommendations.career_growth?.length > 0 && (
              <div>
                <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                  <Target className="w-4 h-4 text-blue-600" /> Career Growth Opportunities
                </h4>
                <div className="space-y-2">
                  {recommendations.career_growth.map((growth, idx) => (
                    <div key={idx} className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <span className="font-medium">{growth.certification}</span>
                      <p className="text-sm text-slate-600">{growth.benefit}</p>
                      <p className="text-xs text-blue-600 mt-1">Prerequisites: {growth.prerequisites}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Wins */}
            {recommendations.quick_wins?.length > 0 && (
              <div>
                <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-indigo-600" /> Quick Wins This Week
                </h4>
                <ul className="space-y-1">
                  {recommendations.quick_wins.map((win, idx) => (
                    <li key={idx} className="text-sm text-slate-700 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full" /> {win}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Button variant="outline" onClick={() => setRecommendations(null)} className="w-full">
              Refresh Recommendations
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}