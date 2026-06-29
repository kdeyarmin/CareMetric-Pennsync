import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Brain,
  Target,
  CheckCircle2,
  Clock,
  Loader2,
  Sparkles,
  AlertTriangle,
  Play,
  Trophy,
  TrendingUp
} from "lucide-react";

export default function AIPersonalizedTrainingPlan({ 
  nurseEmail, 
  audits = [], 
  recommendations = [],
  onStartModule 
}) {
  const ai = useAICall();
  const [trainingPlan, setTrainingPlan] = useState(null);
  const [expandedModule, setExpandedModule] = useState(null);

  // Analyze nurse's weak areas from audits
  const analyzeWeakAreas = () => {
    const weakAreas = {};
    
    audits.filter(a => a.nurse_email === nurseEmail).forEach(audit => {
      audit.issues?.forEach(issue => {
        const category = categorizeIssue(issue.element || issue.problem || '');
        if (!weakAreas[category]) {
          weakAreas[category] = { count: 0, severity: 0, examples: [] };
        }
        weakAreas[category].count++;
        weakAreas[category].severity += issue.severity === 'critical' ? 3 : issue.severity === 'high' ? 2 : 1;
        if (weakAreas[category].examples.length < 3) {
          weakAreas[category].examples.push(issue.problem || issue.element);
        }
      });
    });

    return Object.entries(weakAreas)
      .map(([area, data]) => ({ area, ...data, priority: data.severity / data.count }))
      .sort((a, b) => b.severity - a.severity);
  };

  const generateTrainingPlan = async () => {
    const weakAreas = analyzeWeakAreas();

    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Generate a personalized training plan for a home health nurse based on their compliance audit performance.

NURSE'S WEAK AREAS (from audit analysis):
${weakAreas.map(w => `- ${w.area}: ${w.count} issues, severity score ${w.severity}
  Examples: ${w.examples.join('; ')}`).join('\n')}

ADDITIONAL RECOMMENDATIONS FROM SYSTEM:
${recommendations.map(r => `- ${r.recommendation_type}: ${r.recommendation_text}`).join('\n') || 'None'}

Create a comprehensive, prioritized training plan with:
1. 3-5 training modules ordered by priority
2. Each module should have:
   - Clear learning objectives
   - Estimated duration
   - Key topics to cover
   - Practice exercises
   - Assessment criteria

Focus on practical, actionable training that directly addresses the nurse's documentation gaps.
Make the content specific to Medicare home health compliance requirements.`,
        response_json_schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            overall_goal: { type: "string" },
            estimated_total_time: { type: "string" },
            modules: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  priority: { type: "string" },
                  weak_area_addressed: { type: "string" },
                  duration_minutes: { type: "number" },
                  objectives: { type: "array", items: { type: "string" } },
                  topics: { type: "array", items: { type: "string" } },
                  practice_exercises: { type: "array", items: { type: "string" } },
                  assessment_type: { type: "string" },
                  key_takeaways: { type: "array", items: { type: "string" } }
                }
              }
            },
            success_metrics: { type: "array", items: { type: "string" } }
          }
        }
      });

      setTrainingPlan(result);
    } catch (error) {
      console.error("Error generating training plan:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'critical':
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-blue-100 text-blue-800';
    }
  };

  const weakAreas = analyzeWeakAreas();

  return (
    <Card className="border-2 border-indigo-200">
      <CardHeader className="bg-gradient-to-r from-indigo-50 to-navy-50 py-4">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-600" />
            AI-Powered Training Plan
          </div>
          {!trainingPlan && (
            <Button
              onClick={generateTrainingPlan}
              disabled={ai.loading || weakAreas.length === 0}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {ai.loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Generate Plan</>
              )}
            </Button>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Weak Areas Summary */}
        {weakAreas.length > 0 && !trainingPlan && (
          <div className="bg-orange-50 p-3 rounded-lg border border-orange-200">
            <p className="text-sm font-semibold text-orange-800 mb-2 flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" /> Identified Weak Areas
            </p>
            <div className="flex flex-wrap gap-2">
              {weakAreas.slice(0, 5).map((area, idx) => (
                <Badge key={idx} className={getPriorityColor(area.priority > 2 ? 'high' : 'medium')}>
                  {area.area} ({area.count})
                </Badge>
              ))}
            </div>
          </div>
        )}

        {weakAreas.length === 0 && !trainingPlan && (
          <div className="text-center py-8 text-slate-500">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-green-500" />
            <p>No significant weak areas identified from recent audits.</p>
            <p className="text-sm">Keep up the great work!</p>
          </div>
        )}

        {ai.loading && (
          <div className="text-center py-8">
            <Loader2 className="w-10 h-10 animate-spin text-indigo-600 mx-auto mb-3" />
            <p className="text-sm text-slate-600">Analyzing your performance and creating a personalized plan...</p>
          </div>
        )}

        {trainingPlan && (
          <div className="space-y-4">
            {/* Plan Summary */}
            <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
              <p className="text-sm text-indigo-900">{trainingPlan.summary}</p>
              <div className="flex items-center gap-4 mt-3 text-xs text-indigo-700">
                <span className="flex items-center gap-1">
                  <Target className="w-3 h-3" /> {trainingPlan.overall_goal}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {trainingPlan.estimated_total_time}
                </span>
              </div>
            </div>

            {/* Training Modules */}
            <Accordion type="single" collapsible value={expandedModule} onValueChange={setExpandedModule}>
              {trainingPlan.modules?.map((module, idx) => (
                <AccordionItem key={module.id || idx} value={module.id || `module-${idx}`}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 w-full pr-4">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm">
                        {idx + 1}
                      </div>
                      <div className="flex-1 text-left">
                        <p className="font-medium text-sm">{module.title}</p>
                        <p className="text-xs text-slate-500">{module.weak_area_addressed}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={getPriorityColor(module.priority)}>
                          {module.priority}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          <Clock className="w-3 h-3 mr-1" />
                          {module.duration_minutes} min
                        </Badge>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="pl-11 space-y-4">
                      {/* Objectives */}
                      <div>
                        <p className="text-xs font-semibold text-slate-700 mb-1">Learning Objectives:</p>
                        <ul className="space-y-1">
                          {module.objectives?.map((obj, i) => (
                            <li key={i} className="text-xs text-slate-600 flex items-start gap-2">
                              <CheckCircle2 className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
                              {obj}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Topics */}
                      <div>
                        <p className="text-xs font-semibold text-slate-700 mb-1">Key Topics:</p>
                        <div className="flex flex-wrap gap-1">
                          {module.topics?.map((topic, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {topic}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {/* Practice Exercises */}
                      <div>
                        <p className="text-xs font-semibold text-slate-700 mb-1">Practice Exercises:</p>
                        <ul className="space-y-1">
                          {module.practice_exercises?.map((ex, i) => (
                            <li key={i} className="text-xs text-slate-600">• {ex}</li>
                          ))}
                        </ul>
                      </div>

                      {/* Key Takeaways */}
                      <div className="bg-green-50 p-2 rounded">
                        <p className="text-xs font-semibold text-green-800 mb-1">Key Takeaways:</p>
                        <ul className="space-y-0.5">
                          {module.key_takeaways?.map((takeaway, i) => (
                            <li key={i} className="text-xs text-green-700">✓ {takeaway}</li>
                          ))}
                        </ul>
                      </div>

                      {/* Start Button */}
                      <Button
                        size="sm"
                        onClick={() => onStartModule?.(module)}
                        className="bg-indigo-600 hover:bg-indigo-700"
                      >
                        <Play className="w-3 h-3 mr-1" /> Start Module
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>

            {/* Success Metrics */}
            <div className="bg-green-50 p-3 rounded-lg border border-green-200">
              <p className="text-xs font-semibold text-green-800 mb-2 flex items-center gap-1">
                <Trophy className="w-4 h-4" /> Success Metrics
              </p>
              <ul className="space-y-1">
                {trainingPlan.success_metrics?.map((metric, idx) => (
                  <li key={idx} className="text-xs text-green-700 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" /> {metric}
                  </li>
                ))}
              </ul>
            </div>

            {/* Regenerate Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={generateTrainingPlan}
              className="w-full"
            >
              <Sparkles className="w-3 h-3 mr-1" /> Regenerate Plan
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function categorizeIssue(text) {
  const lower = text.toLowerCase();
  if (lower.includes('homebound')) return 'Homebound Status';
  if (lower.includes('skilled')) return 'Skilled Need';
  if (lower.includes('vital')) return 'Vital Signs';
  if (lower.includes('assessment')) return 'Assessment';
  if (lower.includes('response') || lower.includes('teach')) return 'Patient Response';
  if (lower.includes('medication')) return 'Medication';
  if (lower.includes('care plan') || lower.includes('goal')) return 'Care Plan';
  if (lower.includes('functional') || lower.includes('adl')) return 'Functional Status';
  return 'General Documentation';
}