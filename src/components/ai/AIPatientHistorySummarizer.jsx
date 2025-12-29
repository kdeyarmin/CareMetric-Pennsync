import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, FileText, User, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function AIPatientHistorySummarizer({ patientId, onSummaryGenerated }) {
  const [generating, setGenerating] = useState(false);
  const [summary, setSummary] = useState(null);
  const [selectedPatientId, setSelectedPatientId] = useState(patientId || "");

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list()
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['patientVisits', selectedPatientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: selectedPatientId }),
    enabled: !!selectedPatientId
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['patientCarePlans', selectedPatientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: selectedPatientId }),
    enabled: !!selectedPatientId
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['patientIncidents', selectedPatientId],
    queryFn: () => base44.entities.Incident.filter({ patient_id: selectedPatientId }),
    enabled: !!selectedPatientId
  });

  const patient = patients.find(p => p.id === selectedPatientId);

  const generateSummary = async () => {
    if (!patient) return;

    setGenerating(true);
    try {
      const recentVisits = visits.slice(0, 10);
      const activeCarePlans = carePlans.filter(cp => cp.status === 'active');
      
      const prompt = `Generate a comprehensive medical history summary for this patient:

Patient Information:
- Name: ${patient.first_name} ${patient.last_name}
- Age: ${patient.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : 'Unknown'}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Allergies: ${patient.allergies || 'None documented'}

Current Medications (${patient.current_medications?.length || 0}):
${patient.current_medications?.map(med => `- ${med.name} ${med.dosage} ${med.frequency}`).join('\n') || 'None'}

Past Medical History:
${patient.past_medical_history?.join(', ') || 'None documented'}

Recent Care (${recentVisits.length} visits):
${recentVisits.map(v => `- ${v.visit_date}: ${v.visit_type} - ${v.nurse_notes?.substring(0, 100) || 'No notes'}`).join('\n')}

Active Care Plans (${activeCarePlans.length}):
${activeCarePlans.map(cp => `- ${cp.problem}: Goal - ${cp.goal}`).join('\n')}

Recent Incidents (${incidents.length}):
${incidents.slice(0, 5).map(i => `- ${i.incident_date}: ${i.incident_type}`).join('\n')}

Please provide:
1. Executive Summary (2-3 sentences)
2. Key Medical History Points
3. Current Treatment Status
4. Notable Patterns or Concerns
5. Recent Progress and Changes`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            executive_summary: { type: "string" },
            key_history_points: { type: "array", items: { type: "string" } },
            current_treatment_status: { type: "string" },
            notable_patterns: { type: "array", items: { type: "string" } },
            recent_progress: { type: "string" }
          }
        }
      });

      setSummary(result);
      if (onSummaryGenerated) {
        onSummaryGenerated(result);
      }
      toast.success("Medical history summary generated");
    } catch (error) {
      console.error('Error generating summary:', error);
      toast.error("Failed to generate summary");
    }
    setGenerating(false);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-600" />
            AI Patient History Summarizer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Select Patient</label>
            <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a patient" />
              </SelectTrigger>
              <SelectContent>
                {patients.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.first_name} {p.last_name} - {p.primary_diagnosis || 'No diagnosis'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {patient && (
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-gray-600" />
                <span className="font-medium">{patient.first_name} {patient.last_name}</span>
              </div>
              <div className="flex gap-2">
                <Badge>{visits.length} visits</Badge>
                <Badge variant="outline">{carePlans.length} care plans</Badge>
              </div>
            </div>
          )}

          <Button 
            onClick={generateSummary} 
            disabled={!selectedPatientId || generating}
            className="w-full"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating Summary...
              </>
            ) : (
              <>
                <Brain className="w-4 h-4 mr-2" />
                Generate AI Summary
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              Medical History Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Executive Summary
              </h4>
              <p className="text-gray-700">{summary.executive_summary}</p>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Key Medical History</h4>
              <ul className="space-y-1">
                {summary.key_history_points?.map((point, idx) => (
                  <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-blue-600 mt-1">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Current Treatment Status</h4>
              <p className="text-gray-700">{summary.current_treatment_status}</p>
            </div>

            {summary.notable_patterns?.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-orange-600" />
                  Notable Patterns & Concerns
                </h4>
                <ul className="space-y-1">
                  {summary.notable_patterns.map((pattern, idx) => (
                    <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                      <span className="text-orange-600 mt-1">⚠</span>
                      <span>{pattern}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h4 className="font-semibold text-sm mb-2">Recent Progress</h4>
              <p className="text-gray-700">{summary.recent_progress}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}