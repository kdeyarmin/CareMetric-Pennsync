import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Copy,
  FileText,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Wand2
} from "lucide-react";
import { toast } from 'sonner';

export default function TemplateEditor({ 
  templateData, 
  patient,
  _visitType,
  onContentChange,
  onClose 
}) {
  const [content, setContent] = useState(templateData?.content?.template_content || '');
  const [expandedSections, setExpandedSections] = useState({});
  const [clinicalResponses, setClinicalResponses] = useState({});
  const ai = useAICall();
  const [copied, setCopied] = useState(false);

  const clinicalPrompts = templateData?.content?.clinical_prompts || [];
  const requiredFields = templateData?.content?.required_fields || [];

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleClinicalResponse = (section, value) => {
    setClinicalResponses(prev => ({
      ...prev,
      [section]: value
    }));
  };

  const handleEnhanceWithAI = async () => {
    try {
      const prompt = `You are a clinical documentation specialist. Enhance this clinical note by:
1. Filling in placeholders with clinically appropriate language based on the responses provided
2. Ensuring Medicare compliance
3. Adding professional clinical terminology
4. Making it complete and ready for EHR submission

PATIENT CONTEXT:
- Name: ${patient?.first_name || 'Patient'} ${patient?.last_name || ''}
- Diagnosis: ${patient?.primary_diagnosis || 'Not specified'}
- Care Type: ${patient?.care_type || 'home_health'}

TEMPLATE TYPE: ${templateData?.template?.name || 'Clinical Visit'}

CLINICIAN RESPONSES:
${Object.entries(clinicalResponses).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

CURRENT TEMPLATE:
${content}

Return the enhanced, complete clinical note ready for documentation. Keep all factual information accurate. Fill in bracketed placeholders appropriately.`;

      const result = await ai.run({
        model: "claude_sonnet_4_6",
        prompt
      });

      setContent(result);
      if (onContentChange) {
        onContentChange(result);
      }
    } catch (error) {
      console.error('Error enhancing template:', error);
      toast.error('Failed to enhance template. Please try again.');
    }
  };

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleContentChange = (newContent) => {
    setContent(newContent);
    if (onContentChange) {
      onContentChange(newContent);
    }
  };

  // Group prompts by section
  const groupedPrompts = clinicalPrompts.reduce((acc, prompt) => {
    if (!acc[prompt.section]) {
      acc[prompt.section] = [];
    }
    acc[prompt.section].push(prompt);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Template Info */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 ${templateData?.template?.color || 'bg-blue-500'} rounded-lg flex items-center justify-center`}>
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">{templateData?.template?.name || 'Clinical Template'}</h3>
                <p className="text-sm text-slate-600">{templateData?.template?.description}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyToClipboard}
                className="gap-2"
              >
                {copied ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copy
                  </>
                )}
              </Button>
              {onClose && (
                <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Clinical Prompts */}
      {Object.keys(groupedPrompts).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-navy-600" />
              Quick Fill - Clinical Responses
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(groupedPrompts).map(([section, prompts]) => (
              <div key={section} className="border rounded-lg">
                <button
                  onClick={() => toggleSection(section)}
                  className="w-full flex items-center justify-between p-3 hover:bg-slate-50"
                >
                  <span className="font-medium capitalize">{section.replace(/_/g, ' ')}</span>
                  {expandedSections[section] ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
                {expandedSections[section] && (
                  <div className="p-3 pt-0 space-y-3 border-t">
                    {prompts.map((prompt, idx) => (
                      <div key={idx}>
                        <Label className="text-sm text-slate-700">{prompt.prompt}</Label>
                        {prompt.options && prompt.options.length > 0 ? (
                          <Select
                            value={clinicalResponses[`${section}_${idx}`] || ''}
                            onValueChange={(value) => handleClinicalResponse(`${section}_${idx}`, value)}
                          >
                            <SelectTrigger className="mt-1">
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                            <SelectContent>
                              {prompt.options.map((option, optIdx) => (
                                <SelectItem key={optIdx} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            className="mt-1"
                            placeholder="Enter value..."
                            value={clinicalResponses[`${section}_${idx}`] || ''}
                            onChange={(e) => handleClinicalResponse(`${section}_${idx}`, e.target.value)}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <Button
              onClick={handleEnhanceWithAI}
              disabled={ai.loading}
              className="w-full bg-gradient-to-r from-navy-600 to-gold-600 hover:from-navy-700 hover:to-gold-700"
            >
              {ai.loading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Enhancing with AI...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4 mr-2" />
                  Apply Responses & Enhance with AI
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Required Fields Alert */}
      {requiredFields.length > 0 && (
        <Alert className="bg-yellow-50 border-yellow-200">
          <AlertCircle className="w-4 h-4 text-yellow-600" />
          <AlertDescription className="text-yellow-900">
            <strong>Required Fields:</strong> {requiredFields.slice(0, 5).join(', ')}
            {requiredFields.length > 5 && ` and ${requiredFields.length - 5} more`}
          </AlertDescription>
        </Alert>
      )}

      {/* Template Content Editor */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Template Content
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            className="min-h-[500px] font-mono text-sm"
            placeholder="Template content will appear here..."
          />
        </CardContent>
      </Card>
    </div>
  );
}