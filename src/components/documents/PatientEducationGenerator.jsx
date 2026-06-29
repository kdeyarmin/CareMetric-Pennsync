import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GraduationCap, Sparkles } from "lucide-react";
import SmartNotesContextPanel from "./SmartNotesContextPanel";
import DocumentDraftManager from "./DocumentDraftManager";

export default function PatientEducationGenerator({ patientId, patient }) {
  const [topic, setTopic] = useState("");
  const [readingLevel, setReadingLevel] = useState("6th-grade");
  const [includeImages, setIncludeImages] = useState(false);
  const [generatedMaterial, setGeneratedMaterial] = useState("");
  const ai = useAICall();
  const [additionalContext, setAdditionalContext] = useState("");

  const generateEducationMaterial = async () => {
    try {
      const result = await ai.run({
        model: "claude_sonnet_4_6",
        prompt: `Generate patient education material tailored for home health patients.

PATIENT CONTEXT:
Name: ${patient.first_name} ${patient.last_name}
Primary Diagnosis: ${patient.primary_diagnosis || 'General home health'}
Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
Cognitive Status: ${patient.functional_status?.cognitive_status || 'Not assessed'}
Primary Language: ${patient.social_history?.primary_language || 'English'}

EDUCATION TOPIC: ${topic || patient.primary_diagnosis || 'General Home Health Care'}

ADDITIONAL CONTEXT FROM SMART NOTES:
${additionalContext || 'None provided'}

REQUIREMENTS:
- Reading Level: ${readingLevel}
- Language: Simple, easy to understand
- Cultural Sensitivity: Yes
- Include practical examples: Yes
${includeImages ? '- Include image descriptions where helpful' : ''}

Generate comprehensive patient education material with:

1. TITLE (Clear and descriptive)

2. WHAT YOU NEED TO KNOW
   - Simple explanation of the condition/topic
   - Why this is important for you

3. SIGNS AND SYMPTOMS TO WATCH FOR
   - What's normal
   - What's concerning
   - When to call your nurse or doctor

4. DAILY CARE INSTRUCTIONS
   - Step-by-step what to do
   - How often to do it
   - Tips to make it easier

5. MEDICATIONS (if applicable)
   - Why you're taking them
   - How to take them correctly
   - Side effects to watch for

6. LIFESTYLE TIPS
   - Diet recommendations
   - Activity guidelines
   - Things to avoid

7. WHEN TO GET HELP
   - Warning signs (RED FLAGS in bold)
   - Emergency situations
   - Non-emergency concerns

8. QUESTIONS TO ASK YOUR HEALTHCARE TEAM
   - Important questions to remember

9. RESOURCES
   - Who to call for help
   - Support groups or additional information

FORMAT REQUIREMENTS:
- Use bullet points and short paragraphs
- Bold important information
- Use simple words (avoid medical jargon, or explain it simply)
- Include specific examples
- Add "✓" for do's and "✗" for don'ts
- Make it actionable and practical

Keep language at ${readingLevel} reading level. Be encouraging and supportive in tone.`,
        response_json_schema: {
          type: "object",
          properties: {
            material: { type: "string" }
          }
        }
      });

      setGeneratedMaterial(result.material);
    } catch (error) {
      console.error("Error generating education material:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <SmartNotesContextPanel
          patientId={patientId}
          onInsertSnippet={(text) => setAdditionalContext(prev => prev ? prev + '\n\n' + text : text)}
        />
      </div>

      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-navy-600" />
              Patient Education Material Generator
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Education Topic</Label>
              <Textarea 
                placeholder={`e.g., "Managing CHF at home", "Wound care instructions", "Diabetes management"...`}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                rows={2}
              />
              {!topic && patient.primary_diagnosis && (
                <p className="text-sm text-slate-500 mt-1">
                  Default: {patient.primary_diagnosis}
                </p>
              )}
            </div>

            <div>
              <Label>Reading Level</Label>
              <select 
                className="w-full h-10 px-3 border border-slate-300 rounded-md"
                value={readingLevel}
                onChange={(e) => setReadingLevel(e.target.value)}
              >
                <option value="5th-grade">5th Grade (Very Simple)</option>
                <option value="6th-grade">6th Grade (Simple)</option>
                <option value="8th-grade">8th Grade (Standard)</option>
                <option value="high-school">High School</option>
              </select>
            </div>

            {additionalContext && (
              <div>
                <Label>Context from Smart Notes</Label>
                <div className="bg-navy-50 p-3 rounded-lg border border-navy-200 text-sm">
                  <p className="text-slate-700 whitespace-pre-wrap">{additionalContext}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setAdditionalContext("")}
                    className="mt-2 text-xs text-navy-600"
                  >
                    Clear Context
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input 
                type="checkbox" 
                id="includeImages"
                checked={includeImages}
                onChange={(e) => setIncludeImages(e.target.checked)}
                className="w-4 h-4"
              />
              <Label htmlFor="includeImages" className="cursor-pointer">
                Include image descriptions
              </Label>
            </div>

            <div className="bg-navy-50 p-4 rounded-lg border border-navy-200">
              <p className="text-sm text-navy-900">
                <strong>Tailored for:</strong> {patient.first_name} {patient.last_name}
                {patient.functional_status?.cognitive_status && (
                  <> • Cognitive Status: {patient.functional_status.cognitive_status}</>
                )}
              </p>
            </div>

            <Button 
              onClick={generateEducationMaterial} 
              disabled={ai.loading}
              className="w-full bg-navy-600 hover:bg-navy-700"
            >
              {ai.loading ? (
                <><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" /> Generating...</>
              ) : (
                <><Sparkles className="w-5 h-5 mr-2" /> Generate Education Material</>
              )}
            </Button>
          </CardContent>
        </Card>

        {generatedMaterial && (
          <DocumentDraftManager
            generatedContent={generatedMaterial}
            documentType="Patient_Education"
            patientName={`${patient.first_name}_${patient.last_name}`}
            onContentChange={(content) => setGeneratedMaterial(content)}
          />
        )}
      </div>
    </div>
  );
}