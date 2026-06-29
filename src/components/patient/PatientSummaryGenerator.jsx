import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Download, Loader2, Copy, Check } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from 'sonner';

export default function PatientSummaryGenerator({ patient, visits, carePlans, incidents }) {
  const [summaryFormat, setSummaryFormat] = useState("concise");
  const ai = useAICall();
  const [summaries, setSummaries] = useState({});
  const [copied, setCopied] = useState(false);

  const generateSummary = async (format) => {
    setSummaryFormat(format);

    try {
      const recentVisits = visits.slice(0, 5);
      const activeCarePlans = carePlans.filter(cp => cp.status === 'active');
      const recentIncidents = incidents.slice(0, 3);

      let prompt = '';
      let schema = {};

      if (format === 'concise') {
        prompt = `Create a CONCISE patient summary (3-4 sentences max) for quick review:

Patient: ${patient.first_name} ${patient.last_name}
Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
Current Medications: ${patient.current_medications?.length || 0} medications
Recent Visits: ${recentVisits.length} (last 30 days)
Active Care Plans: ${activeCarePlans.length}
Recent Incidents: ${recentIncidents.length}

Provide a brief snapshot focusing on current status, key concerns, and immediate priorities.`;

        schema = {
          type: "object",
          properties: {
            summary: { type: "string" },
            key_points: {
              type: "array",
              items: { type: "string" }
            }
          }
        };
      } else if (format === 'detailed') {
        prompt = `Create a COMPREHENSIVE patient summary for thorough understanding:

PATIENT INFORMATION:
Name: ${patient.first_name} ${patient.last_name}
DOB: ${patient.date_of_birth || 'Unknown'}
MRN: ${patient.medical_record_number || 'N/A'}
Care Type: ${patient.care_type || 'home_health'}

DIAGNOSES:
Primary: ${patient.primary_diagnosis || 'Not specified'}
Secondary: ${patient.secondary_diagnoses?.join(', ') || 'None'}

MEDICATIONS (${patient.current_medications?.length || 0}):
${patient.current_medications?.map(m => `- ${m.name} ${m.dosage} ${m.frequency}`).join('\n') || 'None documented'}

ALLERGIES: ${patient.allergies || 'NKDA'}

MEDICAL HISTORY:
${patient.past_medical_history?.join(', ') || 'No past medical history documented'}

RECENT CLINICAL ACTIVITY:
- Visits (last 30 days): ${recentVisits.length}
- Active Care Plans: ${activeCarePlans.length}
${activeCarePlans.map(cp => `  • ${cp.problem}: ${cp.goal}`).join('\n')}
- Recent Incidents: ${recentIncidents.length}
${recentIncidents.map(i => `  • ${i.incident_type} on ${i.incident_date}`).join('\n')}

FUNCTIONAL STATUS:
${patient.functional_status ? `
- Ambulation: ${patient.functional_status.ambulation || 'Not documented'}
- ADL Independence: ${patient.functional_status.adl_independence || 'Not documented'}
- Cognitive Status: ${patient.functional_status.cognitive_status || 'Not documented'}
- Fall Risk: ${patient.functional_status.fall_risk || 'Not documented'}
` : 'Not documented'}

Create a detailed narrative summary that includes:
1. Clinical overview and current status
2. Treatment history and progress
3. Current care plan focus areas
4. Barriers and challenges
5. Strengths and support systems
6. Next steps and priorities`;

        schema = {
          type: "object",
          properties: {
            executive_summary: { type: "string" },
            clinical_overview: { type: "string" },
            treatment_progress: { type: "string" },
            current_focus: { type: "string" },
            barriers_challenges: { type: "string" },
            strengths_supports: { type: "string" },
            next_steps: {
              type: "array",
              items: { type: "string" }
            }
          }
        };
      } else if (format === 'handoff') {
        prompt = `Create a HANDOFF SUMMARY for nurse-to-nurse communication:

Patient: ${patient.first_name} ${patient.last_name} (${patient.medical_record_number || 'No MRN'})
Primary Dx: ${patient.primary_diagnosis || 'Not specified'}
Payor: ${patient.payor || 'Not specified'}

Last Visit: ${recentVisits[0]?.visit_date || 'No recent visits'}
${recentVisits[0]?.nurse_notes ? `Notes: ${recentVisits[0].nurse_notes.substring(0, 200)}...` : ''}

Active Problems: ${activeCarePlans.map(cp => cp.problem).join(', ') || 'None'}
Recent Concerns: ${recentIncidents.map(i => i.incident_type).join(', ') || 'None'}
Allergies: ${patient.allergies || 'NKDA'}

Key Medications: ${patient.current_medications?.slice(0, 5).map(m => `${m.name} ${m.dosage}`).join(', ') || 'None'}

Provide actionable handoff information including:
- What's happening now (current status)
- What to watch for (alerts and concerns)
- What needs to be done (pending tasks and priorities)
- Important patient/family considerations`;

        schema = {
          type: "object",
          properties: {
            current_status: { type: "string" },
            watch_for: {
              type: "array",
              items: { type: "string" }
            },
            pending_actions: {
              type: "array",
              items: { type: "string" }
            },
            patient_family_notes: { type: "string" },
            safety_concerns: {
              type: "array",
              items: { type: "string" }
            }
          }
        };
      }

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: schema
      });

      setSummaries(prev => ({ ...prev, [format]: result }));
    } catch (error) {
      console.error('Summary generation error:', error);
      toast.error('Failed to generate summary. Please try again.');
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const downloadSummary = (format, content) => {
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `patient-summary-${format}-${patient.last_name}-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  return (
    <Card className="border-blue-200 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-navy-50 border-b border-blue-100">
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-6 h-6 text-blue-600" />
          Patient Summary Generator
        </CardTitle>
        <p className="text-sm text-slate-600 mt-2">
          Generate patient summaries in different formats for various clinical needs
        </p>
      </CardHeader>
      <CardContent className="p-6">
        <Tabs value={summaryFormat} onValueChange={setSummaryFormat} className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="concise">Concise</TabsTrigger>
            <TabsTrigger value="detailed">Detailed</TabsTrigger>
            <TabsTrigger value="handoff">Handoff</TabsTrigger>
          </TabsList>

          {/* Concise Summary */}
          <TabsContent value="concise" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">Concise Summary</h3>
                <p className="text-sm text-slate-600">Quick overview for rapid review (3-4 sentences)</p>
              </div>
              <Button
                onClick={() => generateSummary('concise')}
                disabled={ai.loading}
                size="sm"
              >
                {ai.loading && summaryFormat === 'concise' ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Generate'
                )}
              </Button>
            </div>
            {summaries.concise && (
              <Card className="bg-slate-50">
                <CardContent className="p-4">
                  <p className="text-sm text-slate-900 mb-4 leading-relaxed">{summaries.concise.summary}</p>
                  {summaries.concise.key_points && summaries.concise.key_points.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 mb-2">Key Points:</p>
                      <ul className="space-y-1">
                        {summaries.concise.key_points.map((point, idx) => (
                          <li key={idx} className="text-sm text-slate-700">• {point}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex gap-2 mt-4">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyToClipboard(summaries.concise.summary)}
                    >
                      {copied ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadSummary('concise', summaries.concise)}
                    >
                      <Download className="w-3 h-3 mr-1" />
                      Download
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Detailed Summary */}
          <TabsContent value="detailed" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">Detailed Summary</h3>
                <p className="text-sm text-slate-600">Comprehensive narrative for thorough understanding</p>
              </div>
              <Button
                onClick={() => generateSummary('detailed')}
                disabled={ai.loading}
                size="sm"
              >
                {ai.loading && summaryFormat === 'detailed' ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Generate'
                )}
              </Button>
            </div>
            {summaries.detailed && (
              <Card className="bg-slate-50">
                <CardContent className="p-4">
                  <ScrollArea className="max-h-96">
                    <div className="space-y-4 text-sm">
                      {summaries.detailed.executive_summary && (
                        <div>
                          <p className="font-semibold text-slate-900 mb-1">Executive Summary</p>
                          <p className="text-slate-700 leading-relaxed">{summaries.detailed.executive_summary}</p>
                        </div>
                      )}
                      {summaries.detailed.clinical_overview && (
                        <div>
                          <p className="font-semibold text-slate-900 mb-1">Clinical Overview</p>
                          <p className="text-slate-700 leading-relaxed">{summaries.detailed.clinical_overview}</p>
                        </div>
                      )}
                      {summaries.detailed.treatment_progress && (
                        <div>
                          <p className="font-semibold text-slate-900 mb-1">Treatment Progress</p>
                          <p className="text-slate-700 leading-relaxed">{summaries.detailed.treatment_progress}</p>
                        </div>
                      )}
                      {summaries.detailed.current_focus && (
                        <div>
                          <p className="font-semibold text-slate-900 mb-1">Current Focus</p>
                          <p className="text-slate-700 leading-relaxed">{summaries.detailed.current_focus}</p>
                        </div>
                      )}
                      {summaries.detailed.barriers_challenges && (
                        <div>
                          <p className="font-semibold text-slate-900 mb-1">Barriers & Challenges</p>
                          <p className="text-slate-700 leading-relaxed">{summaries.detailed.barriers_challenges}</p>
                        </div>
                      )}
                      {summaries.detailed.strengths_supports && (
                        <div>
                          <p className="font-semibold text-slate-900 mb-1">Strengths & Supports</p>
                          <p className="text-slate-700 leading-relaxed">{summaries.detailed.strengths_supports}</p>
                        </div>
                      )}
                      {summaries.detailed.next_steps && summaries.detailed.next_steps.length > 0 && (
                        <div>
                          <p className="font-semibold text-slate-900 mb-2">Next Steps</p>
                          <ul className="space-y-1">
                            {summaries.detailed.next_steps.map((step, idx) => (
                              <li key={idx} className="text-slate-700">• {step}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                  <div className="flex gap-2 mt-4">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyToClipboard(JSON.stringify(summaries.detailed, null, 2))}
                    >
                      {copied ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadSummary('detailed', summaries.detailed)}
                    >
                      <Download className="w-3 h-3 mr-1" />
                      Download
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Handoff Summary */}
          <TabsContent value="handoff" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">Handoff Summary</h3>
                <p className="text-sm text-slate-600">Nurse-to-nurse communication for shift changes</p>
              </div>
              <Button
                onClick={() => generateSummary('handoff')}
                disabled={ai.loading}
                size="sm"
              >
                {ai.loading && summaryFormat === 'handoff' ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Generate'
                )}
              </Button>
            </div>
            {summaries.handoff && (
              <Card className="bg-slate-50">
                <CardContent className="p-4">
                  <div className="space-y-4 text-sm">
                    {summaries.handoff.current_status && (
                      <div>
                        <p className="font-semibold text-slate-900 mb-1">Current Status</p>
                        <p className="text-slate-700 leading-relaxed">{summaries.handoff.current_status}</p>
                      </div>
                    )}
                    {summaries.handoff.watch_for && summaries.handoff.watch_for.length > 0 && (
                      <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg">
                        <p className="font-semibold text-slate-900 mb-2">⚠️ Watch For</p>
                        <ul className="space-y-1">
                          {summaries.handoff.watch_for.map((item, idx) => (
                            <li key={idx} className="text-slate-700">• {item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {summaries.handoff.pending_actions && summaries.handoff.pending_actions.length > 0 && (
                      <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg">
                        <p className="font-semibold text-slate-900 mb-2">📋 Pending Actions</p>
                        <ul className="space-y-1">
                          {summaries.handoff.pending_actions.map((action, idx) => (
                            <li key={idx} className="text-slate-700">• {action}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {summaries.handoff.safety_concerns && summaries.handoff.safety_concerns.length > 0 && (
                      <div className="bg-red-50 border border-red-200 p-3 rounded-lg">
                        <p className="font-semibold text-slate-900 mb-2">🛡️ Safety Concerns</p>
                        <ul className="space-y-1">
                          {summaries.handoff.safety_concerns.map((concern, idx) => (
                            <li key={idx} className="text-slate-700">• {concern}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {summaries.handoff.patient_family_notes && (
                      <div>
                        <p className="font-semibold text-slate-900 mb-1">Patient/Family Considerations</p>
                        <p className="text-slate-700 leading-relaxed">{summaries.handoff.patient_family_notes}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyToClipboard(JSON.stringify(summaries.handoff, null, 2))}
                    >
                      {copied ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadSummary('handoff', summaries.handoff)}
                    >
                      <Download className="w-3 h-3 mr-1" />
                      Download
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}