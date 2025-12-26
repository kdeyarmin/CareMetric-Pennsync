import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BookOpen,
  Sparkles,
  Loader2,
  Download,
  Mail,
  Copy,
  CheckCircle2,
  FileText,
  AlertCircle,
  Lightbulb,
  Brain
} from "lucide-react";

export default function AIEducationRecommender({ patient, carePlans = [], recentVisits = [], visitNotes, vitalSigns }) {
  const [activeTab, setActiveTab] = useState("recommend");
  const [isGenerating, setIsGenerating] = useState(false);
  const [recommendations, setRecommendations] = useState(null);
  const [simplifiedExplanation, setSimplifiedExplanation] = useState(null);
  const [customHandout, setCustomHandout] = useState(null);
  const [copied, setCopied] = useState(false);

  // Auto-generate recommendations when patient loads
  useEffect(() => {
    if (patient && patient.primary_diagnosis) {
      generateRecommendations();
    }
  }, [patient?.id]);

  const generateRecommendations = async () => {
    if (!patient) return;

    setIsGenerating(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a patient education specialist. Analyze this patient's profile and recommend relevant education resources.

PATIENT PROFILE:
- Age: ${calculateAge(patient.date_of_birth)}
- Primary Diagnosis: ${patient.primary_diagnosis}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Medications: ${patient.current_medications?.map(m => m.name || m).join(', ') || 'None'}
- Allergies: ${patient.allergies || 'NKDA'}
- Cognitive Status: ${patient.functional_status?.cognitive_status || 'Unknown'}
- Living Situation: ${patient.social_history?.living_situation || 'Unknown'}
- Primary Language: ${patient.social_history?.primary_language || 'English'}

ACTIVE CARE PLANS:
${carePlans.filter(cp => cp.status === 'active').map(cp => `- ${cp.problem}: ${cp.goal}`).join('\n') || 'None'}

RECENT VISIT SUMMARY:
${recentVisits[0]?.nurse_notes?.substring(0, 300) || 'No recent visits'}

Provide comprehensive education recommendations including:
1. Priority education topics based on diagnosis and medications
2. Disease-specific self-management education needs
3. Medication education requirements
4. Safety education priorities
5. Lifestyle modification education
6. Family/caregiver education needs
7. Red flag symptoms patient must know
8. Resources and support groups

Prioritize based on clinical urgency and patient learning needs.`,
        response_json_schema: {
          type: "object",
          properties: {
            priority_education_topics: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  topic: { type: "string" },
                  category: { type: "string", enum: ["disease_management", "medication", "safety", "lifestyle", "symptoms", "self_care"] },
                  priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  rationale: { type: "string" },
                  key_points: { type: "array", items: { type: "string" } },
                  recommended_resources: { type: "array", items: { type: "string" } },
                  teach_back_questions: { type: "array", items: { type: "string" } }
                }
              }
            },
            red_flag_symptoms: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  symptom: { type: "string" },
                  action_required: { type: "string" },
                  urgency: { type: "string", enum: ["call_911", "call_nurse_today", "call_doctor_today", "report_next_visit"] }
                }
              }
            },
            family_education_needs: { type: "array", items: { type: "string" } },
            recommended_support_groups: { type: "array", items: { type: "string" } }
          }
        }
      });

      setRecommendations(result);
    } catch (error) {
      console.error('Error generating recommendations:', error);
    }
    setIsGenerating(false);
  };

  const generateSimplifiedExplanation = async () => {
    if (!patient) return;

    setIsGenerating(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Create simplified, patient-friendly explanations of this patient's medical conditions and treatment plan.

PATIENT: ${patient.first_name} ${patient.last_name}
AGE: ${calculateAge(patient.date_of_birth)}
READING LEVEL: ${patient.functional_status?.cognitive_status === 'moderate_impairment' || patient.functional_status?.cognitive_status === 'severe_impairment' ? '5th grade or below' : '6th-8th grade'}

CONDITIONS:
- Primary: ${patient.primary_diagnosis}
- Secondary: ${patient.secondary_diagnoses?.join(', ') || 'None'}

MEDICATIONS:
${patient.current_medications?.map(m => `- ${m.name} ${m.dosage || ''}`).join('\n') || 'None documented'}

TREATMENT PLAN (from care plans):
${carePlans.filter(cp => cp.status === 'active').map(cp => `- Goal: ${cp.goal}\n  Interventions: ${cp.interventions?.join(', ')}`).join('\n\n') || 'No active care plans'}

Create simplified explanations that:
1. Explain each condition in plain language (what it is, why they have it, what it does to the body)
2. Explain each medication in simple terms (what it does, why they take it, important things to remember)
3. Explain the treatment plan and what the patient needs to do
4. Use analogies and simple comparisons when possible
5. Avoid medical jargon or explain terms clearly
6. Be encouraging and positive
7. Adapt to cognitive level if impaired

Format as clear, easy-to-understand sections.`,
        response_json_schema: {
          type: "object",
          properties: {
            condition_explanations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  condition_name: { type: "string" },
                  simple_explanation: { type: "string" },
                  what_to_expect: { type: "string" },
                  how_to_help_yourself: { type: "string" },
                  analogy_or_comparison: { type: "string" }
                }
              }
            },
            medication_explanations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  medication_name: { type: "string" },
                  what_it_does: { type: "string" },
                  why_you_take_it: { type: "string" },
                  important_reminders: { type: "array", items: { type: "string" } }
                }
              }
            },
            treatment_plan_summary: { type: "string" },
            encouraging_message: { type: "string" }
          }
        }
      });

      setSimplifiedExplanation(result);
      setActiveTab("explain");
    } catch (error) {
      console.error('Error generating explanation:', error);
    }
    setIsGenerating(false);
  };

  const generateCustomHandout = async () => {
    if (!patient) return;

    setIsGenerating(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Create a customized patient education handout incorporating specific instructions and precautions from today's visit.

PATIENT: ${patient.first_name} ${patient.last_name}
PRIMARY DIAGNOSIS: ${patient.primary_diagnosis}
COGNITIVE STATUS: ${patient.functional_status?.cognitive_status || 'Alert and oriented'}

TODAY'S VISIT NOTES:
${visitNotes || 'Not yet documented'}

TODAY'S VITAL SIGNS:
${vitalSigns ? Object.entries(vitalSigns).filter(([k,v]) => v && k !== 'o2Source' && k !== 'o2Flow').map(([k,v]) => `${k}: ${v}`).join(', ') : 'None documented'}

ACTIVE CARE PLAN GOALS:
${carePlans.filter(cp => cp.status === 'active').map(cp => `- ${cp.problem}: ${cp.goal}\n  Interventions: ${cp.interventions?.join(', ')}`).join('\n\n') || 'None'}

Create a personalized handout that:
1. Incorporates specific findings from today's visit
2. Includes personalized instructions based on today's assessment
3. Lists specific precautions discussed during the visit
4. Provides customized warning signs to watch for based on patient's current status
5. Includes follow-up instructions specific to this patient
6. References specific medications adjusted or discussed today
7. Incorporates vital sign targets if relevant
8. Is formatted for printing and easy reference

Make it highly personalized - not generic. Reference specific details from the visit notes and current status.`,
        response_json_schema: {
          type: "object",
          properties: {
            handout_title: { type: "string" },
            personalized_greeting: { type: "string" },
            visit_summary: { type: "string" },
            specific_instructions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  instruction_category: { type: "string" },
                  instruction: { type: "string" },
                  reason: { type: "string" }
                }
              }
            },
            precautions_for_you: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  precaution: { type: "string" },
                  why_important: { type: "string" }
                }
              }
            },
            your_warning_signs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  symptom: { type: "string" },
                  what_to_do: { type: "string" },
                  urgency: { type: "string" }
                }
              }
            },
            follow_up_plan: { type: "string" },
            contact_information: { type: "string" },
            personalized_encouragement: { type: "string" }
          }
        }
      });

      setCustomHandout(result);
      setActiveTab("handout");
    } catch (error) {
      console.error('Error generating handout:', error);
    }
    setIsGenerating(false);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadHandout = () => {
    if (!customHandout) return;

    const content = `${customHandout.handout_title}

Patient: ${patient.first_name} ${patient.last_name}
Date: ${new Date().toLocaleDateString()}

${customHandout.personalized_greeting}

VISIT SUMMARY:
${customHandout.visit_summary}

YOUR SPECIFIC INSTRUCTIONS:
${customHandout.specific_instructions.map((inst, i) => `
${i + 1}. ${inst.instruction_category}
   ${inst.instruction}
   Why: ${inst.reason}
`).join('\n')}

IMPORTANT PRECAUTIONS FOR YOU:
${customHandout.precautions_for_you.map((prec, i) => `
${i + 1}. ${prec.precaution}
   ${prec.why_important}
`).join('\n')}

WARNING SIGNS TO WATCH FOR:
${customHandout.your_warning_signs.map((sign, i) => `
${i + 1}. ${sign.symptom}
   What to do: ${sign.what_to_do}
   Urgency: ${sign.urgency}
`).join('\n')}

FOLLOW-UP PLAN:
${customHandout.follow_up_plan}

CONTACT INFORMATION:
${customHandout.contact_information}

${customHandout.personalized_encouragement}

---
Generated by CareMetric AI
`;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CareMetric_${patient.last_name}_Education_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  const sendHandoutEmail = async () => {
    if (!customHandout || !patient.email) {
      alert('Patient email not available');
      return;
    }

    try {
      const emailContent = `
        <h2 style="color: #2563eb;">${customHandout.handout_title}</h2>
        <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        <p>${customHandout.personalized_greeting}</p>
        
        <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #1e40af;">Visit Summary</h3>
          <p>${customHandout.visit_summary}</p>
        </div>

        <div style="margin: 20px 0;">
          <h3 style="color: #1e40af;">Your Specific Instructions</h3>
          ${customHandout.specific_instructions.map((inst, i) => `
            <div style="background: white; padding: 15px; border-left: 4px solid #3b82f6; margin: 10px 0;">
              <strong>${i + 1}. ${inst.instruction_category}</strong><br/>
              ${inst.instruction}<br/>
              <em style="color: #6b7280;">Why: ${inst.reason}</em>
            </div>
          `).join('')}
        </div>

        <div style="background: #fef3c7; padding: 15px; border-radius: 8px; border-left: 4px solid #f59e0b; margin: 20px 0;">
          <h3 style="color: #b45309;">Important Precautions</h3>
          ${customHandout.precautions_for_you.map((prec, i) => `
            <p><strong>${i + 1}. ${prec.precaution}</strong><br/>
            ${prec.why_important}</p>
          `).join('')}
        </div>

        <div style="background: #fee2e2; padding: 15px; border-radius: 8px; border-left: 4px solid #ef4444; margin: 20px 0;">
          <h3 style="color: #991b1b;">⚠️ Warning Signs to Watch For</h3>
          ${customHandout.your_warning_signs.map((sign, i) => `
            <div style="margin: 10px 0;">
              <strong>${i + 1}. ${sign.symptom}</strong><br/>
              What to do: ${sign.what_to_do}<br/>
              <span style="background: ${
                sign.urgency.includes('911') ? '#dc2626' : 
                sign.urgency.includes('today') ? '#f59e0b' : '#22c55e'
              }; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">
                ${sign.urgency}
              </span>
            </div>
          `).join('')}
        </div>

        <div style="background: #f0fdf4; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #16a34a;">Follow-Up Plan</h3>
          <p>${customHandout.follow_up_plan}</p>
        </div>

        <div style="background: #e0e7ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="color: #3730a3;"><strong>${customHandout.personalized_encouragement}</strong></p>
        </div>

        <hr style="margin: 20px 0;"/>
        <p style="color: #6b7280; font-size: 12px;">${customHandout.contact_information}</p>
      `;

      await base44.integrations.Core.SendEmail({
        to: patient.email,
        from_name: "CareMetric AI",
        subject: `Your Personalized Care Instructions - ${customHandout.handout_title}`,
        body: emailContent
      });

      alert(`Handout sent to ${patient.email}`);
    } catch (error) {
      console.error('Email error:', error);
      alert('Failed to send email. Please try again.');
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-600 text-white';
      case 'medium': return 'bg-blue-600 text-white';
      case 'low': return 'bg-gray-500 text-white';
      default: return 'bg-gray-400 text-white';
    }
  };

  const getUrgencyColor = (urgency) => {
    if (urgency?.includes('911')) return 'bg-red-600 text-white';
    if (urgency?.includes('today')) return 'bg-orange-500 text-white';
    return 'bg-green-600 text-white';
  };

  if (!patient) {
    return (
      <Alert>
        <BookOpen className="w-4 h-4" />
        <AlertDescription>Select a patient to access AI education tools</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="border-2 border-blue-300 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-6 h-6 text-blue-600" />
          AI Patient Education Assistant
        </CardTitle>
        <p className="text-sm text-gray-600 mt-2">
          Generate personalized education materials, simplified explanations, and custom handouts
        </p>
      </CardHeader>
      <CardContent className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="recommend">Recommendations</TabsTrigger>
            <TabsTrigger value="explain">Simplified Explanations</TabsTrigger>
            <TabsTrigger value="handout">Custom Handout</TabsTrigger>
          </TabsList>

          {/* Recommendations Tab */}
          <TabsContent value="recommend" className="space-y-4 mt-4">
            <div className="flex gap-2">
              <Button
                onClick={generateRecommendations}
                disabled={isGenerating}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                {isGenerating ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" /> Generate Recommendations</>
                )}
              </Button>
            </div>

            {recommendations && (
              <ScrollArea className="h-[500px] pr-4">
                <div className="space-y-4">
                  {/* Priority Topics */}
                  {recommendations.priority_education_topics?.map((topic, idx) => (
                    <Card key={idx} className="border-l-4 border-l-blue-500">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-semibold text-gray-900">{topic.topic}</h4>
                          <div className="flex gap-2">
                            <Badge className={getPriorityColor(topic.priority)}>
                              {topic.priority}
                            </Badge>
                            <Badge variant="outline">{topic.category}</Badge>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600 mb-3">{topic.rationale}</p>
                        
                        <div className="bg-blue-50 p-3 rounded mb-3">
                          <p className="text-xs font-semibold text-blue-900 mb-2">Key Points:</p>
                          <ul className="text-xs text-blue-800 space-y-1">
                            {topic.key_points.map((pt, i) => (
                              <li key={i}>• {pt}</li>
                            ))}
                          </ul>
                        </div>

                        {topic.recommended_resources?.length > 0 && (
                          <div className="bg-green-50 p-3 rounded mb-3">
                            <p className="text-xs font-semibold text-green-900 mb-2">Recommended Resources:</p>
                            <ul className="text-xs text-green-800 space-y-1">
                              {topic.recommended_resources.map((res, i) => (
                                <li key={i}>• {res}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {topic.teach_back_questions?.length > 0 && (
                          <div className="bg-purple-50 p-3 rounded">
                            <p className="text-xs font-semibold text-purple-900 mb-2">Teach-Back Questions:</p>
                            <ul className="text-xs text-purple-800 space-y-1">
                              {topic.teach_back_questions.map((q, i) => (
                                <li key={i}>{i + 1}. {q}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}

                  {/* Red Flag Symptoms */}
                  {recommendations.red_flag_symptoms?.length > 0 && (
                    <Card className="border-2 border-red-300 bg-red-50">
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2 text-red-900">
                          <AlertCircle className="w-5 h-5" />
                          Critical Warning Signs
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {recommendations.red_flag_symptoms.map((symptom, idx) => (
                          <div key={idx} className="bg-white p-3 rounded border border-red-200">
                            <div className="flex items-start justify-between mb-2">
                              <p className="font-semibold text-red-900">{symptom.symptom}</p>
                              <Badge className={getUrgencyColor(symptom.urgency)}>
                                {symptom.urgency.replace(/_/g, ' ')}
                              </Badge>
                            </div>
                            <p className="text-sm text-red-800">{symptom.action_required}</p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Family Education & Support Groups */}
                  {(recommendations.family_education_needs?.length > 0 || recommendations.recommended_support_groups?.length > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {recommendations.family_education_needs?.length > 0 && (
                        <Card className="bg-indigo-50 border-indigo-200">
                          <CardHeader>
                            <CardTitle className="text-sm">Family/Caregiver Education</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <ul className="text-xs space-y-2">
                              {recommendations.family_education_needs.map((need, i) => (
                                <li key={i} className="flex items-start gap-2">
                                  <Lightbulb className="w-3 h-3 text-indigo-600 mt-0.5 flex-shrink-0" />
                                  <span>{need}</span>
                                </li>
                              ))}
                            </ul>
                          </CardContent>
                        </Card>
                      )}

                      {recommendations.recommended_support_groups?.length > 0 && (
                        <Card className="bg-green-50 border-green-200">
                          <CardHeader>
                            <CardTitle className="text-sm">Support Groups</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <ul className="text-xs space-y-2">
                              {recommendations.recommended_support_groups.map((group, i) => (
                                <li key={i}>• {group}</li>
                              ))}
                            </ul>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          {/* Simplified Explanations Tab */}
          <TabsContent value="explain" className="space-y-4 mt-4">
            <Button
              onClick={generateSimplifiedExplanation}
              disabled={isGenerating}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {isGenerating ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
              ) : (
                <><Brain className="w-4 h-4 mr-2" /> Generate Simple Explanations</>
              )}
            </Button>

            {simplifiedExplanation && (
              <ScrollArea className="h-[500px] pr-4">
                <div className="space-y-4">
                  {/* Condition Explanations */}
                  {simplifiedExplanation.condition_explanations?.map((cond, idx) => (
                    <Card key={idx} className="border-l-4 border-l-green-500">
                      <CardContent className="p-4">
                        <h4 className="font-bold text-gray-900 mb-3">{cond.condition_name}</h4>
                        <div className="space-y-3 text-sm">
                          <div>
                            <p className="font-semibold text-green-700">What is it?</p>
                            <p className="text-gray-700">{cond.simple_explanation}</p>
                          </div>
                          {cond.analogy_or_comparison && (
                            <div className="bg-blue-50 p-3 rounded">
                              <p className="font-semibold text-blue-700">Think of it like this:</p>
                              <p className="text-blue-800 italic">{cond.analogy_or_comparison}</p>
                            </div>
                          )}
                          <div>
                            <p className="font-semibold text-purple-700">What to expect:</p>
                            <p className="text-gray-700">{cond.what_to_expect}</p>
                          </div>
                          <div className="bg-green-50 p-3 rounded">
                            <p className="font-semibold text-green-700">How you can help yourself:</p>
                            <p className="text-green-800">{cond.how_to_help_yourself}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  {/* Medication Explanations */}
                  {simplifiedExplanation.medication_explanations?.map((med, idx) => (
                    <Card key={idx} className="border-l-4 border-l-purple-500">
                      <CardContent className="p-4">
                        <h4 className="font-bold text-gray-900 mb-3">{med.medication_name}</h4>
                        <div className="space-y-3 text-sm">
                          <div>
                            <p className="font-semibold text-purple-700">What it does:</p>
                            <p className="text-gray-700">{med.what_it_does}</p>
                          </div>
                          <div>
                            <p className="font-semibold text-indigo-700">Why you take it:</p>
                            <p className="text-gray-700">{med.why_you_take_it}</p>
                          </div>
                          <div className="bg-yellow-50 p-3 rounded">
                            <p className="font-semibold text-yellow-800 mb-2">Important to remember:</p>
                            <ul className="space-y-1">
                              {med.important_reminders.map((reminder, i) => (
                                <li key={i} className="text-yellow-900 flex items-start gap-2">
                                  <CheckCircle2 className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                                  <span>{reminder}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  {/* Treatment Plan Summary */}
                  {simplifiedExplanation.treatment_plan_summary && (
                    <Card className="bg-blue-50 border-blue-300">
                      <CardContent className="p-4">
                        <h4 className="font-bold text-blue-900 mb-2">Your Treatment Plan</h4>
                        <p className="text-sm text-blue-800 whitespace-pre-wrap">
                          {simplifiedExplanation.treatment_plan_summary}
                        </p>
                      </CardContent>
                    </Card>
                  )}

                  {/* Encouraging Message */}
                  {simplifiedExplanation.encouraging_message && (
                    <Alert className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-300">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      <AlertDescription className="text-green-900">
                        {simplifiedExplanation.encouraging_message}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          {/* Custom Handout Tab */}
          <TabsContent value="handout" className="space-y-4 mt-4">
            <div className="flex gap-2">
              <Button
                onClick={generateCustomHandout}
                disabled={isGenerating || !visitNotes}
                className="flex-1 bg-purple-600 hover:bg-purple-700"
              >
                {isGenerating ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</>
                ) : (
                  <><FileText className="w-4 h-4 mr-2" /> Generate Custom Handout</>
                )}
              </Button>
            </div>

            {!visitNotes && (
              <Alert className="bg-yellow-50 border-yellow-300">
                <AlertCircle className="w-4 h-4 text-yellow-600" />
                <AlertDescription className="text-yellow-900 text-sm">
                  Visit notes required to generate personalized handout
                </AlertDescription>
              </Alert>
            )}

            {customHandout && (
              <div className="space-y-4">
                <ScrollArea className="h-[400px] pr-4">
                  <div className="space-y-4">
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                      <h3 className="font-bold text-blue-900 mb-2">{customHandout.handout_title}</h3>
                      <p className="text-sm text-blue-800">{customHandout.personalized_greeting}</p>
                    </div>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Visit Summary</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-gray-700">{customHandout.visit_summary}</p>
                      </CardContent>
                    </Card>

                    <Card className="border-l-4 border-l-blue-500">
                      <CardHeader>
                        <CardTitle className="text-base">Your Specific Instructions</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {customHandout.specific_instructions.map((inst, i) => (
                          <div key={i} className="bg-blue-50 p-3 rounded">
                            <p className="font-semibold text-blue-900">{inst.instruction_category}</p>
                            <p className="text-sm text-blue-800 mt-1">{inst.instruction}</p>
                            <p className="text-xs text-blue-600 mt-1 italic">Why: {inst.reason}</p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>

                    <Card className="border-l-4 border-l-orange-500">
                      <CardHeader>
                        <CardTitle className="text-base">Important Precautions</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {customHandout.precautions_for_you.map((prec, i) => (
                          <div key={i} className="bg-orange-50 p-3 rounded">
                            <p className="font-semibold text-orange-900">{prec.precaution}</p>
                            <p className="text-sm text-orange-800 mt-1">{prec.why_important}</p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>

                    <Card className="border-l-4 border-l-red-500 bg-red-50">
                      <CardHeader>
                        <CardTitle className="text-base text-red-900">⚠️ Warning Signs</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {customHandout.your_warning_signs.map((sign, i) => (
                          <div key={i} className="bg-white p-3 rounded border border-red-200">
                            <p className="font-semibold text-red-900">{sign.symptom}</p>
                            <p className="text-sm text-red-700 mt-1">{sign.what_to_do}</p>
                            <Badge className={`${getUrgencyColor(sign.urgency)} mt-2`}>
                              {sign.urgency.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                        ))}
                      </CardContent>
                    </Card>

                    <Card className="bg-green-50 border-green-200">
                      <CardHeader>
                        <CardTitle className="text-base text-green-900">Follow-Up Plan</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-green-800">{customHandout.follow_up_plan}</p>
                      </CardContent>
                    </Card>

                    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 p-4 rounded-lg border border-indigo-200">
                      <p className="text-sm text-indigo-900 font-semibold">{customHandout.personalized_encouragement}</p>
                    </div>
                  </div>
                </ScrollArea>

                <div className="flex gap-2 pt-4 border-t">
                  <Button
                    onClick={downloadHandout}
                    variant="outline"
                    className="flex-1"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                  {patient.email && (
                    <Button
                      onClick={sendHandoutEmail}
                      variant="outline"
                      className="flex-1"
                    >
                      <Mail className="w-4 h-4 mr-2" />
                      Email
                    </Button>
                  )}
                  <Button
                    onClick={() => copyToClipboard(JSON.stringify(customHandout, null, 2))}
                    variant="outline"
                  >
                    {copied ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
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