import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { FileText, Printer, Mail, Download, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

export default function QuickPatientHandoutGenerator({ 
  patientId, 
  visitNotes, 
  diagnosis,
  medications 
}) {
  const [generating, setGenerating] = useState(false);
  const [handout, setHandout] = useState(null);

  const generateHandout = async () => {
    setGenerating(true);
    try {
      const prompt = `Create a patient-friendly educational handout based on this visit:

Diagnosis: ${diagnosis || 'General visit'}
Visit Notes: ${visitNotes?.substring(0, 500) || 'N/A'}
Medications: ${medications?.map(m => m.name).join(', ') || 'None'}

Generate a clear, easy-to-understand handout with:
1. What We Discussed Today (2-3 sentences)
2. Your Condition Explained (simple language, 3-4 sentences)
3. What You Need to Do (3-5 bullet points)
4. Warning Signs to Watch For (3-4 items)
5. When to Call Us (specific situations)
6. Medication Instructions (if applicable)

Use simple 6th-grade reading level language. Be reassuring but clear.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            summary: { type: 'string' },
            condition_explanation: { type: 'string' },
            action_items: { type: 'array', items: { type: 'string' } },
            warning_signs: { type: 'array', items: { type: 'string' } },
            when_to_call: { type: 'array', items: { type: 'string' } },
            medication_instructions: { type: 'string' }
          }
        }
      });

      setHandout(response);
      toast.success('Handout generated');
    } catch (error) {
      console.error('Error generating handout:', error);
      toast.error('Failed to generate handout');
    } finally {
      setGenerating(false);
    }
  };

  const printHandout = () => {
    const printWindow = window.open('', '', 'width=800,height=600');
    printWindow.document.write(`
      <html>
        <head>
          <title>${handout.title}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; }
            h1 { color: #2563eb; }
            h2 { color: #475569; margin-top: 20px; }
            ul { line-height: 1.8; }
            .warning { color: #dc2626; font-weight: bold; }
          </style>
        </head>
        <body>
          <h1>${handout.title}</h1>
          <h2>What We Discussed Today</h2>
          <p>${handout.summary}</p>
          <h2>Understanding Your Condition</h2>
          <p>${handout.condition_explanation}</p>
          <h2>What You Need to Do</h2>
          <ul>${handout.action_items.map(item => `<li>${item}</li>`).join('')}</ul>
          <h2 class="warning">Warning Signs</h2>
          <ul>${handout.warning_signs.map(sign => `<li>${sign}</li>`).join('')}</ul>
          <h2>When to Call Us</h2>
          <ul>${handout.when_to_call.map(item => `<li>${item}</li>`).join('')}</ul>
          ${handout.medication_instructions ? `<h2>Medication Instructions</h2><p>${handout.medication_instructions}</p>` : ''}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <Card className="border-green-200 dark:border-green-800">
      <CardHeader className="bg-green-50 dark:bg-green-950">
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="w-5 h-5 text-green-600 dark:text-green-400" />
          Patient Handout
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {!handout ? (
          <Button 
            onClick={generateHandout} 
            disabled={generating}
            className="w-full bg-green-600 hover:bg-green-700"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating Patient Handout...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Patient Handout
              </>
            )}
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg max-h-96 overflow-y-auto">
              <h3 className="font-bold text-lg mb-2">{handout.title}</h3>
              
              <div className="mb-3">
                <p className="font-semibold text-sm mb-1">What We Discussed Today</p>
                <p className="text-sm">{handout.summary}</p>
              </div>

              <div className="mb-3">
                <p className="font-semibold text-sm mb-1">Understanding Your Condition</p>
                <p className="text-sm">{handout.condition_explanation}</p>
              </div>

              <div className="mb-3">
                <p className="font-semibold text-sm mb-1">What You Need to Do</p>
                <ul className="text-sm list-disc list-inside space-y-1">
                  {handout.action_items.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="mb-3 p-3 bg-red-50 dark:bg-red-900 rounded">
                <p className="font-semibold text-sm mb-1 text-red-700 dark:text-red-300">Warning Signs</p>
                <ul className="text-sm list-disc list-inside space-y-1">
                  {handout.warning_signs.map((sign, idx) => (
                    <li key={idx}>{sign}</li>
                  ))}
                </ul>
              </div>

              <div className="mb-3">
                <p className="font-semibold text-sm mb-1">When to Call Us</p>
                <ul className="text-sm list-disc list-inside space-y-1">
                  {handout.when_to_call.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>

              {handout.medication_instructions && (
                <div>
                  <p className="font-semibold text-sm mb-1">Medication Instructions</p>
                  <p className="text-sm">{handout.medication_instructions}</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button onClick={printHandout} variant="outline">
                <Printer className="w-4 h-4 mr-2" />
                Print
              </Button>
              <Button onClick={generateHandout} variant="outline">
                <Sparkles className="w-4 h-4 mr-2" />
                Regenerate
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}