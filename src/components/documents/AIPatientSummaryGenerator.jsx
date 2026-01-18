import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Sparkles, Copy, Download, Mail, Loader2, FileText, Zap, BookOpen, BarChart3 } from "lucide-react";
import jsPDF from "jspdf";
import { format } from "date-fns";

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
    const pageWidth = 210;
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    
    // Header
    doc.setFillColor(59, 130, 246);
    doc.rect(0, 0, pageWidth, 35, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.text('Patient Summary', margin, 15);
    doc.setFontSize(10);
    doc.text(`Generated: ${format(new Date(summary.generated_at), 'MMM d, yyyy HH:mm')}`, margin, 28);
    
    // Reset text color
    doc.setTextColor(0, 0, 0);
    y = 45;
    
    // Patient info section
    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    doc.text(summary.patient_name, margin, y);
    y += 8;
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Urgency Level: ${summary.urgency_level.toUpperCase()}`, margin, y);
    doc.text(`Summary Type: ${summary.length.charAt(0).toUpperCase() + summary.length.slice(1)}`, pageWidth - margin - 50, y);
    y += 12;
    
    // Focus areas
    if (summary.focus && summary.focus.length > 0) {
      doc.setFontSize(9);
      doc.setFont(undefined, 'bold');
      doc.text('Focus Areas:', margin, y);
      y += 5;
      doc.setFont(undefined, 'normal');
      const focusText = summary.focus.map(f => f.replace(/_/g, ' ')).join(', ');
      const focusLines = doc.splitTextToSize(focusText, contentWidth);
      focusLines.forEach(line => {
        doc.text(line, margin + 5, y);
        y += 4;
      });
      y += 4;
    }
    
    // Main summary
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Clinical Summary', margin, y);
    y += 6;
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    const summaryLines = doc.splitTextToSize(summary.summary_text, contentWidth);
    summaryLines.forEach(line => {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      doc.text(line, margin, y);
      y += 5;
    });
    
    y += 8;
    
    // Key highlights
    if (summary.key_highlights && summary.key_highlights.length > 0) {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(11);
      doc.setFont(undefined, 'bold');
      doc.text('Key Highlights', margin, y);
      y += 6;
      
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      summary.key_highlights.forEach(highlight => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        const lines = doc.splitTextToSize(`• ${highlight}`, contentWidth - 5);
        lines.forEach((line, idx) => {
          doc.text(line, margin + (idx === 0 ? 0 : 5), y);
          y += 5;
        });
      });
    }
    
    // Footer
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    const pageCount = doc.internal.pages.length - 1;
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.text(
        `Page ${i} of ${pageCount}`,
        pageWidth / 2,
        doc.internal.pageSize.height - 10,
        { align: 'center' }
      );
    }
    
    doc.save(`patient-summary-${summary.patient_name.replace(/\s/g, '-')}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    toast.success('PDF downloaded successfully');
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
      <CardContent className="space-y-5 pt-6">
        {!summary ? (
          <>
            {/* Length Selection */}
            <div>
              <label className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3 block">
                Summary Length
              </label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: 'brief', label: 'Brief', icon: Zap, desc: '2-3 sentences' },
                  { value: 'medium', label: 'Medium', icon: BookOpen, desc: '1 paragraph' },
                  { value: 'detailed', label: 'Detailed', icon: BarChart3, desc: 'Comprehensive' }
                ].map(option => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.value}
                      onClick={() => setSummaryLength(option.value)}
                      className={`p-3 rounded-lg border-2 transition-all text-center ${
                        summaryLength === option.value
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      <Icon className={`w-5 h-5 mx-auto mb-1 ${summaryLength === option.value ? 'text-blue-600' : 'text-slate-600 dark:text-slate-400'}`} />
                      <div className="font-medium text-sm">{option.label}</div>
                      <div className="text-xs text-slate-500">{option.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Focus Areas */}
            <div>
              <label className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3 block">
                Focus Areas (Select Multiple)
              </label>
              <div className="grid grid-cols-2 gap-3">
                {Object.keys(focusAreas).map(area => (
                  <div key={area} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                    <Checkbox
                      id={`focus-${area}`}
                      checked={focusAreas[area]}
                      onCheckedChange={(checked) => setFocusAreas({ ...focusAreas, [area]: checked })}
                    />
                    <label htmlFor={`focus-${area}`} className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer flex-1">
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