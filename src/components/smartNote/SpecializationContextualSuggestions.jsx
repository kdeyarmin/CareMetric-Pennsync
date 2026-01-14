import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Zap, Copy, AlertCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function SpecializationContextualSuggestions({
  patientDiagnosis,
  providerEmail,
  noteContent,
  onSuggestionApplied
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userEmail, setUserEmail] = useState(providerEmail);

  useEffect(() => {
    if (!userEmail) {
      base44.auth.me().then(user => setUserEmail(user.email));
    }
  }, []);

  useEffect(() => {
    if (userEmail && patientDiagnosis && noteContent?.length > 50) {
      generateSpecializationSuggestions();
    }
  }, [patientDiagnosis, noteContent]);

  const generateSpecializationSuggestions = async () => {
    setLoading(true);
    try {
      // Fetch provider's specializations
      const specs = await base44.entities.ProviderSpecialization.filter({
        provider_email: userEmail,
        is_active: true
      });

      if (specs.length === 0) {
        setSuggestions([]);
        setLoading(false);
        return;
      }

      // Get relevant specialty for this patient diagnosis
      const relevantSpec = specs.find(s => 
        patientDiagnosis.toLowerCase().includes(s.specialty_code) ||
        patientDiagnosis.toLowerCase().includes(s.specialty_name.toLowerCase())
      ) || specs[0];

      // Generate AI suggestions based on specialization
      const prompt = `As an expert in ${relevantSpec.specialty_name}, review this clinical note and provide 3-4 specialized assessment suggestions.

Patient Diagnosis: ${patientDiagnosis}
Expertise Level: ${relevantSpec.expertise_level}
Current Note: ${noteContent?.substring(0, 300)}...

For a ${relevantSpec.specialty_name} specialist, provide specific assessment items, tools, or clinical findings that should be documented.
Return as JSON array with "text" (the suggestion) and "priority" (high/medium/low) fields.`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              priority: { type: 'string', enum: ['high', 'medium', 'low'] },
              specialty_focus: { type: 'string' }
            }
          }
        }
      });

      setSuggestions(Array.isArray(result) ? result : []);
    } catch (error) {
      console.error('Error generating specialization suggestions:', error);
    }
    setLoading(false);
  };

  const handleApply = (suggestion) => {
    onSuggestionApplied?.(suggestion.text);
  };

  if (!noteContent || noteContent.length < 50) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="w-4 h-4 text-blue-600" />
          Specialty-Specific Suggestions
          {loading && <span className="ml-auto text-xs text-gray-500 animate-pulse">Analyzing...</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {suggestions.length > 0 ? (
          <div className="space-y-2">
            {suggestions.map((suggestion, idx) => (
              <div key={idx} className="border rounded-lg p-3 bg-blue-50">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700">{suggestion.text}</p>
                    {suggestion.specialty_focus && (
                      <Badge variant="outline" className="text-xs mt-1">
                        {suggestion.specialty_focus}
                      </Badge>
                    )}
                  </div>
                  {suggestion.priority === 'high' && (
                    <Badge className="bg-red-100 text-red-800 text-xs flex-shrink-0">
                      Critical
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleApply(suggestion)}
                  className="w-full text-xs gap-1"
                >
                  <Copy className="w-3 h-3" />
                  Add to Note
                </Button>
              </div>
            ))}
          </div>
        ) : loading ? (
          <div className="text-center py-4 text-gray-500">
            <div className="animate-spin inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full" />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <AlertCircle className="w-4 h-4" />
            Complete your note to get specialty suggestions
          </div>
        )}
      </CardContent>
    </Card>
  );
}