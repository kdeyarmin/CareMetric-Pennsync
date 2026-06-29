import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileEdit,
  CheckCircle2,
  Lightbulb,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Star,
  Target,
  PenTool
} from "lucide-react";

export default function DocumentationQualitySuggestions({ analysisResults }) {
  const [expandedSection, setExpandedSection] = useState(null);

  if (!analysisResults) return null;

  // Generate quality improvement suggestions
  const generateSuggestions = () => {
    const suggestions = {
      narrative: [],
      specificity: [],
      consistency: [],
      completeness: []
    };

    // Analyze accuracy issues for narrative improvements
    const accuracyIssues = analysisResults.accuracy_issues || [];
    accuracyIssues.forEach(issue => {
      if (issue.recommendation) {
        suggestions.specificity.push({
          item: issue.item,
          current: issue.issue,
          suggestion: issue.recommendation,
          priority: issue.severity === 'high' ? 'high' : 'medium'
        });
      }
    });

    // Analyze documentation improvements
    const docImprovements = analysisResults.documentation_improvements || [];
    docImprovements.forEach(imp => {
      suggestions.narrative.push({
        item: imp.item,
        current: imp.current_state,
        suggestion: imp.improved_state,
        rationale: imp.rationale,
        priority: 'medium'
      });
    });

    // Check for consistency issues from validation
    const validationIssues = analysisResults.validation_summary?.issues || [];
    validationIssues.forEach(issue => {
      if (issue.type === 'inconsistency' || issue.description?.toLowerCase().includes('inconsisten')) {
        suggestions.consistency.push({
          item: issue.item,
          problem: issue.description,
          fix: issue.suggested_correction,
          priority: issue.severity === 'critical' ? 'high' : 'medium'
        });
      }
    });

    // Check for completeness based on extracted items
    const missingItems = analysisResults.extracted_items?.items_missing || [];
    if (missingItems.length > 0) {
      missingItems.slice(0, 5).forEach(item => {
        suggestions.completeness.push({
          item: item,
          suggestion: `Ensure ${item} is properly documented with supporting narrative`,
          priority: 'medium'
        });
      });
    }

    // Add general best practice suggestions based on scores
    if (analysisResults.accuracy_score < 80) {
      suggestions.narrative.push({
        item: 'General',
        current: 'Documentation lacks clinical specificity',
        suggestion: 'Include specific measurements, timeframes, and observable patient responses',
        rationale: 'Specific documentation supports accurate OASIS scoring',
        priority: 'high'
      });
    }

    if (analysisResults.compliance_score < 80) {
      suggestions.specificity.push({
        item: 'Skilled Need',
        current: 'Skilled care necessity may not be clearly documented',
        suggestion: 'Document WHY skilled services are required, not just WHAT services are provided',
        priority: 'high'
      });
    }

    return suggestions;
  };

  const suggestions = generateSuggestions();
  const totalSuggestions = Object.values(suggestions).flat().length;

  const sections = [
    {
      key: 'narrative',
      title: 'Narrative Enhancement',
      icon: PenTool,
      color: 'blue',
      items: suggestions.narrative
    },
    {
      key: 'specificity',
      title: 'Clinical Specificity',
      icon: Target,
      color: 'purple',
      items: suggestions.specificity
    },
    {
      key: 'consistency',
      title: 'Internal Consistency',
      icon: CheckCircle2,
      color: 'green',
      items: suggestions.consistency
    },
    {
      key: 'completeness',
      title: 'Documentation Completeness',
      icon: BookOpen,
      color: 'orange',
      items: suggestions.completeness
    }
  ];

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-blue-100 text-blue-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getColorClasses = (color) => {
    const colors = {
      blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', icon: 'text-blue-600' },
      purple: { bg: 'bg-navy-50', border: 'border-navy-200', text: 'text-navy-700', icon: 'text-navy-600' },
      green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', icon: 'text-green-600' },
      orange: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', icon: 'text-orange-600' }
    };
    return colors[color] || colors.blue;
  };

  return (
    <Card className="border-2 border-blue-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileEdit className="w-5 h-5 text-blue-600" />
            Documentation Quality Suggestions
          </div>
          <Badge variant="outline" className="text-xs">
            {totalSuggestions} suggestions
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {totalSuggestions === 0 ? (
          <div className="p-4 bg-green-50 rounded-lg border border-green-200 text-center">
            <Star className="w-8 h-8 text-green-600 mx-auto mb-2" />
            <p className="text-sm font-medium text-green-800">Excellent Documentation Quality</p>
            <p className="text-xs text-green-600 mt-1">No significant quality improvements identified</p>
          </div>
        ) : (
          sections.map(section => {
            if (section.items.length === 0) return null;
            
            const colorClasses = getColorClasses(section.color);
            const isExpanded = expandedSection === section.key;
            const Icon = section.icon;

            return (
              <div key={section.key} className={`rounded-lg border ${colorClasses.border} overflow-hidden`}>
                <button
                  onClick={() => setExpandedSection(isExpanded ? null : section.key)}
                  className={`w-full flex items-center justify-between p-3 ${colorClasses.bg} hover:opacity-90 transition-colors`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${colorClasses.icon}`} />
                    <span className={`text-sm font-medium ${colorClasses.text}`}>{section.title}</span>
                    <Badge variant="outline" className="text-xs">
                      {section.items.length}
                    </Badge>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  )}
                </button>

                {isExpanded && (
                  <div className="p-3 bg-white space-y-3">
                    {section.items.map((item, idx) => (
                      <div key={idx} className="p-3 bg-slate-50 rounded-lg border">
                        <div className="flex items-start justify-between mb-2">
                          <Badge variant="outline" className="text-xs font-mono">
                            {item.item}
                          </Badge>
                          <Badge className={`text-xs ${getPriorityBadge(item.priority)}`}>
                            {item.priority}
                          </Badge>
                        </div>

                        {item.current && (
                          <div className="mb-2">
                            <p className="text-xs text-slate-500">Current Issue:</p>
                            <p className="text-xs text-slate-700">{item.current}</p>
                          </div>
                        )}

                        {item.problem && (
                          <div className="mb-2">
                            <p className="text-xs text-slate-500">Problem:</p>
                            <p className="text-xs text-slate-700">{item.problem}</p>
                          </div>
                        )}

                        <div className="p-2 bg-green-50 rounded border border-green-200">
                          <div className="flex items-start gap-2">
                            <Lightbulb className="w-3 h-3 text-green-600 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-xs font-medium text-green-800">Suggestion:</p>
                              <p className="text-xs text-green-700">{item.suggestion || item.fix}</p>
                            </div>
                          </div>
                        </div>

                        {item.rationale && (
                          <p className="text-xs text-slate-500 mt-2 italic">
                            Why: {item.rationale}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Quick Tips */}
        <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-200 mt-4">
          <p className="text-xs font-semibold text-indigo-800 mb-2 flex items-center gap-1">
            <BookOpen className="w-3 h-3" />
            Documentation Best Practices
          </p>
          <ul className="text-xs text-indigo-700 space-y-1">
            <li>• Use objective, measurable terms (e.g., "walked 50 feet" vs "walked a short distance")</li>
            <li>• Document patient response to interventions, not just interventions performed</li>
            <li>• Include timeframes and progression notes for ongoing conditions</li>
            <li>• Connect functional limitations to skilled need and diagnosis</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}