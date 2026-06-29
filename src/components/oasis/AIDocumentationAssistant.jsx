import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Sparkles,
  FileText,
  Copy,
  Check,
  Loader2,
  BookOpen,
  AlertTriangle,
  Lightbulb,
  Scale,
  TrendingUp
} from "lucide-react";

export default function AIDocumentationAssistant({ analysisResults, pdgmData, onInsertText }) {
  const [activeTab, setActiveTab] = useState("suggestions");
  const ai = useAICall();
  const [suggestions, setSuggestions] = useState(null);
  const [cmsExplanations, setCmsExplanations] = useState(null);
  const [copiedIndex, setCopiedIndex] = useState(null);

  const generateSuggestions = async () => {
    if (!analysisResults) return;

    try {
      const issues = [
        ...(analysisResults.accuracy_issues || []),
        ...(analysisResults.compliance_concerns || []),
        ...(analysisResults.documentation_improvements || [])
      ].slice(0, 8);

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert OASIS clinical documentation specialist. Based on these identified issues, generate SPECIFIC documentation text that clinicians can use to improve their OASIS assessments.

IDENTIFIED ISSUES:
${JSON.stringify(issues, null, 2)}

CURRENT PDGM DATA:
${JSON.stringify(pdgmData, null, 2)}

For each issue, provide:
1. A ready-to-use documentation snippet (exact clinical language)
2. Why this text improves the documentation
3. Which M-item(s) it supports
4. Expected impact on scoring

Return JSON:
{
  "documentation_suggestions": [
    {
      "issue_addressed": "brief description of the issue",
      "m_items": ["M1830", "M1860"],
      "suggested_text": "Exact clinical documentation text ready to copy/paste into EHR. Be specific with measurements, timeframes, and patient responses.",
      "rationale": "Why this documentation is effective",
      "scoring_impact": "How this affects OASIS scoring",
      "compliance_benefit": "How this improves compliance"
    }
  ],
  "narrative_template": "A complete narrative paragraph combining all key elements that would improve the overall documentation quality for this patient.",
  "quick_fixes": [
    {
      "item": "M-item code",
      "current_issue": "What's missing",
      "add_this": "Short phrase to add"
    }
  ]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            documentation_suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  issue_addressed: { type: "string" },
                  m_items: { type: "array", items: { type: "string" } },
                  suggested_text: { type: "string" },
                  rationale: { type: "string" },
                  scoring_impact: { type: "string" },
                  compliance_benefit: { type: "string" }
                }
              }
            },
            narrative_template: { type: "string" },
            quick_fixes: { type: "array", items: { type: "object" } }
          }
        }
      });

      setSuggestions(result);
    } catch (error) {
      console.error("Error generating suggestions:", error);
    }
  };

  const generateCMSExplanations = async () => {
    if (!analysisResults) return;

    try {
      const flaggedItems = [
        ...(analysisResults.compliance_concerns || []),
        ...(analysisResults.audit_risk_areas || [])
      ].slice(0, 6);

      const result = await ai.run({
        model: "claude_sonnet_4_6",
        prompt: `You are a CMS regulations expert specializing in home health OASIS documentation. Explain the regulatory requirements for these flagged compliance items in plain language that clinicians can understand.

FLAGGED ITEMS:
${JSON.stringify(flaggedItems, null, 2)}

For each item, provide:
1. The specific CMS regulation or guideline that applies
2. Plain-language explanation of what CMS requires
3. Why this matters for reimbursement and audit protection
4. Common mistakes agencies make
5. Best practice documentation tips

Return JSON:
{
  "cms_explanations": [
    {
      "item": "The compliance area or M-item",
      "regulation_reference": "Specific CMS reference (e.g., CMS-HH-PPS, OASIS-E Guidance)",
      "requirement_summary": "What CMS specifically requires",
      "plain_language": "Simple explanation for clinicians",
      "reimbursement_impact": "How this affects payment",
      "audit_risk": "What auditors look for",
      "common_mistakes": ["mistake 1", "mistake 2"],
      "best_practices": ["practice 1", "practice 2"],
      "documentation_example": "Example of compliant documentation"
    }
  ],
  "key_takeaways": ["Most important points to remember"]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            cms_explanations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  item: { type: "string" },
                  regulation_reference: { type: "string" },
                  requirement_summary: { type: "string" },
                  plain_language: { type: "string" },
                  reimbursement_impact: { type: "string" },
                  audit_risk: { type: "string" },
                  common_mistakes: { type: "array", items: { type: "string" } },
                  best_practices: { type: "array", items: { type: "string" } },
                  documentation_example: { type: "string" }
                }
              }
            },
            key_takeaways: { type: "array", items: { type: "string" } }
          }
        }
      });

      setCmsExplanations(result);
    } catch (error) {
      console.error("Error generating CMS explanations:", error);
    }
  };

  const handleCopy = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  if (!analysisResults) return null;

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-navy-50 to-indigo-50">
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-navy-600" />
          AI Documentation Assistant
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="suggestions" className="gap-1">
              <FileText className="w-3 h-3" />
              Documentation Suggestions
            </TabsTrigger>
            <TabsTrigger value="cms" className="gap-1">
              <Scale className="w-3 h-3" />
              CMS Regulations
            </TabsTrigger>
          </TabsList>

          <TabsContent value="suggestions">
            {!suggestions ? (
              <div className="text-center py-6">
                <Lightbulb className="w-12 h-12 text-navy-300 mx-auto mb-3" />
                <p className="text-sm text-slate-600 mb-4">
                  Generate AI-powered documentation text to address identified issues
                </p>
                <Button onClick={generateSuggestions} disabled={ai.loading}>
                  {ai.loading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
                  ) : (
                    <><Sparkles className="w-4 h-4 mr-2" /> Generate Suggestions</>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Quick Fixes */}
                {suggestions.quick_fixes?.length > 0 && (
                  <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                    <p className="text-sm font-semibold text-green-800 mb-2 flex items-center gap-1">
                      <TrendingUp className="w-4 h-4" /> Quick Fixes
                    </p>
                    <div className="space-y-2">
                      {suggestions.quick_fixes.map((fix, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-white p-2 rounded border">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">{fix.item}</Badge>
                            <span className="text-sm text-slate-600">{fix.current_issue}</span>
                          </div>
                          <Button 
                            size="sm" 
                            variant="ghost"
                            onClick={() => handleCopy(fix.add_this, `quick-${idx}`)}
                          >
                            {copiedIndex === `quick-${idx}` ? (
                              <Check className="w-3 h-3 text-green-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            <span className="ml-1 text-xs text-green-700">{fix.add_this}</span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Narrative Template */}
                {suggestions.narrative_template && (
                  <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold text-blue-800">Complete Narrative Template</p>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => handleCopy(suggestions.narrative_template, 'narrative')}
                      >
                        {copiedIndex === 'narrative' ? (
                          <><Check className="w-3 h-3 mr-1" /> Copied</>
                        ) : (
                          <><Copy className="w-3 h-3 mr-1" /> Copy</>
                        )}
                      </Button>
                    </div>
                    <p className="text-sm text-blue-900 bg-white p-2 rounded border border-blue-200">
                      {suggestions.narrative_template}
                    </p>
                  </div>
                )}

                {/* Detailed Suggestions */}
                <Accordion type="single" collapsible>
                  {suggestions.documentation_suggestions?.map((suggestion, idx) => (
                    <AccordionItem key={idx} value={`suggestion-${idx}`}>
                      <AccordionTrigger className="text-sm hover:no-underline">
                        <div className="flex items-center gap-2">
                          <span>{suggestion.issue_addressed}</span>
                          {suggestion.m_items?.map(item => (
                            <Badge key={item} variant="outline" className="text-xs">{item}</Badge>
                          ))}
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3 p-2">
                          <div className="bg-navy-50 p-3 rounded border border-navy-200">
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-xs font-semibold text-navy-700">Suggested Documentation:</p>
                              <div className="flex gap-1">
                                <Button 
                                  size="sm" 
                                  variant="ghost"
                                  onClick={() => handleCopy(suggestion.suggested_text, idx)}
                                >
                                  {copiedIndex === idx ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                </Button>
                                {onInsertText && (
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    onClick={() => onInsertText(suggestion.suggested_text)}
                                  >
                                    Insert
                                  </Button>
                                )}
                              </div>
                            </div>
                            <p className="text-sm text-navy-900 italic">"{suggestion.suggested_text}"</p>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-slate-50 p-2 rounded">
                              <p className="font-semibold text-slate-600">Scoring Impact:</p>
                              <p className="text-slate-800">{suggestion.scoring_impact}</p>
                            </div>
                            <div className="bg-slate-50 p-2 rounded">
                              <p className="font-semibold text-slate-600">Compliance Benefit:</p>
                              <p className="text-slate-800">{suggestion.compliance_benefit}</p>
                            </div>
                          </div>
                          <p className="text-xs text-slate-600">{suggestion.rationale}</p>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>

                <Button variant="outline" size="sm" onClick={generateSuggestions} className="w-full">
                  <Sparkles className="w-3 h-3 mr-1" /> Regenerate Suggestions
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="cms">
            {!cmsExplanations ? (
              <div className="text-center py-6">
                <BookOpen className="w-12 h-12 text-indigo-300 mx-auto mb-3" />
                <p className="text-sm text-slate-600 mb-4">
                  Get AI-powered explanations of CMS regulations for flagged items
                </p>
                <Button onClick={generateCMSExplanations} disabled={ai.loading}>
                  {ai.loading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
                  ) : (
                    <><Scale className="w-4 h-4 mr-2" /> Explain Regulations</>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Key Takeaways */}
                {cmsExplanations.key_takeaways?.length > 0 && (
                  <div className="bg-amber-50 p-3 rounded-lg border border-amber-200">
                    <p className="text-sm font-semibold text-amber-800 mb-2">Key Takeaways</p>
                    <ul className="space-y-1">
                      {cmsExplanations.key_takeaways.map((takeaway, idx) => (
                        <li key={idx} className="text-sm text-amber-900 flex items-start gap-2">
                          <AlertTriangle className="w-3 h-3 mt-1 flex-shrink-0" />
                          {takeaway}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* CMS Explanations */}
                <Accordion type="single" collapsible>
                  {cmsExplanations.cms_explanations?.map((exp, idx) => (
                    <AccordionItem key={idx} value={`cms-${idx}`}>
                      <AccordionTrigger className="text-sm hover:no-underline">
                        <div className="flex items-center gap-2">
                          <Scale className="w-4 h-4 text-indigo-600" />
                          {exp.item}
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3 p-2">
                          <div className="bg-indigo-50 p-2 rounded border border-indigo-200">
                            <p className="text-xs font-semibold text-indigo-600">CMS Reference:</p>
                            <p className="text-sm text-indigo-900">{exp.regulation_reference}</p>
                          </div>
                          
                          <div>
                            <p className="text-xs font-semibold text-slate-600">Plain Language Explanation:</p>
                            <p className="text-sm text-slate-800 bg-white p-2 rounded border">{exp.plain_language}</p>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="bg-green-50 p-2 rounded border border-green-200">
                              <p className="text-xs font-semibold text-green-700">Reimbursement Impact:</p>
                              <p className="text-xs text-green-800">{exp.reimbursement_impact}</p>
                            </div>
                            <div className="bg-red-50 p-2 rounded border border-red-200">
                              <p className="text-xs font-semibold text-red-700">Audit Risk:</p>
                              <p className="text-xs text-red-800">{exp.audit_risk}</p>
                            </div>
                          </div>

                          {exp.common_mistakes?.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-slate-600">Common Mistakes:</p>
                              <ul className="text-xs text-red-700 list-disc list-inside">
                                {exp.common_mistakes.map((mistake, i) => (
                                  <li key={i}>{mistake}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {exp.best_practices?.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-slate-600">Best Practices:</p>
                              <ul className="text-xs text-green-700 list-disc list-inside">
                                {exp.best_practices.map((practice, i) => (
                                  <li key={i}>{practice}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {exp.documentation_example && (
                            <div className="bg-navy-50 p-2 rounded border border-navy-200">
                              <p className="text-xs font-semibold text-navy-700">Example Documentation:</p>
                              <p className="text-xs text-navy-900 italic">"{exp.documentation_example}"</p>
                            </div>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>

                <Button variant="outline" size="sm" onClick={generateCMSExplanations} className="w-full">
                  <Scale className="w-3 h-3 mr-1" /> Refresh Explanations
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}