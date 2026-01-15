import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const COMMON_PLACEHOLDERS = {
  'Patient Information': [
    '{{patient_name}}',
    '{{patient_dob}}',
    '{{patient_email}}',
    '{{patient_phone}}',
    '{{patient_address}}'
  ],
  'Document': [
    '{{date}}',
    '{{document_date}}',
    '{{provider_name}}',
    '{{provider_credentials}}'
  ],
  'Clinical': [
    '{{diagnosis}}',
    '{{condition}}',
    '{{allergies}}',
    '{{current_medications}}'
  ],
  'Custom Fields': [
    '{{topic}}',
    '{{instructions}}',
    '{{warning_signs}}',
    '{{follow_up_instructions}}'
  ]
};

export default function PlaceholderHelper({ onInsert }) {
  return (
    <div className="space-y-3">
      {Object.entries(COMMON_PLACEHOLDERS).map(([category, placeholders]) => (
        <div key={category}>
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">{category}</p>
          <div className="flex flex-wrap gap-2">
            {placeholders.map((placeholder) => (
              <Button
                key={placeholder}
                variant="outline"
                size="sm"
                onClick={() => onInsert(placeholder)}
                className="text-xs h-8 px-2"
              >
                {placeholder}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}