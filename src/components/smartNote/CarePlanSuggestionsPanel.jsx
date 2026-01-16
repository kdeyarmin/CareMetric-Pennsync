import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader, CheckCircle2, AlertCircle, Lightbulb } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getProviderSpecificPromptAdditions, getRelevantTaskTypes } from '@/components/utils/providerSpecificPrompts';

export default function CarePlanSuggestionsPanel({ patientId, visitType, diagnosis, noteContent, providerType }) {
   const [isGenerating, setIsGenerating] = useState(false);
   const [suggestions, setSuggestions] = useState(null);
   const [expanded, setExpanded] = useState(false);

   const { data: currentUser } = useQuery({
     queryKey: ['currentUser'],
     queryFn: () => base44.auth.me()
   });

   const { data: existingCarePlans = [] } = useQuery({
     queryKey: ['carePlans', patientId],
     queryFn: () => patientId ? base44.entities.CarePlan.filter({ patient_id: patientId }) : Promise.resolve([]),
     enabled: !!patientId
   });

   const queryClient = useQueryClient();

   const effectiveProviderType = providerType || currentUser?.credential_type || 'RN';
   const relevantTaskTypes = getRelevantTaskTypes(effectiveProviderType);

  const createCarePlanMutation = useMutation({
    mutationFn: (carePlan) => base44.entities.CarePlan.create(carePlan),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carePlans', patientId] });
      toast.success('Care plan created successfully');
    }
  });

  const generateSuggestions = async () => {
    if (!patientId || !noteContent) {
      toast.error('Please complete the note first');
      return;
    }

    setIsGenerating(true);
    try {
      const prompt = `Based on the following clinical note, suggest new or updated care plans for this patient.

Visit Type: ${visitType || 'Not specified'}
Diagnosis: ${diagnosis || 'Not specified'}
Clinical Note: ${noteContent.substring(0, 1000)}

Current Care Plans:
${existingCarePlans.map(cp => `- Problem: ${cp.problem}, Goal: ${cp.goal}, Status: ${cp.status}`).join('\n') || 'No existing care plans'}

Suggest 2-3 care plans with:
- problem: nursing diagnosis/problem
- goal: measurable goal
- interventions: array of specific nursing actions
- frequency: how often to assess (e.g., "Each visit", "Weekly")

Return as JSON object with "carePlans" array.`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            carePlans: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  problem: { type: 'string' },
                  goal: { type: 'string' },
                  interventions: { type: 'array', items: { type: 'string' } },
                  frequency: { type: 'string' }
                }
              }
            }
          }
        }
      });

      setSuggestions(result.carePlans || []);
      setExpanded(true);
      toast.success('Care plan suggestions generated');
    } catch (error) {
      toast.error('Failed to generate suggestions');
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateCarePlan = (suggestion) => {
    if (!patientId) {
      toast.error('Patient required to create care plan');
      return;
    }

    createCarePlanMutation.mutate({
      patient_id: patientId,
      problem: suggestion.problem,
      goal: suggestion.goal,
      interventions: suggestion.interventions,
      frequency: suggestion.frequency,
      status: 'active',
      target_date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });
  };

  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-blue-600" />
            AI Care Plan Suggestions
          </div>
          {existingCarePlans.length > 0 && (
            <Badge variant="outline">{existingCarePlans.length} existing</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!expanded ? (
          <Button
            onClick={generateSuggestions}
            disabled={isGenerating || !patientId || !noteContent}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {isGenerating ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Lightbulb className="w-4 h-4 mr-2" />
                Suggest Care Plans
              </>
            )}
          </Button>
        ) : suggestions && suggestions.length > 0 ? (
          <div className="space-y-3">
            {suggestions.map((suggestion, idx) => (
              <div key={idx} className="border rounded-lg p-3 bg-white">
                <div className="mb-2">
                  <h4 className="font-semibold text-gray-900">{suggestion.problem}</h4>
                  <p className="text-sm text-gray-600 mt-1">Goal: {suggestion.goal}</p>
                </div>
                <div className="mb-2">
                  <p className="text-xs text-gray-600 font-medium mb-1">Interventions:</p>
                  <ul className="text-xs text-gray-600 space-y-1">
                    {suggestion.interventions?.map((intervention, i) => (
                      <li key={i} className="flex gap-2">
                        <span>•</span>
                        <span>{intervention}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-xs text-gray-500 mb-3">Frequency: {suggestion.frequency}</p>
                <Button
                  size="sm"
                  onClick={() => handleCreateCarePlan(suggestion)}
                  disabled={createCarePlanMutation.isPending}
                  className="w-full bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Create This Plan
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setExpanded(false);
                setSuggestions(null);
              }}
            >
              Close
            </Button>
          </div>
        ) : null}

        {expanded && !suggestions && !isGenerating && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <AlertCircle className="w-4 h-4" />
            No suggestions available
          </div>
        )}
      </CardContent>
    </Card>
  );
}