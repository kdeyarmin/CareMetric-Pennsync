import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sparkles,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  Award,
  Brain,
  Target
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from 'sonner';

export default function AITrainingModuleGenerator() {
  const queryClient = useQueryClient();
  const ai = useAICall();
  const [selectedRecommendations, setSelectedRecommendations] = useState(new Set());
  const [selectedExemplars, setSelectedExemplars] = useState(new Set());
  const [moduleType, setModuleType] = useState("mixed");
  const [moduleTitle, setModuleTitle] = useState("");
  const [generatedModule, setGeneratedModule] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const { data: trainingRecommendations = [] } = useQuery({
    queryKey: ['trainingRecommendationsForModules'],
    queryFn: () => base44.entities.TrainingRecommendation.filter({ addressed: false }, '-created_date', 100),
    initialData: [],
  });

  const { data: exemplaryDocs = [] } = useQuery({
    queryKey: ['exemplaryDocumentation'],
    queryFn: async () => {
      const all = await base44.entities.TrainingRecommendation.filter({
        recommendation_type: 'documentation',
        addressed: false
      }, '-created_date', 50);
      return all.filter(rec => 
        rec.context_data?.overall_score >= 90 || 
        rec.recommendation_text?.toLowerCase().includes('exemplary')
      );
    },
    initialData: [],
  });

  const generateTrainingModule = async () => {
    if (selectedRecommendations.size === 0 && selectedExemplars.size === 0) {
      toast.error('Please select at least one recommendation or exemplary document');
      return;
    }

    try {
      const selectedRecs = trainingRecommendations.filter(r => selectedRecommendations.has(r.id));
      const selectedExs = exemplaryDocs.filter(e => selectedExemplars.has(e.id));

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert clinical education specialist for home health nursing. Create a comprehensive training module for Pennsylvania home health staff focusing on Medicare compliance (42 CFR 484).

INPUT DATA FOR MODULE GENERATION:

COMPLIANCE GAPS IDENTIFIED:
${selectedRecs.map(r => `- ${r.recommendation_text} (Source: ${r.source}, Severity: ${r.severity})`).join('\n')}

EXEMPLARY DOCUMENTATION EXAMPLES:
${selectedExs.map(e => `
Example ${selectedExs.indexOf(e) + 1}:
${e.context_data?.note_snippet || 'No snippet available'}
Why Exemplary: ${e.context_data?.training_value || 'High quality documentation'}
Score: ${e.context_data?.overall_score || 'N/A'}
`).join('\n')}

MODULE PARAMETERS:
- Module Type: ${moduleType}
- Target Audience: Pennsylvania home health nurses (RNs and LPNs)
- Regulatory Focus: 42 CFR 484 CoP + Pennsylvania state regulations

CREATE A COMPREHENSIVE TRAINING MODULE:

1. MODULE TITLE & DESCRIPTION:
   - Engaging title that addresses the gaps
   - Clear learning objectives

2. EDUCATIONAL CONTENT:
   - Introduction explaining the Medicare/PA requirements
   - Detailed explanation of best practices
   - Reference to 42 CFR 484 requirements
   - Use exemplary documentation as positive examples
   - Contrast with common errors

3. INTERACTIVE ELEMENTS (if module type supports):
   - Case scenarios based on real compliance gaps
   - Practice exercises

4. QUIZ QUESTIONS (5-10 questions):
   - Multiple choice format
   - Each question tests understanding of a key concept
   - Include correct answer index (0-based) and explanation
   - Cover both what TO do and what NOT to do
   - Reference specific CoP requirements

5. SCENARIO-BASED EXERCISES:
   - 2-3 realistic clinical scenarios
   - Present a documentation challenge
   - Guide learners to compliant solution
   - Show exemplary vs poor documentation

6. KEY TAKEAWAYS:
   - 3-5 critical points to remember
   - Specific phrases/templates to use
   - Red flags to avoid

Return structured JSON training module.`,
        response_json_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            learning_objectives: { type: "array", items: { type: "string" } },
            duration_minutes: { type: "number" },
            difficulty_level: { type: "string", enum: ["beginner", "intermediate", "advanced"] },
            content: {
              type: "object",
              properties: {
                introduction: { type: "string" },
                main_content: { type: "string" },
                medicare_requirements: { type: "array", items: { type: "string" } },
                best_practices: { type: "array", items: { type: "string" } },
                exemplary_examples: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      example_text: { type: "string" },
                      analysis: { type: "string" }
                    }
                  }
                },
                common_errors: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      error: { type: "string" },
                      why_problematic: { type: "string" },
                      correct_approach: { type: "string" }
                    }
                  }
                },
                quiz_questions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      question: { type: "string" },
                      options: { type: "array", items: { type: "string" } },
                      correct_answer: { type: "number" },
                      explanation: { type: "string" },
                      cop_reference: { type: "string" }
                    }
                  }
                },
                scenarios: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      scenario_title: { type: "string" },
                      patient_context: { type: "string" },
                      challenge: { type: "string" },
                      poor_documentation: { type: "string" },
                      exemplary_documentation: { type: "string" },
                      learning_points: { type: "array", items: { type: "string" } }
                    }
                  }
                },
                key_takeaways: { type: "array", items: { type: "string" } },
                quick_reference_phrases: { type: "array", items: { type: "string" } }
              }
            },
            related_diagnoses: { type: "array", items: { type: "string" } },
            related_skills: { type: "array", items: { type: "string" } },
            category: { type: "string" }
          }
        }
      });

      setGeneratedModule(result);
    } catch (error) {
      console.error('Error generating training module:', error);
      toast.error('Failed to generate training module. Please try again.');
    }
  };

  const publishModule = async () => {
    if (!generatedModule) return;

    setIsPublishing(true);
    try {
      const moduleData = {
        title: moduleTitle || generatedModule.title,
        description: generatedModule.description,
        category: generatedModule.category || 'documentation',
        module_type: moduleType,
        content_type: 'mixed',
        content: generatedModule.content,
        related_diagnoses: generatedModule.related_diagnoses || [],
        related_skills: generatedModule.related_skills || [],
        duration_minutes: generatedModule.duration_minutes || 30,
        difficulty_level: generatedModule.difficulty_level || 'intermediate',
        is_required: false,
        passing_score: 80,
        is_active: true
      };

      await base44.entities.TrainingModule.create(moduleData);

      // Mark recommendations as addressed
      for (const recId of selectedRecommendations) {
        await base44.entities.TrainingRecommendation.update(recId, { addressed: true });
      }
      for (const exId of selectedExemplars) {
        await base44.entities.TrainingRecommendation.update(exId, { addressed: true });
      }

      queryClient.invalidateQueries({ queryKey: ['trainingModules'] });
      queryClient.invalidateQueries({ queryKey: ['trainingRecommendationsForModules'] });
      queryClient.invalidateQueries({ queryKey: ['exemplaryDocumentation'] });

      toast.success('Training module published successfully!');
      setGeneratedModule(null);
      setSelectedRecommendations(new Set());
      setSelectedExemplars(new Set());
      setModuleTitle("");
    } catch (error) {
      console.error('Error publishing module:', error);
      toast.error('Failed to publish training module. Please try again.');
    }
    setIsPublishing(false);
  };

  return (
    <div className="space-y-6">
      <Card className="border-2 border-navy-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-navy-600" />
            AI Training Module Generator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">
            Select compliance gaps and exemplary documentation to automatically generate comprehensive training modules.
          </p>

          {/* Module Configuration */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>Module Type</Label>
              <Select value={moduleType} onValueChange={setModuleType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mixed">Interactive + Quiz</SelectItem>
                  <SelectItem value="quiz">Quiz Only</SelectItem>
                  <SelectItem value="interactive">Interactive Only</SelectItem>
                  <SelectItem value="text">Text-based</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Custom Title (Optional)</Label>
              <Input
                placeholder="AI will generate if left blank"
                value={moduleTitle}
                onChange={(e) => setModuleTitle(e.target.value)}
              />
            </div>
          </div>

          {/* Select Compliance Gaps */}
          <div>
            <p className="font-medium text-slate-900 mb-2">Compliance Gaps to Address</p>
            <div className="max-h-48 overflow-y-auto space-y-2 bg-slate-50 p-3 rounded border">
              {trainingRecommendations.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">No unaddressed recommendations</p>
              ) : (
                trainingRecommendations.map(rec => (
                  <div key={rec.id} className="flex items-start gap-2 bg-white p-2 rounded border">
                    <Checkbox
                      checked={selectedRecommendations.has(rec.id)}
                      onCheckedChange={(checked) => {
                        const newSet = new Set(selectedRecommendations);
                        if (checked) newSet.add(rec.id);
                        else newSet.delete(rec.id);
                        setSelectedRecommendations(newSet);
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-900">{rec.recommendation_text}</p>
                      <div className="flex gap-2 mt-1">
                        <Badge className={
                          rec.severity === 'critical' ? 'bg-red-600' :
                          rec.severity === 'high' ? 'bg-orange-600' : 'bg-yellow-600'
                        }>
                          {rec.severity}
                        </Badge>
                        <Badge variant="outline" className="text-xs">{rec.source}</Badge>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Selected: {selectedRecommendations.size}
            </p>
          </div>

          {/* Select Exemplary Documentation */}
          <div>
            <p className="font-medium text-slate-900 mb-2">Exemplary Documentation Examples</p>
            <div className="max-h-48 overflow-y-auto space-y-2 bg-green-50 p-3 rounded border border-green-200">
              {exemplaryDocs.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">No exemplary documentation flagged yet</p>
              ) : (
                exemplaryDocs.map(doc => (
                  <div key={doc.id} className="flex items-start gap-2 bg-white p-2 rounded border">
                    <Checkbox
                      checked={selectedExemplars.has(doc.id)}
                      onCheckedChange={(checked) => {
                        const newSet = new Set(selectedExemplars);
                        if (checked) newSet.add(doc.id);
                        else newSet.delete(doc.id);
                        setSelectedExemplars(newSet);
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Award className="w-3 h-3 text-green-600" />
                        <p className="text-xs font-semibold text-green-900">
                          Score: {doc.context_data?.overall_score || 'N/A'}
                        </p>
                      </div>
                      <p className="text-xs text-slate-700 italic">
                        "{doc.context_data?.note_snippet?.substring(0, 100) || doc.recommendation_text}..."
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Selected: {selectedExemplars.size}
            </p>
          </div>

          <Button
            onClick={generateTrainingModule}
            disabled={ai.loading || (selectedRecommendations.size === 0 && selectedExemplars.size === 0)}
            className="w-full bg-navy-600 hover:bg-navy-700"
          >
            {ai.loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Generating Module...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Training Module with AI
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Generated Module Preview */}
      {generatedModule && (
        <Card className="border-2 border-green-300 bg-gradient-to-b from-green-50 to-white">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                Generated Module: {generatedModule.title}
              </span>
              <Badge className="bg-green-600">
                {generatedModule.duration_minutes} min
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Module Header */}
            <div className="bg-white p-4 rounded border">
              <p className="text-sm text-slate-700 mb-3">{generatedModule.description}</p>
              <div className="flex gap-2">
                <Badge variant="outline">{generatedModule.category}</Badge>
                <Badge variant="outline">{generatedModule.difficulty_level}</Badge>
              </div>
            </div>

            {/* Learning Objectives */}
            <div className="bg-blue-50 p-4 rounded border border-blue-200">
              <p className="font-semibold text-blue-900 mb-2">Learning Objectives</p>
              <ul className="space-y-1">
                {generatedModule.learning_objectives?.map((obj, idx) => (
                  <li key={idx} className="text-sm text-blue-800 flex items-start gap-2">
                    <Target className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    {obj}
                  </li>
                ))}
              </ul>
            </div>

            <Accordion type="multiple" className="space-y-2">
              {/* Introduction */}
              <AccordionItem value="intro" className="border rounded-lg bg-white">
                <AccordionTrigger className="px-4 py-3">
                  <span className="font-medium">Introduction & Medicare Requirements</span>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <p className="text-sm text-slate-700 mb-3">{generatedModule.content?.introduction}</p>
                  {generatedModule.content?.medicare_requirements?.length > 0 && (
                    <div className="bg-navy-50 p-3 rounded border border-navy-200">
                      <p className="font-semibold text-navy-900 text-sm mb-2">42 CFR 484 Requirements:</p>
                      <ul className="space-y-1">
                        {generatedModule.content.medicare_requirements.map((req, i) => (
                          <li key={i} className="text-xs text-navy-800">• {req}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>

              {/* Main Content */}
              <AccordionItem value="content" className="border rounded-lg bg-white">
                <AccordionTrigger className="px-4 py-3">
                  <span className="font-medium">Educational Content</span>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="prose prose-sm max-w-none">
                    <div className="text-sm text-slate-700 whitespace-pre-line">
                      {generatedModule.content?.main_content}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Exemplary Examples */}
              {generatedModule.content?.exemplary_examples?.length > 0 && (
                <AccordionItem value="examples" className="border rounded-lg bg-green-50">
                  <AccordionTrigger className="px-4 py-3">
                    <span className="font-medium flex items-center gap-2">
                      <Award className="w-4 h-4 text-green-600" />
                      Exemplary Documentation Examples ({generatedModule.content.exemplary_examples.length})
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4 space-y-3">
                    {generatedModule.content.exemplary_examples.map((ex, idx) => (
                      <div key={idx} className="bg-white p-3 rounded border-l-4 border-l-green-500">
                        <p className="font-semibold text-green-900 mb-2">{ex.title}</p>
                        <div className="bg-green-50 p-3 rounded mb-2">
                          <p className="text-sm text-green-900 italic">"{ex.example_text}"</p>
                        </div>
                        <p className="text-xs text-slate-700">{ex.analysis}</p>
                      </div>
                    ))}
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Common Errors */}
              {generatedModule.content?.common_errors?.length > 0 && (
                <AccordionItem value="errors" className="border rounded-lg bg-red-50">
                  <AccordionTrigger className="px-4 py-3">
                    <span className="font-medium flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600" />
                      Common Errors to Avoid ({generatedModule.content.common_errors.length})
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4 space-y-3">
                    {generatedModule.content.common_errors.map((err, idx) => (
                      <div key={idx} className="bg-white p-3 rounded border">
                        <p className="font-semibold text-red-900 mb-1">❌ {err.error}</p>
                        <p className="text-xs text-slate-600 mb-2">{err.why_problematic}</p>
                        <div className="bg-green-50 p-2 rounded border border-green-200">
                          <p className="text-xs font-semibold text-green-900 mb-1">✓ Correct Approach:</p>
                          <p className="text-xs text-green-800">{err.correct_approach}</p>
                        </div>
                      </div>
                    ))}
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Quiz Questions */}
              {generatedModule.content?.quiz_questions?.length > 0 && (
                <AccordionItem value="quiz" className="border rounded-lg bg-blue-50">
                  <AccordionTrigger className="px-4 py-3">
                    <span className="font-medium">Knowledge Check Quiz ({generatedModule.content.quiz_questions.length} questions)</span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4 space-y-3">
                    {generatedModule.content.quiz_questions.map((q, idx) => (
                      <div key={idx} className="bg-white p-3 rounded border">
                        <p className="font-medium text-slate-900 mb-2">
                          {idx + 1}. {q.question}
                        </p>
                        <div className="space-y-1 mb-2">
                          {q.options?.map((opt, optIdx) => (
                            <div
                              key={optIdx}
                              className={`p-2 rounded text-sm ${
                                optIdx === q.correct_answer
                                  ? 'bg-green-100 border-2 border-green-500 font-medium'
                                  : 'bg-slate-50 border'
                              }`}
                            >
                              {String.fromCharCode(65 + optIdx)}. {opt}
                              {optIdx === q.correct_answer && (
                                <CheckCircle2 className="w-3 h-3 inline ml-2 text-green-600" />
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="bg-blue-50 p-2 rounded border border-blue-200">
                          <p className="text-xs font-semibold text-blue-900 mb-1">Explanation:</p>
                          <p className="text-xs text-blue-800">{q.explanation}</p>
                          {q.cop_reference && (
                            <p className="text-xs text-blue-600 mt-1">
                              <strong>CoP:</strong> {q.cop_reference}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Scenarios */}
              {generatedModule.content?.scenarios?.length > 0 && (
                <AccordionItem value="scenarios" className="border rounded-lg bg-yellow-50">
                  <AccordionTrigger className="px-4 py-3">
                    <span className="font-medium">Practice Scenarios ({generatedModule.content.scenarios.length})</span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4 space-y-4">
                    {generatedModule.content.scenarios.map((scenario, idx) => (
                      <div key={idx} className="bg-white p-4 rounded border">
                        <p className="font-bold text-slate-900 mb-2">{scenario.scenario_title}</p>
                        <div className="bg-slate-50 p-3 rounded mb-3">
                          <p className="text-sm text-slate-700">{scenario.patient_context}</p>
                        </div>
                        <p className="text-sm font-medium text-orange-600 mb-2">
                          Challenge: {scenario.challenge}
                        </p>
                        <div className="grid md:grid-cols-2 gap-3 mb-3">
                          <div className="bg-red-50 p-3 rounded border border-red-200">
                            <p className="text-xs font-semibold text-red-900 mb-1">❌ Poor Documentation:</p>
                            <p className="text-xs text-red-800 italic">"{scenario.poor_documentation}"</p>
                          </div>
                          <div className="bg-green-50 p-3 rounded border border-green-200">
                            <p className="text-xs font-semibold text-green-900 mb-1">✓ Exemplary Documentation:</p>
                            <p className="text-xs text-green-800 italic">"{scenario.exemplary_documentation}"</p>
                          </div>
                        </div>
                        <div className="bg-blue-50 p-3 rounded border border-blue-200">
                          <p className="text-xs font-semibold text-blue-900 mb-1">Learning Points:</p>
                          <ul className="space-y-0.5">
                            {scenario.learning_points?.map((point, i) => (
                              <li key={i} className="text-xs text-blue-800">• {point}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ))}
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Key Takeaways */}
              <AccordionItem value="takeaways" className="border rounded-lg bg-navy-50">
                <AccordionTrigger className="px-4 py-3">
                  <span className="font-medium">Key Takeaways & Quick Reference</span>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-3">
                  <div className="bg-white p-3 rounded border">
                    <p className="font-semibold text-slate-900 mb-2">Key Takeaways:</p>
                    <ul className="space-y-1">
                      {generatedModule.content?.key_takeaways?.map((takeaway, idx) => (
                        <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                          {takeaway}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {generatedModule.content?.quick_reference_phrases?.length > 0 && (
                    <div className="bg-navy-50 p-3 rounded border border-navy-200">
                      <p className="font-semibold text-navy-900 mb-2">Quick Reference Phrases:</p>
                      <div className="flex flex-wrap gap-2">
                        {generatedModule.content.quick_reference_phrases.map((phrase, idx) => (
                          <Badge key={idx} className="bg-navy-100 text-navy-900">
                            {phrase}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* Publish Module */}
            <div className="flex gap-3">
              <Input
                placeholder="Edit module title if needed"
                value={moduleTitle || generatedModule.title}
                onChange={(e) => setModuleTitle(e.target.value)}
              />
              <Button
                onClick={publishModule}
                disabled={isPublishing}
                className="bg-green-600 hover:bg-green-700 whitespace-nowrap"
              >
                {isPublishing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Publishing...
                  </>
                ) : (
                  <>
                    <BookOpen className="w-4 h-4 mr-2" />
                    Publish Module
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}