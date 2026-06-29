import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TrendingUp, Sparkles } from "lucide-react";
import { todayEastern } from "../utils/timezone";
import SmartNotesContextPanel from "./SmartNotesContextPanel";
import DocumentDraftManager from "./DocumentDraftManager";

export default function ProgressReportGenerator({ patientId, patient }) {
  const [reportDate, setReportDate] = useState(todayEastern());
  const [reportPeriod, setReportPeriod] = useState("30");
  const [recipient, setRecipient] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [generatedReport, setGeneratedReport] = useState("");
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

  const generateReport = async () => {
    try {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(reportPeriod));
      
      const periodVisits = visits.filter(v => 
        v.status === 'completed' && new Date(v.visit_date) >= daysAgo
      );

      const firstVisit = periodVisits[periodVisits.length - 1];
      const latestVisit = periodVisits[0];
      
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Generate a comprehensive progress report for home health services.

REPORT INFORMATION:
Report Date: ${reportDate}
Reporting Period: Last ${reportPeriod} days
Recipient: ${recipient || 'Physician/Care Team'}

PATIENT INFORMATION:
Name: ${patient.first_name} ${patient.last_name}
DOB: ${patient.date_of_birth || 'Not recorded'}
MRN: ${patient.medical_record_number || 'Not assigned'}
Admission Date: ${patient.admission_date || 'Not recorded'}
Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}

SERVICES PROVIDED:
Total Visits in Period: ${periodVisits.length}
Visit Types: ${[...new Set(periodVisits.map(v => v.visit_type))].join(', ')}
First Visit in Period: ${firstVisit?.visit_date || 'N/A'}
Most Recent Visit: ${latestVisit?.visit_date || 'N/A'}

BASELINE STATUS (Beginning of Period):
${firstVisit ? `
Vitals: BP ${firstVisit.vital_signs?.blood_pressure_systolic}/${firstVisit.vital_signs?.blood_pressure_diastolic}, HR ${firstVisit.vital_signs?.heart_rate}, O2 ${firstVisit.vital_signs?.oxygen_saturation}%
Weight: ${firstVisit.vital_signs?.weight || 'Not recorded'} lbs
Pain Level: ${firstVisit.vital_signs?.pain_level || 'Not recorded'}/10
` : 'No baseline data available'}

CURRENT STATUS (End of Period):
${latestVisit ? `
Vitals: BP ${latestVisit.vital_signs?.blood_pressure_systolic}/${latestVisit.vital_signs?.blood_pressure_diastolic}, HR ${latestVisit.vital_signs?.heart_rate}, O2 ${latestVisit.vital_signs?.oxygen_saturation}%
Weight: ${latestVisit.vital_signs?.weight || 'Not recorded'} lbs
Pain Level: ${latestVisit.vital_signs?.pain_level || 'Not recorded'}/10
` : 'No current data available'}

CARE PLAN PROGRESS:
${carePlans.map(cp => `
Problem: ${cp.problem}
Goal: ${cp.goal}
Status: ${cp.status}
Target Date: ${cp.target_date || 'Not set'}
${cp.baseline_measurement ? `Baseline: ${cp.baseline_measurement}` : ''}
`).join('\n') || 'No active care plans'}

CLINICAL NOTES SUMMARY:
${periodVisits.slice(0, 3).map((v, i) => `
Visit ${i + 1} (${v.visit_date}):
${v.nurse_notes?.substring(0, 250)}
`).join('\n')}

INCIDENTS/CONCERNS:
${incidents.filter(inc => new Date(inc.incident_date) >= daysAgo).map(inc => `
- ${inc.incident_type} (${inc.incident_date}): ${inc.severity} severity
  ${inc.report?.substring(0, 100)}
`).join('\n') || 'No incidents reported during this period'}

FUNCTIONAL STATUS:
Current: ${patient.functional_status?.ambulation || 'Not assessed'} (Ambulation)
ADL: ${patient.functional_status?.adl_independence || 'Not assessed'}
Cognitive: ${patient.functional_status?.cognitive_status || 'Not assessed'}

ADDITIONAL CONTEXT FROM SMART NOTES:
${additionalContext || 'None provided'}

ADDITIONAL NOTES:
${additionalNotes || 'None'}

Generate a professional progress report with:

1. PATIENT IDENTIFICATION & REPORT PERIOD

2. SUMMARY OF SERVICES
   - Number and types of visits
   - Skilled interventions provided

3. PROGRESS TOWARD GOALS
   - Detailed analysis of each care plan goal
   - Measurable improvements or concerns
   - Functional status changes

4. CLINICAL FINDINGS & TRENDS
   - Vital signs trends (improving/stable/declining)
   - Symptom progression
   - Response to treatment

5. PATIENT/CAREGIVER RESPONSE
   - Compliance with care plan
   - Understanding of instructions
   - Barriers to progress

6. INCIDENTS/COMPLICATIONS
   - Any adverse events
   - Interventions taken

7. MEDICATION REVIEW
   - Changes in medications
   - Adherence issues
   - Side effects noted

8. RECOMMENDATIONS
   - Continue current plan vs. modifications needed
   - Additional services recommended
   - Discharge planning considerations

9. PLAN FOR NEXT PERIOD
   - Anticipated visits
   - Focus areas
   - Expected outcomes

Use professional medical terminology. Be objective and data-driven. Include specific measurements and observations.`,
        response_json_schema: {
          type: "object",
          properties: {
            report: { type: "string" }
          }
        }
      });

      setGeneratedReport(result.report);
    } catch (error) {
      console.error("Error generating progress report:", error);
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
              <TrendingUp className="w-5 h-5 text-green-600" />
              Progress Report Generator
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <Label>Report Date</Label>
                <Input 
                  type="date" 
                  value={reportDate} 
                  onChange={(e) => setReportDate(e.target.value)}
                  max={todayEastern()}
                />
              </div>
              <div>
                <Label>Reporting Period</Label>
                <select 
                  className="w-full h-10 px-3 border border-slate-300 rounded-md"
                  value={reportPeriod}
                  onChange={(e) => setReportPeriod(e.target.value)}
                >
                  <option value="7">Last 7 days</option>
                  <option value="14">Last 2 weeks</option>
                  <option value="30">Last 30 days</option>
                  <option value="60">Last 60 days</option>
                  <option value="90">Last 90 days</option>
                </select>
              </div>
              <div>
                <Label>Recipient</Label>
                <Input 
                  placeholder="e.g., Dr. Smith" 
                  value={recipient} 
                  onChange={(e) => setRecipient(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label>Additional Notes (Optional)</Label>
              <Textarea 
                placeholder="Any additional information to include in the report..."
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

            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <p className="text-sm text-green-900">
                <strong>Data Source:</strong> {visits.length} total visits
                {carePlans.length > 0 && `, ${carePlans.length} care plans`}
              </p>
            </div>

            <Button 
              onClick={generateReport} 
              disabled={ai.loading}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {ai.loading ? (
                <><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" /> Generating...</>
              ) : (
                <><Sparkles className="w-5 h-5 mr-2" /> Generate Progress Report</>
              )}
            </Button>
          </CardContent>
        </Card>

        {generatedReport && (
          <DocumentDraftManager
            generatedContent={generatedReport}
            documentType="Progress_Report"
            patientName={`${patient.first_name}_${patient.last_name}`}
            onContentChange={(content) => setGeneratedReport(content)}
          />
        )}
      </div>
    </div>
  );
}