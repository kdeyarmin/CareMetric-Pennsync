import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Copy, Save } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function AITemplateGenerator({ onTemplateGenerated }) {
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState("");
  const [visitType, setVisitType] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedTemplate, setGeneratedTemplate] = useState(null);

  const handleGenerate = async () => {
    if (!prompt.trim() || !category) {
      toast.error("Please provide a description and select a category");
      return;
    }

    setIsGenerating(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an expert in clinical documentation for home health and hospice care. Generate a comprehensive, Medicare-compliant documentation template based on the following request:

Category: ${category}
Visit Type: ${visitType || 'Not specified'}
Description: ${prompt}

Create a professional template that includes:
1. All required Medicare/Medicaid documentation elements
2. Placeholders using {{placeholder_name}} format (e.g., {{patient_name}}, {{vital_signs}}, {{assessment_findings}})
3. Proper clinical terminology and structure
4. Compliance checkpoints
5. Quality documentation standards

The template should be ready to use and meet regulatory requirements.`,
        response_json_schema: {
          type: "object",
          properties: {
            template_name: { type: "string" },
            description: { type: "string" },
            content: { type: "string" },
            required_elements: {
              type: "array",
              items: { type: "string" }
            },
            placeholders: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string" },
                  label: { type: "string" },
                  type: { type: "string" }
                }
              }
            },
            tags: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });

      const template = {
        ...response,
        category,
        visit_type: visitType || undefined,
        ai_generated: true,
        generation_prompt: prompt
      };

      setGeneratedTemplate(template);
      toast.success("Template generated successfully!");
    } catch (error) {
      toast.error("Failed to generate template: " + error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!generatedTemplate) return;

    try {
      await base44.entities.DocumentTemplate.create(generatedTemplate);
      toast.success("Template saved successfully!");
      onTemplateGenerated?.();
      setGeneratedTemplate(null);
      setPrompt("");
      setCategory("");
      setVisitType("");
    } catch (error) {
      toast.error("Failed to save template: " + error.message);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedTemplate.content);
    toast.success("Template content copied to clipboard");
  };

  return (
    <div className="space-y-6">
      <Card className="border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-pink-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            AI Template Generator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>What type of documentation template do you need?</Label>
            <Textarea
              placeholder="E.g., 'Skilled nursing visit note for post-surgical wound care' or 'OASIS assessment for CHF patient admission' or 'Care plan for fall risk management'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="mt-2 min-h-24"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Select category..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skilled_nursing">Skilled Nursing</SelectItem>
                  <SelectItem value="physical_therapy">Physical Therapy</SelectItem>
                  <SelectItem value="occupational_therapy">Occupational Therapy</SelectItem>
                  <SelectItem value="speech_therapy">Speech Therapy</SelectItem>
                  <SelectItem value="social_work">Social Work</SelectItem>
                  <SelectItem value="care_plan">Care Plan</SelectItem>
                  <SelectItem value="oasis">OASIS Assessment</SelectItem>
                  <SelectItem value="discharge">Discharge Summary</SelectItem>
                  <SelectItem value="admission">Admission Assessment</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Visit Type (Optional)</Label>
              <Select value={visitType} onValueChange={setVisitType}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Select visit type..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admission">Admission</SelectItem>
                  <SelectItem value="routine">Routine</SelectItem>
                  <SelectItem value="recertification">Recertification</SelectItem>
                  <SelectItem value="discharge">Discharge</SelectItem>
                  <SelectItem value="reassessment">Reassessment</SelectItem>
                  <SelectItem value="follow_up">Follow-up</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim() || !category}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating Template...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Template
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Generated Template Preview */}
      {generatedTemplate && (
        <Card className="border-2 border-green-200">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-green-600" />
                Generated Template
              </CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleCopy}>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </Button>
                <Button size="sm" onClick={handleSave} className="bg-green-600 hover:bg-green-700">
                  <Save className="w-4 h-4 mr-2" />
                  Save Template
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold text-lg text-gray-900">{generatedTemplate.template_name}</h3>
              <p className="text-sm text-gray-600 mt-1">{generatedTemplate.description}</p>
              <div className="flex gap-2 mt-2">
                <Badge>{category}</Badge>
                {visitType && <Badge variant="outline">{visitType}</Badge>}
                <Badge className="bg-purple-600">AI Generated</Badge>
              </div>
            </div>

            <div>
              <Label>Template Content</Label>
              <div className="mt-2 p-4 bg-gray-50 rounded-lg border border-gray-200 max-h-96 overflow-y-auto">
                <pre className="text-sm whitespace-pre-wrap font-mono">{generatedTemplate.content}</pre>
              </div>
            </div>

            {generatedTemplate.placeholders && generatedTemplate.placeholders.length > 0 && (
              <div>
                <Label>Placeholders ({generatedTemplate.placeholders.length})</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {generatedTemplate.placeholders.map((p, idx) => (
                    <Badge key={idx} variant="outline">
                      {`{{${p.key}}}`}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {generatedTemplate.required_elements && generatedTemplate.required_elements.length > 0 && (
              <div>
                <Label>Required Elements</Label>
                <ul className="mt-2 space-y-1">
                  {generatedTemplate.required_elements.map((elem, idx) => (
                    <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                      <span className="text-green-600">✓</span>
                      {elem}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}