import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  CheckCircle2,
  BookOpen,
  Target,
  Plus,
  AlertCircle
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export default function AICarePlanSuggestionEngine({
  patientId,
  patientData,
  diagnosis,
  existingCarePlans = [],
  onAcceptSuggestion,
  autoGenerate = false
}) {
  const ai = useAICall();
  const [suggestions, setSuggestions] = useState(null);
  // Monotonic id so a slower, older "Generate New Suggestions" run can't overwrite
  // the result of a newer one.
  const genReqIdRef = useRef(0);
  const [acceptedSuggestions, setAcceptedSuggestions] = useState(new Set());

  const { data: medicareRules = [] } = useQuery({
    queryKey: ['medicareComplianceRules'],
    queryFn: () => base44.entities.MedicareComplianceRule.list(),
    initialData: [],
  });

  const { data: educationMaterials = [] } = useQuery({
    queryKey: ['patientEducationForCarePlan'],
    queryFn: () => base44.entities.EducationMaterial.filter({ is_published: true }, '-last_used_date', 50),
    initialData: [],
  });

  const generateSuggestions = useCallback(async () => {
    if (!diagnosis) return;

    const myReqId = ++genReqIdRef.current;
    try {
      const _existingProblems = existingCarePlans.map(cp => cp.problem);
      const _existingGoals = existingCarePlans.map(cp => cp.goal);

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Generate Medicare-compliant care plan suggestions for Pennsylvania home health patient.

PATIENT CONTEXT:
- Diagnosis: ${diagnosis}
- Current Medications: ${patientData?.current_medications?.map(m => m.name).join(', ') || 'None documented'}
- Functional Status: ${JSON.stringify(patientData?.functional_status || {})}
- Age: ${patientData?.date_of_birth ? Math.floor((new Date() - new Date(patientData.date_of_birth)) / 31557600000) : 'Unknown'}
- Allergies: ${patientData?.allergies || 'None'}

EXISTING CARE PLANS (do NOT duplicate):
${existingCarePlans.length > 0 ? existingCarePlans.map(cp => `- ${cp.problem}: ${cp.goal}`).join('\n') : 'None'}

MEDICARE REQUIREMENTS (42 CFR 484):
${medicareRules.filter(r => r.category === 'plan_of_care').map(r => `- ${r.rule_name}: ${r.description}`).join('\n')}

AVAILABLE PATIENT EDUCATION MATERIALS (prefer these titles when suggesting education_topics):
${educationMaterials.length > 0 ? educationMaterials.map(m => `- ${m.title}${m.category ? ` (${m.category})` : ''}`).join('\n') : 'None on file'}

Generate 3-5 NEW care plan suggestions that:
1. Are NOT duplicates of existing plans
2. Address key aspects of ${diagnosis} management
3. Include measurable, time-bound goals (SMART goals)
4. Follow Medicare CoP requirements for home health
5. Are appropriate for Pennsylvania home health setting

For EACH suggestion provide:
- problem: Nursing diagnosis (clear, specific)
- goal: Measurable outcome with timeframe
- interventions: Array of 3-5 specific nursing interventions
- rationale: Why this is important for Medicare compliance
- priority: high, medium, low
- frequency: How often to assess
- baseline_measurement: What to measure initially
- target_timeframe_days: Number of days to achieve goal (typically 60)
- education_topics: Array of patient education topics needed
- medicare_compliance_note: Which CoP requirement this addresses

Return JSON with suggestions array.`,
        response_json_schema: {
          type: "object",
          properties: {
            suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  problem: { type: "string" },
                  goal: { type: "string" },
                  interventions: { type: "array", items: { type: "string" } },
                  rationale: { type: "string" },
                  priority: { type: "string" },
                  frequency: { type: "string" },
                  baseline_measurement: { type: "string" },
                  target_timeframe_days: { type: "number" },
                  education_topics: { type: "array", items: { type: "string" } },
                  medicare_compliance_note: { type: "string" }
                }
              }
            }
          }
        }
      });

      // A newer generation superseded this one while it was in flight — discard.
      if (myReqId !== genReqIdRef.current) return;
      setSuggestions(result.suggestions || []);
    } catch (error) {
      console.error('Error generating care plan suggestions:', error);
      if (myReqId === genReqIdRef.current) {
        toast.error("Failed to generate care plan suggestions. Please try again.");
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [diagnosis, existingCarePlans, patientData, medicareRules, educationMaterials]);

  useEffect(() => {
    if (autoGenerate && diagnosis && !suggestions) {
      generateSuggestions();
    }
  }, [autoGenerate, diagnosis, suggestions, generateSuggestions]);

  const handleAcceptSuggestion = async (suggestion, index) => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + (suggestion.target_timeframe_days || 60));

    const carePlanData = {
      patient_id: patientId,
      problem: suggestion.problem,
      goal: suggestion.goal,
      interventions: suggestion.interventions,
      // Local calendar date — toISOString() converts to UTC and, for a plan
      // created in the evening in any US timezone, rolls target_date a day late.
      target_date: `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`,
      status: 'active',
      baseline_measurement: suggestion.baseline_measurement,
      frequency: suggestion.frequency
    };

    await onAcceptSuggestion?.(carePlanData, suggestion.education_topics);
    setAcceptedSuggestions(prev => new Set([...prev, index]));
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  if (!diagnosis) {
    return (
      <Card className="border-2 border-slate-200">
        <CardContent className="p-6 text-center">
          <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-600">Enter patient diagnosis to generate AI care plan suggestions</p>
        </CardContent>
      </Card>
    );
  }

  if (ai.loading) {
    return (
      <Card className="border-2 border-navy-200">
        <CardContent className="p-6 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-navy-600 mx-auto mb-4" />
          <p className="text-sm text-slate-600">AI analyzing {diagnosis} and generating Medicare-compliant care plan suggestions...</p>
        </CardContent>
      </Card>
    );
  }

  if (!suggestions) {
    return (
      <Card className="border-2 border-navy-200">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-navy-600" />
            AI Care Plan Suggestions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600 mb-4">
            Generate evidence-based care plan recommendations for {diagnosis}
          </p>
          <Button onClick={generateSuggestions} className="w-full">
            <Sparkles className="w-4 h-4 mr-2" />
            Generate Suggestions
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-navy-200 bg-gradient-to-b from-navy-50 to-white">
      <CardHeader>
        <CardTitle className="text-lg flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-navy-600" />
            AI Care Plan Suggestions
          </span>
          <Badge variant="outline">{suggestions.length} suggestions</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Accordion type="multiple" className="space-y-2">
          {suggestions.map((suggestion, idx) => {
            const isAccepted = acceptedSuggestions.has(idx);
            
            return (
              <AccordionItem
                key={idx}
                value={`suggestion-${idx}`}
                className={`border-2 rounded-lg ${getPriorityColor(suggestion.priority)} ${isAccepted ? 'opacity-60' : ''}`}
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-4">
                    <div className="text-left">
                      <p className="font-semibold text-sm">{suggestion.problem}</p>
                      <Badge className={`mt-1 ${getPriorityColor(suggestion.priority)}`}>
                        {suggestion.priority} priority
                      </Badge>
                    </div>
                    {isAccepted && (
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-3">
                  {/* Goal */}
                  <div className="bg-white p-3 rounded border">
                    <div className="flex items-start gap-2 mb-2">
                      <Target className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-slate-700">SMART Goal</p>
                        <p className="text-sm text-slate-900 font-medium">{suggestion.goal}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 text-xs text-slate-600 mt-2">
                      <Badge variant="outline" className="text-xs">
                        Target: {suggestion.target_timeframe_days} days
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        Assess: {suggestion.frequency}
                      </Badge>
                    </div>
                  </div>

                  {/* Interventions */}
                  <div className="bg-blue-50 p-3 rounded border border-blue-200">
                    <p className="text-xs font-semibold text-blue-900 mb-2">Nursing Interventions:</p>
                    <ul className="space-y-1">
                      {suggestion.interventions?.map((intervention, i) => (
                        <li key={i} className="text-xs text-blue-800 flex items-start gap-2">
                          <span className="text-blue-600">•</span>
                          <span>{intervention}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Baseline Measurement */}
                  <div className="bg-slate-50 p-3 rounded border">
                    <p className="text-xs font-semibold text-slate-700 mb-1">Baseline Measurement:</p>
                    <p className="text-xs text-slate-600">{suggestion.baseline_measurement}</p>
                  </div>

                  {/* Education Topics */}
                  {suggestion.education_topics?.length > 0 && (
                    <div className="bg-green-50 p-3 rounded border border-green-200">
                      <div className="flex items-center gap-2 mb-2">
                        <BookOpen className="w-4 h-4 text-green-700" />
                        <p className="text-xs font-semibold text-green-900">Patient Education Topics:</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {suggestion.education_topics.map((topic, i) => (
                          <Badge key={i} className="bg-green-100 text-green-800 text-xs">
                            {topic}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Medicare Compliance */}
                  <div className="bg-navy-50 p-3 rounded border border-navy-200">
                    <p className="text-xs font-semibold text-navy-900 mb-1">Medicare Compliance:</p>
                    <p className="text-xs text-navy-800">{suggestion.medicare_compliance_note}</p>
                  </div>

                  {/* Rationale */}
                  <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                    <p className="text-xs font-semibold text-yellow-900 mb-1">Clinical Rationale:</p>
                    <p className="text-xs text-yellow-800">{suggestion.rationale}</p>
                  </div>

                  {/* Action Button */}
                  {!isAccepted && (
                    <Button
                      onClick={() => handleAcceptSuggestion(suggestion, idx)}
                      className="w-full bg-navy-600 hover:bg-navy-700"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add to Care Plan
                    </Button>
                  )}

                  {isAccepted && (
                    <div className="text-center py-2 text-sm text-green-700 font-medium">
                      ✓ Added to Care Plan
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSuggestions(null);
            setAcceptedSuggestions(new Set());
          }}
          className="w-full"
        >
          Generate New Suggestions
        </Button>
      </CardContent>
    </Card>
  );
}