import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ListChecks,
  Loader2,
  Copy,
  CheckCircle2,
  Printer,
  AlertTriangle,
  Clock,
  Phone,
  Eye,
  Pill,
  Calendar,
  ArrowRight
} from "lucide-react";
import { toast } from 'sonner';

export default function NextStepsSummaryGenerator({ patient, educationMaterial, diagnosis }) {
  const [sessionNotes, setSessionNotes] = useState("");
  const [medicationsDiscussed, setMedicationsDiscussed] = useState("");
  const [followUpDays, setFollowUpDays] = useState("7");
  const ai = useAICall();
  const [summary, setSummary] = useState(null);
  const [copied, setCopied] = useState(false);
  const [selectedItems, setSelectedItems] = useState({});

  const generateSummary = async () => {
    try {
      const result = await ai.run({
        model: "claude_sonnet_4_6",
        prompt: `You are creating a personalized "Next Steps" and "What to Watch For" summary for a patient after an education session. This should be simple, actionable, and easy for patients/caregivers to follow at home.

PATIENT: ${patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown'}
DIAGNOSIS: ${diagnosis || patient?.primary_diagnosis || 'Not specified'}
EDUCATION TOPIC: ${educationMaterial?.title || 'General Health Education'}
FOLLOW-UP TIMEFRAME: ${followUpDays} days

EDUCATION SESSION NOTES:
${sessionNotes || 'Standard education session on condition management'}

MEDICATIONS DISCUSSED:
${medicationsDiscussed || 'Standard medication regimen reviewed'}

EDUCATION MATERIAL COVERED:
${educationMaterial ? `
- Key Points: ${educationMaterial.key_points?.map(kp => kp.point).join(', ')}
- Warning Signs Discussed: ${educationMaterial.warning_signs?.map(ws => ws.sign).join(', ')}
- Self-Care Tips: ${educationMaterial.self_care_tips?.map(tip => tip.tip).join(', ')}
` : 'General education provided'}

Create a comprehensive but simple take-home summary that includes:
1. Immediate next steps (today/tomorrow)
2. Daily routine items to remember
3. Warning signs specific to their condition
4. When to call the nurse vs when to call 911
5. Medication reminders tailored to what was discussed
6. Upcoming appointments/follow-up expectations

Return JSON:
{
  "patient_name": "Patient's name for personalization",
  "summary_date": "${new Date().toLocaleDateString()}",
  "condition_focus": "The main condition being managed",
  "immediate_next_steps": [
    {
      "action": "Specific action to take",
      "when": "When to do it (today, tomorrow, etc.)",
      "why": "Brief reason why this is important",
      "how": "Simple instructions"
    }
  ],
  "daily_checklist": [
    {
      "item": "Daily task",
      "time_of_day": "morning/afternoon/evening/anytime",
      "details": "How to do it"
    }
  ],
  "warning_signs_to_watch": [
    {
      "sign": "Warning sign to watch for",
      "severity": "urgent" | "concerning" | "monitor",
      "what_to_do": "Action to take if this occurs"
    }
  ],
  "call_nurse_if": [
    "Situation when to call the nurse"
  ],
  "call_911_if": [
    "Emergency situation requiring 911"
  ],
  "medication_reminders": [
    {
      "medication": "Medication name/type",
      "reminder": "Important thing to remember",
      "tip": "Helpful tip for taking it"
    }
  ],
  "follow_up_plan": {
    "next_visit": "When to expect next visit",
    "prepare_for_visit": ["What to have ready for next visit"],
    "questions_to_track": ["Questions to write down for next visit"]
  },
  "encouragement_message": "Personalized encouraging message",
  "printable_summary": "A formatted text version for printing - keep it simple and use large font descriptions"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            patient_name: { type: "string" },
            summary_date: { type: "string" },
            condition_focus: { type: "string" },
            immediate_next_steps: { type: "array", items: { type: "object" } },
            daily_checklist: { type: "array", items: { type: "object" } },
            warning_signs_to_watch: { type: "array", items: { type: "object" } },
            call_nurse_if: { type: "array", items: { type: "string" } },
            call_911_if: { type: "array", items: { type: "string" } },
            medication_reminders: { type: "array", items: { type: "object" } },
            follow_up_plan: { type: "object" },
            encouragement_message: { type: "string" },
            printable_summary: { type: "string" }
          }
        }
      });

      setSummary(result);
      
      // Initialize selected items
      const initialSelected = {};
      result.immediate_next_steps?.forEach((_, idx) => initialSelected[`step_${idx}`] = true);
      result.daily_checklist?.forEach((_, idx) => initialSelected[`daily_${idx}`] = true);
      result.warning_signs_to_watch?.forEach((_, idx) => initialSelected[`warning_${idx}`] = true);
      setSelectedItems(initialSelected);
    } catch (error) {
      console.error("Error generating summary:", error);
      toast.error("Error generating summary. Please try again.");
    }
  };

  const handleCopy = () => {
    if (summary?.printable_summary) {
      navigator.clipboard.writeText(summary.printable_summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handlePrint = () => {
    if (!summary) return;

    // Respect the selection checkboxes — an unchecked step/daily item is excluded
    // from the printed patient handout (previously every item was always printed).
    const selectedSteps = (summary.immediate_next_steps || []).filter((_, idx) => selectedItems[`step_${idx}`]);
    const selectedDaily = (summary.daily_checklist || []).filter((_, idx) => selectedItems[`daily_${idx}`]);

    const escapeHtml = (str) => {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Next Steps - ${escapeHtml(summary.patient_name)}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; font-size: 14px; }
            h1 { color: #1e40af; border-bottom: 3px solid #1e40af; padding-bottom: 10px; font-size: 24px; }
            h2 { color: #1e40af; margin-top: 20px; font-size: 18px; border-left: 4px solid #1e40af; padding-left: 10px; }
            .section { background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 15px 0; }
            .warning { background: #fef3c7; padding: 15px; border-radius: 8px; margin: 15px 0; border: 2px solid #f59e0b; }
            .emergency { background: #fee2e2; padding: 15px; border-radius: 8px; margin: 15px 0; border: 2px solid #dc2626; }
            .checklist { list-style: none; padding: 0; }
            .checklist li { padding: 8px 0; border-bottom: 1px dashed #ccc; display: flex; align-items: center; }
            .checklist li:before { content: "☐"; margin-right: 10px; font-size: 18px; }
            .encouragement { background: #d1fae5; padding: 20px; border-radius: 8px; text-align: center; font-size: 16px; margin-top: 20px; }
            @media print { body { font-size: 12px; } }
          </style>
        </head>
        <body>
          <h1>📋 Your Next Steps</h1>
          <p><strong>Patient:</strong> ${escapeHtml(summary.patient_name)} | <strong>Date:</strong> ${escapeHtml(summary.summary_date)} | <strong>Focus:</strong> ${escapeHtml(summary.condition_focus)}</p>
          
          <div class="section">
            <h2>✅ Do This First</h2>
            <ul class="checklist">
              ${selectedSteps.map(step => `<li><strong>${escapeHtml(step.action)}</strong> - ${escapeHtml(step.when)}<br><small>${escapeHtml(step.how)}</small></li>`).join('') || ''}
            </ul>
          </div>
          
          <div class="section">
            <h2>📅 Daily Checklist</h2>
            <ul class="checklist">
              ${selectedDaily.map(item => `<li><strong>${escapeHtml(item.item)}</strong> (${escapeHtml(item.time_of_day)})<br><small>${escapeHtml(item.details)}</small></li>`).join('') || ''}
            </ul>
          </div>
          
          <div class="warning">
            <h2>⚠️ Watch For These Signs</h2>
            <ul>
              ${summary.warning_signs_to_watch?.map(sign => `<li><strong>${escapeHtml(sign.sign)}</strong> → ${escapeHtml(sign.what_to_do)}</li>`).join('') || ''}
            </ul>
          </div>
          
          <div class="section">
            <h2>📞 Call Your Nurse If:</h2>
            <ul>${summary.call_nurse_if?.map(item => `<li>${escapeHtml(item)}</li>`).join('') || ''}</ul>
          </div>
          
          <div class="emergency">
            <h2>🚨 Call 911 If:</h2>
            <ul>${summary.call_911_if?.map(item => `<li><strong>${escapeHtml(item)}</strong></li>`).join('') || ''}</ul>
          </div>
          
          <div class="section">
            <h2>💊 Medication Reminders</h2>
            <ul>${summary.medication_reminders?.map(med => `<li><strong>${escapeHtml(med.medication)}:</strong> ${escapeHtml(med.reminder)}<br><small>Tip: ${escapeHtml(med.tip)}</small></li>`).join('') || ''}</ul>
          </div>
          
          <div class="encouragement">
            <p>💚 ${escapeHtml(summary.encouragement_message)}</p>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'urgent': return 'bg-red-100 text-red-800 border-red-300';
      case 'concerning': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'monitor': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <Card className="border-green-200">
      <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="w-5 h-5 text-green-600" />
          Next Steps & What to Watch For
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {!summary ? (
          <div className="space-y-4">
            <div className="bg-green-50 p-3 rounded-lg border border-green-200 text-sm text-green-800">
              <Eye className="w-4 h-4 inline mr-1" />
              Generate a personalized take-home summary with action items, warning signs, and follow-up instructions.
            </div>

            <div>
              <Label>Session Notes (What was discussed)</Label>
              <Textarea
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                placeholder="Brief notes about what was covered during the education session..."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Medications Discussed</Label>
                <Input
                  value={medicationsDiscussed}
                  onChange={(e) => setMedicationsDiscussed(e.target.value)}
                  placeholder="e.g., Lasix, Lisinopril, Metformin"
                />
              </div>
              <div>
                <Label>Follow-up in (days)</Label>
                <Input
                  type="number"
                  value={followUpDays}
                  onChange={(e) => setFollowUpDays(e.target.value)}
                  placeholder="7"
                />
              </div>
            </div>

            <Button
              onClick={generateSummary}
              disabled={ai.loading}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {ai.loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Summary...</>
              ) : (
                <><ListChecks className="w-4 h-4 mr-2" /> Generate Patient Summary</>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header & Actions */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-lg">{summary.patient_name}'s Next Steps</h3>
                <p className="text-sm text-slate-600">{summary.condition_focus} | {summary.summary_date}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                </Button>
                <Button variant="outline" size="sm" onClick={handlePrint}>
                  <Printer className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Immediate Next Steps */}
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <h4 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
                <ArrowRight className="w-4 h-4" /> Do This First
              </h4>
              <div className="space-y-2">
                {summary.immediate_next_steps?.map((step, idx) => (
                  <div key={idx} className="flex items-start gap-2 bg-white p-2 rounded border">
                    <Checkbox 
                      checked={selectedItems[`step_${idx}`] || false}
                      onCheckedChange={(checked) => setSelectedItems(prev => ({...prev, [`step_${idx}`]: checked}))}
                    />
                    <div className="flex-1">
                      <p className="font-medium text-sm">{step.action}</p>
                      <p className="text-xs text-slate-600">
                        <Clock className="w-3 h-3 inline mr-1" />{step.when} — {step.how}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Daily Checklist */}
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <h4 className="font-semibold text-green-900 mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Daily Checklist
              </h4>
              <div className="space-y-2">
                {summary.daily_checklist?.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 bg-white p-2 rounded border">
                    <Checkbox 
                      checked={selectedItems[`daily_${idx}`] || false}
                      onCheckedChange={(checked) => setSelectedItems(prev => ({...prev, [`daily_${idx}`]: checked}))}
                    />
                    <div className="flex-1">
                      <p className="font-medium text-sm">{item.item}</p>
                      <Badge variant="outline" className="text-xs">{item.time_of_day}</Badge>
                      <p className="text-xs text-slate-600 mt-1">{item.details}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Warning Signs */}
            <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
              <h4 className="font-semibold text-yellow-900 mb-3 flex items-center gap-2">
                <Eye className="w-4 h-4" /> Watch For These Signs
              </h4>
              <div className="space-y-2">
                {summary.warning_signs_to_watch?.map((sign, idx) => (
                  <div key={idx} className="bg-white p-2 rounded border flex items-start gap-2">
                    <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${sign.severity === 'urgent' ? 'text-red-600' : sign.severity === 'concerning' ? 'text-yellow-600' : 'text-blue-600'}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{sign.sign}</span>
                        <Badge className={getSeverityColor(sign.severity)}>{sign.severity}</Badge>
                      </div>
                      <p className="text-xs text-slate-600">→ {sign.what_to_do}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Call Instructions */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                <h4 className="font-semibold text-blue-900 mb-2 flex items-center gap-1 text-sm">
                  <Phone className="w-4 h-4" /> Call Nurse If:
                </h4>
                <ul className="text-xs space-y-1">
                  {summary.call_nurse_if?.map((item, idx) => (
                    <li key={idx} className="text-blue-800">• {item}</li>
                  ))}
                </ul>
              </div>
              <div className="bg-red-50 p-3 rounded-lg border border-red-200">
                <h4 className="font-semibold text-red-900 mb-2 flex items-center gap-1 text-sm">
                  🚨 Call 911 If:
                </h4>
                <ul className="text-xs space-y-1">
                  {summary.call_911_if?.map((item, idx) => (
                    <li key={idx} className="text-red-800 font-medium">• {item}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Medication Reminders */}
            <div className="bg-navy-50 p-4 rounded-lg border border-navy-200">
              <h4 className="font-semibold text-navy-900 mb-3 flex items-center gap-2">
                <Pill className="w-4 h-4" /> Medication Reminders
              </h4>
              <div className="space-y-2">
                {summary.medication_reminders?.map((med, idx) => (
                  <div key={idx} className="bg-white p-2 rounded border">
                    <p className="font-medium text-sm">{med.medication}</p>
                    <p className="text-xs text-slate-700">{med.reminder}</p>
                    <p className="text-xs text-navy-600 mt-1">💡 {med.tip}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Encouragement */}
            <div className="bg-gradient-to-r from-green-100 to-emerald-100 p-4 rounded-lg text-center border border-green-200">
              <p className="text-green-800 font-medium">💚 {summary.encouragement_message}</p>
            </div>

            {/* Reset */}
            <Button variant="outline" onClick={() => setSummary(null)} className="w-full">
              Generate New Summary
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}