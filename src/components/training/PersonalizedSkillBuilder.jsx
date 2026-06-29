import { useState, useEffect } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { safePercent } from "@/lib/safePercent";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  GraduationCap,
  Loader2,
  ChevronDown,
  ChevronUp,
  BookOpen,
  CheckCircle2,
  Lightbulb,
  TrendingUp,
  Star,
  RefreshCw
} from "lucide-react";

export default function PersonalizedSkillBuilder({ userEmail }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const ai = useAICall();
  const [skillAnalysis, setSkillAnalysis] = useState(null);
  const [completedModules, setCompletedModules] = useState([]);

  // Load from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`skill_progress_${userEmail}`);
      if (stored) {
        setCompletedModules(JSON.parse(stored));
      }

      const storedAnalysis = localStorage.getItem(`skill_analysis_${userEmail}`);
      if (storedAnalysis) {
        setSkillAnalysis(JSON.parse(storedAnalysis));
      }
    } catch {}
  }, [userEmail]);

  const analyzeDocumentationPatterns = async () => {
    try {
      // Get user's recent documentation scores from localStorage
      let scores = [];
      try {
        const storedScores = localStorage.getItem(`doc_scores_${userEmail}`);
        scores = storedScores ? JSON.parse(storedScores) : [];
      } catch {}

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a clinical documentation educator. Analyze this nurse's documentation patterns and suggest personalized skill-building modules.

DOCUMENTATION HISTORY:
${scores.length > 0 ? 
  `Recent scores: ${scores.map(s => s.score).join(', ')}
  Common issues: ${scores.flatMap(s => s.issues || []).join(', ')}` :
  'No history available - provide general recommendations for new nurses'
}

Generate personalized learning recommendations:

1. Identify 2-3 areas for improvement based on patterns
2. Suggest specific micro-learning modules (5-10 min each)
3. Provide practical tips they can apply immediately
4. Include best practice reminders

Return JSON:
{
  "skill_level": "beginner" | "intermediate" | "advanced",
  "strengths": ["Area 1", "Area 2"],
  "improvement_areas": [
    {
      "area": "Area name",
      "current_level": 1-5,
      "description": "What needs improvement"
    }
  ],
  "recommended_modules": [
    {
      "title": "Module title",
      "duration": "5 min",
      "category": "compliance" | "clinical" | "efficiency" | "communication",
      "description": "What you'll learn",
      "key_points": ["Point 1", "Point 2", "Point 3"],
      "practice_tip": "Immediate action to practice"
    }
  ],
  "quick_wins": ["Tip 1", "Tip 2", "Tip 3"]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            skill_level: { type: "string" },
            strengths: { type: "array", items: { type: "string" } },
            improvement_areas: { type: "array", items: { type: "object" } },
            recommended_modules: { type: "array", items: { type: "object" } },
            quick_wins: { type: "array", items: { type: "string" } }
          }
        }
      });

      setSkillAnalysis(result);
      try { localStorage.setItem(`skill_analysis_${userEmail}`, JSON.stringify(result)); } catch {}

    } catch (error) {
      console.error("Error analyzing skills:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const markModuleComplete = (moduleTitle) => {
    const updated = [...completedModules, moduleTitle];
    setCompletedModules(updated);
    try { localStorage.setItem(`skill_progress_${userEmail}`, JSON.stringify(updated)); } catch {}
  };

  const getCategoryColor = (category) => {
    const colors = {
      compliance: "bg-blue-100 text-blue-800",
      clinical: "bg-green-100 text-green-800",
      efficiency: "bg-navy-100 text-navy-800",
      communication: "bg-orange-100 text-orange-800"
    };
    return colors[category] || "bg-slate-100 text-slate-800";
  };

  const completedCount = skillAnalysis?.recommended_modules?.filter(
    m => completedModules.includes(m.title)
  ).length || 0;
  const totalModules = skillAnalysis?.recommended_modules?.length || 0;

  return (
    <Card className="border-navy-200">
      <CardHeader 
        className="py-3 bg-gradient-to-r from-navy-50 to-indigo-50 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-navy-600" />
            Skill Builder
          </div>
          <div className="flex items-center gap-2">
            {skillAnalysis && (
              <Badge variant="outline" className="text-xs">
                {completedCount}/{totalModules} completed
              </Badge>
            )}
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </CardTitle>
      </CardHeader>

      {isExpanded && (
        <CardContent className="p-3">
          {!skillAnalysis ? (
            <div className="text-center py-4">
              <p className="text-sm text-slate-600 mb-3">
                Get personalized learning recommendations based on your documentation patterns.
              </p>
              <Button
                onClick={analyzeDocumentationPatterns}
                disabled={ai.loading}
                className="bg-navy-600 hover:bg-navy-700"
              >
                {ai.loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
                ) : (
                  <><TrendingUp className="w-4 h-4 mr-2" /> Analyze My Skills</>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Progress */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium">Learning Progress</span>
                  <span className="text-xs text-slate-500">{safePercent(completedCount, totalModules)}%</span>
                </div>
                <Progress value={safePercent(completedCount, totalModules)} className="h-2" />
              </div>

              {/* Strengths */}
              {skillAnalysis.strengths?.length > 0 && (
                <div className="bg-green-50 p-2 rounded">
                  <p className="text-xs font-semibold text-green-800 mb-1 flex items-center gap-1">
                    <Star className="w-3 h-3" /> Your Strengths
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {skillAnalysis.strengths.map((s, idx) => (
                      <Badge key={idx} className="bg-green-100 text-green-800 text-xs">{s}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Wins */}
              {skillAnalysis.quick_wins?.length > 0 && (
                <div className="bg-yellow-50 p-2 rounded">
                  <p className="text-xs font-semibold text-yellow-800 mb-1 flex items-center gap-1">
                    <Lightbulb className="w-3 h-3" /> Quick Wins
                  </p>
                  <ul className="text-xs text-yellow-900 space-y-1">
                    {skillAnalysis.quick_wins.map((tip, idx) => (
                      <li key={idx}>• {tip}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Learning Modules */}
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-2">Recommended Modules</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {skillAnalysis.recommended_modules?.map((module, idx) => (
                    <Card 
                      key={idx} 
                      className={`border ${completedModules.includes(module.title) ? 'bg-green-50 border-green-200' : ''}`}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h4 className="text-sm font-semibold">{module.title}</h4>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge className={`${getCategoryColor(module.category)} text-xs`}>
                                {module.category}
                              </Badge>
                              <span className="text-xs text-slate-500">{module.duration}</span>
                            </div>
                          </div>
                          {completedModules.includes(module.title) ? (
                            <CheckCircle2 className="w-5 h-5 text-green-600" />
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => markModuleComplete(module.title)}
                            >
                              <BookOpen className="w-3 h-3 mr-1" /> Start
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 mb-2">{module.description}</p>
                        <ul className="text-xs text-slate-500 space-y-0.5">
                          {module.key_points?.map((point, pIdx) => (
                            <li key={pIdx}>• {point}</li>
                          ))}
                        </ul>
                        {module.practice_tip && (
                          <div className="mt-2 p-2 bg-navy-50 rounded text-xs text-navy-800">
                            💡 <strong>Practice:</strong> {module.practice_tip}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={analyzeDocumentationPatterns}
                disabled={ai.loading}
              >
                <RefreshCw className={`w-3 h-3 mr-1 ${ai.loading ? 'animate-spin' : ''}`} />
                Refresh Recommendations
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}