import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Sparkles,
  Target,
  Plus,
  RefreshCw,
  CheckCircle2,
  TrendingUp,
  AlertTriangle,
  Lightbulb
} from "lucide-react";
import { toast } from 'sonner';

export default function AICarePlanSuggestions({ patient, existingCarePlans, onAddCarePlan }) {
  const [suggestions, setSuggestions] = useState(null);
  const ai = useAICall();
  const [addedSuggestions, setAddedSuggestions] = useState([]);

  const { data: visits } = useQuery({
    queryKey: ['patientVisitsForCarePlan', patient?.id],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patient.id }, '-visit_date', 10),
    enabled: !!patient?.id,
    initialData: [],
  });

  const { data: incidents } = useQuery({
    queryKey: ['patientIncidentsForCarePlan', patient?.id],
    queryFn: () => base44.entities.Incident.filter({ patient_id: patient.id }, '-incident_date', 10),
    enabled: !!patient?.id,
    initialData: [],
  });

  const generateSuggestions = async () => {
    if (!patient) return;
    
    try {
      const recentVisits = visits.slice(0, 5);
      const recentNotes = recentVisits
        .filter(v => v.nurse_notes)
        .map(v => v.nurse_notes.substring(0, 300))
        .join('\n---\n');

      const existingProblems = (existingCarePlans || [])
        .filter(cp => cp.status === 'active')
        .map(cp => cp.problem)
        .join(', ');

      const prompt = `You are a clinical care plan specialist for home health/hospice. Analyze this patient and suggest new care plan goals and interventions.

PATIENT PROFILE:
- Name: ${patient.first_name} ${patient.last_name}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Care Type: ${patient.care_type === 'hospice' ? 'Hospice' : 'Home Health'}
- Allergies: ${patient.allergies || 'NKDA'}

EXISTING ACTIVE CARE PLAN PROBLEMS (avoid duplicates):
${existingProblems || 'None'}

RECENT VISIT NOTES:
${recentNotes || 'No recent notes available'}

RECENT INCIDENTS:
${incidents.length > 0 ? incidents.map(i => `- ${i.incident_type}: ${i.incident_date}`).join('\n') : 'None'}

Based on this information, suggest 3-5 NEW care plan goals that:
1. Address gaps not covered by existing care plans
2. Are evidence-based and measurable
3. Align with Medicare quality measures (hospitalization prevention, functional improvement, fall prevention, medication management)
4. Are appropriate for ${patient.care_type === 'hospice' ? 'hospice comfort care' : 'home health rehabilitation'}

Return JSON:
{
  "suggestions": [
    {
      "problem": "Nursing diagnosis statement",
      "goal": "Specific, measurable goal with timeline",
      "interventions": ["Intervention 1", "Intervention 2", "Intervention 3"],
      "rationale": "Why this is needed based on patient data",
      "priority": "high|medium|low",
      "quality_measure_impact": "Which Medicare quality measure this addresses",
      "estimated_days_to_achieve": 30-90
    }
  ],
  "gaps_identified": ["List of care gaps found"],
  "quality_measure_opportunities": ["Specific quality improvements possible"]
}`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
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
                  quality_measure_impact: { type: "string" },
                  estimated_days_to_achieve: { type: "number" }
                }
              }
            },
            gaps_identified: { type: "array", items: { type: "string" } },
            quality_measure_opportunities: { type: "array", items: { type: "string" } }
          }
        }
      });

      setSuggestions(result);
    } catch (error) {
      console.error('Error generating suggestions:', error);
      toast.error('Failed to generate suggestions. Please try again.');
    }
  };

  const handleAddSuggestion = (suggestion, index) => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + (suggestion.estimated_days_to_achieve || 60));
    // Format from local date parts, not toISOString (which is UTC and rolls the date
    // back a day for evening US-timezone creation).
    const target_date = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;

    onAddCarePlan({
      problem: suggestion.problem,
      goal: suggestion.goal,
      interventions: suggestion.interventions,
      frequency: 'Each visit',
      target_date,
      status: 'active'
    });

    setAddedSuggestions([...addedSuggestions, index]);
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-500 text-white';
      case 'medium': return 'bg-yellow-500 text-black';
      case 'low': return 'bg-blue-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  if (!patient) return null;

  return (
    <Card className="border-navy-200">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-gold-50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-navy-600" />
            AI Care Plan Suggestions
          </CardTitle>
          <Button
            onClick={generateSuggestions}
            disabled={ai.loading}
            size="sm"
            className="bg-navy-600 hover:bg-navy-700"
          >
            {ai.loading ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Lightbulb className="w-4 h-4 mr-2" />
                Generate Suggestions
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {!suggestions && !ai.loading && (
          <div className="text-center py-6 text-slate-500">
            <Target className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm">Click to analyze patient data and generate care plan suggestions</p>
          </div>
        )}

        {suggestions && (
          <div className="space-y-4">
            {/* Gaps Identified */}
            {suggestions.gaps_identified?.length > 0 && (
              <Alert className="bg-orange-50 border-orange-200">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                <AlertDescription className="text-orange-900">
                  <p className="font-semibold mb-1">Care Gaps Identified:</p>
                  <ul className="list-disc ml-5 text-sm">
                    {suggestions.gaps_identified.map((gap, idx) => (
                      <li key={idx}>{gap}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Suggestions */}
            <div className="space-y-3">
              {suggestions.suggestions?.map((suggestion, idx) => (
                <Card key={idx} className={`border ${addedSuggestions.includes(idx) ? 'border-green-300 bg-green-50' : 'border-slate-200'}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge className={getPriorityColor(suggestion.priority)}>
                          {suggestion.priority} priority
                        </Badge>
                        {suggestion.quality_measure_impact && (
                          <Badge variant="outline" className="text-xs">
                            <TrendingUp className="w-3 h-3 mr-1" />
                            {suggestion.quality_measure_impact}
                          </Badge>
                        )}
                      </div>
                      {addedSuggestions.includes(idx) ? (
                        <Badge className="bg-green-500 text-white">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Added
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleAddSuggestion(suggestion, idx)}
                          className="bg-navy-600 hover:bg-navy-700"
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          Add
                        </Button>
                      )}
                    </div>

                    <h4 className="font-semibold text-slate-900 mb-1">{suggestion.problem}</h4>
                    <p className="text-sm text-slate-700 mb-2"><strong>Goal:</strong> {suggestion.goal}</p>
                    
                    <div className="mb-2">
                      <p className="text-xs font-medium text-slate-600 mb-1">Interventions:</p>
                      <ul className="list-disc ml-5 text-xs text-slate-600">
                        {suggestion.interventions?.slice(0, 3).map((int, i) => (
                          <li key={i}>{int}</li>
                        ))}
                      </ul>
                    </div>

                    <p className="text-xs text-slate-500 italic">{suggestion.rationale}</p>
                    
                    {suggestion.estimated_days_to_achieve && (
                      <p className="text-xs text-navy-600 mt-2">
                        ⏱ Estimated achievement: ~{suggestion.estimated_days_to_achieve} days
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Quality Measure Opportunities */}
            {suggestions.quality_measure_opportunities?.length > 0 && (
              <Alert className="bg-green-50 border-green-200">
                <TrendingUp className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-900">
                  <p className="font-semibold mb-1">Quality Measure Opportunities:</p>
                  <ul className="list-disc ml-5 text-sm">
                    {suggestions.quality_measure_opportunities.map((opp, idx) => (
                      <li key={idx}>{opp}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}