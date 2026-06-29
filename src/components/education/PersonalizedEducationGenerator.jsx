import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sparkles,
  Download,
  Mail,
  Loader2,
  Copy,
  CheckCircle2,
  BookOpen,
  Heart
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from 'sonner';

export default function PersonalizedEducationGenerator({ patient, carePlans = [], recentVisits = [] }) {
  const ai = useAICall();
  const [educationMaterial, setEducationMaterial] = useState(null);
  const [readingLevel, setReadingLevel] = useState("6th-grade");
  const [language, _setLanguage] = useState("English");
  const [format, setFormat] = useState("comprehensive");
  const [copied, setCopied] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const generateMaterial = async () => {
    if (!patient) return;

    try {
      const activePlans = carePlans.filter(cp => cp.status === 'active');
      const latestVisit = recentVisits[0];

      const result = await ai.run({
        model: "claude_sonnet_4_6",
        prompt: `You are a patient education specialist creating easy-to-understand health information for home health patients.

PATIENT INFORMATION:
Name: ${patient.first_name} ${patient.last_name}
Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
Current Medications: ${patient.current_medications?.map(m => m.name).join(', ') || 'Not documented'}
Allergies: ${patient.allergies || 'None documented'}
Cognitive Status: ${patient.functional_status?.cognitive_status || 'Not assessed'}
Primary Language: ${patient.social_history?.primary_language || 'English'}
Living Situation: ${patient.social_history?.living_situation || 'Not specified'}

ACTIVE CARE PLAN GOALS:
${activePlans.map(cp => `• ${cp.problem}: ${cp.goal}`).join('\n') || 'No active care plans'}

RECENT VISIT NOTES (for context):
${latestVisit?.nurse_notes?.substring(0, 500) || 'No recent visit notes'}...

EDUCATION REQUIREMENTS:
- Reading Level: ${readingLevel}
- Language: ${language}
- Format: ${format}
- Cognitive Adaptation: ${patient.functional_status?.cognitive_status === 'moderate_impairment' || patient.functional_status?.cognitive_status === 'severe_impairment' ? 'Use very simple language, large text recommendations, visual cues' : 'Standard'}

CREATE PERSONALIZED EDUCATION MATERIAL:

1. **Your Health Conditions**
   - Explain each diagnosis in simple terms
   - Why you're getting home health care
   - What to expect during recovery

2. **Your Medications**
   - List current medications with:
     * What it's for (in simple words)
     * When to take it
     * Important side effects to know
     * What to avoid (food/activities)
   - Include any allergies: ${patient.allergies || 'None'}

3. **Your Daily Care Plan**
   - What your nurse will help you with
   - Your care goals in simple language:
     ${activePlans.map(cp => `* ${cp.goal}`).join('\n')}
   - How you can help yourself get better

4. **What You Can Do at Home**
   - Daily self-care activities
   - Exercises or activities (if any)
   - Diet recommendations
   - Safety tips specific to your conditions

5. **Warning Signs - When to Call for Help**
   - Symptoms that mean call 911 immediately
   - Symptoms that mean call your nurse today
   - Symptoms that can wait until next visit
   - Make these VERY clear with simple language

6. **Your Healthcare Team**
   - Who's who on your care team
   - How to reach them
   - What each person does

7. **Questions You Might Have**
   - Common questions about your conditions
   - Simple answers
   - Encouragement to ask questions

8. **Next Steps**
   - What to expect in the coming weeks
   - Follow-up appointments
   - Goals to work toward

PERSONALIZATION NOTES:
${patient.functional_status?.cognitive_status === 'moderate_impairment' || patient.functional_status?.cognitive_status === 'severe_impairment' ? '- Use EXTRA simple language, repeat key points, use visual markers' : ''}
${patient.social_history?.living_situation === 'alone' ? '- Emphasize safety and when to call for help since patient lives alone' : ''}
${patient.social_history?.interpreter_needed ? `- Note: Interpreter needed for ${patient.social_history.primary_language}` : ''}

FORMAT:
- Use bullet points and numbered lists
- Bold important warnings
- Use ✓ for things to do
- Use ✗ for things to avoid
- Keep sentences short and clear
- Avoid medical jargon or explain it simply
- Be encouraging and supportive

Return JSON with the complete material:`,
        response_json_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            introduction: { type: "string" },
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  section_title: { type: "string" },
                  content: { type: "string" },
                  key_points: { type: "array", items: { type: "string" } }
                }
              }
            },
            emergency_contacts: { type: "string" },
            summary: { type: "string" },
            teach_back_questions: {
              type: "array",
              items: { type: "string" },
              description: "Questions to verify patient understanding"
            }
          }
        }
      });

      setEducationMaterial(result);
    } catch (error) {
      console.error("Education generation error:", error);
    }
  };

  const copyToClipboard = () => {
    if (!educationMaterial) return;
    
    const fullText = `${educationMaterial.title}\n\n${educationMaterial.introduction}\n\n` +
      (educationMaterial.sections || []).map(s => `${s.section_title}\n${s.content}\n`).join('\n') +
      `\n${educationMaterial.summary}`;
    
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sendToPatient = async () => {
    if (!educationMaterial || !patient.email) return;

    setIsSending(true);
    try {
      const fullText = `${educationMaterial.title}\n\n${educationMaterial.introduction}\n\n` +
        (educationMaterial.sections || []).map(s => `${s.section_title}\n${s.content}\n`).join('\n') +
        `\n${educationMaterial.summary}`;

      await base44.integrations.Core.SendEmail({
        to: patient.email,
        from_name: "Penn Sync Care Team",
        subject: `Your Personal Health Education Guide - ${educationMaterial.title}`,
        body: fullText
      });

      toast.success(`Education material sent to ${patient.email}`);
    } catch (error) {
      console.error("Email error:", error);
      toast.error("Failed to send email. Please try again.");
    }
    setIsSending(false);
  };

  return (
    <div className="space-y-4">
      <Card className="border-2 border-navy-300">
        <CardHeader className="bg-gradient-to-r from-navy-50 to-gold-50">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-navy-600" />
            AI Personalized Education Generator
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription className="text-xs text-blue-900">
              Generates personalized education materials based on {patient.first_name}'s diagnosis, medications, care plan goals, and cognitive status.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Reading Level</Label>
              <Select value={readingLevel} onValueChange={setReadingLevel}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5th-grade">5th Grade (Very Simple)</SelectItem>
                  <SelectItem value="6th-grade">6th Grade (Simple)</SelectItem>
                  <SelectItem value="8th-grade">8th Grade (Standard)</SelectItem>
                  <SelectItem value="high-school">High School</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Format</Label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="comprehensive">Comprehensive Guide</SelectItem>
                  <SelectItem value="quick_reference">Quick Reference</SelectItem>
                  <SelectItem value="caregiver_focused">For Caregivers</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {patient.functional_status?.cognitive_status && (
            <div className="bg-yellow-50 p-2 rounded border border-yellow-200">
              <p className="text-xs text-yellow-900">
                <strong>Cognitive Status:</strong> {patient.functional_status.cognitive_status} - Material will be adapted accordingly
              </p>
            </div>
          )}

          <Button
            onClick={generateMaterial}
            disabled={ai.loading}
            className="w-full bg-navy-600 hover:bg-navy-700"
          >
            {ai.loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Personalized Material...</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-2" /> Generate Education Material</>
            )}
          </Button>
        </CardContent>
      </Card>

      {educationMaterial && (
        <>
          <Card className="border-2 border-green-200">
            <CardHeader className="bg-green-50">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-green-600" />
                  {educationMaterial.title}
                </CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={copyToClipboard}>
                    {copied ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </Button>
                  {patient.email && (
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={sendToPatient}
                      disabled={isSending}
                    >
                      {isSending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Mail className="w-4 h-4" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <ScrollArea className="h-[600px] pr-4">
                <div className="space-y-4">
                  {/* Introduction */}
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                    <p className="text-sm text-blue-900 leading-relaxed">
                      {educationMaterial.introduction}
                    </p>
                  </div>

                  {/* Sections */}
                  {educationMaterial.sections?.map((section, idx) => (
                    <div key={idx} className="bg-white p-4 rounded-lg border-2 border-slate-200">
                      <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                        <span className="bg-navy-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-sm">
                          {idx + 1}
                        </span>
                        {section.section_title}
                      </h3>
                      <div className="prose prose-sm max-w-none">
                        <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">
                          {section.content}
                        </p>
                      </div>
                      {section.key_points?.length > 0 && (
                        <div className="mt-3 bg-navy-50 p-3 rounded border border-navy-200">
                          <p className="text-xs font-semibold text-navy-800 mb-2">Key Points:</p>
                          <ul className="space-y-1">
                            {section.key_points.map((point, i) => (
                              <li key={i} className="text-xs text-navy-900 flex items-start gap-2">
                                <CheckCircle2 className="w-3 h-3 text-navy-600 mt-0.5 flex-shrink-0" />
                                <span>{point}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Emergency Contacts */}
                  {educationMaterial.emergency_contacts && (
                    <div className="bg-red-50 p-4 rounded-lg border-2 border-red-300">
                      <h3 className="font-bold text-red-900 mb-2 flex items-center gap-2">
                        <Heart className="w-4 h-4" />
                        Emergency Contacts
                      </h3>
                      <p className="text-sm text-red-800 whitespace-pre-wrap">
                        {educationMaterial.emergency_contacts}
                      </p>
                    </div>
                  )}

                  {/* Summary */}
                  {educationMaterial.summary && (
                    <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-4 rounded-lg border-2 border-green-300">
                      <h3 className="font-bold text-green-900 mb-2">Remember:</h3>
                      <p className="text-sm text-green-800 leading-relaxed">
                        {educationMaterial.summary}
                      </p>
                    </div>
                  )}

                  {/* Teach-Back Questions */}
                  {educationMaterial.teach_back_questions?.length > 0 && (
                    <div className="bg-indigo-50 p-4 rounded-lg border-2 border-indigo-200">
                      <h3 className="font-bold text-indigo-900 mb-2">
                        Questions to Check Understanding:
                      </h3>
                      <p className="text-xs text-indigo-700 mb-2 italic">
                        Ask the patient/caregiver these questions to ensure they understand:
                      </p>
                      <ul className="space-y-2">
                        {educationMaterial.teach_back_questions.map((q, i) => (
                          <li key={i} className="text-sm text-indigo-900">
                            {i + 1}. {q}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="flex gap-2 mt-4 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={copyToClipboard}
                  className="flex-1"
                >
                  {copied ? (
                    <><CheckCircle2 className="w-4 h-4 mr-2 text-green-600" /> Copied!</>
                  ) : (
                    <><Copy className="w-4 h-4 mr-2" /> Copy All</>
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => window.print()}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Print
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}