import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { getChecklistForDiagnosis } from '@/components/utils/diagnosisChecklistConfig';
import { toast } from 'sonner';

/**
 * Dynamic Visit Checklist Component
 * Adapts assessment items based on patient's primary diagnosis
 * Auto-saves progress to visit data
 */
export default function DynamicVisitChecklist({
  patient,
  visit,
  onChecklistUpdate,
  autoSave = true
}) {
  const [checklist, setChecklist] = useState(null);
  const [completedItems, setCompletedItems] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  // Load checklist based on diagnosis
  useEffect(() => {
    if (!patient?.primary_diagnosis) return;
    
    const loadedChecklist = getChecklistForDiagnosis(patient.primary_diagnosis);
    setChecklist(loadedChecklist);

    // Load previously completed items from visit
    if (visit?.checklist_progress) {
      setCompletedItems(visit.checklist_progress);
    }
  }, [patient?.primary_diagnosis, visit?.checklist_progress]);

  // Handle checkbox changes
  const handleItemToggle = useCallback((itemId) => {
    setCompletedItems(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }));
  }, []);

  // Auto-save progress
  useEffect(() => {
    if (!autoSave || !visit?.id) return;

    const saveTimeout = setTimeout(async () => {
      setIsSaving(true);
      try {
        // Update visit with checklist progress
        await onChecklistUpdate?.(completedItems);
      } catch (error) {
        console.error('Failed to save checklist progress:', error);
        toast.error('Failed to save checklist progress');
      } finally {
        setIsSaving(false);
      }
    }, 500); // Debounce saves by 500ms

    return () => clearTimeout(saveTimeout);
  }, [completedItems, visit?.id, autoSave, onChecklistUpdate]);

  if (!checklist) {
    return null;
  }

  // Calculate progress
  const totalItems = checklist.items.length;
  const completedCount = Object.values(completedItems).filter(Boolean).length;
  const requiredItems = checklist.items.filter(item => item.required);
  const requiredCompleted = requiredItems.filter(item => completedItems[item.id]).length;
  const progressPercent = Math.round((completedCount / totalItems) * 100);
  const isAllRequiredDone = requiredCompleted === requiredItems.length;

  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5 text-blue-600" />
              {checklist.category} Checklist
            </CardTitle>
            <p className="text-sm text-slate-600 mt-1">
              {patient?.primary_diagnosis && `Based on diagnosis: ${patient.primary_diagnosis}`}
            </p>
          </div>
          <div className="text-right">
            <Badge className={isAllRequiredDone ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}>
              {completedCount}/{totalItems}
            </Badge>
            {isSaving && (
              <p className="text-xs text-slate-500 mt-1">Saving...</p>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-700">Progress</span>
            <span className="text-xs font-medium text-slate-600">{progressPercent}%</span>
          </div>
          <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isAllRequiredDone ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Required Items Status */}
        {requiredItems.length > 0 && (
          <div className={`p-3 rounded-lg border ${
            isAllRequiredDone 
              ? 'bg-green-50 border-green-200' 
              : 'bg-yellow-50 border-yellow-200'
          }`}>
            <div className="flex items-start gap-2">
              {isAllRequiredDone ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
              )}
              <div className="text-sm">
                <p className={isAllRequiredDone ? 'text-green-800 font-medium' : 'text-yellow-800 font-medium'}>
                  Required Items: {requiredCompleted}/{requiredItems.length}
                </p>
                {!isAllRequiredDone && (
                  <p className="text-xs text-yellow-700 mt-0.5">
                    Complete all required items to proceed
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Checklist Items */}
        <div className="space-y-3">
          {checklist.items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 p-3 rounded-lg hover:bg-white/50 transition-colors"
            >
              <Checkbox
                id={item.id}
                checked={completedItems[item.id] || false}
                onCheckedChange={() => handleItemToggle(item.id)}
                className="mt-1 flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <Label
                  htmlFor={item.id}
                  className={`block cursor-pointer text-sm font-medium ${
                    completedItems[item.id]
                      ? 'text-slate-500 line-through'
                      : 'text-slate-900'
                  }`}
                >
                  {item.label}
                </Label>
                {item.required && (
                  <Badge variant="outline" className="mt-1 text-xs">
                    Required
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="mt-6 pt-4 border-t border-blue-200">
          <p className="text-xs text-slate-600">
            {isAllRequiredDone ? (
              <span className="text-green-700 font-medium">✓ All required assessments completed</span>
            ) : (
              <span className="text-yellow-700">
                {requiredItems.length - requiredCompleted} required item{requiredItems.length - requiredCompleted !== 1 ? 's' : ''} remaining
              </span>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}