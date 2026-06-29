import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FileOutput, Sparkles } from "lucide-react";
import { todayEastern } from "../utils/timezone";
import SmartNotesContextPanel from "./SmartNotesContextPanel";
import DocumentDraftManager from "./DocumentDraftManager";

export default function DischargeSummaryGenerator({ patientId, patient }) {
  const [dischargeDate, setDischargeDate] = useState(todayEastern());
  const [dischargeDisposition, setDischargeDisposition] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [generatedSummary, setGeneratedSummary] = useState("");
  const ai = useAICall();
  const [additionalContext, setAdditionalContext] = useState("");

  const { data: visits = [] } = useQuery({
    queryKey: ['patientVisits', patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date'),
    enabled: !!patientId,
    initialData: [],
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['patientCarePlans', patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId }),
    enabled: !!patientId,
    initialData: [],
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['patientIncidents', patientId],
    queryFn: () => base44.entities.Incident.filter({ patient_id: patientId }),
    enabled: !!patientId,
    initialData: [],
  });

  const generateSummary = async () => {
    try {
      const completedVisits = visits.filter(v => v.status === 'completed').slice(0, 10);
      
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Generate a comprehensive Medicare-compliant discharge summary for home health services.

PATIENT INFORMATION:
- Name: ${patient.first_name} ${patient.last_name}
- DOB: ${patient.date_of_birth || 'Not recorded'}
- MRN: ${patient.medical_record_number || 'Not assigned'}
- Admission Date: ${patient.admission_date || 'Not recorded'}
- Discharge Date: ${dischargeDate}
- Discharge Disposition: ${dischargeDisposition || 'To be determined'}

PRIMARY DIAGNOSIS: ${patient.primary_diagnosis || 'Not specified'}
SECONDARY DIAGNOSES: ${patient.secondary_diagnoses?.join(', ') || 'None documented'}

ADMISSION SOURCE: ${patient.admission_source || 'Not specified'}
REASON FOR HOME HEALTH: ${patient.clinical_notes || 'Not specified'}

CARE PROVIDED:
Total Visits: ${completedVisits.length}
First Visit: ${completedVisits[completedVisits.length - 1]?.visit_date || 'N/A'}
Last Visit: ${completedVisits[0]?.visit_date || 'N/A'}

VISIT SUMMARY:
${completedVisits.slice(0, 5).map((v, i) => `
Visit ${i + 1} (${v.visit_date}):
- Type: ${v.visit_type}
- Vitals: BP ${v.vital_signs?.blood_pressure_systolic || '?'}/${v.vital_signs?.blood_pressure_diastolic || '?'}, HR ${v.vital_signs?.heart_rate || '?'}, O2 ${v.vital_signs?.oxygen_saturation || '?'}%
- Summary: ${v.nurse_notes?.substring(0, 200) || 'No notes'}
`).join('\n')}

CARE PLAN OUTCOMES:
${carePlans.map(cp => `
- Problem: ${cp.problem}
- Goal: ${cp.goal}
- Status: ${cp.status}
- Progress: ${cp.status === 'met' ? 'Goal achieved' : cp.status === 'active' ? 'In progress' : 'Not met'}
`).join('\n') || 'No care plans documented'}

INCIDENTS DURING CARE:
${incidents.length > 0 ? incidents.map(inc => `
- ${inc.incident_type} (${inc.incident_date}): ${inc.severity} severity
`).join('\n') : 'No incidents reported'}

CURRENT MEDICATIONS:
${patient.current_medications?.map(med => `${med.name} ${med.dosage} ${med.frequency}`).join(', ') || 'See medication list'}

FUNCTIONAL STATUS AT DISCHARGE:
- Ambulation: ${patient.functional_status?.ambulation || 'Not assessed'}
- ADL Independence: ${patient.functional_status?.adl_independence || 'Not assessed'}
- Cognitive Status: ${patient.functional_status?.cognitive_status || 'Not assessed'}

ADDITIONAL CONTEXT FROM SMART NOTES:
${additionalContext || 'None provided'}

ADDITIONAL NOTES: ${additionalNotes || 'None'}

Generate a comprehensive discharge summary in proper clinical format with these sections:
1. PATIENT IDENTIFICATION
2. ADMISSION INFORMATION
3. DIAGNOSES
4. HOSPITAL COURSE / SKILLED SERVICES PROVIDED
5. FUNCTIONAL STATUS PROGRESSION
6. CARE PLAN OUTCOMES
7. MEDICATIONS AT DISCHARGE
8. DISCHARGE INSTRUCTIONS
9. FOLLOW-UP RECOMMENDATIONS
10. DISCHARGE DISPOSITION

Use professional medical terminology. Be detailed and specific. Include all relevant clinical information. Ensure Medicare compliance.`,
        response_json_schema: {
          type: "object",
          properties: {
            summary: { type: "string" }
          }
        }
      });

      setGeneratedSummary(result.summary);
    } catch (error) {
      console.error("Error generating discharge summary:", error);
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
              <FileOutput className="w-5 h-5 text-blue-600" />
              Discharge Summary Generator
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Discharge Date</Label>
                <Input 
                  type="date" 
                  value={dischargeDate} 
                  onChange={(e) => setDischargeDate(e.target.value)}
                  max={todayEastern()}
                />
              </div>
              <div>
                <Label>Discharge Disposition</Label>
                <Input 
                  placeholder="e.g., Home with family, Assisted living" 
                  value={dischargeDisposition} 
                  onChange={(e) => setDischargeDisposition(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label>Additional Notes (Optional)</Label>
              <Textarea 
                placeholder="Any additional information to include..."
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                rows={3}
              />
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

            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <p className="text-sm text-blue-900">
                <strong>Data Source:</strong> {visits.length} visits, {carePlans.length} care plans
                {incidents.length > 0 && `, ${incidents.length} incidents`}
              </p>
            </div>

            <Button 
              onClick={generateSummary} 
              disabled={ai.loading}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {ai.loading ? (
                <><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" /> Generating...</>
              ) : (
                <><Sparkles className="w-5 h-5 mr-2" /> Generate Discharge Summary</>
              )}
            </Button>
          </CardContent>
        </Card>

        {generatedSummary && (
          <DocumentDraftManager
            generatedContent={generatedSummary}
            documentType="Discharge_Summary"
            patientName={`${patient.first_name}_${patient.last_name}`}
            onContentChange={(content) => setGeneratedSummary(content)}
          />
        )}
      </div>
    </div>
  );
}