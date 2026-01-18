import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Wand2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export function ResolveComplianceIssue({ issue, noteContent, onResolved }) {
  const [resolving, setResolving] = useState(false);

  const handleResolve = async () => {
    setResolving(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Fix this specific compliance issue in the clinical note:

ISSUE: ${issue.problem}
ELEMENT: ${issue.element}
SUGGESTION: ${issue.suggestion}
${issue.specific_fix ? `EXAMPLE FIX: ${issue.specific_fix}` : ''}

CURRENT NOTE:
${noteContent}

Generate the complete corrected note with this specific issue resolved. Maintain all other content exactly as is. Only fix this one issue.`,
        response_json_schema: {
          type: "object",
          properties: {
            corrected_note: { type: "string" },
            what_was_changed: { type: "string" }
          }
        }
      });

      onResolved(response.corrected_note, response.what_was_changed);
      toast.success('Issue resolved automatically');
    } catch (error) {
      console.error('Error resolving issue:', error);
      toast.error('Failed to resolve issue');
    } finally {
      setResolving(false);
    }
  };

  return (
    <Button
      size="sm"
      onClick={handleResolve}
      disabled={resolving}
      className="bg-indigo-600 hover:bg-indigo-700 text-white"
    >
      {resolving ? (
        <>
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          Fixing...
        </>
      ) : (
        <>
          <Wand2 className="w-3 h-3 mr-1" />
          Auto-Fix
        </>
      )}
    </Button>
  );
}

export function ResolveDocumentationGap({ gap, noteContent, visitType, diagnosis, onResolved }) {
  const [resolving, setResolving] = useState(false);

  const handleResolve = async () => {
    setResolving(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Fill this documentation gap in the clinical note:

GAP IDENTIFIED: ${gap.gap}
IMPORTANCE: ${gap.importance}
SUGGESTED QUESTIONS TO ADDRESS: ${gap.suggested_questions?.join(', ')}
EXAMPLE DOCUMENTATION: ${gap.example_documentation}

CURRENT NOTE:
${noteContent}

Visit Type: ${visitType}
Diagnosis: ${diagnosis}

Add the missing documentation to the note in the appropriate section. Use professional clinical language. If specific data is unknown, use appropriate clinical phrasing like "Patient reports..." or "Assessment shows...".`,
        response_json_schema: {
          type: "object",
          properties: {
            enhanced_note: { type: "string" },
            what_was_added: { type: "string" }
          }
        }
      });

      onResolved(response.enhanced_note, response.what_was_added);
      toast.success('Gap filled automatically');
    } catch (error) {
      console.error('Error filling gap:', error);
      toast.error('Failed to fill gap');
    } finally {
      setResolving(false);
    }
  };

  return (
    <Button
      size="sm"
      onClick={handleResolve}
      disabled={resolving}
      className="bg-green-600 hover:bg-green-700 text-white"
    >
      {resolving ? (
        <>
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          Filling...
        </>
      ) : (
        <>
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Fill Gap
        </>
      )}
    </Button>
  );
}

export function ResolveQualitySuggestion({ suggestion, noteContent, onResolved }) {
  const [resolving, setResolving] = useState(false);

  const handleResolve = async () => {
    setResolving(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Improve the clinical note based on this quality suggestion:

SUGGESTION: ${suggestion.suggestion}
CATEGORY: ${suggestion.category}
${suggestion.example ? `EXAMPLE: ${suggestion.example}` : ''}

CURRENT NOTE:
${noteContent}

Apply this improvement to the note while maintaining all other content. Make the change seamless and professional.`,
        response_json_schema: {
          type: "object",
          properties: {
            improved_note: { type: "string" },
            what_changed: { type: "string" }
          }
        }
      });

      onResolved(response.improved_note, response.what_changed);
      toast.success('Quality improved');
    } catch (error) {
      console.error('Error applying suggestion:', error);
      toast.error('Failed to apply suggestion');
    } finally {
      setResolving(false);
    }
  };

  return (
    <Button
      size="sm"
      onClick={handleResolve}
      disabled={resolving}
      className="bg-purple-600 hover:bg-purple-700 text-white"
    >
      {resolving ? (
        <>
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          Applying...
        </>
      ) : (
        <>
          <Wand2 className="w-3 h-3 mr-1" />
          Apply
        </>
      )}
    </Button>
  );
}

export function ResolveAllIssues({ issues, gaps, suggestions, noteContent, visitType, diagnosis, onResolved }) {
  const [resolving, setResolving] = useState(false);

  const handleResolveAll = async () => {
    setResolving(true);
    try {
      const issuesList = issues?.map(i => `- ${i.element}: ${i.problem} (Fix: ${i.suggestion})`).join('\n') || '';
      const gapsList = gaps?.map(g => `- ${g.gap} (${g.importance}): ${g.example_documentation}`).join('\n') || '';
      const suggestionsList = suggestions?.map(s => `- ${s.category}: ${s.suggestion}`).join('\n') || '';

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Comprehensively improve this clinical note by resolving ALL issues, gaps, and suggestions:

COMPLIANCE ISSUES TO FIX:
${issuesList}

DOCUMENTATION GAPS TO FILL:
${gapsList}

QUALITY IMPROVEMENTS TO APPLY:
${suggestionsList}

CURRENT NOTE:
${noteContent}

Visit Type: ${visitType}
Diagnosis: ${diagnosis}

Generate a fully corrected, complete, high-quality clinical note that addresses every single item above. Make it Medicare-compliant and professional.`,
        response_json_schema: {
          type: "object",
          properties: {
            fully_corrected_note: { type: "string" },
            summary_of_changes: { type: "string" }
          }
        }
      });

      onResolved(response.fully_corrected_note, response.summary_of_changes);
      toast.success('All issues resolved automatically');
    } catch (error) {
      console.error('Error resolving all issues:', error);
      toast.error('Failed to resolve all issues');
    } finally {
      setResolving(false);
    }
  };

  const totalIssues = (issues?.length || 0) + (gaps?.length || 0) + (suggestions?.length || 0);

  if (totalIssues === 0) return null;

  return (
    <Button
      size="lg"
      onClick={handleResolveAll}
      disabled={resolving}
      className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white w-full"
    >
      {resolving ? (
        <>
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          Resolving {totalIssues} Issues...
        </>
      ) : (
        <>
          <Wand2 className="w-5 h-5 mr-2" />
          Auto-Fix All {totalIssues} Issues
        </>
      )}
    </Button>
  );
}