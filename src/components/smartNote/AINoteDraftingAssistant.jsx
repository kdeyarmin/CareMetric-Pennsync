import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Bot,
  Stethoscope,
  Activity,
  BookOpen,
  Loader2,
  Copy,
  CheckCircle2,
  Plus,
  Sparkles,
  MessageSquare,
  ChevronDown
} from "lucide-react";
import { logActivity, ActivityActions } from "../utils/activityLogger";
import AISuggestionFeedback from "../feedback/AISuggestionFeedback";
import { invokeGemini } from "../utils/geminiHelper";

export default function AINoteDraftingAssistant({
  vitalSigns,
  diagnosis,
  patientContext,
  symptoms,
  onInsertText,
  patientId,
  previousVisits,
  patientData
}) {
  const [activeTab, setActiveTab] = useState("assessment");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState({
    assessment: "",
    interventions: "",
    patientResponse: ""
  });
  const [customPrompt, setCustomPrompt] = useState("");
  const [copied, setCopied] = useState(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  React.useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const generateAssessment = async () => {
    setIsGenerating(true);
    try {
      // Build comprehensive patient history context
      const previousVisitsContext = previousVisits?.slice(0, 3).map((v, idx) => 
        `Visit ${idx + 1} (${v.visit_date}): ${v.nurse_notes?.substring(0, 200) || 'No notes'}`
      ).join('\n') || 'No previous visits';

      const vitalsTrend = previousVisits?.length > 0 && previousVisits[0].vital_signs ? 
        `Previous Vitals: BP ${previousVisits[0].vital_signs?.blood_pressure_systolic}/${previousVisits[0].vital_signs?.blood_pressure_diastolic}, HR ${previousVisits[0].vital_signs?.heart_rate}, O2 ${previousVisits[0].vital_signs?.oxygen_saturation}%` : 
        'No previous vitals on record';

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate objective assessment findings for a home health nursing visit note.

CURRENT VITAL SIGNS:
${vitalSigns?.bp ? `- Blood Pressure: ${vitalSigns.bp}` : ''}
${vitalSigns?.hr ? `- Heart Rate: ${vitalSigns.hr} bpm` : ''}
${vitalSigns?.temp ? `- Temperature: ${vitalSigns.temp}°F` : ''}
${vitalSigns?.o2 ? `- Oxygen Saturation: ${vitalSigns.o2}%${vitalSigns.o2Source === 'on_oxygen' ? ' on supplemental oxygen' : ' on room air'}` : ''}
${vitalSigns?.pain ? `- Pain Level: ${vitalSigns.pain}/10` : ''}
${vitalSigns?.weight ? `- Weight: ${vitalSigns.weight} lbs` : ''}

PREVIOUS VITALS FOR COMPARISON:
${vitalsTrend}

CURRENT DIAGNOSIS: ${diagnosis || 'Not specified'}

PATIENT INFORMATION:
${patientData ? `- Name: ${patientData.first_name} ${patientData.last_name}
- Age/DOB: ${patientData.date_of_birth || 'Not specified'}
- Primary Diagnosis: ${patientData.primary_diagnosis || diagnosis}
- Secondary Diagnoses: ${patientData.secondary_diagnoses?.join(', ') || 'None documented'}
- Allergies: ${patientData.allergies || 'NKDA'}
- Current Status: ${patientData.status}` : patientContext || 'Home health patient'}

RECENT VISIT HISTORY (Last 3 Visits):
${previousVisitsContext}

CURRENT OBSERVATIONS/SYMPTOMS:
${symptoms || 'Standard assessment performed'}

Based on the complete patient history and current findings, write professional, objective clinical assessment findings in narrative format. 

REQUIREMENTS:
1. Compare current vitals to previous visit trends - note any significant changes or concerning trends
2. Reference relevant aspects of patient's medical history and secondary diagnoses
3. Include general appearance and mental status
4. Provide clinical interpretation of vital signs (note if stable, improved, or worsened from last visit)
5. System-specific assessments relevant to ALL diagnoses (primary + secondary)
6. Functional status observations compared to baseline
7. Safety assessment of home environment
8. Note any reported symptoms or changes since last visit

Use proper medical terminology. Be thorough and context-aware, incorporating patient history to show continuity of care.`,
        response_json_schema: {
          type: "object",
          properties: {
            assessment: { type: "string" }
          }
        }
      });
      setGeneratedContent(prev => ({ ...prev, assessment: result.assessment }));

      // Log AI generation
      logActivity(ActivityActions.NOTE_AI_GENERATED, {
        content_type: 'assessment',
        diagnosis: diagnosis,
        page: 'SmartNoteAssistant'
      });
    } catch (error) {
      console.error("Error generating assessment:", error);
    }
    setIsGenerating(false);
  };

  const generateInterventions = async () => {
    setIsGenerating(true);
    try {
      const previousInterventionsContext = previousVisits?.length > 0 ?
        previousVisits.map(v => {
          const noteMatch = v.nurse_notes?.match(/intervention|skilled|teaching|education|assess|monitor/gi);
          return noteMatch ? `Previous visit: ${v.nurse_notes.substring(0, 300)}` : null;
        }).filter(Boolean).join('\n') :
        'No previous intervention history';

      const result = await invokeGemini({
        prompt: `Generate appropriate skilled nursing interventions for a home health visit note.

CURRENT DIAGNOSIS: ${diagnosis || 'Not specified'}
CURRENT SYMPTOMS/OBSERVATIONS: ${symptoms || 'Standard assessment'}

PATIENT INFORMATION:
${patientData ? `- Name: ${patientData.first_name} ${patientData.last_name}
- Primary Diagnosis: ${patientData.primary_diagnosis}
- Secondary Diagnoses: ${patientData.secondary_diagnoses?.join(', ') || 'None'}
- Allergies: ${patientData.allergies || 'NKDA'}` : patientContext || 'Home health patient'}

CURRENT VITAL SIGNS:
${vitalSigns?.bp ? `- Blood Pressure: ${vitalSigns.bp}` : ''}
${vitalSigns?.hr ? `- Heart Rate: ${vitalSigns.hr} bpm` : ''}
${vitalSigns?.temp ? `- Temperature: ${vitalSigns.temp}°F` : ''}
${vitalSigns?.o2 ? `- Oxygen Saturation: ${vitalSigns.o2}%` : ''}
${vitalSigns?.pain ? `- Pain Level: ${vitalSigns.pain}/10` : ''}

PREVIOUS INTERVENTIONS PATTERN (Last 3 Visits):
${previousInterventionsContext}

Generate skilled nursing interventions that:
1. Build upon and reference previous interventions (show continuity of care)
2. Address the primary AND relevant secondary diagnoses
3. Are Medicare-compliant (require RN skill, knowledge, and clinical judgment)
4. Include specific actions taken during THIS visit
5. Document disease-specific monitoring and assessment
6. Include medication review/management if applicable
7. Document patient/caregiver teaching specific to conditions
8. Note wound care specifics if applicable
9. Document coordination with physician or other team members
10. Reference progress toward care plan goals if improvements noted

Be specific about skilled interventions performed. Show clinical expertise and judgment. Format as a detailed narrative paragraph suitable for Medicare reimbursement.`,
        response_json_schema: {
          type: "object",
          properties: {
            interventions: { type: "string" }
          }
        }
      });
      setGeneratedContent(prev => ({ ...prev, interventions: result.interventions }));
    } catch (error) {
      console.error("Error generating interventions:", error);
    }
    setIsGenerating(false);
  };

  const generatePatientResponse = async () => {
    setIsGenerating(true);
    try {
      const previousResponseContext = previousVisits?.length > 0 ?
        `Previous patient response patterns: ${previousVisits[0]?.nurse_notes?.match(/patient (verbalized|demonstrated|states|reports|tolerated).{0,100}/gi)?.join('; ') || 'No previous response documentation'}` :
        'First visit - no previous response data';

      const result = await invokeGemini({
        prompt: `Generate patient response and education documentation for a home health nursing note.

CURRENT DIAGNOSIS: ${diagnosis || 'Not specified'}

PATIENT INFORMATION:
${patientData ? `- Name: ${patientData.first_name} ${patientData.last_name}
- Primary Diagnosis: ${patientData.primary_diagnosis}
- Allergies: ${patientData.allergies || 'NKDA'}
- Caregiver: ${patientData.caregiver_name || 'None identified'}` : patientContext || 'Home health patient'}

PREVIOUS PATIENT RESPONSE PATTERNS:
${previousResponseContext}

CURRENT OBSERVATIONS:
${symptoms || 'Standard visit completed'}

Generate comprehensive documentation that includes:

1. PATIENT RESPONSE TO INTERVENTIONS:
   - How patient tolerated procedures/care TODAY
   - Patient's reported symptoms/comfort level compared to previous visit
   - Specific changes from last documented visit (improvements or declines)
   - Response to any medication changes
   - Pain management effectiveness if applicable

2. PATIENT/CAREGIVER EDUCATION PROVIDED:
   - Specific topics taught during THIS visit
   - Disease-specific education (tailored to primary + secondary diagnoses)
   - Medication education if changes occurred
   - Safety teaching provided
   - Teaching methods used (demonstration, verbal instruction, written materials)
   - Caregiver involvement if applicable

3. COMPREHENSION & TEACH-BACK DOCUMENTATION:
   - Evidence of patient understanding using teach-back method
   - Specific examples: "Patient able to verbalize/demonstrate..."
   - Ability to demonstrate skills (medication administration, glucose monitoring, etc.)
   - Areas requiring reinforcement or follow-up teaching
   - Caregiver's understanding and ability to assist

4. PATIENT ENGAGEMENT & GOALS:
   - Patient's engagement with care plan
   - Progress toward documented care plan goals
   - Patient's stated concerns or questions
   - Motivational level and barriers to care

Format as detailed narrative paragraphs suitable for Medicare-compliant clinical documentation. Include SPECIFIC teach-back examples showing patient comprehension.`,
        response_json_schema: {
          type: "object",
          properties: {
            patientResponse: { type: "string" }
          }
        }
      });
      setGeneratedContent(prev => ({ ...prev, patientResponse: result.patientResponse }));
    } catch (error) {
      console.error("Error generating patient response:", error);
    }
    setIsGenerating(false);
  };

  const generateCustom = async () => {
    if (!customPrompt.trim()) return;
    setIsGenerating(true);
    try {
      const previousNotesContext = previousVisits?.slice(0, 2).map((v, idx) => 
        `Visit ${idx + 1} (${v.visit_date}): ${v.nurse_notes?.substring(0, 250) || 'No notes'}`
      ).join('\n\n') || 'No previous visits';

      const result = await invokeGemini({
        prompt: `You are a clinical documentation assistant for home health nursing with access to complete patient history.

CURRENT PATIENT CONTEXT:
- Diagnosis: ${diagnosis || 'Not specified'}
- Patient: ${patientContext || 'Home health patient'}
- Current Vitals: ${JSON.stringify(vitalSigns || {})}

PATIENT MEDICAL HISTORY:
${patientData ? `- Primary Diagnosis: ${patientData.primary_diagnosis}
- Secondary Diagnoses: ${patientData.secondary_diagnoses?.join(', ') || 'None'}
- Allergies: ${patientData.allergies || 'NKDA'}
- Address: ${patientData.address || 'Not specified'}
- Phone: ${patientData.phone || 'Not specified'}` : 'Limited patient data available'}

PREVIOUS VISIT NOTES (Last 2 Visits):
${previousNotesContext}

USER REQUEST: ${customPrompt}

Generate professional, Medicare-compliant clinical documentation based on the request. Use proper medical terminology and be specific. Reference patient history when relevant to show continuity of care and clinical expertise.`,
        response_json_schema: {
          type: "object",
          properties: {
            content: { type: "string" }
          }
        }
      });
      setGeneratedContent(prev => ({ ...prev, custom: result.content }));
      setActiveTab("custom");
    } catch (error) {
      console.error("Error generating custom content:", error);
    }
    setIsGenerating(false);
  };

  const handleCopy = (type) => {
    const content = generatedContent[type];
    if (content) {
      navigator.clipboard.writeText(content);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  const handleInsert = async (type) => {
    const content = generatedContent[type];
    if (content && onInsertText) {
      onInsertText(content);
      
      // Track AI suggestion usage
      const user = await base44.auth.me();
      if (user?.email) {
        const categoryMap = {
          'assessment': 'clinical',
          'interventions': 'clinical',
          'patientResponse': 'communication',
          'custom': 'documentation'
        };
        
        const { trackAISuggestion } = await import("../training/SuggestionTracker");
        trackAISuggestion({
          nurseEmail: user.email,
          suggestionType: categoryMap[type] || 'clinical',
          suggestionText: `Generated ${type} section using AI`,
          context: content.substring(0, 200),
          source: 'ai_drafting_assistant',
          patientId: patientId
        });
      }
    }
  };

  const ContentDisplay = ({ type, title, icon: Icon, onGenerate }) => (
    <div className="space-y-3">
      {!generatedContent[type] ? (
        <div className="text-center py-6">
          <Icon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500 mb-3">Generate {title.toLowerCase()} based on patient data</p>
          <Button onClick={onGenerate} disabled={isGenerating} className="bg-indigo-600 hover:bg-indigo-700">
            {isGenerating ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-2" /> Generate {title}</>
            )}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="bg-white border rounded-lg p-3">
            <p className="text-sm whitespace-pre-wrap">{generatedContent[type]}</p>
          </div>
          
          <AISuggestionFeedback
            suggestionType="note_enhancement"
            suggestionContent={generatedContent[type]}
            userAction="accepted"
            contextData={{
              patient_id: patientId,
              section_type: type,
              diagnosis: diagnosis,
              visit_type: 'smart_note'
            }}
            compact={true}
          />

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleCopy(type)}
            >
              {copied === type ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
              {copied === type ? 'Copied' : 'Copy'}
            </Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              onClick={() => handleInsert(type)}
            >
              <Plus className="w-3 h-3 mr-1" /> Insert into Note
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onGenerate}
              disabled={isGenerating}
            >
              <Sparkles className="w-3 h-3 mr-1" /> Regenerate
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <Card className="border-2 border-purple-200">
      <CardHeader className="py-3 bg-gradient-to-r from-purple-50 to-indigo-50">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bot className="w-4 h-4 text-purple-600" />
          AI Note Drafting Assistant
          <Badge variant="outline" className="text-xs ml-auto">Beta</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex flex-wrap gap-1 mb-3 h-auto w-full">
            <TabsTrigger value="assessment" className="text-xs px-2 py-1.5 flex-1 min-w-0">
              <Stethoscope className="w-3 h-3 flex-shrink-0" />
            </TabsTrigger>
            <TabsTrigger value="interventions" className="text-xs px-2 py-1.5 flex-1 min-w-0">
              <Activity className="w-3 h-3 flex-shrink-0" />
            </TabsTrigger>
            <TabsTrigger value="patientResponse" className="text-xs px-2 py-1.5 flex-1 min-w-0">
              <BookOpen className="w-3 h-3 flex-shrink-0" />
            </TabsTrigger>
            <TabsTrigger value="custom" className="text-xs px-2 py-1.5 flex-1 min-w-0">
              <MessageSquare className="w-3 h-3 flex-shrink-0" />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="assessment">
            <ContentDisplay
              type="assessment"
              title="Assessment"
              icon={Stethoscope}
              onGenerate={generateAssessment}
            />
          </TabsContent>

          <TabsContent value="interventions">
            <ContentDisplay
              type="interventions"
              title="Interventions"
              icon={Activity}
              onGenerate={generateInterventions}
            />
          </TabsContent>

          <TabsContent value="patientResponse">
            <ContentDisplay
              type="patientResponse"
              title="Patient Response"
              icon={BookOpen}
              onGenerate={generatePatientResponse}
            />
          </TabsContent>

          <TabsContent value="custom">
            <div className="space-y-3">
              <Textarea
                placeholder="Ask the AI to help with any part of your note... e.g., 'Write a wound assessment for a stage 2 pressure ulcer on the sacrum'"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={3}
                className="text-sm"
              />
              <Button
                onClick={generateCustom}
                disabled={isGenerating || !customPrompt.trim()}
                className="w-full bg-purple-600 hover:bg-purple-700"
              >
                {isGenerating ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" /> Generate Custom Content</>
                )}
              </Button>
              
              {generatedContent.custom && (
                <div className="space-y-2">
                  <div className="bg-white border rounded-lg p-3">
                    <p className="text-sm whitespace-pre-wrap">{generatedContent.custom}</p>
                  </div>

                  <AISuggestionFeedback
                    suggestionType="note_enhancement"
                    suggestionContent={generatedContent.custom}
                    userAction="accepted"
                    contextData={{
                      patient_id: patientId,
                      section_type: 'custom',
                      custom_prompt: customPrompt,
                      diagnosis: diagnosis
                    }}
                    compact={true}
                  />

                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleCopy('custom')}>
                      {copied === 'custom' ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                      Copy
                    </Button>
                    <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleInsert('custom')}>
                      <Plus className="w-3 h-3 mr-1" /> Insert
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Quick Actions */}
        <div className="mt-3 pt-3 border-t">
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="w-full justify-between">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Quick Generate
                </span>
                <ChevronDown className="w-3 h-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2">
              <div className="space-y-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => { setCustomPrompt("Write homebound status justification"); generateCustom(); setPopoverOpen(false); }}
                >
                  Homebound Status
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => { setCustomPrompt("Write skilled need justification for RN visit"); generateCustom(); setPopoverOpen(false); }}
                >
                  Skilled Need Justification
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => { setCustomPrompt("Write medication reconciliation findings"); generateCustom(); setPopoverOpen(false); }}
                >
                  Medication Reconciliation
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => { setCustomPrompt("Write care coordination notes"); generateCustom(); setPopoverOpen(false); }}
                >
                  Care Coordination
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => { setCustomPrompt("Write safety assessment of home environment"); generateCustom(); setPopoverOpen(false); }}
                >
                  Safety Assessment
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </CardContent>
    </Card>
  );
}