import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Sparkles, Search, Zap } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

const TEMPLATE_TYPES = {
  patient_education: { label: 'Patient Education', color: 'bg-blue-100 text-blue-800' },
  discharge_instructions: { label: 'Discharge Instructions', color: 'bg-green-100 text-green-800' },
  referral_letter: { label: 'Referral Letter', color: 'bg-purple-100 text-purple-800' },
  care_plan_summary: { label: 'Care Plan Summary', color: 'bg-orange-100 text-orange-800' },
  clinical_summary: { label: 'Clinical Summary', color: 'bg-pink-100 text-pink-800' }
};

export default function TemplateSelectionFlow({ patient, templates, onSelect, loading }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState(null);

  const suggestMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('suggestTemplatesAndFields', {
        patient_id: patient.id
      });
      return response.data || response;
    },
    onSuccess: (data) => {
      setSuggestions(data);
    }
  });

  useEffect(() => {
    if (patient?.id) {
      suggestMutation.mutate();
    }
  }, [patient?.id]);

  const filteredTemplates = templates?.filter(t =>
    t.template_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.description?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const handleSelectTemplate = (template) => {
    const preFilledFields = suggestions?.pre_filled_fields || {};
    onSelect(template, preFilledFields);
  };

  const suggestedTemplateIds = suggestions?.suggested_templates?.map(t => t.template_id) || [];

  return (
    <div className="space-y-6">
      {/* Patient Context */}
      <Card className="border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-slate-800">
        <CardContent className="p-4">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            <span className="font-semibold">Creating document for:</span> {suggestions?.patient_info?.name}
            {suggestions?.patient_info?.diagnosis && (
              <span className="ml-3 text-slate-600 dark:text-slate-400">
                Diagnosis: <span className="font-semibold">{suggestions.patient_info.diagnosis}</span>
              </span>
            )}
          </p>
        </CardContent>
      </Card>

      {/* AI Suggestions Section */}
      {suggestions?.suggested_templates && suggestions.suggested_templates.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-yellow-500" />
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">
              AI Recommended Templates
            </h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {suggestions.suggested_templates.map((suggestion) => (
              <Card
                key={suggestion.template_id}
                className="border-yellow-300 dark:border-yellow-700 cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => handleSelectTemplate({
                  id: suggestion.template_id,
                  template_name: suggestion.template_name,
                  template_type: suggestion.template_type,
                  description: suggestion.description
                })}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        {suggestion.template_name}
                      </CardTitle>
                      <Badge className={`${TEMPLATE_TYPES[suggestion.template_type]?.color || 'bg-gray-100'} mt-2`}>
                        {TEMPLATE_TYPES[suggestion.template_type]?.label || suggestion.template_type}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1 bg-yellow-100 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300 px-2 py-1 rounded text-xs font-semibold">
                      <Zap className="w-3 h-3" />
                      P{suggestion.priority}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-slate-600 dark:text-slate-400">{suggestion.reason}</p>
                  <Button
                    className="w-full mt-3 bg-yellow-500 hover:bg-yellow-600 text-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectTemplate({
                        id: suggestion.template_id,
                        template_name: suggestion.template_name,
                        template_type: suggestion.template_type,
                        description: suggestion.description
                      });
                    }}
                  >
                    Use This Template
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* General Notes */}
      {suggestions?.general_notes && (
        <Card className="border-slate-300 dark:border-slate-600">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Clinical Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600 dark:text-slate-400">{suggestions.general_notes}</p>
          </CardContent>
        </Card>
      )}

      {/* All Templates */}
      <div>
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">All Templates</h3>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search templates..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {loading ? (
          <div className="text-center py-8 text-slate-500">Loading templates...</div>
        ) : filteredTemplates.length === 0 ? (
          <div className="text-center py-8 text-slate-500">No templates found</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {filteredTemplates.map((template) => {
              const isSuggested = suggestedTemplateIds.includes(template.id);
              return (
                <Card
                  key={template.id}
                  className={`hover:shadow-lg transition-shadow cursor-pointer ${
                    isSuggested ? 'border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-slate-800' : ''
                  }`}
                  onClick={() => handleSelectTemplate(template)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-base flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          {template.template_name}
                        </CardTitle>
                      </div>
                      <Badge className={TEMPLATE_TYPES[template.template_type]?.color || 'bg-gray-100'}>
                        {TEMPLATE_TYPES[template.template_type]?.label || template.template_type}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-slate-600 dark:text-slate-400">{template.description}</p>
                    {template.category && (
                      <div className="text-xs text-slate-500">
                        Category: <span className="font-semibold">{template.category}</span>
                      </div>
                    )}
                    <Button
                      onClick={() => handleSelectTemplate(template)}
                      className="w-full mt-3 bg-slate-300 hover:bg-slate-400 dark:bg-slate-600 dark:hover:bg-slate-700 text-slate-900 dark:text-white"
                    >
                      Use This Template
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}