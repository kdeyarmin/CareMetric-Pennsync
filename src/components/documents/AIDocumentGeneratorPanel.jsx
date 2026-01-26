import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader, CheckCircle2, AlertCircle, Copy } from 'lucide-react';
import { toast } from 'sonner';

export default function AIDocumentGeneratorPanel({
  patientId,
  patientName,
  patientAge,
  diagnosis,
  visitType,
  onDocumentGenerated,
}) {
  const [roughNotes, setRoughNotes] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [vitalSigns, setVitalSigns] = useState({ temperature: '', pulse: '', respirations: '', bp: '' });
  const [generatedDocument, setGeneratedDocument] = useState('');
  const [complianceScore, setComplianceScore] = useState(0);
  const queryClient = useQueryClient();

  const { data: suggestedTemplates = [] } = useQuery({
    queryKey: ['suggestedTemplates', diagnosis, visitType],
    queryFn: async () => {
      const response = await base44.functions.invoke('suggestDocumentTemplates', {
        diagnosis,
        visitType,
      });
      return response?.data?.suggested_templates || [];
    },
    enabled: !!diagnosis && !!visitType,
  });

  const generateDocMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('generateClinicalDocument', {
        patientId,
        patientName,
        patientAge,
        diagnosis,
        visitType,
        roughNotes,
        templateId: selectedTemplate,
        vitalSigns: Object.fromEntries(
          Object.entries(vitalSigns).filter(([, v]) => v)
        ),
      });
      return response?.data;
    },
    onSuccess: (data) => {
      setGeneratedDocument(data.document);
      setComplianceScore(data.compliance?.score || 0);
      
      if (data.compliance?.issues?.length > 0) {
        toast.warning(`Document review: ${data.compliance.issues.length} items to review`);
      } else {
        toast.success('Document generated successfully');
      }

      onDocumentGenerated?.(data);
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  const handleGenerateDocument = async () => {
    if (!roughNotes.trim()) {
      toast.error('Please enter some notes first');
      return;
    }
    generateDocMutation.mutate();
  };

  const handleCopyDocument = () => {
    navigator.clipboard.writeText(generatedDocument);
    toast.success('Document copied to clipboard');
  };

  return (
    <div className="space-y-4">
      {/* Input Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Generate Clinical Document</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Patient Context */}
          <div className="grid grid-cols-2 gap-2 text-sm bg-blue-50 p-3 rounded-lg">
            <div>
              <p className="text-slate-600">Patient</p>
              <p className="font-medium">{patientName}</p>
            </div>
            <div>
              <p className="text-slate-600">Diagnosis</p>
              <p className="font-medium">{diagnosis}</p>
            </div>
            <div>
              <p className="text-slate-600">Visit Type</p>
              <p className="font-medium">{visitType}</p>
            </div>
            <div>
              <p className="text-slate-600">Age</p>
              <p className="font-medium">{patientAge}</p>
            </div>
          </div>

          {/* Template Selector */}
          {suggestedTemplates.length > 0 && (
            <div>
              <label className="text-sm font-medium">Suggested Template</label>
              <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a template (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>No template</SelectItem>
                  {suggestedTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.template_name} ({template.category})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Vital Signs */}
          <div>
            <label className="text-sm font-medium">Vital Signs (optional)</label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Temperature (°F)"
                value={vitalSigns.temperature}
                onChange={(e) =>
                  setVitalSigns({ ...vitalSigns, temperature: e.target.value })
                }
                className="text-sm"
              />
              <Input
                placeholder="Pulse (bpm)"
                value={vitalSigns.pulse}
                onChange={(e) => setVitalSigns({ ...vitalSigns, pulse: e.target.value })}
                className="text-sm"
              />
              <Input
                placeholder="Respirations (breaths/min)"
                value={vitalSigns.respirations}
                onChange={(e) =>
                  setVitalSigns({ ...vitalSigns, respirations: e.target.value })
                }
                className="text-sm"
              />
              <Input
                placeholder="Blood Pressure (mmHg)"
                value={vitalSigns.bp}
                onChange={(e) => setVitalSigns({ ...vitalSigns, bp: e.target.value })}
                className="text-sm"
              />
            </div>
          </div>

          {/* Rough Notes */}
          <div>
            <label className="text-sm font-medium">Clinical Notes</label>
            <Textarea
              placeholder="Enter your rough notes, observations, and assessment findings..."
              value={roughNotes}
              onChange={(e) => setRoughNotes(e.target.value)}
              className="min-h-32 text-sm"
            />
          </div>

          <Button
            onClick={handleGenerateDocument}
            disabled={generateDocMutation.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {generateDocMutation.isPending && <Loader className="w-4 h-4 mr-2 animate-spin" />}
            {generateDocMutation.isPending ? 'Generating...' : 'Generate Document'}
          </Button>
        </CardContent>
      </Card>

      {/* Generated Document Section */}
      {generatedDocument && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  Generated Document
                </CardTitle>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyDocument}
                className="gap-1"
              >
                <Copy className="w-4 h-4" />
                Copy
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Compliance Score */}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm text-slate-600">Compliance Score</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        complianceScore >= 80
                          ? 'bg-green-600'
                          : complianceScore >= 60
                          ? 'bg-yellow-600'
                          : 'bg-red-600'
                      }`}
                      style={{ width: `${complianceScore}%` }}
                    />
                  </div>
                  <span className="font-semibold">{complianceScore}/100</span>
                </div>
              </div>
            </div>

            {/* Document Preview */}
            <div className="bg-white border rounded-lg p-4 max-h-96 overflow-y-auto text-sm whitespace-pre-wrap font-mono text-slate-700">
              {generatedDocument}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={handleCopyDocument}>
                Copy Document
              </Button>
              <Button className="flex-1 bg-blue-600 hover:bg-blue-700">
                Save Document
              </Button>
              <Button variant="outline" className="flex-1">
                Generate Tasks
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}