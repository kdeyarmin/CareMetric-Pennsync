import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, FileText, Star, Loader2, ChevronDown, ChevronUp, Zap } from "lucide-react";
import { toast } from "sonner";

export default function SmartTemplateSuggester({
  visitType,
  providerType,
  diagnosis,
  patientData,
  onSelectTemplate,
  onOpenCreator,
}) {
  const [expanded, setExpanded] = useState(false);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiTemplate, setAiTemplate] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  // Fetch all matching templates
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["noteTemplates", visitType, providerType],
    queryFn: () => base44.entities.NoteTemplate.filter({ visit_type: visitType, provider_type: providerType }),
    enabled: !!visitType && !!providerType,
  });

  // Score and rank templates based on diagnosis match + patient history
  const rankedTemplates = React.useMemo(() => {
    if (!templates.length) return [];
    return templates
      .map((t) => {
        let score = 0;
        // Diagnosis tag match
        const diagLower = (diagnosis || "").toLowerCase();
        if (t.diagnosis_tags?.some((tag) => diagLower.includes(tag.toLowerCase()) || tag.toLowerCase().includes(diagLower.split(" - ")[0]?.toLowerCase() || ""))) {
          score += 50;
        }
        // Favorite bonus
        if (t.is_favorite) score += 20;
        // Custom template bonus (user-created are more relevant)
        if (!t.is_system_template) score += 10;
        // Patient diagnosis match
        if (patientData?.primary_diagnosis && t.diagnosis_tags?.some((tag) => patientData.primary_diagnosis.toLowerCase().includes(tag.toLowerCase()))) {
          score += 30;
        }
        return { ...t, _score: score };
      })
      .sort((a, b) => b._score - a._score);
  }, [templates, diagnosis, patientData]);

  // Best match auto-detection
  const bestMatch = rankedTemplates[0]?._score > 30 ? rankedTemplates[0] : null;

  // Auto-expand when there's a good match
  useEffect(() => {
    if (bestMatch && !expanded) {
      setExpanded(true);
    }
  }, [bestMatch?.id]);

  const handleSelect = (template) => {
    setSelectedId(template.id);
    const formattedNote = (template.sections || [])
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((s) => `${s.section_name}:\n${s.template_text}\n`)
      .join("\n");
    onSelectTemplate(formattedNote, template);
    toast.success(`Template "${template.name}" loaded`);
  };

  const generateAITemplate = async () => {
    setAiSuggesting(true);
    setAiTemplate(null);
    try {
      const patientContext = patientData
        ? `Patient: ${patientData.first_name} ${patientData.last_name}, Diagnosis: ${patientData.primary_diagnosis || diagnosis}, Secondary: ${(patientData.secondary_diagnoses || []).join(", ")}, Medications: ${(patientData.current_medications || []).join(", ")}`
        : "";

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical documentation expert for home health and hospice nursing.

Generate a detailed clinical note template for:
- Visit Type: ${visitType}
- Provider Type: ${providerType}
- Primary Diagnosis: ${diagnosis}
${patientContext ? `- Patient Context: ${patientContext}` : ""}

Create a structured template with sections appropriate for this visit type and diagnosis. Each section should have realistic placeholder text that guides the nurse on what to document. Include Medicare-compliant elements.

For the template, generate 5-8 sections. Common sections include: Subjective/Patient Report, Objective/Assessment Findings, Vital Signs, Medication Review, Wound Assessment (if applicable), Functional Status, Patient Education, Plan of Care, and Coordination of Care.

Make the placeholder text diagnosis-specific. For example, for CHF include fluid status, weight changes, edema assessment. For wound care include wound measurements, drainage, surrounding skin.`,
        response_json_schema: {
          type: "object",
          properties: {
            template_name: { type: "string" },
            description: { type: "string" },
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  section_name: { type: "string" },
                  template_text: { type: "string" },
                  order: { type: "number" },
                },
              },
            },
            diagnosis_tags: { type: "array", items: { type: "string" } },
          },
        },
      });

      setAiTemplate(result);
    } catch (err) {
      console.error("AI template generation error:", err);
      toast.error("Failed to generate AI template");
    } finally {
      setAiSuggesting(false);
    }
  };

  const handleUseAITemplate = () => {
    if (!aiTemplate) return;
    const formattedNote = (aiTemplate.sections || [])
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((s) => `${s.section_name}:\n${s.template_text}\n`)
      .join("\n");
    onSelectTemplate(formattedNote, { ...aiTemplate, name: aiTemplate.template_name, id: "ai_generated" });
    toast.success("AI-generated template loaded");
  };

  if (!visitType || !providerType) return null;

  return (
    <Card className="border-indigo-200 bg-indigo-50/50 dark:bg-indigo-950/20">
      <CardHeader
        className="bg-slate-200 p-3 sm:p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-600" />
            Smart Templates
            {bestMatch && (
              <Badge className="bg-indigo-100 text-indigo-700 text-[10px]">
                <Sparkles className="w-2.5 h-2.5 mr-0.5" /> Match found
              </Badge>
            )}
            {rankedTemplates.length > 0 && (
              <Badge variant="outline" className="text-[10px]">{rankedTemplates.length}</Badge>
            )}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </CardTitle>
      </CardHeader>

      {expanded && (
        <CardContent className="p-3 sm:p-4 space-y-3">
          {/* AI Generate Button */}
          <div className="flex gap-2">
            <Button
              onClick={(e) => { e.stopPropagation(); generateAITemplate(); }}
              disabled={aiSuggesting || !diagnosis}
              variant="outline"
              size="sm"
              className="flex-1 border-indigo-300 text-indigo-700 hover:bg-indigo-50 text-xs"
            >
              {aiSuggesting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Zap className="w-3 h-3 mr-1" />}
              {aiSuggesting ? "Generating..." : "AI Generate Template"}
            </Button>
            <Button onClick={(e) => { e.stopPropagation(); onOpenCreator?.(); }} variant="outline" size="sm" className="text-xs">
              + Create Custom
            </Button>
          </div>

          {/* AI Generated Template */}
          {aiTemplate && (
            <Card className="border-indigo-300 bg-indigo-50 dark:bg-indigo-950/30">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="font-medium text-sm flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                      {aiTemplate.template_name}
                    </p>
                    <p className="text-[10px] text-slate-600 mt-0.5">{aiTemplate.description}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {aiTemplate.diagnosis_tags?.map((tag, i) => (
                    <Badge key={i} variant="outline" className="text-[9px]">{tag}</Badge>
                  ))}
                </div>
                <div className="text-[10px] text-slate-500 mb-2">{aiTemplate.sections?.length} sections</div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleUseAITemplate} className="bg-indigo-600 hover:bg-indigo-700 text-xs flex-1">
                    Use This Template
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs" onClick={(e) => { e.stopPropagation(); onOpenCreator?.(aiTemplate); }}>
                    Save as Custom
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Best Match Highlight */}
          {bestMatch && !aiTemplate && (
            <Card className="border-green-300 bg-green-50 dark:bg-green-950/30">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex-1">
                    <p className="font-medium text-sm flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-green-600" />
                      Recommended: {bestMatch.name}
                    </p>
                    <p className="text-[10px] text-slate-600 mt-0.5">{bestMatch.description}</p>
                  </div>
                  {bestMatch.is_favorite && <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400 flex-shrink-0" />}
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {bestMatch.diagnosis_tags?.map((tag, i) => (
                    <Badge key={i} variant="outline" className="text-[9px]">{tag}</Badge>
                  ))}
                </div>
                <Button size="sm" onClick={() => handleSelect(bestMatch)} className="bg-green-600 hover:bg-green-700 text-xs w-full">
                  Use Recommended Template
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Template List */}
          {isLoading ? (
            <p className="text-xs text-slate-500 text-center py-3">Loading templates...</p>
          ) : rankedTemplates.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-3">No saved templates for this visit type. Try AI Generate or create one.</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {rankedTemplates.map((t) => (
                <div
                  key={t.id}
                  onClick={() => handleSelect(t)}
                  className={`p-2.5 rounded-lg border cursor-pointer transition-all text-xs ${
                    selectedId === t.id ? "border-indigo-500 bg-indigo-100" : "border-slate-200 bg-white hover:border-indigo-300"
                  }`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-medium flex items-center gap-1">
                      {t.name}
                      {t.is_system_template && <Badge variant="outline" className="text-[8px] px-1">System</Badge>}
                      {t.is_favorite && <Star className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />}
                    </span>
                    <span className="text-[9px] text-slate-400">{t.sections?.length} sections</span>
                  </div>
                  {t.description && <p className="text-[10px] text-slate-500 truncate">{t.description}</p>}
                  {t.diagnosis_tags?.length > 0 && (
                    <div className="flex gap-0.5 mt-1 flex-wrap">
                      {t.diagnosis_tags.slice(0, 3).map((tag, i) => (
                        <Badge key={i} variant="outline" className="text-[8px] px-1 py-0">{tag}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}