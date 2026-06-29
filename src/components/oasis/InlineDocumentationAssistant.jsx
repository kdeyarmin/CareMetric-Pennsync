import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Copy, CheckCircle2, Sparkles } from "lucide-react";

export default function InlineDocumentationAssistant({ 
  issue, 
  issueType, 
  pdgmData,
  onInsertText 
}) {
  const ai = useAICall();
  const [suggestion, setSuggestion] = useState(null);
  const [copied, setCopied] = useState(false);

  const generateSuggestion = async () => {
    
    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a CMS OASIS documentation expert. Generate specific clinical documentation to address this issue.

ISSUE DETAILS:
Type: ${issueType}
${JSON.stringify(issue, null, 2)}

PATIENT CONTEXT:
Primary Diagnosis: ${pdgmData?.primary_diagnosis || 'Unknown'}
Functional Scores: ${JSON.stringify(pdgmData?.functional_scores || {}, null, 2)}
Admission Source: ${pdgmData?.admission_source || 'Unknown'}

REQUIREMENTS:
1. Generate CMS-compliant clinical documentation text
2. Use objective, measurable language
3. Support the recommended scoring or correction
4. Include specific clinical observations and patient responses
5. Follow Medicare documentation guidelines

Provide:
1. CLINICAL DOCUMENTATION TEXT - Ready to copy/paste into notes
2. CMS RATIONALE - Why this documentation is compliant and appropriate
3. M-ITEM SUPPORT - How this documentation supports the recommended scoring
4. ALTERNATIVE PHRASING - 2-3 alternative ways to document the same finding

Return JSON:
{
  "documentation_text": "Ready-to-use clinical documentation paragraph",
  "cms_rationale": "Why this is CMS-compliant and appropriate",
  "m_item_support": "How this supports the recommended M-item scoring",
  "alternative_phrases": [
    {"text": "Alternative phrasing option 1", "use_case": "when to use this"},
    {"text": "Alternative phrasing option 2", "use_case": "when to use this"}
  ],
  "key_elements": ["element 1", "element 2"],
  "warning": "Any potential pitfalls or things to verify"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            documentation_text: { type: "string" },
            cms_rationale: { type: "string" },
            m_item_support: { type: "string" },
            alternative_phrases: { type: "array", items: { type: "object" } },
            key_elements: { type: "array", items: { type: "string" } },
            warning: { type: "string" }
          }
        }
      });

      setSuggestion(result);
    } catch (error) {
      console.error("Error generating suggestion:", error);
      setSuggestion({ error: "Failed to generate suggestion. Please try again." });
    }
    
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-3 border-t pt-3">
      {!suggestion ? (
        <Button
          onClick={generateSuggestion}
          disabled={ai.loading}
          size="sm"
          className="w-full bg-indigo-600 hover:bg-indigo-700"
        >
          {ai.loading ? (
            <><Loader2 className="w-3 h-3 mr-2 animate-spin" /> Generating...</>
          ) : (
            <><Sparkles className="w-3 h-3 mr-2" /> AI Documentation Assistant</>
          )}
        </Button>
      ) : suggestion.error ? (
        <div className="bg-red-50 p-2 rounded text-xs text-red-700">
          {suggestion.error}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Main Documentation Text */}
          <div className="bg-gradient-to-r from-indigo-50 to-navy-50 p-3 rounded-lg border-2 border-indigo-300">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-indigo-800 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                AI-Generated Documentation
              </p>
              <div className="flex gap-1">
                <Button
                  onClick={() => handleCopy(suggestion.documentation_text)}
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs"
                >
                  {copied ? (
                    <><CheckCircle2 className="w-3 h-3 mr-1" /> Copied</>
                  ) : (
                    <><Copy className="w-3 h-3 mr-1" /> Copy</>
                  )}
                </Button>
                {onInsertText && (
                  <Button
                    onClick={() => onInsertText(suggestion.documentation_text)}
                    size="sm"
                    className="h-6 text-xs bg-indigo-600"
                  >
                    Insert
                  </Button>
                )}
              </div>
            </div>
            <p className="text-sm text-slate-800 leading-relaxed italic">
              "{suggestion.documentation_text}"
            </p>
          </div>

          {/* CMS Rationale */}
          <div className="bg-blue-50 p-2 rounded border border-blue-200">
            <p className="text-xs font-medium text-blue-800 mb-1">📋 CMS Compliance Rationale:</p>
            <p className="text-xs text-blue-900">{suggestion.cms_rationale}</p>
          </div>

          {/* M-Item Support */}
          <div className="bg-navy-50 p-2 rounded border border-navy-200">
            <p className="text-xs font-medium text-navy-800 mb-1">🎯 M-Item Scoring Support:</p>
            <p className="text-xs text-navy-900">{suggestion.m_item_support}</p>
          </div>

          {/* Key Elements */}
          {suggestion.key_elements?.length > 0 && (
            <div className="bg-green-50 p-2 rounded border border-green-200">
              <p className="text-xs font-medium text-green-800 mb-1">✓ Key Elements Included:</p>
              <div className="flex flex-wrap gap-1">
                {suggestion.key_elements.map((element, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs bg-white">
                    {element}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Alternative Phrases */}
          {suggestion.alternative_phrases?.length > 0 && (
            <details className="bg-slate-50 p-2 rounded border">
              <summary className="text-xs font-medium text-slate-700 cursor-pointer">
                Alternative Phrasing Options ({suggestion.alternative_phrases.length})
              </summary>
              <div className="mt-2 space-y-2">
                {suggestion.alternative_phrases.map((alt, idx) => (
                  <div key={idx} className="bg-white p-2 rounded border">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-xs text-slate-800 italic flex-1">"{alt.text}"</p>
                      <Button
                        onClick={() => handleCopy(alt.text)}
                        size="sm"
                        variant="ghost"
                        className="h-5 text-xs px-2"
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                    <p className="text-xs text-slate-500">Use: {alt.use_case}</p>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Warning */}
          {suggestion.warning && (
            <div className="bg-yellow-50 p-2 rounded border border-yellow-300 text-xs text-yellow-800">
              <strong>⚠️ Note:</strong> {suggestion.warning}
            </div>
          )}

          {/* Regenerate */}
          <Button
            onClick={() => { setSuggestion(null); generateSuggestion(); }}
            size="sm"
            variant="outline"
            className="w-full text-xs"
          >
            Regenerate Suggestion
          </Button>
        </div>
      )}
    </div>
  );
}