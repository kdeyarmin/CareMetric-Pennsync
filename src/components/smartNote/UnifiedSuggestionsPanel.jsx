import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Sparkles, 
  Zap, 
  CheckCircle2,
  Lightbulb,
  TrendingUp,
  Loader2,
  Check,
  X
} from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function UnifiedSuggestionsPanel({ 
  qualityAnalysis,
  suggestedTasks = [],
  noteContent,
  visitType,
  diagnosis,
  onNoteUpdate,
  onTaskAdd,
  userEmail,
  selectedPatient
}) {
  const [applyingAll, setApplyingAll] = useState(false);
  const [appliedSuggestions, setAppliedSuggestions] = useState(new Set());

  if (!qualityAnalysis && suggestedTasks.length === 0) {
    return null;
  }

  const suggestions = qualityAnalysis?.suggestions || [];
  const totalSuggestions = suggestions.length + suggestedTasks.length;

  const applyAllSuggestions = async () => {
    if (!noteContent || suggestions.length === 0) return;

    setApplyingAll(true);
    try {
      const prompt = `Improve this clinical note by applying ALL of these suggestions:

CURRENT NOTE:
${noteContent}

SUGGESTIONS TO APPLY:
${suggestions.map((s, i) => `${i + 1}. ${s.suggestion_text}${s.example_improved_text ? `\n   Example: "${s.example_improved_text}"` : ''}`).join('\n')}

Return the fully improved note with all suggestions applied. Maintain the original structure and flow while incorporating all improvements.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            improved_note: { type: "string" },
            changes_applied: { type: "array", items: { type: "string" } }
          }
        }
      });

      if (response.improved_note) {
        onNoteUpdate?.(response.improved_note);
        setAppliedSuggestions(new Set(suggestions.map((_, i) => i)));
        toast.success(`Applied ${suggestions.length} suggestions successfully`);
      }
    } catch (error) {
      console.error('Error applying suggestions:', error);
      toast.error('Failed to apply suggestions');
    } finally {
      setApplyingAll(false);
    }
  };

  const applySingleSuggestion = async (suggestion, index) => {
    if (!noteContent) return;

    try {
      const prompt = `Apply this specific suggestion to improve the clinical note:

CURRENT NOTE:
${noteContent}

SUGGESTION:
${suggestion.suggestion_text}
${suggestion.example_improved_text ? `Example: "${suggestion.example_improved_text}"` : ''}

Return only the improved note with this suggestion applied.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt
      });

      if (response) {
        onNoteUpdate?.(response);
        setAppliedSuggestions(prev => new Set([...prev, index]));
        toast.success('Suggestion applied');
      }
    } catch (error) {
      console.error('Error applying suggestion:', error);
      toast.error('Failed to apply suggestion');
    }
  };

  const addAllTasks = async () => {
    if (!userEmail || suggestedTasks.length === 0) return;

    try {
      const tasksToCreate = suggestedTasks.map(task => {
        const dueDate = (() => {
          const today = new Date();
          switch (task.suggested_due_timeframe) {
            case 'today': return today.toISOString().split('T')[0];
            case '24_hours':
              today.setDate(today.getDate() + 1);
              return today.toISOString().split('T')[0];
            case '48_hours':
              today.setDate(today.getDate() + 2);
              return today.toISOString().split('T')[0];
            case 'this_week':
              today.setDate(today.getDate() + 7);
              return today.toISOString().split('T')[0];
            default: return null;
          }
        })();

        return {
          title: task.title,
          description: task.description,
          priority: task.priority,
          type: task.type,
          due_date: dueDate,
          patient_id: selectedPatient !== 'no_patient' ? selectedPatient : null,
          assigned_to: userEmail,
          source: 'ai_generated',
          status: 'pending'
        };
      });

      await base44.entities.Task.bulkCreate(tasksToCreate);
      onTaskAdd?.();
      toast.success(`Added ${suggestedTasks.length} tasks to your list`);
    } catch (error) {
      console.error('Error adding tasks:', error);
      toast.error('Failed to add some tasks');
    }
  };

  return (
    <Card className="border-purple-200 bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-950 dark:to-indigo-950">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-purple-600" />
            <span>AI Suggestions & Actions</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-purple-600">
              {totalSuggestions} Suggestion{totalSuggestions !== 1 ? 's' : ''}
            </Badge>
            {suggestions.length > 0 && (
              <Button 
                size="sm"
                onClick={applyAllSuggestions}
                disabled={applyingAll}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {applyingAll ? (
                  <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Applying...</>
                ) : (
                  <><Zap className="w-3 h-3 mr-1" /> Fix All</>
                )}
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs defaultValue="quality" className="w-full">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="quality">
              Quality Improvements ({suggestions.length})
            </TabsTrigger>
            <TabsTrigger value="tasks">
              Follow-Up Tasks ({suggestedTasks.length})
            </TabsTrigger>
          </TabsList>

          {/* Quality Suggestions Tab */}
          <TabsContent value="quality" className="space-y-2 mt-4">
            {suggestions.length === 0 ? (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  No quality improvements needed - your documentation is excellent!
                </AlertDescription>
              </Alert>
            ) : (
              suggestions.map((suggestion, idx) => {
                const isApplied = appliedSuggestions.has(idx);
                
                return (
                  <div 
                    key={idx}
                    className={`p-3 rounded-lg border ${
                      isApplied 
                        ? 'bg-green-50 dark:bg-green-950 border-green-200' 
                        : 'bg-white dark:bg-slate-900 border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {isApplied && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                          <Badge className={
                            suggestion.priority === 'high' ? 'bg-red-100 text-red-800' :
                            suggestion.priority === 'medium' ? 'bg-amber-100 text-amber-800' :
                            'bg-blue-100 text-blue-800'
                          }>
                            {suggestion.category || 'Quality'}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-700 dark:text-slate-300 mb-2">
                          {suggestion.suggestion_text}
                        </p>
                        {suggestion.example_improved_text && (
                          <div className="bg-blue-50 dark:bg-blue-900 p-2 rounded text-xs">
                            <strong>Example:</strong> {suggestion.example_improved_text}
                          </div>
                        )}
                      </div>
                      {!isApplied && (
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => applySingleSuggestion(suggestion, idx)}
                          className="flex-shrink-0"
                        >
                          <Check className="w-3 h-3 mr-1" />
                          Apply
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </TabsContent>

          {/* Tasks Tab */}
          <TabsContent value="tasks" className="space-y-2 mt-4">
            {suggestedTasks.length === 0 ? (
              <Alert className="bg-blue-50 border-blue-200">
                <Lightbulb className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-800">
                  No follow-up tasks suggested for this visit.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="flex justify-end mb-2">
                  <Button 
                    size="sm"
                    onClick={addAllTasks}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Add All {suggestedTasks.length} Tasks
                  </Button>
                </div>
                {suggestedTasks.map((task, idx) => (
                  <TaskCard key={idx} task={task} />
                ))}
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function TaskCard({ task }) {
  return (
    <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-blue-200">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100">
              {task.title}
            </h4>
            <Badge className={
              task.priority === 'critical' ? 'bg-red-600' :
              task.priority === 'high' ? 'bg-orange-500' :
              task.priority === 'medium' ? 'bg-amber-500' :
              'bg-blue-500'
            }>
              {task.priority}
            </Badge>
            <Badge variant="outline" className="text-xs">{task.type}</Badge>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
            {task.description}
          </p>
          {task.ai_reason && (
            <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 p-2 rounded">
              <strong>AI Analysis:</strong> {task.ai_reason}
            </p>
          )}
        </div>
      </div>
      {task.suggested_due_timeframe && (
        <p className="text-xs text-slate-500">
          Due: {task.suggested_due_timeframe.replace('_', ' ')}
        </p>
      )}
    </div>
  );
}