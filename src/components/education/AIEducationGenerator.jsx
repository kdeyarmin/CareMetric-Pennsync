import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sparkles, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function AIEducationGenerator({ onClose, onGenerated, existingMaterial = null, patientId = null }) {
  const [title, setTitle] = useState(existingMaterial?.title || "");
  const [category, setCategory] = useState(existingMaterial?.category || "");
  const [targetCondition, setTargetCondition] = useState("");
  const [readingLevel, setReadingLevel] = useState("basic");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [generatedContent, setGeneratedContent] = useState("");

  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => base44.entities.Patient.filter({ id: patientId }).then(r => r[0]),
    enabled: !!patientId,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const prompt = `Generate comprehensive patient education material about: ${title || targetCondition}
      
Category: ${category}
Target Condition: ${targetCondition}
Reading Level: ${readingLevel}
${patient ? `Patient Context: ${patient.primary_diagnosis}, Age: ${patient.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : 'Unknown'}` : ''}
${additionalInstructions ? `Additional Instructions: ${additionalInstructions}` : ''}

Please create patient-friendly educational content that includes:
1. What is this condition/topic?
2. Key symptoms or signs to watch for
3. Self-care tips and management strategies
4. When to call the doctor or seek help
5. Lifestyle recommendations
6. Important do's and don'ts

Write in clear, simple language appropriate for ${readingLevel} reading level. Use short sentences and everyday words. Include specific, actionable advice.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: false
      });
      
      return response;
    },
    onSuccess: (data) => {
      setGeneratedContent(data);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const tags = [targetCondition, category, readingLevel].filter(Boolean);
      
      const materialData = {
        title: title || `${targetCondition} Education`,
        category,
        content: generatedContent,
        tags,
        target_conditions: [targetCondition].filter(Boolean),
        reading_level: readingLevel,
        source: existingMaterial ? "ai_generated" : "ai_generated",
        parent_material_id: existingMaterial?.id || null,
        is_active: true
      };

      return base44.entities.PatientEducationMaterial.create(materialData);
    },
    onSuccess: () => {
      onGenerated();
    },
  });

  const categories = [
    "Diabetes Management",
    "Wound Care",
    "Heart Disease",
    "COPD/Respiratory",
    "Fall Prevention",
    "Medication Management",
    "Pain Management",
    "Nutrition",
    "Exercise/Mobility",
    "Mental Health",
    "Infection Control",
    "Post-Surgery Care",
    "Chronic Disease",
    "Safety",
    "General Health"
  ];

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            {existingMaterial ? "Personalize Educational Material" : "Generate Educational Material with AI"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {patient && (
            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription>
                Generating personalized content for: <strong>{patient.first_name} {patient.last_name}</strong>
                {patient.primary_diagnosis && ` - ${patient.primary_diagnosis}`}
              </AlertDescription>
            </Alert>
          )}

          <div>
            <Label>Title (optional)</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Managing Your Diabetes at Home"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Category *</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Reading Level</Label>
              <Select value={readingLevel} onValueChange={setReadingLevel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="basic">Basic (Grade 5-6)</SelectItem>
                  <SelectItem value="intermediate">Intermediate (Grade 7-9)</SelectItem>
                  <SelectItem value="advanced">Advanced (Grade 10+)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Condition/Topic *</Label>
            <Input
              value={targetCondition}
              onChange={(e) => setTargetCondition(e.target.value)}
              placeholder="e.g., Type 2 Diabetes, Heart Failure, COPD"
            />
          </div>

          <div>
            <Label>Additional Instructions (optional)</Label>
            <Textarea
              value={additionalInstructions}
              onChange={(e) => setAdditionalInstructions(e.target.value)}
              placeholder="Any specific topics to cover or patient preferences..."
              rows={3}
            />
          </div>

          <Button
            onClick={() => generateMutation.mutate()}
            disabled={!category || !targetCondition || generateMutation.isPending}
            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
          >
            {generateMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Content
              </>
            )}
          </Button>

          {generatedContent && (
            <div className="border-t pt-4">
              <Label>Generated Content</Label>
              <Textarea
                value={generatedContent}
                onChange={(e) => setGeneratedContent(e.target.value)}
                rows={12}
                className="mt-2 font-mono text-sm"
              />
              <div className="flex gap-2 mt-4">
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  {saveMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save to Library"
                  )}
                </Button>
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}