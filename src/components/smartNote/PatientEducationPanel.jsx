import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  BookOpen,
  Sparkles,
  Loader2,
  CheckCircle2,
  Download,
  Plus,
  FileText,
  Lightbulb,
  ClipboardCopy
} from "lucide-react";

export default function PatientEducationPanel({
  patient,
  diagnosis,
  visitNotes,
  vitalSigns,
  carePlans = [],
  onDocumentEducation,
  autoSuggest = true
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [selectedTopics, setSelectedTopics] = useState([]);
  const [generatedHandouts, setGeneratedHandouts] = useState({});
  const [assignedTopics, setAssignedTopics] = useState(new Set());
  const [documentationText, setDocumentationText] = useState("");

  useEffect(() => {
    if (autoSuggest && patient && diagnosis) {
      generateSuggestions();
    }
  }, [autoSuggest, patient?.id, diagnosis]);

  const generateSuggestions = async () => {
    if (!patient || !diagnosis) return;

    setIsGenerating(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a patient education specialist. Based on this patient's clinical data, suggest personalized education topics.

PATIENT PROFILE:
- Name: ${patient.first_name} ${patient.last_name}
- Age: ${calculateAge(patient.date_of_birth)}
- Primary Diagnosis: ${diagnosis}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Medications: ${patient.current_medications?.map(m => m.name || m).join(', ') || 'None'}
- Cognitive Status: ${patient.functional_status?.cognitive_status || 'Unknown'}
- Living Situation: ${patient.social_history?.living_situation || 'Unknown'}
- Primary Language: ${patient.social_history?.primary_language || 'English'}

VISIT NOTES:
${visitNotes || 'Not yet documented'}

VITAL SIGNS:
${vitalSigns ? Object.entries(vitalSigns).filter(([k,v]) => v && k !== 'o2Source' && k !== 'o2Flow').map(([k,v]) => `${k}: ${v}`).join(', ') : 'None'}

ACTIVE CARE PLAN GOALS:
${carePlans.filter(cp => cp.status === 'active').map(cp => `- ${cp.problem}: ${cp.goal}`).join('\n') || 'None'}

Suggest 3-5 high-priority patient education topics that are:
1. Directly relevant to diagnosis and current condition
2. Appropriate for cognitive and language level
3. Actionable and practical for home setting
4. Aligned with care plan goals
5. Address medication safety if applicable
6. Include disease management and self-care

For each topic, provide:
- Clear, patient-friendly title
- Why this education is critical now
- Key learning objectives (what patient needs to understand/do)
- Teach-back validation questions
- Reading level required
- Estimated teaching time`,
        response_json_schema: {
          type: "object",
          properties: {
            priority_topics: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  topic: { type: "string" },
                  priority: { type: "string", enum: ["critical", "high", "medium"] },
                  rationale: { type: "string" },
                  learning_objectives: { type: "array", items: { type: "string" } },
                  teach_back_questions: { type: "array", items: { type: "string" } },
                  reading_level: { type: "string" },
                  estimated_minutes: { type: "number" },
                  relates_to_care_plan: { type: "string" }
                }
              }
            },
            overall_education_priority: { type: "string" }
          }
        }
      });

      setSuggestions(result);
    } catch (error) {
      console.error('Error generating suggestions:', error);
    }
    setIsGenerating(false);
  };

  const generateHandout = async (topic, topicData) => {
    setIsGenerating(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Create a personalized patient education handout for this specific patient.

PATIENT: ${patient.first_name} ${patient.last_name}
AGE: ${calculateAge(patient.date_of_birth)}
DIAGNOSIS: ${diagnosis}
COGNITIVE STATUS: ${patient.functional_status?.cognitive_status || 'Alert and oriented'}
PRIMARY LANGUAGE: ${patient.social_history?.primary_language || 'English'}
LIVING SITUATION: ${patient.social_history?.living_situation || 'Unknown'}

EDUCATION TOPIC: ${topic}
RATIONALE: ${topicData.rationale}
LEARNING OBJECTIVES:
${topicData.learning_objectives.map(obj => `- ${obj}`).join('\n')}

Create a patient-friendly handout that:
1. Uses ${topicData.reading_level} reading level
2. Is personalized to patient's specific condition and situation
3. Includes simple, actionable steps
4. Has clear warning signs to watch for
5. Provides specific examples relevant to their diagnosis
6. Includes contact information section (to be filled in)
7. Is culturally appropriate and respectful
8. Addresses medication instructions if relevant
9. Includes safety precautions specific to their condition

Format as a complete, printable handout (markdown format).
Include sections: Overview, What You Need to Know, What to Do, Warning Signs, Questions to Ask, Additional Resources.`,
        response_json_schema: {
          type: "object",
          properties: {
            handout_title: { type: "string" },
            handout_content: { type: "string" },
            key_points: { type: "array", items: { type: "string" } },
            warning_signs: { type: "array", items: { type: "string" } },
            action_steps: { type: "array", items: { type: "string" } }
          }
        }
      });

      setGeneratedHandouts(prev => ({
        ...prev,
        [topic]: result
      }));
    } catch (error) {
      console.error('Error generating handout:', error);
      alert('Failed to generate handout. Please try again.');
    }
    setIsGenerating(false);
  };

  const assignToPatient = async (topic, handoutData) => {
    try {
      // Create education assignment
      await base44.entities.PatientEducationAssignment.create({
        patient_id: patient.id,
        topic: topic,
        material_content: handoutData.handout_content,
        assigned_date: new Date().toISOString().split('T')[0],
        status: 'provided',
        method: 'printed_handout',
        nurse_notes: `Education provided on ${topic}. Patient verbalized understanding.`
      });

      setAssignedTopics(prev => new Set([...prev, topic]));

      // Generate documentation text
      const docText = `PATIENT EDUCATION PROVIDED:\n\nTopic: ${topic}\n\nKey points reviewed with patient:\n${handoutData.key_points.map((pt, i) => `${i + 1}. ${pt}`).join('\n')}\n\nPatient verbalized understanding and was provided written handout. Patient encouraged to contact nurse with questions.`;
      
      setDocumentationText(docText);
    } catch (error) {
      console.error('Error assigning education:', error);
      alert('Failed to assign education. Please try again.');
    }
  };

  const copyDocumentation = () => {
    navigator.clipboard.writeText(documentationText);
  };

  const downloadHandout = async (topic, handoutData) => {
    const { formatTextDocument } = await import('../utils/branding');
    
    const content = formatTextDocument(
      `${handoutData.handout_title}\n\nPatient: ${patient.first_name} ${patient.last_name}\nDate: ${new Date().toLocaleDateString()}\n\n${handoutData.handout_content}`,
      {
        title: `Patient Education: ${topic}`,
        date: new Date().toLocaleDateString()
      }
    );
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CareMetric_${topic.replace(/\s+/g, '_')}_${patient.last_name}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  const getPriorityColor = (priority) => {
    if (priority === 'critical') return 'bg-red-600 text-white';
    if (priority === 'high') return 'bg-orange-600 text-white';
    return 'bg-blue-600 text-white';
  };

  if (!patient) {
    return (
      <Alert>
        <BookOpen className="w-4 h-4" />
        <AlertDescription className="text-sm">
          Select a patient to generate personalized education materials
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="border-2 border-green-300 bg-gradient-to-br from-green-50 to-emerald-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-green-600" />
          AI Patient Education Generator
          {assignedTopics.size > 0 && (
            <Badge className="bg-green-600 text-white ml-auto">
              {assignedTopics.size} Assigned
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Auto-suggest button */}
        {!suggestions && (
          <Button
            onClick={generateSuggestions}
            disabled={isGenerating}
            className="w-full bg-green-600 hover:bg-green-700"
          >
            {isGenerating ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing Patient Needs...</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-2" /> Suggest Education Topics</>
            )}
          </Button>
        )}

        {/* Priority Notice */}
        {suggestions?.overall_education_priority && (
          <Alert className="bg-blue-50 border-blue-300">
            <Lightbulb className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-sm text-blue-900">
              <strong>Education Priority:</strong> {suggestions.overall_education_priority}
            </AlertDescription>
          </Alert>
        )}

        {/* Suggested Topics */}
        {suggestions?.priority_topics && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-700">Recommended Education Topics:</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSuggestions(null)}
              >
                Refresh Suggestions
              </Button>
            </div>

            {suggestions.priority_topics.map((item, idx) => {
              const hasHandout = generatedHandouts[item.topic];
              const isAssigned = assignedTopics.has(item.topic);

              return (
                <Card key={idx} className={`border-2 ${
                  isAssigned ? 'border-green-400 bg-green-50' :
                  item.priority === 'critical' ? 'border-red-300 bg-red-50' :
                  'border-gray-200'
                }`}>
                  <CardContent className="p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-gray-900">{item.topic}</h4>
                          <Badge className={getPriorityColor(item.priority)}>
                            {item.priority}
                          </Badge>
                          {isAssigned && (
                            <Badge className="bg-green-600 text-white">
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Assigned
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-gray-600">{item.rationale}</p>
                      </div>
                    </div>

                    {/* Learning Objectives */}
                    <div className="bg-white p-2 rounded border">
                      <p className="text-xs font-semibold text-gray-700 mb-1">Learning Objectives:</p>
                      <ul className="text-xs text-gray-600 space-y-0.5">
                        {item.learning_objectives.slice(0, 3).map((obj, i) => (
                          <li key={i}>• {obj}</li>
                        ))}
                      </ul>
                    </div>

                    {/* Metadata */}
                    <div className="flex gap-3 text-xs text-gray-500">
                      <span>📖 {item.reading_level}</span>
                      <span>⏱️ ~{item.estimated_minutes} min</span>
                    </div>

                    {/* Actions */}
                    {!hasHandout ? (
                      <Button
                        size="sm"
                        onClick={() => generateHandout(item.topic, item)}
                        disabled={isGenerating}
                        className="w-full bg-blue-600 hover:bg-blue-700"
                      >
                        {isGenerating ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4 mr-2" />
                        )}
                        Generate Handout
                      </Button>
                    ) : (
                      <div className="space-y-2">
                        {/* Generated Handout Preview */}
                        <div className="bg-white p-3 rounded border border-green-200">
                          <p className="text-xs font-semibold text-green-900 mb-2">
                            ✓ Handout Generated: {hasHandout.handout_title}
                          </p>
                          <div className="max-h-32 overflow-y-auto text-xs text-gray-700">
                            {hasHandout.key_points.map((pt, i) => (
                              <div key={i} className="mb-1">• {pt}</div>
                            ))}
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => downloadHandout(item.topic, hasHandout)}
                            variant="outline"
                            className="flex-1"
                          >
                            <Download className="w-3 h-3 mr-1" />
                            Download
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => assignToPatient(item.topic, hasHandout)}
                            disabled={isAssigned}
                            className="flex-1 bg-green-600 hover:bg-green-700"
                          >
                            {isAssigned ? (
                              <><CheckCircle2 className="w-3 h-3 mr-1" /> Assigned</>
                            ) : (
                              <><Plus className="w-3 h-3 mr-1" /> Assign to Patient</>
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Documentation Text */}
        {documentationText && (
          <Card className="border-2 border-blue-300 bg-blue-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />
                Education Documentation (Add to Note)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={documentationText}
                onChange={(e) => setDocumentationText(e.target.value)}
                className="min-h-[120px] text-sm bg-white"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    onDocumentEducation?.(documentationText);
                    setDocumentationText("");
                  }}
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add to Visit Note
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyDocumentation}
                >
                  <ClipboardCopy className="w-4 h-4 mr-1" />
                  Copy
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Actions */}
        {suggestions && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const allGenerated = suggestions.priority_topics.every(t => generatedHandouts[t.topic]);
                if (!allGenerated) {
                  suggestions.priority_topics.forEach(t => {
                    if (!generatedHandouts[t.topic]) {
                      generateHandout(t.topic, t);
                    }
                  });
                }
              }}
              disabled={isGenerating}
              className="flex-1"
            >
              Generate All Handouts
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function calculateAge(dob) {
  if (!dob) return 'Unknown';
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}