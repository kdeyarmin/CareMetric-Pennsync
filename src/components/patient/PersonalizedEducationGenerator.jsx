import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { isSafeExternalUrl } from "@/components/utils/security";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  BookOpen,
  Sparkles,
  Copy,
  Mail,
  Printer,
  Loader2,
  CheckCircle2
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from 'sonner';

export default function PersonalizedEducationGenerator({ patient, complianceData, visits }) {
  const ai = useAICall();
  const [educationMaterials, setEducationMaterials] = useState(null);

  const generateMaterials = async () => {
    try {
      const recentCompliance = complianceData || {};
      const recentVisit = visits?.[0];

      const result = await ai.run({
        model: "claude_sonnet_4_6",
        prompt: `Generate personalized patient education materials for this patient:

PATIENT INFORMATION:
- Name: ${patient.first_name} ${patient.last_name}
- Age: ${patient.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : 'Unknown'}
- Primary Diagnosis: ${patient.primary_diagnosis}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Current Medications: ${patient.current_medications?.map(m => m.name).join(', ') || 'None'}
- Allergies: ${patient.allergies || 'None'}
- Functional Status: Ambulation=${patient.functional_status?.ambulation}, ADL Independence=${patient.functional_status?.adl_independence}
- Primary Language: ${patient.social_history?.primary_language || 'English'}
- Reading Level: ${patient.social_history?.interpreter_needed ? 'Simple/Visual' : 'Standard'}

RECENT VISIT DATA:
${recentVisit ? `- Last Visit: ${recentVisit.visit_date}
- Vital Signs: BP ${recentVisit.vital_signs?.blood_pressure_systolic}/${recentVisit.vital_signs?.blood_pressure_diastolic}, HR ${recentVisit.vital_signs?.heart_rate}
- Pain Level: ${recentVisit.vital_signs?.pain_level}/10` : 'No recent visits'}

COMPLIANCE STATUS:
- Overall Compliance: ${recentCompliance.overall_compliance_score || 'Unknown'}%
- Critical Issues: ${recentCompliance.violations?.filter(v => v.severity === 'critical').length || 0}

Create comprehensive, personalized education materials covering:

1. CONDITION OVERVIEW: Simple explanation of their condition(s) tailored to their health literacy
2. MEDICATIONS: Easy-to-understand guide about their medications, timing, side effects, and what to watch for
3. SELF-CARE INSTRUCTIONS: Daily self-care tasks specific to their condition and functional abilities
4. WARNING SIGNS: Clear list of symptoms that require immediate medical attention
5. LIFESTYLE RECOMMENDATIONS: Diet, activity, and lifestyle modifications specific to their conditions
6. MEDICATION MANAGEMENT: Tips for remembering medications and tracking adherence
7. SAFETY AT HOME: Fall prevention and safety tips based on their functional status
8. WHEN TO CALL: Clear guidelines on when to contact their nurse or doctor
9. RESOURCES: Relevant support groups, educational websites, and community resources
10. NEXT STEPS: What to expect and prepare for upcoming visits

Make it:
- Written at appropriate reading level (${patient.social_history?.interpreter_needed ? '5th grade' : '8th grade'})
- Culturally sensitive
- Actionable and specific
- Encouraging and supportive in tone
- Includes visual descriptions where helpful
- Addresses their specific compliance gaps if any

Format each section clearly with headers.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            condition_overview: { type: "string" },
            medication_guide: { type: "string" },
            self_care_instructions: { type: "string" },
            warning_signs: { type: "array", items: { type: "string" } },
            lifestyle_recommendations: { type: "string" },
            medication_management_tips: { type: "string" },
            safety_at_home: { type: "string" },
            when_to_call: { type: "array", items: { type: "string" } },
            resources: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  link: { type: "string" }
                }
              }
            },
            next_steps: { type: "string" },
            key_takeaways: { type: "array", items: { type: "string" } }
          }
        }
      });

      setEducationMaterials(result);
    } catch (error) {
      console.error('Education generation error:', error);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleCopy = () => {
    const fullText = `
PATIENT EDUCATION MATERIALS
Generated for: ${patient.first_name} ${patient.last_name}
Date: ${new Date().toLocaleDateString()}

CONDITION OVERVIEW
${educationMaterials.condition_overview}

MEDICATION GUIDE
${educationMaterials.medication_guide}

SELF-CARE INSTRUCTIONS
${educationMaterials.self_care_instructions}

WARNING SIGNS - CALL 911 IF:
${educationMaterials.warning_signs?.map(s => `• ${s}`).join('\n')}

LIFESTYLE RECOMMENDATIONS
${educationMaterials.lifestyle_recommendations}

MEDICATION MANAGEMENT TIPS
${educationMaterials.medication_management_tips}

SAFETY AT HOME
${educationMaterials.safety_at_home}

WHEN TO CALL YOUR NURSE/DOCTOR
${educationMaterials.when_to_call?.map(s => `• ${s}`).join('\n')}

HELPFUL RESOURCES
${educationMaterials.resources?.map(r => `• ${r.name}: ${r.description}`).join('\n')}

NEXT STEPS
${educationMaterials.next_steps}

KEY TAKEAWAYS
${educationMaterials.key_takeaways?.map(k => `• ${k}`).join('\n')}
    `.trim();

    navigator.clipboard.writeText(fullText);
  };

  const handleEmail = async () => {
    if (!patient.caregiver_email && !patient.email) {
      toast.error('No email address available for this patient or caregiver');
      return;
    }

    const emailContent = `
<h2>Patient Education Materials</h2>
<p><strong>For:</strong> ${patient.first_name} ${patient.last_name}</p>
<p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>

<h3>Condition Overview</h3>
<p>${educationMaterials.condition_overview}</p>

<h3>Medication Guide</h3>
<p>${educationMaterials.medication_guide}</p>

<h3>Self-Care Instructions</h3>
<p>${educationMaterials.self_care_instructions}</p>

<h3>⚠️ Warning Signs - Call 911 If:</h3>
<ul>${educationMaterials.warning_signs?.map(s => `<li>${s}</li>`).join('')}</ul>

<h3>Lifestyle Recommendations</h3>
<p>${educationMaterials.lifestyle_recommendations}</p>

<h3>Key Takeaways</h3>
<ul>${educationMaterials.key_takeaways?.map(k => `<li>${k}</li>`).join('')}</ul>
    `;

    try {
      await base44.integrations.Core.SendEmail({
        to: patient.caregiver_email || patient.email,
        subject: `Patient Education Materials - ${patient.first_name} ${patient.last_name}`,
        body: emailContent
      });
      toast.success('Education materials sent successfully!');
    } catch (error) {
      console.error('Email error:', error);
      toast.error('Failed to send email');
    }
  };

  if (ai.loading) {
    return (
      <Card className="border-2 border-green-300">
        <CardContent className="p-6 text-center">
          <Loader2 className="h-12 w-12 animate-spin text-green-600 mx-auto mb-4" />
          <p className="text-sm text-slate-900 font-semibold">Generating Personalized Education Materials...</p>
          <p className="text-xs text-slate-600 mt-2">📚 Customizing content based on patient's condition, language, and compliance status</p>
        </CardContent>
      </Card>
    );
  }

  if (!educationMaterials) {
    return (
      <Card className="border-2 border-green-300">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-green-600" />
            Personalized Patient Education
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="bg-green-50 border-green-200 mb-3">
            <BookOpen className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-xs text-green-900">
              Generate customized education materials based on patient's diagnosis, medications, compliance status, and reading level
            </AlertDescription>
          </Alert>
          <Button onClick={generateMaterials} className="bg-green-600 hover:bg-green-700">
            <Sparkles className="w-4 h-4 mr-2" />
            Generate Education Materials
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-green-300">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-green-600" />
            Patient Education Materials
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleCopy}>
              <Copy className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={handleEmail} disabled={!patient.email && !patient.caregiver_email}>
              <Mail className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={handlePrint}>
              <Printer className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="medications">Medications</TabsTrigger>
            <TabsTrigger value="safety">Safety</TabsTrigger>
            <TabsTrigger value="resources">Resources</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="bg-blue-50 p-4 rounded border border-blue-200">
              <h3 className="font-semibold text-sm text-blue-900 mb-2">Your Condition</h3>
              <p className="text-sm text-blue-800 whitespace-pre-wrap">{educationMaterials.condition_overview}</p>
            </div>

            <div className="bg-navy-50 p-4 rounded border border-navy-200">
              <h3 className="font-semibold text-sm text-navy-900 mb-2">Daily Self-Care</h3>
              <p className="text-sm text-navy-800 whitespace-pre-wrap">{educationMaterials.self_care_instructions}</p>
            </div>

            {educationMaterials.key_takeaways?.length > 0 && (
              <div className="bg-green-50 p-4 rounded border border-green-200">
                <h3 className="font-semibold text-sm text-green-900 mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Key Takeaways
                </h3>
                <ul className="space-y-1">
                  {educationMaterials.key_takeaways.map((item, idx) => (
                    <li key={idx} className="text-sm text-green-800">✓ {item}</li>
                  ))}
                </ul>
              </div>
            )}
          </TabsContent>

          <TabsContent value="medications" className="space-y-4 mt-4">
            <div className="bg-indigo-50 p-4 rounded border border-indigo-200">
              <h3 className="font-semibold text-sm text-indigo-900 mb-2">Your Medications</h3>
              <p className="text-sm text-indigo-800 whitespace-pre-wrap">{educationMaterials.medication_guide}</p>
            </div>

            <div className="bg-navy-50 p-4 rounded border border-navy-200">
              <h3 className="font-semibold text-sm text-navy-900 mb-2">Medication Management Tips</h3>
              <p className="text-sm text-navy-800 whitespace-pre-wrap">{educationMaterials.medication_management_tips}</p>
            </div>

            <div className="bg-orange-50 p-4 rounded border border-orange-200">
              <h3 className="font-semibold text-sm text-orange-900 mb-2">Lifestyle Recommendations</h3>
              <p className="text-sm text-orange-800 whitespace-pre-wrap">{educationMaterials.lifestyle_recommendations}</p>
            </div>
          </TabsContent>

          <TabsContent value="safety" className="space-y-4 mt-4">
            <div className="bg-red-50 p-4 rounded border border-red-200">
              <h3 className="font-semibold text-sm text-red-900 mb-2">🚨 Warning Signs - Call 911 If:</h3>
              <ul className="space-y-2">
                {educationMaterials.warning_signs?.map((sign, idx) => (
                  <li key={idx} className="text-sm text-red-800 font-medium">• {sign}</li>
                ))}
              </ul>
            </div>

            <div className="bg-yellow-50 p-4 rounded border border-yellow-200">
              <h3 className="font-semibold text-sm text-yellow-900 mb-2">When to Call Your Nurse/Doctor</h3>
              <ul className="space-y-1">
                {educationMaterials.when_to_call?.map((item, idx) => (
                  <li key={idx} className="text-sm text-yellow-800">• {item}</li>
                ))}
              </ul>
            </div>

            <div className="bg-slate-50 p-4 rounded border border-slate-200">
              <h3 className="font-semibold text-sm text-slate-900 mb-2">Safety at Home</h3>
              <p className="text-sm text-slate-800 whitespace-pre-wrap">{educationMaterials.safety_at_home}</p>
            </div>
          </TabsContent>

          <TabsContent value="resources" className="space-y-4 mt-4">
            {educationMaterials.resources?.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold text-sm text-slate-900">Helpful Resources</h3>
                {educationMaterials.resources.map((resource, idx) => (
                  <div key={idx} className="bg-white p-3 rounded border hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-semibold text-sm text-slate-900">{resource.name}</p>
                        <p className="text-xs text-slate-600 mt-1">{resource.description}</p>
                      </div>
                      {resource.link && (
                        <a
                          href={isSafeExternalUrl(resource.link) ? resource.link : undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-blue-600 hover:text-blue-800"
                        >
                          <Badge variant="outline" className="cursor-pointer">Visit</Badge>
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-blue-50 p-4 rounded border border-blue-200">
              <h3 className="font-semibold text-sm text-blue-900 mb-2">Next Steps</h3>
              <p className="text-sm text-blue-800 whitespace-pre-wrap">{educationMaterials.next_steps}</p>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}