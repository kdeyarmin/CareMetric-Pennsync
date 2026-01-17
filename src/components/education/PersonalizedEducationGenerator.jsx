import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, FileText, Download, Send, CheckCircle2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function PersonalizedEducationGenerator({ 
  diagnosis, 
  visitType, 
  clinicalNote,
  patientId,
  patientContext,
  onMaterialGenerated 
}) {
  const [generating, setGenerating] = useState(false);
  const [generatedMaterial, setGeneratedMaterial] = useState(null);
  const [providing, setProviding] = useState(false);

  const generateMaterial = async () => {
    if (!diagnosis) {
      toast.error('Diagnosis required to generate education');
      return;
    }

    setGenerating(true);
    try {
      const response = await base44.functions.invoke('generatePatientEducationMaterial', {
        patient_id: patientId,
        diagnosis,
        topic: diagnosis,
        visit_type: visitType,
        clinical_note: clinicalNote,
        patient_context: patientContext,
        education_level: 'basic',
        language: 'English'
      });

      const material = response.data;
      setGeneratedMaterial(material);
      toast.success('Personalized education material generated!');
    } catch (error) {
      console.error('Error generating material:', error);
      toast.error('Failed to generate education material');
    } finally {
      setGenerating(false);
    }
  };

  const markAsProvided = async (method) => {
    setProviding(true);
    try {
      if (patientId && generatedMaterial) {
        // Create assignment record
        await base44.entities.PatientEducationAssignment.create({
          patient_id: patientId,
          education_material_id: null, // AI-generated, not from library
          material_title: generatedMaterial.title,
          assigned_by: (await base44.auth.me()).email,
          assigned_date: new Date().toISOString(),
          delivery_method: method,
          provided_date: new Date().toISOString(),
          status: 'provided',
          notes: 'AI-generated personalized education material'
        });
      }

      if (onMaterialGenerated) {
        onMaterialGenerated(generatedMaterial, method);
      }

      toast.success(`Education marked as provided via ${method}`);
    } catch (error) {
      console.error('Error marking as provided:', error);
      toast.error('Failed to track education');
    } finally {
      setProviding(false);
    }
  };

  const downloadPDF = () => {
    // Create simple text version for download
    const content = `
${generatedMaterial.title}

OVERVIEW:
${generatedMaterial.overview}

KEY POINTS:
${generatedMaterial.key_points?.map((p, i) => `${i + 1}. ${p}`).join('\n')}

WHAT TO EXPECT:
${generatedMaterial.what_to_expect}

${generatedMaterial.personalized_recommendations ? `PERSONALIZED RECOMMENDATIONS:
${generatedMaterial.personalized_recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : ''}

DAILY CARE TIPS:
${generatedMaterial.daily_care_tips?.map((t, i) => `${i + 1}. ${t}`).join('\n')}

${generatedMaterial.medications ? `MEDICATIONS:
${generatedMaterial.medications}` : ''}

⚠️ WARNING SIGNS:
${generatedMaterial.warning_signs?.map((w, i) => `${i + 1}. ${w}`).join('\n')}

WHEN TO CALL YOUR HEALTHCARE PROVIDER:
${generatedMaterial.when_to_call}

${generatedMaterial.follow_up_instructions ? `FOLLOW-UP INSTRUCTIONS:
${generatedMaterial.follow_up_instructions}` : ''}

HELPFUL RESOURCES:
${generatedMaterial.helpful_resources?.map((r, i) => `${i + 1}. ${r}`).join('\n')}
    `;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${generatedMaterial.title.replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="border-purple-200 bg-purple-50 dark:bg-purple-950">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-purple-600" />
            Personalized Patient Education
          </span>
          {!generatedMaterial && (
            <Button 
              onClick={generateMaterial} 
              disabled={generating || !diagnosis}
              size="sm"
              className="bg-purple-600 hover:bg-purple-700"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                'Generate AI Education'
              )}
            </Button>
          )}
        </CardTitle>
      </CardHeader>

      {generatedMaterial && (
        <CardContent className="space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-lg p-4 space-y-4">
            <div>
              <h3 className="font-bold text-lg mb-2">{generatedMaterial.title}</h3>
              <p className="text-sm text-gray-700 dark:text-gray-300">{generatedMaterial.overview}</p>
            </div>

            {generatedMaterial.key_points?.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-2">Key Points:</h4>
                <ul className="list-disc list-inside space-y-1">
                  {generatedMaterial.key_points.map((point, idx) => (
                    <li key={idx} className="text-sm text-gray-700 dark:text-gray-300">{point}</li>
                  ))}
                </ul>
              </div>
            )}

            {generatedMaterial.personalized_recommendations?.length > 0 && (
              <div className="bg-blue-50 dark:bg-blue-900 p-3 rounded">
                <h4 className="font-semibold text-sm mb-2 text-blue-900 dark:text-blue-100">
                  Personalized for You:
                </h4>
                <ul className="list-disc list-inside space-y-1">
                  {generatedMaterial.personalized_recommendations.map((rec, idx) => (
                    <li key={idx} className="text-sm text-blue-800 dark:text-blue-200">{rec}</li>
                  ))}
                </ul>
              </div>
            )}

            {generatedMaterial.warning_signs?.length > 0 && (
              <div className="bg-red-50 dark:bg-red-900 p-3 rounded">
                <h4 className="font-semibold text-sm mb-2 text-red-900 dark:text-red-100">
                  ⚠️ Warning Signs - Call Your Provider If:
                </h4>
                <ul className="list-disc list-inside space-y-1">
                  {generatedMaterial.warning_signs.map((sign, idx) => (
                    <li key={idx} className="text-sm text-red-800 dark:text-red-200">{sign}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button 
              onClick={downloadPDF} 
              variant="outline" 
              size="sm"
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
            <Button 
              onClick={() => markAsProvided('printed')} 
              disabled={providing}
              variant="outline" 
              size="sm"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Mark as Printed
            </Button>
            <Button 
              onClick={() => markAsProvided('verbal')} 
              disabled={providing}
              variant="outline" 
              size="sm"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Mark as Discussed
            </Button>
            {patientId && (
              <Button 
                onClick={() => markAsProvided('via_portal')} 
                disabled={providing}
                className="bg-green-600 hover:bg-green-700"
                size="sm"
              >
                <Send className="w-4 h-4 mr-2" />
                Send to Patient
              </Button>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}