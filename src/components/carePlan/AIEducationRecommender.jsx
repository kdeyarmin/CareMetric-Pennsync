import { useState } from "react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  BookOpen,
  Loader2,
  CheckCircle2,
  Sparkles
} from "lucide-react";
import { format } from "date-fns";

export default function AIEducationRecommender({ patient, carePlans = [], onAssignEducation }) {
  const ai = useAICall();
  const [recommendations, setRecommendations] = useState([]);
  const [selectedTopics, setSelectedTopics] = useState({});
  const [isAssigning, setIsAssigning] = useState(false);

  // Fetch existing education assignments
  const { data: existingEducation = [] } = useQuery({
    queryKey: ['patientEducation', patient?.id],
    queryFn: () => base44.entities.PatientEducationAssignment.filter({ patient_id: patient?.id }),
    enabled: !!patient?.id,
    initialData: []
  });

  const generateRecommendations = async () => {
    if (!patient) return;

    try {
      const activeCarePlans = carePlans.filter(cp => cp.status === 'active');
      const assignedTopics = existingEducation.map(e => e.topic.toLowerCase());

      const result = await ai.run({
        model: "claude_sonnet_4_6",
        prompt: `You are a patient education specialist. Recommend educational topics for this patient based on their diagnosis and care plan goals.

PATIENT: ${patient.first_name} ${patient.last_name}
PRIMARY DIAGNOSIS: ${patient.primary_diagnosis || 'Not specified'}
SECONDARY DIAGNOSES: ${patient.secondary_diagnoses?.join(', ') || 'None'}
COGNITIVE STATUS: ${patient.functional_status?.cognitive_status || 'Alert and oriented'}
PRIMARY LANGUAGE: ${patient.social_history?.primary_language || 'English'}

ACTIVE CARE PLANS:
${activeCarePlans.map(cp => `- ${cp.problem}: ${cp.goal}`).join('\n') || 'None'}

ALREADY ASSIGNED EDUCATION:
${assignedTopics.length > 0 ? assignedTopics.join(', ') : 'None'}

Recommend 4-6 education topics that:
1. Support active care plan goals
2. Address patient's diagnoses
3. Are appropriate for cognitive status
4. Haven't been assigned yet
5. Will improve self-management and outcomes

For each topic provide:
- Clear, concise educational content (5-7 sentences, appropriate reading level)
- Connection to specific care plan goals
- Key learning objectives
- Teach-back questions to verify understanding
- Priority based on clinical need

Return JSON:`,
        response_json_schema: {
          type: "object",
          properties: {
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  topic: { type: "string" },
                  content: { type: "string" },
                  care_plan_connection: { type: "string" },
                  learning_objectives: { type: "array", items: { type: "string" } },
                  teach_back_questions: { type: "array", items: { type: "string" } },
                  priority: { type: "string", enum: ["high", "medium", "low"] },
                  delivery_format: { type: "string", enum: ["handout", "verbal", "demonstration", "video", "written"] },
                  key_points: { type: "array", items: { type: "string" } }
                }
              }
            }
          }
        }
      });

      setRecommendations(result.recommendations || []);
      
      // Auto-select high priority
      const autoSelected = {};
      result.recommendations?.forEach((rec, idx) => {
        if (rec.priority === 'high') {
          autoSelected[idx] = true;
        }
      });
      setSelectedTopics(autoSelected);

    } catch (error) {
      console.error("Education recommendation error:", error);
      toast.error("Failed to generate recommendations. Please try again.");
    }
  };

  const toggleSelection = (idx) => {
    setSelectedTopics(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const assignSelected = async () => {
    if (!patient) return;

    const selected = recommendations.filter((_, idx) => selectedTopics[idx]);
    if (selected.length === 0) {
      toast.error("Please select at least one education topic.");
      return;
    }

    setIsAssigning(true);
    try {
      const assignedBy = (await base44.auth.me()).email;

      const results = await Promise.allSettled(
        selected.map((topic) =>
          base44.entities.PatientEducationAssignment.create({
            patient_id: patient.id,
            topic: topic.topic,
            content: topic.content,
            format: topic.delivery_format,
            status: 'assigned',
            assigned_date: format(new Date(), 'yyyy-MM-dd'),
            assigned_by: assignedBy,
            priority: topic.priority,
            materials_provided: topic.key_points || []
          })
        )
      );

      const assignments = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value);
      const failedCount = results.length - assignments.length;

      if (assignments.length > 0 && onAssignEducation) {
        onAssignEducation(assignments);
      }

      if (failedCount === 0) {
        toast.success(`Assigned ${assignments.length} education topic(s)!`);
      } else if (assignments.length > 0) {
        results
          .filter((r) => r.status === 'rejected')
          .forEach((r) => console.error("Education assignment error:", r.reason));
        toast.error(`Assigned ${assignments.length} topic(s), but ${failedCount} failed. Please retry the rest.`);
      } else {
        results.forEach((r) => console.error("Education assignment error:", r.reason));
        toast.error("Failed to assign education. Please try again.");
      }

      // Only clear topics that succeeded so failures can be retried.
      if (failedCount === 0) {
        setRecommendations([]);
        setSelectedTopics({});
      }
    } catch (error) {
      console.error("Assignment error:", error);
      toast.error("Failed to assign education. Please try again.");
    } finally {
      setIsAssigning(false);
    }
  };

  const getPriorityColor = (priority) => {
    const colors = {
      high: "bg-red-100 text-red-800 border-red-300",
      medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
      low: "bg-blue-100 text-blue-800 border-blue-300"
    };
    return colors[priority] || "bg-slate-100 text-slate-800";
  };

  const selectedCount = Object.values(selectedTopics).filter(Boolean).length;

  return (
    <Card className="border-2 border-green-300">
      <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-green-600" />
          AI Education Recommender
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {recommendations.length === 0 ? (
          <div className="space-y-3">
            <Alert className="bg-green-50 border-green-200">
              <AlertDescription className="text-sm text-green-900">
                Generate personalized education topics based on patient's diagnosis, care plans, and learning needs.
              </AlertDescription>
            </Alert>
            <Button
              onClick={generateRecommendations}
              disabled={ai.loading || !patient}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {ai.loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Generate Education Topics</>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {recommendations.length} topic(s) recommended
              </span>
              <Button size="sm" variant="outline" onClick={() => {
                const all = {};
                recommendations.forEach((_, idx) => { all[idx] = true; });
                setSelectedTopics(all);
              }}>
                Select All
              </Button>
            </div>

            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {recommendations.map((rec, idx) => (
                  <Card 
                    key={idx}
                    className={`border transition-all ${
                      selectedTopics[idx] 
                        ? 'border-green-400 bg-green-50' 
                        : 'border-slate-200'
                    }`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={selectedTopics[idx] || false}
                          onCheckedChange={() => toggleSelection(idx)}
                          className="mt-1"
                        />
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={getPriorityColor(rec.priority)}>
                              {rec.priority}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {rec.delivery_format}
                            </Badge>
                          </div>

                          <h4 className="font-semibold text-slate-900">{rec.topic}</h4>
                          
                          <div className="bg-blue-50 p-2 rounded border border-blue-200">
                            <p className="text-xs text-blue-900">
                              <strong>Supports:</strong> {rec.care_plan_connection}
                            </p>
                          </div>

                          <p className="text-sm text-slate-700">{rec.content}</p>

                          {rec.learning_objectives?.length > 0 && (
                            <div className="bg-navy-50 p-2 rounded border border-navy-200">
                              <p className="text-xs font-medium text-navy-800 mb-1">Learning Objectives:</p>
                              <ul className="text-xs text-navy-900 space-y-0.5">
                                {rec.learning_objectives.map((obj, i) => (
                                  <li key={i}>• {obj}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {rec.key_points?.length > 0 && (
                            <div className="bg-green-50 p-2 rounded border border-green-200">
                              <p className="text-xs font-medium text-green-800 mb-1">Key Points:</p>
                              <ul className="text-xs text-green-900 space-y-0.5">
                                {rec.key_points.map((point, i) => (
                                  <li key={i}>✓ {point}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {rec.teach_back_questions?.length > 0 && (
                            <div className="bg-orange-50 p-2 rounded border border-orange-200">
                              <p className="text-xs font-medium text-orange-800 mb-1">Teach-Back Questions:</p>
                              <ul className="text-xs text-orange-900 space-y-0.5">
                                {rec.teach_back_questions.slice(0, 2).map((q, i) => (
                                  <li key={i}>? {q}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>

            <div className="flex gap-2 pt-4 border-t">
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={assignSelected}
                disabled={selectedCount === 0 || isAssigning}
              >
                {isAssigning ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Assigning...</>
                ) : (
                  <><CheckCircle2 className="w-4 h-4 mr-2" /> Assign {selectedCount} Topic(s)</>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setRecommendations([]);
                  setSelectedTopics({});
                }}
              >
                Reset
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}