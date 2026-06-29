import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Copy, CheckCircle2, Edit3, Save, Eye } from "lucide-react";
import AIFieldIndicator from "@/components/ui/ai-field-indicator";
import ProgressFeedback from "@/components/ui/progress-feedback";
import RealTimeDocumentationReviewer from "../documentation/RealTimeDocumentationReviewer";
import { toast } from 'sonner';

export default function AIAdmissionNoteGenerator({ referralData, onNoteGenerated, autoGenerate = false }) {
  const ai = useAICall();
  const [generatedNote, setGeneratedNote] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editedNote, setEditedNote] = useState("");
  const [generationStage, setGenerationStage] = useState(0);
  const [showReviewer, setShowReviewer] = useState(false);
  const progressIntervalRef = useRef(null);
  // Monotonic id so a slower, older generation (e.g. an earlier Regenerate click)
  // can't overwrite the result of a newer one.
  const generateReqIdRef = useRef(0);

  // Clear the progress interval if the component unmounts mid-generation so it
  // doesn't keep firing setState on an unmounted component.
  useEffect(() => () => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
  }, []);

  const generationStages = useMemo(() => [
    "Analyzing patient demographics and history...",
    "Structuring assessment findings...",
    "Formulating clinical impressions...",
    "Generating plan of care...",
    "Finalizing admission note..."
  ], []);

  const generateAdmissionNote = useCallback(async () => {
    if (!referralData) {
      toast.error("No referral data available");
      return;
    }

    setGenerationStage(0);
    const myReqId = ++generateReqIdRef.current;

    const progressInterval = setInterval(() => {
      setGenerationStage(prev => Math.min(prev + 1, generationStages.length - 1));
    }, 2500);
    progressIntervalRef.current = progressInterval;

    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert home health nurse with 20+ years of experience writing comprehensive, Medicare-compliant admission notes.

Using the extracted referral data below, generate a complete, professional admission nursing assessment note that is ready for clinical documentation.

REFERRAL DATA:
${JSON.stringify(referralData, null, 2)}

CRITICAL REQUIREMENTS FOR ADMISSION NOTE:

**STRUCTURE:**
Use standard SOAP format with the following sections:
1. SUBJECTIVE
2. OBJECTIVE (with subsections)
3. ASSESSMENT
4. PLAN

**SUBJECTIVE:**
- Patient's chief complaint and reason for referral
- Patient's stated goals and concerns
- Relevant history from patient/caregiver perspective
- Include quotes when impactful
- Note caregiver presence and engagement

**OBJECTIVE - Organize into clear subsections:**

**Demographics:**
- Age, gender, admission source
- Living situation and support system

**Vital Signs:**
- BP, HR, RR, Temp, SpO2, Weight
- Note if any abnormal values

**Cardiovascular:**
- Heart rate and rhythm
- Peripheral pulses
- Edema assessment
- Relevant cardiac history

**Respiratory:**
- Lung sounds
- Respiratory effort
- Oxygen needs
- Relevant respiratory history

**Integumentary:**
- Skin condition and integrity
- Wounds (location, size, stage, treatment)
- Pressure areas
- Turgor

**Musculoskeletal:**
- Range of motion
- Strength assessment
- Gait and mobility
- Assistive devices

**Neurological:**
- Alert and orientation (x4)
- Speech and comprehension
- Sensation
- Cognitive status

**Gastrointestinal:**
- Bowel function
- Diet
- Nutrition status
- Abdomen assessment

**Genitourinary:**
- Urinary continence
- Catheter if present
- Fluid balance

**Pain Assessment:**
- Location, intensity (0-10 scale), quality
- Aggravating/relieving factors
- Current pain management

**Functional Status (ADLs):**
- Ambulation (distance, assistive device, assistance level)
- Transfers (bed, chair, toilet - assistance level)
- Bathing (independence level)
- Dressing (upper/lower body)
- Toileting
- Grooming
- Feeding
Use OASIS scoring language: independent, requires assistive device, minimal/moderate/maximal assistance, dependent

**Medications:**
- Review medication reconciliation completed
- High-risk medications noted
- Patient/caregiver understanding assessed
- Medication management ability

**Mental/Emotional Status:**
- Depression screening result (if done)
- Anxiety level
- Coping mechanisms
- Support system strength

**Safety Assessment:**
- Fall risk level (low/medium/high) with specific factors
- Home environment hazards
- Emergency preparedness
- Safety equipment in place

**ASSESSMENT:**
This should be a comprehensive clinical summary that:
- Summarizes primary diagnosis and relevant comorbidities
- Identifies why patient requires skilled nursing
- States patient is HOMEBOUND with specific justification:
  * Why patient cannot leave home safely (physical limitations, medical condition)
  * What makes leaving home require considerable and taxing effort
  * Note that absences from home are infrequent/short duration (medical appointments only)
- Acknowledges rehabilitation potential
- Notes family support and engagement
- Identifies barriers to care or learning needs

**PLAN:**
- Skilled nursing services: specific interventions, frequency, goals
- Therapy services if ordered (PT/OT/ST): goals and frequency
- Physician orders to be followed
- Medication management plan
- Patient/caregiver education topics
- Safety interventions
- Monitoring parameters
- Coordination needs
- Short-term and long-term goals
- Expected outcomes

**STYLE GUIDELINES:**
- Professional, clinical, objective tone
- Medicare-compliant language throughout
- Specific and measurable descriptions
- Avoid vague terms ("appears to be", "seems")
- Use medical terminology appropriately
- Include specific measurements, distances, assistance levels
- Document what YOU observed during admission visit
- Note patient/caregiver verbalized understanding of plan

**HOMEBOUND JUSTIFICATION - CRITICAL:**
Must clearly document why patient meets homebound criteria:
- Physical limitations (mobility impairment, assistive device needs)
- Medical condition requiring bed rest or restricted activity
- Leaving home requires considerable and taxing effort
- Absences from home rare and short duration
- Use specific examples (e.g., "patient ambulates 10 feet with FWW and moderate assistance, becomes SOB and requires rest")

Generate a complete, detailed admission note that a skilled nurse would write after a thorough admission visit. Make it comprehensive, specific, and Medicare-compliant.`,
        response_json_schema: {
          type: "object",
          properties: {
            admission_note: {
              type: "string",
              description: "Complete SOAP-formatted admission nursing note"
            },
            key_findings: {
              type: "array",
              items: { type: "string" },
              description: "Top 5-7 critical findings that require immediate attention"
            },
            homebound_justification_strength: {
              type: "string",
              enum: ["strong", "moderate", "needs_clarification"],
              description: "Assessment of homebound documentation strength"
            },
            suggested_care_priorities: {
              type: "array",
              items: { type: "string" },
              description: "Top 3-5 care priorities based on assessment"
            }
          }
        }
      });

      clearInterval(progressInterval);
      // A newer generation started while this one was in flight — discard this result.
      if (myReqId !== generateReqIdRef.current) return;
      setGenerationStage(generationStages.length - 1);
      setGeneratedNote(result.admission_note || "");
      setEditedNote(result.admission_note || "");

      if (onNoteGenerated) {
        onNoteGenerated({
          note: result.admission_note,
          keyFindings: result.key_findings,
          homeboundStrength: result.homebound_justification_strength,
          carePriorities: result.suggested_care_priorities
        });
      }
    } catch (error) {
      clearInterval(progressInterval);
      console.error('Error generating admission note:', error);
      if (myReqId === generateReqIdRef.current) {
        toast.error('Failed to generate admission note. Please try again.');
      }
    } finally {
      if (myReqId === generateReqIdRef.current) setGenerationStage(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [generationStages, onNoteGenerated, referralData]);

  useEffect(() => {
    if (autoGenerate && referralData && !generatedNote && !ai.loading) {
      generateAdmissionNote();
    }
  }, [autoGenerate, referralData, generateAdmissionNote, generatedNote, ai.loading]);

  const handleCopy = () => {
    navigator.clipboard.writeText(isEditing ? editedNote : generatedNote);
  };

  const handleSaveEdit = () => {
    setGeneratedNote(editedNote);
    setIsEditing(false);
    if (onNoteGenerated) {
      onNoteGenerated({ note: editedNote });
    }
  };

  if (ai.loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <ProgressFeedback
            stages={generationStages}
            currentStage={generationStage}
            message="Generating Admission Note"
          />
        </CardContent>
      </Card>
    );
  }

  if (!generatedNote) {
    return (
      <Card className="border-2 border-navy-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-navy-600" />
            AI Admission Note Generator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600 mb-4">
            Generate a comprehensive, Medicare-compliant admission nursing note from the extracted referral data.
          </p>
          <Button 
            onClick={generateAdmissionNote}
            className="bg-navy-600 hover:bg-navy-700"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Generate Admission Note
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-navy-300">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-navy-600" />
              AI-Generated Admission Note
            </CardTitle>
            <AIFieldIndicator confidence={95} source="AI Generated" />
          </div>
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button size="sm" variant="outline" onClick={() => {
                  setEditedNote(generatedNote);
                  setIsEditing(false);
                }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveEdit} className="bg-green-600 hover:bg-green-700">
                  <Save className="w-4 h-4 mr-1" />
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={handleCopy}>
                  <Copy className="w-4 h-4 mr-1" />
                  Copy
                </Button>
                <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
                  <Edit3 className="w-4 h-4 mr-1" />
                  Edit
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setShowReviewer(!showReviewer)}
                  className="text-blue-600"
                >
                  <Eye className="w-4 h-4 mr-1" />
                  {showReviewer ? 'Hide' : 'Review'}
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={generateAdmissionNote}
                  className="text-navy-600"
                >
                  <Sparkles className="w-4 h-4 mr-1" />
                  Regenerate
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <Textarea
            value={editedNote}
            onChange={(e) => setEditedNote(e.target.value)}
            className="min-h-[600px] font-mono text-sm"
          />
        ) : (
          <div className="bg-navy-50 p-6 rounded-lg border border-navy-200">
            <pre className="whitespace-pre-wrap font-sans text-sm text-slate-900 leading-relaxed">
              {generatedNote}
            </pre>
          </div>
        )}
        
        <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-blue-900 mb-1">Ready for Clinical Review</p>
              <p className="text-xs text-blue-800">
                This AI-generated note is structured and comprehensive. Review, edit as needed based on actual patient interaction, 
                and add any additional observations from your admission visit.
              </p>
            </div>
          </div>
        </div>

        {showReviewer && (
          <div className="mt-4">
            <RealTimeDocumentationReviewer
              noteContent={isEditing ? editedNote : generatedNote}
              noteType="admission"
              patientData={referralData}
              autoAnalyze={true}
              onApplySuggestion={(suggestion) => {
                if (isEditing) {
                  setEditedNote(prev => prev + "\n\n" + suggestion);
                }
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}