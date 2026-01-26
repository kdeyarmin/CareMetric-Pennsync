import React, { useState, useCallback, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { MessageCircle, Send, X, Lightbulb, HelpCircle, Loader2, ThumbsUp, ThumbsDown, Copy, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

const CONTEXT_PROMPTS = {
  OASIS: `You are a healthcare documentation expert specializing in OASIS (Outcome and Assessment Information Set) requirements. Help users understand OASIS fields, documentation requirements, compliance rules, and best practices for accurate data collection. Provide specific examples and regulatory context.`,
  
  Compliance: `You are a healthcare compliance specialist. Help users understand compliance requirements, regulations (HIPAA, CMS CoP, state regulations), documentation standards, and how to maintain compliance. Provide actionable guidance.`,
  
  SmartNoteAssistant: `You are a healthcare documentation quality expert. Help users write better clinical notes, understand documentation standards, suggest relevant details to include, and ensure compliance with healthcare regulations.`,
  
  CarePlanManagement: `You are an expert care coordinator. Help users develop comprehensive care plans, identify patient needs, suggest evidence-based interventions, and ensure care plan alignment with patient goals and regulations.`,
  
  BillingOptimization: `You are a healthcare billing specialist. Help users understand billing codes, optimize coding for accuracy and reimbursement, understand billing regulations, and identify revenue opportunities while maintaining compliance.`,
  
  DocumentGenerator: `You are a healthcare documentation assistant. Help users generate compliant documents, suggest relevant templates, improve document quality, and ensure proper formatting for clinical use.`,
  
  default: `You are a helpful healthcare AI assistant. Help users with platform functionality, healthcare documentation best practices, regulatory compliance, clinical decision support, and answer questions about the app. Provide clear, actionable guidance.`
};

export default function AIAssistantEngine({ currentPage, patientContext = null, visitContext = null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Generate contextual suggestions on component mount or context change
  useEffect(() => {
    if (isOpen && suggestions.length === 0) {
      generateSuggestions();
    }
  }, [isOpen, currentPage]);

  const generateSuggestions = useCallback(async () => {
    try {
      const contextPrompt = CONTEXT_PROMPTS[currentPage] || CONTEXT_PROMPTS.default;
      const contextInfo = patientContext || visitContext ? 
        `Current context: Patient: ${patientContext?.name || 'N/A'}, Visit type: ${visitContext?.type || 'N/A'}` : 
        `Current module: ${currentPage}`;

      const suggestionPrompt = `Based on a user working in the "${currentPage}" module of a healthcare documentation platform, suggest 2-3 helpful quick questions they might ask. Keep them concise and practical.

${contextInfo}

Return as a JSON array of strings (just the questions, no numbering).`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: suggestionPrompt,
        response_json_schema: {
          type: "array",
          items: { type: "string" }
        }
      });

      setSuggestions(response || []);
    } catch (error) {
      console.error('Failed to generate suggestions:', error);
    }
  }, [currentPage, patientContext, visitContext]);

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim()) return;

    const userMessage = inputValue;
    setInputValue("");
    setMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);

    try {
      const contextPrompt = CONTEXT_PROMPTS[currentPage] || CONTEXT_PROMPTS.default;
      const contextInfo = patientContext || visitContext ?
        `\nCurrent context - Patient: ${patientContext?.name || 'N/A'}, Visit type: ${visitContext?.type || 'N/A'}` :
        `\nCurrent module: ${currentPage}`;

      const systemPrompt = `${contextPrompt}${contextInfo}

Provide clear, actionable answers. Include:
- Direct answer to their question
- Relevant examples or context
- Links to regulatory resources if applicable
- Best practices or recommendations`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `${systemPrompt}\n\nUser Question: ${userMessage}`,
        add_context_from_internet: true
      });

      setMessages(prev => [...prev, { role: "assistant", content: response }]);
      setShowSuggestions(false);
    } catch (error) {
      toast.error("Failed to get response. Please try again.");
      console.error(error);
      setMessages(prev => prev.slice(0, -1)); // Remove the user message on error
    } finally {
      setLoading(false);
    }
  }, [inputValue, currentPage, patientContext, visitContext]);

  const handleQuickSuggestion = (suggestion) => {
    setInputValue(suggestion);
    setShowSuggestions(false);
  };

  const copyMessage = (content) => {
    navigator.clipboard.writeText(content);
    toast.success("Copied to clipboard");
  };

  return (
    <>
      {/* Chat Button */}
      <div className="fixed bottom-6 right-6 z-40">
        {!isOpen && (
          <Button
            onClick={() => setIsOpen(true)}
            className="rounded-full w-14 h-14 bg-blue-600 hover:bg-blue-700 shadow-lg flex items-center justify-center"
          >
            <MessageCircle className="w-6 h-6" />
          </Button>
        )}

        {/* Chat Window */}
        {isOpen && (
          <Card className="fixed bottom-0 right-0 w-96 max-h-[600px] md:max-h-[700px] rounded-t-2xl rounded-b-none shadow-2xl border-t-2 border-blue-600 flex flex-col">
            <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-blue-600" />
                <CardTitle className="text-lg">AI Assistant</CardTitle>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
                className="h-8 w-8"
              >
                <X className="w-4 h-4" />
              </Button>
            </CardHeader>

            <CardContent className="flex-1 overflow-y-auto space-y-4 py-4">
              {messages.length === 0 && !showSuggestions && (
                <div className="space-y-3 text-center py-6">
                  <HelpCircle className="w-12 h-12 text-blue-400 mx-auto" />
                  <p className="text-sm font-medium text-slate-900">Hi! I'm your AI Assistant</p>
                  <p className="text-xs text-slate-600">
                    I can help you with documentation, compliance, regulations, and platform features.
                  </p>
                </div>
              )}

              {/* Messages */}
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-xs lg:max-w-sm px-4 py-2 rounded-lg ${
                      msg.role === "user"
                        ? "bg-blue-600 text-white rounded-br-none"
                        : "bg-slate-100 text-slate-900 rounded-bl-none"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <ReactMarkdown
                          components={{
                            p: ({ children }) => <p className="my-1">{children}</p>,
                            ul: ({ children }) => <ul className="my-1 ml-4 list-disc">{children}</ul>,
                            li: ({ children }) => <li className="my-0">{children}</li>,
                            strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                        <div className="flex gap-1 mt-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            onClick={() => copyMessage(msg.content)}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="bg-slate-100 px-4 py-2 rounded-lg rounded-bl-none">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  </div>
                </div>
              )}

              {/* Quick Suggestions */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="space-y-2 mt-4 p-3 bg-blue-50 rounded-lg">
                  <p className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    <Lightbulb className="w-3 h-3 text-amber-500" />
                    Suggested Questions:
                  </p>
                  <div className="space-y-2">
                    {suggestions.map((suggestion, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleQuickSuggestion(suggestion)}
                        className="w-full text-left text-xs p-2 bg-white rounded border border-blue-200 hover:bg-blue-50 transition-colors text-slate-700"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </CardContent>

            {/* Input Area */}
            <div className="border-t p-3 space-y-2">
              {messages.length === 0 && !showSuggestions && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  onClick={() => setShowSuggestions(true)}
                >
                  <Lightbulb className="w-3 h-3 mr-1" />
                  Show Suggestions
                </Button>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Ask me anything..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
                  className="text-sm"
                  disabled={loading}
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={loading || !inputValue.trim()}
                  className="bg-blue-600 hover:bg-blue-700"
                  size="icon"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}