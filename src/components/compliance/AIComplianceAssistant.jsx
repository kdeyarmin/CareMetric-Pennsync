import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  MessageSquare,
  Send,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  FileText,
  Sparkles
} from "lucide-react";

export default function AIComplianceAssistant({ compact = false, context = null }) {
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState([]);
  const ai = useAICall();

  const { data: complianceRules = [] } = useQuery({
    queryKey: ['medicareComplianceRules'],
    queryFn: () => base44.entities.MedicareComplianceRule.list(),
    initialData: [],
  });

  const quickQuestions = [
    "What documentation is required to prove homebound status?",
    "How do I document skilled need for a routine visit?",
    "What are Pennsylvania-specific home health requirements?",
    "What must be included in patient response documentation?",
    "How often must care plans be updated per Medicare?",
    "What are the requirements for coordination of care documentation?"
  ];

  const askQuestion = async (questionText = question) => {
    if (!questionText.trim()) return;

    const userMessage = { role: "user", content: questionText };
    setConversation(prev => [...prev, userMessage]);
    setQuestion("");

    try {
      // Build regulation context
      const regulationContext = complianceRules.map(rule => 
        `${rule.cop_reference} - ${rule.rule_name}: ${rule.description}`
      ).join('\n\n');

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert Medicare compliance advisor for home health agencies, specializing in 42 CFR 484 regulations and Pennsylvania state requirements.

QUESTION: ${questionText}

${context ? `CONTEXT: ${context}\n\n` : ''}

AVAILABLE REGULATIONS (42 CFR 484):
${regulationContext}

Provide a comprehensive answer that includes:
1. Specific CFR references (e.g., 484.55(a), 484.60)
2. Clear explanation of the requirement
3. Practical guidance for home health nurses
4. Pennsylvania-specific requirements if applicable
5. Best practices and examples
6. Common mistakes to avoid

Format your response in clear sections. Be specific and actionable.`,
        response_json_schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
            relevant_regulations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  reference: { type: "string" },
                  title: { type: "string" },
                  summary: { type: "string" }
                }
              }
            },
            best_practices: {
              type: "array",
              items: { type: "string" }
            },
            common_mistakes: {
              type: "array",
              items: { type: "string" }
            },
            pennsylvania_specific: { type: "string" },
            documentation_examples: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });

      const assistantMessage = { role: "assistant", content: result };
      setConversation(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error asking question:', error);
      const errorMessage = { 
        role: "assistant", 
        content: { 
          answer: "I apologize, but I encountered an error processing your question. Please try again.",
          relevant_regulations: [],
          best_practices: [],
          common_mistakes: []
        }
      };
      setConversation(prev => [...prev, errorMessage]);
    }
  };

  return (
    <Card className={`border-2 border-navy-300 ${compact ? '' : 'max-w-4xl'}`}>
      <CardHeader className="bg-gradient-to-r from-navy-50 to-indigo-50">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-navy-600" />
          AI Compliance Assistant
          <Badge className="ml-auto bg-navy-600">42 CFR 484</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {conversation.length === 0 && (
          <>
            <Alert className="bg-blue-50 border-blue-200">
              <BookOpen className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-sm text-blue-900">
                Ask me anything about Medicare compliance regulations (42 CFR 484) and Pennsylvania requirements. I'll provide specific rule references and practical guidance.
              </AlertDescription>
            </Alert>

            <div>
              <p className="text-xs font-semibold text-slate-700 mb-2">Quick Questions:</p>
              <div className="grid gap-2">
                {quickQuestions.map((q, idx) => (
                  <Button
                    key={idx}
                    size="sm"
                    variant="outline"
                    className="justify-start text-left h-auto py-2 px-3"
                    onClick={() => askQuestion(q)}
                  >
                    <MessageSquare className="w-3 h-3 mr-2 flex-shrink-0" />
                    <span className="text-xs">{q}</span>
                  </Button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Conversation */}
        {conversation.length > 0 && (
          <div className="space-y-4 max-h-[500px] overflow-y-auto">
            {conversation.map((msg, idx) => (
              <div key={idx} className={`${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                {msg.role === 'user' ? (
                  <div className="inline-block bg-blue-100 text-blue-900 px-4 py-2 rounded-lg max-w-[80%]">
                    <p className="text-sm">{msg.content}</p>
                  </div>
                ) : (
                  <div className="bg-navy-50 border border-navy-200 rounded-lg p-4 space-y-3">
                    {/* Main Answer */}
                    <div className="prose prose-sm max-w-none">
                      <p className="text-sm text-slate-900 whitespace-pre-wrap">{msg.content.answer}</p>
                    </div>

                    {/* Relevant Regulations */}
                    {msg.content.relevant_regulations?.length > 0 && (
                      <div className="bg-white p-3 rounded border border-navy-200">
                        <p className="text-xs font-semibold text-navy-900 mb-2 flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          Relevant Regulations:
                        </p>
                        <div className="space-y-2">
                          {msg.content.relevant_regulations.map((reg, i) => (
                            <div key={i} className="bg-navy-50 p-2 rounded">
                              <p className="text-xs font-bold text-navy-900">{reg.reference} - {reg.title}</p>
                              <p className="text-xs text-slate-700 mt-1">{reg.summary}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Best Practices */}
                    {msg.content.best_practices?.length > 0 && (
                      <div className="bg-green-50 p-3 rounded border border-green-200">
                        <p className="text-xs font-semibold text-green-900 mb-2 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Best Practices:
                        </p>
                        <ul className="space-y-1">
                          {msg.content.best_practices.map((practice, i) => (
                            <li key={i} className="text-xs text-slate-900 flex items-start gap-1">
                              <Lightbulb className="w-3 h-3 text-green-600 mt-0.5 flex-shrink-0" />
                              {practice}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Common Mistakes */}
                    {msg.content.common_mistakes?.length > 0 && (
                      <div className="bg-red-50 p-3 rounded border border-red-200">
                        <p className="text-xs font-semibold text-red-900 mb-2 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Common Mistakes to Avoid:
                        </p>
                        <ul className="space-y-1">
                          {msg.content.common_mistakes.map((mistake, i) => (
                            <li key={i} className="text-xs text-slate-900 flex items-start gap-1">
                              <span className="text-red-600 flex-shrink-0">✗</span>
                              {mistake}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Pennsylvania Specific */}
                    {msg.content.pennsylvania_specific && msg.content.pennsylvania_specific !== "None" && (
                      <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                        <p className="text-xs font-semibold text-yellow-900 mb-1">Pennsylvania-Specific Requirements:</p>
                        <p className="text-xs text-slate-900">{msg.content.pennsylvania_specific}</p>
                      </div>
                    )}

                    {/* Documentation Examples */}
                    {msg.content.documentation_examples?.length > 0 && (
                      <div className="bg-blue-50 p-3 rounded border border-blue-200">
                        <p className="text-xs font-semibold text-blue-900 mb-2">Documentation Examples:</p>
                        <ul className="space-y-1">
                          {msg.content.documentation_examples.map((example, i) => (
                            <li key={i} className="text-xs text-slate-900 italic">"{example}"</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="flex gap-2 pt-2 border-t">
          <Textarea
            placeholder="Ask a compliance question..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                askQuestion();
              }
            }}
            className="min-h-[60px]"
            disabled={ai.loading}
          />
          <Button
            onClick={() => askQuestion()}
            disabled={ai.loading || !question.trim()}
            className="bg-navy-600 hover:bg-navy-700"
          >
            {ai.loading ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>

        {conversation.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConversation([])}
            className="w-full"
          >
            Start New Conversation
          </Button>
        )}
      </CardContent>
    </Card>
  );
}