import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Sparkles, Brain, CheckCircle2, AlertCircle } from "lucide-react";

export default function AIPathwayGenerator({ onPathwayGenerated }) {
  const [diagnosis, setDiagnosis] = useState("");
  const [careType, setCareType] = useState("home_health");
  const [demographics, setDemographics] = useState("");
  const ai = useAICall();
  const [generatedPathways, setGeneratedPathways] = useState([]);
  const [error, setError] = useState(null);

  const generatePathways = async () => {
    if (!diagnosis.trim()) {
      setError("Please enter a diagnosis");
      return;
    }

    setError(null);
    setGeneratedPathways([]);

    try {
      const prompt = `As a clinical pathway expert, generate a comprehensive clinical pathway for the following:

Diagnosis: ${diagnosis}
Care Type: ${careType}
Demographics/Context: ${demographics || "General population"}

Generate a detailed clinical pathway with the following components:

1. Pathway Name: A clear, descriptive name
2. Description: Purpose and scope
3. Trigger Conditions: Array of conditions that trigger this pathway (diagnosis codes, keywords, etc.)
4. PDGM Clinical Group: The appropriate PDGM grouping
5. Priority Level: critical, high, medium, or low
6. Documentation Prompts: Array of specific documentation needs with:
   - category (e.g., "Functional Impact", "Skilled Need")
   - prompt (specific documentation guidance)
   - m_items_affected (array of OASIS M-items)
   - priority (critical, high, medium, low)
7. Rescore Opportunities: Array of potential scoring improvements with:
   - m_item (specific OASIS item)
   - typical_score_range
   - documentation_to_support
   - revenue_impact
8. Recommended Tasks: Array of auto-tasks with:
   - task_title
   - task_description
   - task_type (call, notify, schedule, order, coordinate, document, safety, followup, other)
   - priority (high, medium, low)
   - due_timeframe (today, 24_hours, 48_hours, this_week, next_visit)
9. Comorbidity Checklist: Array of common comorbidities to assess
10. Functional Focus Areas: Array of key functional areas to assess

Base recommendations on current Medicare guidelines, evidence-based practice, and PDGM optimization strategies.

Return ONLY valid JSON without any markdown formatting or explanations.`;

      const response = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            pathways: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  pathway_name: { type: "string" },
                  description: { type: "string" },
                  trigger_conditions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string" },
                        value: { type: "string" },
                        operator: { type: "string" }
                      }
                    }
                  },
                  pdgm_clinical_group: { type: "string" },
                  priority_level: { type: "string" },
                  documentation_prompts: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        category: { type: "string" },
                        prompt: { type: "string" },
                        m_items_affected: { type: "array", items: { type: "string" } },
                        priority: { type: "string" }
                      }
                    }
                  },
                  rescore_opportunities: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        m_item: { type: "string" },
                        typical_score_range: { type: "string" },
                        documentation_to_support: { type: "string" },
                        revenue_impact: { type: "string" }
                      }
                    }
                  },
                  recommended_tasks: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        task_title: { type: "string" },
                        task_description: { type: "string" },
                        task_type: { type: "string" },
                        priority: { type: "string" },
                        due_timeframe: { type: "string" }
                      }
                    }
                  },
                  comorbidity_checklist: { type: "array", items: { type: "string" } },
                  functional_focus_areas: { type: "array", items: { type: "string" } }
                }
              }
            }
          }
        }
      });

      const pathways = response.pathways || [];
      pathways.forEach(p => {
        p.is_active = true;
      });

      setGeneratedPathways(pathways);
    } catch (err) {
      console.error("Pathway generation error:", err);
      setError(err.message || "Failed to generate pathways");
    }
  };

  const handleSavePathway = async (pathway) => {
    try {
      await base44.entities.ClinicalPathway.create(pathway);
      if (onPathwayGenerated) {
        onPathwayGenerated(pathway);
      }
      setGeneratedPathways(prev => prev.filter(p => p !== pathway));
    } catch (err) {
      console.error("Failed to save pathway:", err);
      setError(err.message);
    }
  };

  return (
    <Card className="border-navy-200 bg-gradient-to-br from-navy-50 to-indigo-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-navy-900">
          <Brain className="w-5 h-5" />
          AI Pathway Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Diagnosis or Condition *</Label>
          <Input
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
            placeholder="e.g., CHF, Diabetes with neuropathy, Post-surgical recovery"
          />
        </div>

        <div className="space-y-2">
          <Label>Care Type</Label>
          <select
            value={careType}
            onChange={(e) => setCareType(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-md"
          >
            <option value="home_health">Home Health</option>
            <option value="hospice">Hospice</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label>Demographics/Context (Optional)</Label>
          <Textarea
            value={demographics}
            onChange={(e) => setDemographics(e.target.value)}
            placeholder="e.g., Elderly patients, high readmission risk, complex medication regimen"
            rows={2}
          />
        </div>

        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-900">{error}</AlertDescription>
          </Alert>
        )}

        <Button
          onClick={generatePathways}
          disabled={ai.loading || !diagnosis.trim()}
          className="w-full bg-navy-600 hover:bg-navy-700"
        >
          {ai.loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating AI Pathways...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Generate Clinical Pathways
            </>
          )}
        </Button>

        {/* Generated Pathways */}
        {generatedPathways.length > 0 && (
          <div className="space-y-3 mt-6">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              Generated Pathways ({generatedPathways.length})
            </h3>
            {generatedPathways.map((pathway, idx) => (
              <Card key={idx} className="border-green-200 bg-white">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-semibold text-slate-900">{pathway.pathway_name}</h4>
                      <p className="text-sm text-slate-600 mt-1">{pathway.description}</p>
                    </div>
                    <Badge className="bg-navy-500">{pathway.priority_level}</Badge>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div className="bg-blue-50 p-2 rounded text-center">
                      <p className="font-bold text-blue-700">{pathway.trigger_conditions?.length || 0}</p>
                      <p className="text-blue-600">Triggers</p>
                    </div>
                    <div className="bg-navy-50 p-2 rounded text-center">
                      <p className="font-bold text-navy-700">{pathway.documentation_prompts?.length || 0}</p>
                      <p className="text-navy-600">Prompts</p>
                    </div>
                    <div className="bg-green-50 p-2 rounded text-center">
                      <p className="font-bold text-green-700">{pathway.rescore_opportunities?.length || 0}</p>
                      <p className="text-green-600">Rescores</p>
                    </div>
                    <div className="bg-navy-50 p-2 rounded text-center">
                      <p className="font-bold text-navy-700">{pathway.recommended_tasks?.length || 0}</p>
                      <p className="text-navy-600">Tasks</p>
                    </div>
                  </div>

                  {pathway.pdgm_clinical_group && (
                    <Badge variant="outline" className="text-xs">
                      PDGM: {pathway.pdgm_clinical_group}
                    </Badge>
                  )}

                  <Button
                    onClick={() => handleSavePathway(pathway)}
                    size="sm"
                    className="w-full bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Save This Pathway
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}