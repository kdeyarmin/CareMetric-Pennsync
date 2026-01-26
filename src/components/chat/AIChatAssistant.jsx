import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageSquare,
  X,
  Send,
  Loader2,
  Bot,
  User,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
  Sparkles
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { createPageUrl } from "@/utils";
import AIInsightFeedbackWidget from "../feedback/AIInsightFeedbackWidget";

export default function AIChatAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [conversation, setConversation] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMessageForFeedback, setSelectedMessageForFeedback] = useState(null);
  const scrollRef = useRef(null);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation]);

  const suggestedQuestions = [
    "What documentation is required for skilled nursing visits?",
    "How do I manage my subscription and billing?",
    "How do I update my payment method?",
    "What are OASIS M-item requirements?",
    "How do I ensure Medicare compliance?",
    "What features are included in my plan?",
    "How do I use the visit scribe?",
    "How can I upgrade or cancel my subscription?"
  ];

  useEffect(() => {
    if (isOpen && conversation.length === 0) {
      setConversation([
        {
          role: "assistant",
          content: `Hi ${currentUser?.full_name || "there"}! 👋 I'm your AI Assistant.\n\nI can help you with:\n• Documentation requirements & best practices\n• Subscription & billing questions\n• Payment method updates & plan changes\n• Medicare/Medicaid compliance guidance\n• OASIS assessment standards\n• CareMetric AI features & workflows\n\nWhat can I help you with today?`,
          timestamp: new Date(),
          showSuggestions: true
        }
      ]);
    }
  }, [isOpen, currentUser]);

  const handleSendMessage = async (messageText) => {
    const textToSend = messageText || message;
    if (!textToSend.trim() || isLoading) return;

    const userMessage = {
      role: "user",
      content: textToSend,
      timestamp: new Date()
    };

    setConversation((prev) => [...prev, userMessage]);
    setMessage("");
    setIsLoading(true);

    try {
      const response = await base44.functions.invoke("chatWithAI", {
        message: textToSend,
        conversationHistory: conversation.slice(-6),
        context: "user_support",
        userEmail: currentUser?.email,
        userRole: currentUser?.role
      });

      setConversation((prev) => [
        ...prev,
        {
          role: "assistant",
          content: response.data.response,
          suggested_actions: response.data.suggested_actions || [],
          related_pages: response.data.related_pages || [],
          timestamp: new Date()
        }
      ]);
    } catch {
      setConversation((prev) => [
        ...prev,
        { role: "assistant", content: "Something went wrong. Please try again.", timestamp: new Date() }
      ]);
    }

    setIsLoading(false);
  };

  /* =========================
     CLOSED STATE (FAB)
  ========================= */
  if (!isOpen) {
    return (
      <div className="relative">
        <Button
          onClick={() => setIsOpen(true)}
          size="icon"
          title="Open AI Assistant"
          className="
            h-14 w-14 rounded-full shadow-2xl
            bg-gradient-to-r from-indigo-600 to-purple-600
            hover:from-indigo-700 hover:to-purple-700
            fixed bottom-6 right-6 z-40
            animate-slow-bounce hover:animate-none
            transition-all duration-300
          "
        >
          <Sparkles className="w-6 h-6 text-white" />
        </Button>
        <div className="fixed bottom-6 right-6 z-40 -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white animate-pulse" />
      </div>
    );
  }

  /* =========================
     OPEN STATE
  ========================= */
  return (
    <>
      {/* Mobile backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50 md:hidden"
        onClick={() => setIsOpen(false)}
      />

      {/* Chat Window */}
      <div className="fixed inset-0 md:inset-auto md:bottom-6 md:right-6 z-50 p-4 flex items-end md:items-start">
        <Card className="w-full md:w-96 max-h-[90vh] flex flex-col shadow-2xl border-2 border-indigo-300">
          <CardHeader className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
            <div className="flex justify-between items-center">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Bot className="w-4 h-4" />
                AI Documentation Assistant
                <Badge className="bg-white/20 text-white text-xs">24/7</Badge>
              </CardTitle>
              <Button size="icon" variant="ghost" onClick={() => setIsOpen(false)} className="hover:bg-white/20">
                <X className="w-4 h-4 text-white" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="flex-1 p-0">
            <ScrollArea ref={scrollRef} className="h-[50vh] md:h-96 p-4">
              {conversation.map((msg, i) => (
                <div key={i}>
                  <div className={`flex gap-3 mb-4 ${msg.role === "user" ? "justify-end" : ""}`}>
                    {msg.role === "assistant" && (
                      <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                        <Sparkles className="w-4 h-4 text-white" />
                      </div>
                    )}
                    <div className={`rounded-lg p-3 max-w-[80%] ${msg.role === "user" ? "bg-indigo-600 text-white" : "bg-gray-100"}`}>
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      {msg.related_pages && msg.related_pages.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-300 space-y-2">
                          {msg.related_pages.map((page, idx) => (
                            <a
                              key={idx}
                              href={createPageUrl(page.page)}
                              className="flex items-center gap-2 text-xs text-indigo-600 hover:underline"
                              onClick={() => setIsOpen(false)}
                            >
                              <ExternalLink className="w-3 h-3" />
                              {page.label}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    {msg.role === "user" && (
                      <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center flex-shrink-0">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                  {msg.showSuggestions && (
                    <div className="mb-4 space-y-2">
                      <p className="text-xs text-gray-500 font-semibold px-2">Quick questions:</p>
                      <div className="grid grid-cols-1 gap-2">
                        {suggestedQuestions.map((q, idx) => (
                          <Button
                            key={idx}
                            variant="outline"
                            size="sm"
                            className="justify-start text-left text-xs h-auto py-2"
                            onClick={() => handleSendMessage(q)}
                          >
                            {q}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {isLoading && (
                <div className="flex items-center gap-2 text-indigo-600">
                  <Loader2 className="animate-spin w-4 h-4" />
                  <span className="text-xs">Thinking...</span>
                </div>
              )}
            </ScrollArea>

            <div className="p-3 border-t bg-gray-50">
              <div className="flex gap-2">
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                  placeholder="Ask about documentation or compliance..."
                  className="bg-white"
                />
                <Button onClick={() => handleSendMessage()} size="icon" className="bg-gradient-to-r from-indigo-600 to-purple-600">
                  <Send className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-2 text-center">
                Ask about documentation, billing, features, or compliance
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}