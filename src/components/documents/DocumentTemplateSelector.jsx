import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useState } from 'react';

const TEMPLATE_TYPES = {
  patient_education: { label: 'Patient Education', color: 'bg-blue-100 text-blue-800' },
  discharge_instructions: { label: 'Discharge Instructions', color: 'bg-green-100 text-green-800' },
  referral_letter: { label: 'Referral Letter', color: 'bg-purple-100 text-purple-800' },
  care_plan_summary: { label: 'Care Plan Summary', color: 'bg-orange-100 text-orange-800' },
  clinical_summary: { label: 'Clinical Summary', color: 'bg-pink-100 text-pink-800' }
};

export default function DocumentTemplateSelector({ templates, onSelect, loading }) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredTemplates = templates?.filter(t =>
    t.template_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.category?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">Select Document Template</h2>
        <p className="text-slate-600 dark:text-slate-400 mb-4">Choose a template to create a new patient-facing document.</p>
      </div>

      <div className="relative">
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
        <div className="grid gap-4 md:grid-cols-2">
          {filteredTemplates.map((template) => (
            <Card
              key={template.id}
              className="hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => onSelect(template)}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FileText className="w-5 h-5" />
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
                {template.required_fields?.length > 0 && (
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    <span className="font-semibold">Required fields:</span> {template.required_fields.join(', ')}
                  </div>
                )}
                <Button
                  onClick={() => onSelect(template)}
                  className="w-full mt-4 bg-slate-300 hover:bg-slate-400 dark:bg-slate-600 dark:hover:bg-slate-700 text-slate-900 dark:text-white"
                >
                  Use This Template
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}