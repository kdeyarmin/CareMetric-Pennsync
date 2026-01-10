import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Copy, Check, Save, Edit3, Trash2, Loader } from "lucide-react";
import { toast } from "sonner";

const noteTypes = [
  { id: 'progress', label: 'Progress Note', icon: '📝', description: 'Regular visit documentation' },
  { id: 'admission', label: 'Admission Note', icon: '🏥', description: 'New patient admission' },
  { id: 'discharge', label: 'Discharge Summary', icon: '🚪', description: 'Patient discharge documentation' },
  { id: 'recertification', label: 'Recertification', icon: '✅', description: 'Ongoing care justification' }
];

export default function AITemplateGenerator({ 
  visitType, 
  diagnosis, 
  patientData, 
  currentUser,
  onApplyTemplate 
}) {
  const [selectedType, setSelectedType] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedTemplate, setGeneratedTemplate] = useState(null);
  const [savedTemplates, setSavedTemplates] = useState([]);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [customizationPrompt, setCustomizationPrompt] = useState("");
  const [copiedId, setCopiedId] = useState(null);

  const generateTemplate = async (typeId) => {
    setIsGenerating(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate a professional healthcare note template for a ${typeId} note.

Context:
- Visit Type: ${visitType}
- Diagnosis: ${diagnosis}
${patientData ? `- Patient Name: ${patientData.first_name} ${patientData.last_name}
- Primary Diagnosis: ${patientData.primary_diagnosis}
- Secondary Diagnoses: ${patientData.secondary_diagnoses?.join(', ') || 'None'}` : ''}

Generate a complete, customizable template that includes:
1. Structured sections appropriate for a ${noteTypes.find(t => t.id === typeId)?.label}
2. Placeholder text in [brackets] for personalized information
3. Required compliance elements for Medicare
4. Clinical assessment areas
5. Plan and follow-up

Format the response as a clean, ready-to-use template that can be copied directly into an EHR.
Include helpful inline comments in [COMMENT: ...] format.`,
        response_json_schema: {
          type: "object",
          properties: {
            template: { type: "string" },
            sections: { type: "array", items: { type: "string" } },
            key_elements: { type: "array", items: { type: "string" } }
          }
        }
      });

      setGeneratedTemplate({
        ...result,
        typeId: typeId,
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      toast.error('Failed to generate template');
    }
    setIsGenerating(false);
  };

  const customizeTemplate = async () => {
    if (!generatedTemplate || !customizationPrompt.trim()) return;
    
    setIsGenerating(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Take this healthcare note template and customize it based on the following request:

ORIGINAL TEMPLATE:
${generatedTemplate.template}

CUSTOMIZATION REQUEST:
${customizationPrompt}

Please modify the template to incorporate the requested changes while maintaining:
- Professional clinical language
- Medicare compliance requirements
- Clear placeholder structure
- Logical section organization`,
        response_json_schema: {
          type: "object",
          properties: {
            template: { type: "string" }
          }
        }
      });

      setGeneratedTemplate(prev => ({
        ...prev,
        template: result.template
      }));
      setCustomizationPrompt("");
      setIsCustomizing(false);
      toast.success('Template customized');
    } catch (error) {
      toast.error('Failed to customize template');
    }
    setIsGenerating(false);
  };

  const saveTemplate = async () => {
    if (!generatedTemplate) return;

    try {
      const newTemplate = {
        name: `${noteTypes.find(t => t.id === generatedTemplate.typeId)?.label} - ${new Date().toLocaleDateString()}`,
        type: generatedTemplate.typeId,
        content: generatedTemplate.template,
        sections: generatedTemplate.sections,
        keyElements: generatedTemplate.key_elements,
        diagnosis: diagnosis,
        visitType: visitType,
        savedBy: currentUser?.email,
        createdAt: new Date().toISOString()
      };

      setSavedTemplates(prev => [...prev, newTemplate]);
      toast.success('Template saved to library');
    } catch (error) {
      toast.error('Failed to save template');
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success('Copied to clipboard');
  };

  const deleteTemplate = (index) => {
    setSavedTemplates(prev => prev.filter((_, i) => i !== index));
    toast.success('Template deleted');
  };

  return (
    <Card className="w-full max-w-full overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600" />
          AI Template Generator
        </CardTitle>
        <p className="text-sm text-gray-600 mt-2">Generate and customize note templates for different visit types</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!generatedTemplate ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {noteTypes.map(type => (
                <button
                  key={type.id}
                  onClick={() => generateTemplate(type.id)}
                  disabled={isGenerating}
                  className="p-4 border-2 rounded-lg hover:border-purple-400 hover:bg-purple-50 transition-all text-left"
                >
                  <div className="text-2xl mb-2">{type.icon}</div>
                  <p className="font-semibold text-sm">{type.label}</p>
                  <p className="text-xs text-gray-600">{type.description}</p>
                </button>
              ))}
            </div>

            {/* Saved Templates */}
            {savedTemplates.length > 0 && (
              <div className="border-t pt-4">
                <h3 className="font-semibold text-sm mb-3">📚 Saved Templates</h3>
                <div className="space-y-2">
                  {savedTemplates.map((template, idx) => (
                    <div key={idx} className="p-3 bg-gray-50 rounded-lg flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{template.name}</p>
                        <p className="text-xs text-gray-500">{template.diagnosis}</p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyToClipboard(template.content, `saved-${idx}`)}
                        >
                          {copiedId === `saved-${idx}` ? 
                            <Check className="w-4 h-4 text-green-600" /> : 
                            <Copy className="w-4 h-4" />
                          }
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setGeneratedTemplate(template)}
                          className="text-blue-600"
                        >
                          <Edit3 className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteTemplate(idx)}
                          className="text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Generated Template */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge>{noteTypes.find(t => t.id === generatedTemplate.typeId)?.label}</Badge>
                  {isGenerating && <Loader className="w-4 h-4 animate-spin text-purple-600" />}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setGeneratedTemplate(null)}
                >
                  Back
                </Button>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg max-h-96 overflow-y-auto text-sm whitespace-pre-wrap font-mono">
                {generatedTemplate.template}
              </div>

              {/* Key Elements */}
              {generatedTemplate.key_elements && (
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-sm font-medium text-blue-900 mb-2">✓ Included Elements:</p>
                  <ul className="text-xs text-blue-800 space-y-1">
                    {generatedTemplate.key_elements.map((el, idx) => (
                      <li key={idx}>• {el}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Customization */}
              {!isCustomizing ? (
                <div className="flex gap-2">
                  <Button
                    onClick={() => setIsCustomizing(true)}
                    variant="outline"
                    className="flex-1"
                  >
                    <Edit3 className="w-4 h-4 mr-2" />
                    Customize
                  </Button>
                  <Button
                    onClick={() => copyToClipboard(generatedTemplate.template, 'generated')}
                    variant="outline"
                    className="flex-1"
                  >
                    {copiedId === 'generated' ? 
                      <Check className="w-4 h-4 mr-2 text-green-600" /> : 
                      <Copy className="w-4 h-4 mr-2" />
                    }
                    Copy
                  </Button>
                  <Button
                    onClick={saveTemplate}
                    className="flex-1 bg-purple-600 hover:bg-purple-700"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Save
                  </Button>
                  <Button
                    onClick={() => onApplyTemplate?.(generatedTemplate.template)}
                    className="flex-1 bg-green-600 hover:bg-green-700"
                  >
                    Apply
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    value={customizationPrompt}
                    onChange={(e) => setCustomizationPrompt(e.target.value)}
                    placeholder="Describe how you'd like to customize this template..."
                    className="w-full p-3 border rounded-lg text-sm resize-none h-24"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={customizeTemplate}
                      disabled={isGenerating || !customizationPrompt.trim()}
                      className="flex-1 bg-purple-600 hover:bg-purple-700"
                    >
                      {isGenerating ? 'Customizing...' : 'Apply Customization'}
                    </Button>
                    <Button
                      onClick={() => setIsCustomizing(false)}
                      variant="outline"
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}