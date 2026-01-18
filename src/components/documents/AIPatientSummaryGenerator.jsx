import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Sparkles, Copy, Download, Mail, Loader2, FileText } from "lucide-react";
import jsPDF from "jspdf";

export default function AIPatientSummaryGenerator({ patientId, documentAnalysis }) {
  const [generating, setGenerating] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryLength, setSummaryLength] = useState('medium');
  const [focusAreas, setFocusAreas] = useState({
    current_status: true,
    recent_changes: true,
    action_items: true,
    medications: true,
    diagnoses: true,
    vitals: false,
    care_plan: false
  });

  const generateSummary = async () => {
    if (!patientId) {
      toast.error('Please select a patient first');
      return;
    }

    setGenerating(true);
    try {
      // Fetch patient data
      const patient = await base44.entities.Patient.get(patientId);
      const carePlans = await base44.entities.CarePlan.filter({ patient_id: patientId, status: 'active' });
      const recentVisits = await base44.entities.Visit?.filter({ patient_id: patientId }) || [];
      const recentIncidents = await base44.entities.Incident?.filter({ patient_id: patientId }) || [];
      const activeTasks = await base44.entities.Task?.filter({ patient_id: patientId, status: 'pending' }) || [];

      // Build context
      const context = {
        patient: {
          name: `${patient.first_name} ${patient.last_name}`,
          age: patient.date_of_birth ? calculateAge(patient.date_of_birth) : null,
          diagnoses: [patient.primary_diagnosis, ...(patient.secondary_diagnoses || [])].filter(Boolean),
          medications: patient.current_medications || [],
          allergies: patient.allergies,
          baseline_vitals: patient.baseline_vitals,
          care_type: patient.care_type,
          status: patient.status
        },
        care_plans: carePlans.slice(0, 5),
        recent_visits: recentVisits.slice(0, 3),
        recent_incidents: recentIncidents.slice(0, 3),
        active_tasks: activeTasks.slice(0, 5),
        document_analysis: documentAnalysis ? {
          summary: documentAnalysis.executive_summary,
          key_findings: documentAnalysis.key_findings,
          extracted_data: documentAnalysis.extracted_data,
          action_items: documentAnalysis.action_items
        } : null
      };

      const lengthInstructions = {
        brief: 'Create a 2-3 sentence ultra-brief summary highlighting only the most critical information.',
        medium: 'Create a concise paragraph (4-6 sentences) covering key clinical information.',
        detailed: 'Create a comprehensive summary (8-12 sentences) with thorough clinical details.'
      };

      const selectedFocus = Object.keys(focusAreas).filter(key => focusAreas[key]);
      const focusInstruction = selectedFocus.length > 0 
        ? `\n\nFocus specifically on: ${selectedFocus.map(f => f.replace(/_/g, ' ')).join(', ')}.`
        : '';

      const prompt = `Generate a professional clinical patient summary for ${patient.first_name} ${patient.last_name}.

${lengthInstructions[summaryLength]}${focusInstruction}

PATIENT DATA:
${JSON.stringify(context, null, 2)}

The summary should be:
- Clear and professional for healthcare providers
- Organized with current status first, then recent changes, then action items
- Include specific clinical details (vitals, medications, diagnoses)
- Highlight any urgent concerns or changes
- Be ready to share with other providers or for handoff

Format as structured text with clear sections.`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            summary_text: {
              type: "string",
              description: "The complete formatted patient summary"
            },
            key_highlights: {
              type: "array",
              items: { type: "string" },
              description: "3-5 bullet points of most critical information"
            },
            urgency_level: {
              type: "string",
              enum: ["routine", "monitor_closely", "urgent"],
              description: "Overall urgency assessment"
            },
            last_updated: {
              type: "string",
              description: "When this summary was generated"
            }
          }
        }
      });

      setSummary({
        ...result,
        patient_name: `${patient.first_name} ${patient.last_name}`,
        generated_at: new Date().toISOString(),
        length: summaryLength,
        focus: selectedFocus
      });

      toast.success('Summary generated successfully');
    } catch (error) {
      toast.error('Failed to generate summary: ' + error.message);
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = () => {
    const text = `PATIENT SUMMARY - ${summary.patient_name}\nGenerated: ${new Date(summary.generated_at).toLocaleString()}\n\n${summary.summary_text}\n\nKEY HIGHLIGHTS:\n${summary.key_highlights.map(h => `• ${h}`).join('\n')}`;
    navigator.clipboard.writeText(text);
    toast.success('Summary copied to clipboard');
  };

  const downloadPDF = () => {
    const doc = new jsPDF();
    let y = 20;
    
    doc.setFontSize(18);
    doc.text('Patient Summary', 20, y);
    y += 10;
    
    doc.setFontSize(12);
    doc.text(summary.patient_name, 20, y);
    y += 7;
    
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date(summary.generated_at).toLocaleString()}`, 20, y);
    doc.text(`Urgency: ${summary.urgency_level.toUpperCase()}`, 120, y);
    y += 10;
    
    doc.setFontSize(11);
    const summaryLines = doc.splitTextToSize(summary.summary_text, 170);
    summaryLines.forEach(line => {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      doc.text(line, 20, y);
      y += 5;
    });
    
    y += 5;
    doc.setFontSize(12);
    doc.text('Key Highlights:', 20, y);
    y += 7;
    
    doc.setFontSize(10);
    summary.key_highlights.forEach(highlight => {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      const lines = doc.splitTextToSize(`• ${highlight}`, 165);
      lines.forEach(line => {
        doc.text(line, 25, y);
        y += 5;
      });
    });
    
    doc.save(`patient-summary-${summary.patient_name.replace(/\s/g, '-')}.pdf`);
    toast.success('PDF downloaded');
  };

  const emailSummary = async () => {
    try {
      await base44.integrations.Core.SendEmail({
        to: (await base44.auth.me()).email,
        subject: `Patient Summary - ${summary.patient_name}`,
        body: `PATIENT SUMMARY\n\n${summary.patient_name}\nGenerated: ${new Date(summary.generated_at).toLocaleString()}\nUrgency Level: ${summary.urgency_level}\n\n${summary.summary_text}\n\nKEY HIGHLIGHTS:\n${summary.key_highlights.map(h => `• ${h}`).join('\n')}`
      });
      toast.success('Summary emailed to you');
    } catch (error) {
      toast.error('Failed to send email: ' + error.message);
    }
  };

  const getUrgencyColor = (level) => {
    switch (level) {
      case 'urgent': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'monitor_closely': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      default: return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    }
  };

  return (
    <Card className="border-2 border-blue-200 dark:border-blue-800">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950 dark:to-cyan-950">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-600" />
          AI Patient Summary Generator
        </CardTitle>
        <CardDescription>
          Generate shareable patient summaries from document analysis and patient data
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        {!summary ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
                  Summary Length
                </label>
                <Select value={summaryLength} onValueChange={setSummaryLength}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="brief">Brief (2-3 sentences)</SelectItem>
                    <SelectItem value="medium">Medium (1 paragraph)</SelectItem>
                    <SelectItem value="detailed">Detailed (comprehensive)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 block">
                Focus Areas
              </label>
              <div className="grid grid-cols-2 gap-3">
                {Object.keys(focusAreas).map(area => (
                  <div key={area} className="flex items-center gap-2">
                    <Checkbox
                      checked={focusAreas[area]}
                      onCheckedChange={(checked) => setFocusAreas({ ...focusAreas, [area]: checked })}
                    />
                    <label className="text-sm text-slate-600 dark:text-slate-400">
                      {area.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <Button 
              onClick={generateSummary}
              disabled={generating || !patientId}
              className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700"
            >
              {generating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {generating ? 'Generating Summary...' : 'Generate AI Summary'}
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">{summary.patient_name}</h3>
                <p className="text-xs text-slate-500">Generated {new Date(summary.generated_at).toLocaleString()}</p>
              </div>
              <Badge className={getUrgencyColor(summary.urgency_level)}>
                {summary.urgency_level.replace(/_/g, ' ')}
              </Badge>
            </div>

            <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-lg">
              <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                {summary.summary_text}
              </p>
            </div>

            {summary.key_highlights && summary.key_highlights.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Key Highlights</h4>
                <ul className="space-y-2">
                  {summary.key_highlights.map((highlight, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <span className="text-blue-600 font-bold">•</span>
                      {highlight}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={copyToClipboard} variant="outline" size="sm">
                <Copy className="w-4 h-4 mr-2" />
                Copy
              </Button>
              <Button onClick={downloadPDF} variant="outline" size="sm">
                <Download className="w-4 h-4 mr-2" />
                PDF
              </Button>
              <Button onClick={emailSummary} variant="outline" size="sm">
                <Mail className="w-4 h-4 mr-2" />
                Email
              </Button>
              <Button onClick={() => setSummary(null)} variant="ghost" size="sm" className="ml-auto">
                Generate New
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function calculateAge(dob) {
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}