import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FileText,
  Heart,
  RefreshCw,
  Copy,
  CheckCircle2,
  Mail,
  Printer,
  Sparkles,
  User
} from "lucide-react";
import { format } from "date-fns";
import { toast } from 'sonner';

export default function PatientFriendlyCarePlanSummary({ patient, carePlans, _onEmailSummary }) {
  const [summary, setSummary] = useState(null);
  const ai = useAICall();
  const [copied, setCopied] = useState(false);

  const activeCarePlans = (carePlans || []).filter(cp => cp.status === 'active');

  const generateSummary = async () => {
    if (!patient || activeCarePlans.length === 0) {
      toast.error('No active care plans to summarize');
      return;
    }

    try {
      const carePlanData = activeCarePlans.map(cp => ({
        problem: cp.problem,
        goal: cp.goal,
        interventions: cp.interventions,
        target_date: cp.target_date
      }));

      const prompt = `You are a patient education specialist. Create a patient-friendly summary of the care plan that a patient or family caregiver can easily understand.

PATIENT: ${patient.first_name} ${patient.last_name}
DIAGNOSIS: ${patient.primary_diagnosis || 'Not specified'}
CARE TYPE: ${patient.care_type === 'hospice' ? 'Hospice Care' : 'Home Health Care'}

CARE PLANS:
${JSON.stringify(carePlanData, null, 2)}

Create a warm, easy-to-understand summary that:
1. Uses simple, non-medical language (6th grade reading level)
2. Explains what we're working on and why
3. Describes what the patient/caregiver can do to help
4. Includes encouragement and positive framing
5. Lists important things to watch for
6. Provides clear next steps

Return JSON:
{
  "greeting": "Personalized greeting for the patient",
  "overview": "2-3 sentence overview of the care plan in simple terms",
  "goals_explained": [
    {
      "goal_title": "Simple title for the goal",
      "what_it_means": "Plain language explanation",
      "how_we_help": "What the healthcare team will do",
      "what_you_can_do": "What the patient/caregiver can do",
      "target_timeframe": "When we hope to achieve this"
    }
  ],
  "watch_for": ["Simple warning signs to report"],
  "your_care_team_will": ["List of what the care team will do"],
  "tips_for_success": ["Helpful tips for the patient"],
  "encouragement": "Positive, encouraging closing message",
  "questions_to_ask": ["Suggested questions for the patient to ask"]
}`;

      const result = await ai.run({
        model: "claude_sonnet_4_6",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            greeting: { type: "string" },
            overview: { type: "string" },
            goals_explained: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  goal_title: { type: "string" },
                  what_it_means: { type: "string" },
                  how_we_help: { type: "string" },
                  what_you_can_do: { type: "string" },
                  target_timeframe: { type: "string" }
                }
              }
            },
            watch_for: { type: "array", items: { type: "string" } },
            your_care_team_will: { type: "array", items: { type: "string" } },
            tips_for_success: { type: "array", items: { type: "string" } },
            encouragement: { type: "string" },
            questions_to_ask: { type: "array", items: { type: "string" } }
          }
        }
      });

      setSummary(result);
    } catch (error) {
      console.error('Error generating summary:', error);
      toast.error('Failed to generate summary. Please try again.');
    }
  };

  const handleCopy = () => {
    if (!summary) return;
    
    const text = `
${summary.greeting}

${summary.overview}

YOUR CARE GOALS:
${summary.goals_explained?.map(g => `
📌 ${g.goal_title}
   What this means: ${g.what_it_means}
   How we'll help: ${g.how_we_help}
   What you can do: ${g.what_you_can_do}
   Target timeframe: ${g.target_timeframe}
`).join('\n')}

⚠️ WATCH FOR THESE WARNING SIGNS:
${summary.watch_for?.map(w => `• ${w}`).join('\n')}

YOUR CARE TEAM WILL:
${summary.your_care_team_will?.map(t => `• ${t}`).join('\n')}

💡 TIPS FOR SUCCESS:
${summary.tips_for_success?.map(t => `• ${t}`).join('\n')}

${summary.encouragement}

QUESTIONS TO ASK YOUR NURSE:
${summary.questions_to_ask?.map(q => `• ${q}`).join('\n')}

---
Generated on ${format(new Date(), 'MMMM d, yyyy')}
    `.trim();

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEmail = async () => {
    if (!summary || !patient?.email) {
      toast.error('Patient email not available');
      return;
    }

    const body = `
Dear ${patient.first_name},

${summary.greeting}

${summary.overview}

YOUR CARE GOALS:
${summary.goals_explained?.map(g => `
• ${g.goal_title}
  What this means: ${g.what_it_means}
  How we'll help: ${g.how_we_help}
  What you can do: ${g.what_you_can_do}
`).join('\n')}

WATCH FOR THESE WARNING SIGNS (call us if you notice):
${summary.watch_for?.map(w => `• ${w}`).join('\n')}

TIPS FOR SUCCESS:
${summary.tips_for_success?.map(t => `• ${t}`).join('\n')}

${summary.encouragement}

Your Care Team
    `.trim();

    try {
      await base44.integrations.Core.SendEmail({
        to: patient.email,
        subject: `Your Care Plan Summary - ${format(new Date(), 'MMMM d, yyyy')}`,
        body: body,
        from_name: 'Penn Sync Care Team'
      });
      toast.success('Summary sent to patient!');
    } catch (error) {
      console.error('Failed to send email:', error);
      toast.error('Failed to send email. Please try again.');
    }
  };

  if (!patient) return null;

  return (
    <Card className="border-green-200">
      <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-green-600" />
            Patient-Friendly Summary
          </CardTitle>
          <Button
            onClick={generateSummary}
            disabled={ai.loading || activeCarePlans.length === 0}
            size="sm"
            className="bg-green-600 hover:bg-green-700"
          >
            {ai.loading ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Summary
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {activeCarePlans.length === 0 && (
          <div className="text-center py-6 text-slate-500">
            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm">No active care plans to summarize</p>
          </div>
        )}

        {activeCarePlans.length > 0 && !summary && !ai.loading && (
          <div className="text-center py-6 text-slate-500">
            <User className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm">Generate a patient-friendly version of the care plan</p>
            <p className="text-xs text-slate-400 mt-1">Easy to understand for patients and caregivers</p>
          </div>
        )}

        {summary && (
          <div className="space-y-4">
            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <CheckCircle2 className="w-4 h-4 mr-1 text-green-600" /> : <Copy className="w-4 h-4 mr-1" />}
                {copied ? 'Copied!' : 'Copy'}
              </Button>
              {patient?.email && (
                <Button variant="outline" size="sm" onClick={handleEmail}>
                  <Mail className="w-4 h-4 mr-1" />
                  Email to Patient
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="w-4 h-4 mr-1" />
                Print
              </Button>
            </div>

            {/* Greeting */}
            <Alert className="bg-green-50 border-green-200">
              <Heart className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900">
                <p className="font-medium">{summary.greeting}</p>
                <p className="mt-2 text-sm">{summary.overview}</p>
              </AlertDescription>
            </Alert>

            {/* Goals Explained */}
            <div className="space-y-3">
              <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                🎯 Your Care Goals
              </h4>
              {summary.goals_explained?.map((goal, idx) => (
                <Card key={idx} className="bg-white border border-slate-200">
                  <CardContent className="p-4">
                    <h5 className="font-semibold text-slate-900 mb-2">{goal.goal_title}</h5>
                    <div className="space-y-2 text-sm">
                      <p><strong>What this means:</strong> {goal.what_it_means}</p>
                      <p><strong>How we'll help:</strong> {goal.how_we_help}</p>
                      <p className="text-green-700"><strong>What you can do:</strong> {goal.what_you_can_do}</p>
                      <Badge variant="outline" className="mt-2">{goal.target_timeframe}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Watch For */}
            {summary.watch_for?.length > 0 && (
              <Alert className="bg-orange-50 border-orange-200">
                <AlertDescription className="text-orange-900">
                  <p className="font-semibold mb-2">⚠️ Call us right away if you notice:</p>
                  <ul className="list-disc ml-5 text-sm">
                    {summary.watch_for.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Tips */}
            {summary.tips_for_success?.length > 0 && (
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <p className="font-semibold text-blue-900 mb-2">💡 Tips for Success</p>
                <ul className="list-disc ml-5 text-sm text-blue-800">
                  {summary.tips_for_success.map((tip, idx) => (
                    <li key={idx}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Encouragement */}
            <Alert className="bg-navy-50 border-navy-200">
              <Sparkles className="w-4 h-4 text-navy-600" />
              <AlertDescription className="text-navy-900 italic">
                {summary.encouragement}
              </AlertDescription>
            </Alert>

            {/* Questions to Ask */}
            {summary.questions_to_ask?.length > 0 && (
              <div className="p-4 bg-slate-50 rounded-lg border">
                <p className="font-semibold text-slate-900 mb-2">❓ Questions to Ask Your Nurse</p>
                <ul className="list-disc ml-5 text-sm text-slate-700">
                  {summary.questions_to_ask.map((q, idx) => (
                    <li key={idx}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}