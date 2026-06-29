import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Sparkles,
  Target,
  CheckCircle2,
  Plus,
  AlertTriangle,
  TrendingUp,
  FileText,
  RefreshCw,
  Eye,
  EyeOff
} from "lucide-react";
import { toast } from 'sonner';

export default function AICarePlanSuggester({ patientId, onCarePlanCreated }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [expandedSuggestions, setExpandedSuggestions] = useState([]);
  const [creatingPlans, setCreatingPlans] = useState(new Set());
  const [_customNotes, _setCustomNotes] = useState({});

  const generateSuggestions = async () => {
    if (!patientId) return;

    setIsGenerating(true);
    try {
      const { data } = await base44.functions.invoke('generateCarePlanSuggestions', {
        patient_id: patientId
      });

      setSuggestions(data);
      if (data.suggestions?.length > 0) {
        setExpandedSuggestions([0]);
      }
    } catch (error) {
      console.error('Error generating suggestions:', error);
      toast.error('Failed to generate care plan suggestions. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApproveSuggestion = async (suggestion, index) => {
    setCreatingPlans(prev => new Set([...prev, index]));
    try {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + (suggestion.target_days || 60));

      await base44.entities.CarePlan.create({
        patient_id: patientId,
        problem: suggestion.problem,
        goal: suggestion.goal,
        interventions: suggestion.interventions,
        // Local calendar date — toISOString() converts to UTC and, for a plan
        // created in the evening in any US timezone, rolls target_date a day late.
        target_date: `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`,
        baseline_measurement: suggestion.baseline_measurement,
        frequency: suggestion.frequency,
        status: 'active'
      });

      setSuggestions(prev => ({
        ...prev,
        suggestions: prev.suggestions.filter((_, i) => i !== index)
      }));

      if (onCarePlanCreated) {
        onCarePlanCreated();
      }
    } catch (error) {
      console.error('Error creating care plan:', error);
      toast.error('Failed to create care plan. Please try again.');
    } finally {
      setCreatingPlans(prev => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  };

  const handleDismissSuggestion = (index) => {
    setSuggestions(prev => ({
      ...prev,
      suggestions: prev.suggestions.filter((_, i) => i !== index)
    }));
  };

  const toggleExpanded = (index) => {
    setExpandedSuggestions(prev =>
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const getPriorityColor = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'high': return 'bg-red-600';
      case 'medium': return 'bg-orange-600';
      case 'low': return 'bg-yellow-600';
      default: return 'bg-blue-600';
    }
  };

  if (!suggestions) {
    return (
      <Card className="border-2 border-indigo-300 bg-indigo-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-indigo-900">
            <Sparkles className="w-4 h-4" />
            AI Care Plan Suggestions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-indigo-800 mb-3">
            Generate personalized care plan recommendations based on patient timeline, diagnoses, and clinical events.
          </p>
          <Button
            onClick={generateSuggestions}
            disabled={isGenerating}
            size="sm"
            className="bg-indigo-600 hover:bg-indigo-700 w-full"
          >
            {isGenerating ? (
              <>
                <Sparkles className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Patient Data...
              </>
            ) : (
              <>
                <Target className="w-4 h-4 mr-2" />
                Generate Care Plan Suggestions
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (suggestions.suggestions?.length === 0) {
    return (
      <Card className="border-2 border-green-300 bg-green-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-green-900">
            <CheckCircle2 className="w-4 h-4" />
            Care Plans Up to Date
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-green-800 mb-3">
            {suggestions.overall_assessment || 'No additional care plans needed at this time. Current plans appear comprehensive.'}
          </p>
          <Button
            onClick={generateSuggestions}
            variant="outline"
            size="sm"
            className="w-full"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Re-analyze
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-indigo-300 bg-indigo-50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2 text-indigo-900">
            <Sparkles className="w-4 h-4" />
            AI-Suggested Care Plans
          </CardTitle>
          <Badge className="bg-indigo-600 text-white">
            {suggestions.suggestions.length} suggestions
          </Badge>
        </div>
        {suggestions.overall_assessment && (
          <p className="text-xs text-indigo-800 mt-2">{suggestions.overall_assessment}</p>
        )}
        {suggestions.critical_gaps_identified?.length > 0 && (
          <Alert className="mt-2 bg-red-50 border-red-300">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-xs text-red-800">
              <strong>Critical Gaps:</strong> {suggestions.critical_gaps_identified.join(', ')}
            </AlertDescription>
          </Alert>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.suggestions.map((suggestion, index) => {
          const isExpanded = expandedSuggestions.includes(index);
          const isCreating = creatingPlans.has(index);

          return (
            <Card key={index} className="bg-white border-l-4 border-indigo-400">
              <CardContent className="p-4">
                <div
                  className="flex items-start justify-between cursor-pointer mb-2"
                  onClick={() => toggleExpanded(index)}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={`${getPriorityColor(suggestion.priority)} text-white text-xs`}>
                        {suggestion.priority}
                      </Badge>
                      <Target className="w-4 h-4 text-indigo-600" />
                    </div>
                    <h4 className="font-semibold text-sm text-slate-900">{suggestion.problem}</h4>
                    <p className="text-xs text-slate-600 mt-1">{suggestion.goal}</p>
                  </div>
                  <Button variant="ghost" size="sm">
                    {isExpanded ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>

                {isExpanded && (
                  <div className="space-y-3 border-t border-slate-200 pt-3 mt-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        Interventions:
                      </p>
                      <ul className="space-y-1">
                        {suggestion.interventions?.map((intervention, idx) => (
                          <li key={idx} className="text-xs text-slate-600 flex items-start gap-2">
                            <span className="text-indigo-600">•</span>
                            <span>{intervention}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-slate-700 mb-1">Expected Outcomes:</p>
                      <p className="text-xs text-slate-600">{suggestion.expected_outcomes}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-xs font-semibold text-slate-700 mb-1">Baseline:</p>
                        <p className="text-xs text-slate-600">{suggestion.baseline_measurement}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-700 mb-1">Frequency:</p>
                        <p className="text-xs text-slate-600">{suggestion.frequency}</p>
                      </div>
                    </div>

                    <Alert className="bg-blue-50 border-blue-200">
                      <TrendingUp className="w-4 h-4 text-blue-600" />
                      <AlertDescription className="text-xs text-blue-800">
                        <strong>Rationale:</strong> {suggestion.rationale}
                      </AlertDescription>
                    </Alert>

                    {suggestion.medicare_considerations && (
                      <Alert className="bg-navy-50 border-navy-200">
                        <FileText className="w-4 h-4 text-navy-600" />
                        <AlertDescription className="text-xs text-navy-800">
                          <strong>Documentation Tip:</strong> {suggestion.medicare_considerations}
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleApproveSuggestion(suggestion, index)}
                        disabled={isCreating}
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 flex-1"
                      >
                        {isCreating ? (
                          <Sparkles className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <Plus className="w-3 h-3 mr-1" />
                        )}
                        Add to Care Plan
                      </Button>
                      <Button
                        onClick={() => handleDismissSuggestion(index)}
                        disabled={isCreating}
                        variant="outline"
                        size="sm"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        <Button
          onClick={generateSuggestions}
          variant="outline"
          size="sm"
          className="w-full mt-2"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Regenerate Suggestions
        </Button>
      </CardContent>
    </Card>
  );
}