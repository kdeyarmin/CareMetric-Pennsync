import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Plus } from 'lucide-react';

export default function TemplateFieldConfig({
  requiredFields,
  optionalFields,
  onAddRequired,
  onAddOptional,
  onRemoveField,
  newField,
  onNewFieldChange
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Data Fields Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* New Field Input */}
        <div>
          <Label htmlFor="newField">Add New Field</Label>
          <div className="flex gap-2">
            <Input
              id="newField"
              value={newField}
              onChange={(e) => onNewFieldChange(e.target.value)}
              placeholder="e.g., 'treatment_plan', 'medication_list'"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onAddRequired();
                }
              }}
            />
            <Button
              onClick={onAddRequired}
              variant="outline"
              className="px-4"
              title="Add as required field"
            >
              <Plus className="w-4 h-4 mr-1" />
              Required
            </Button>
            <Button
              onClick={onAddOptional}
              variant="outline"
              className="px-4"
              title="Add as optional field"
            >
              <Plus className="w-4 h-4 mr-1" />
              Optional
            </Button>
          </div>
        </div>

        {/* Required Fields */}
        <div>
          <Label>Required Fields ({requiredFields.length})</Label>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            These fields must be provided when using this template.
          </p>
          <div className="flex flex-wrap gap-2">
            {requiredFields.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No required fields yet</p>
            ) : (
              requiredFields.map((field) => (
                <Badge
                  key={field}
                  className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 px-3 py-1 flex items-center gap-2"
                >
                  {field}
                  <button
                    onClick={() => onRemoveField(field, 'required')}
                    className="ml-1 hover:opacity-70"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
        </div>

        {/* Optional Fields */}
        <div>
          <Label>Optional Fields ({optionalFields.length})</Label>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            These fields can be left blank when using this template.
          </p>
          <div className="flex flex-wrap gap-2">
            {optionalFields.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No optional fields yet</p>
            ) : (
              optionalFields.map((field) => (
                <Badge
                  key={field}
                  className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-3 py-1 flex items-center gap-2"
                >
                  {field}
                  <button
                    onClick={() => onRemoveField(field, 'optional')}
                    className="ml-1 hover:opacity-70"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}