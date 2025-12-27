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

  useEffect(() => {
    if (isOpen && conversation.length === 0) {
      setConversation([
        {
          role: "assistant",
          content: `Hi ${currentUser?.full_name || "there"}! 👋 I'm your CareMetric AI Assistant.\n\nHow can I help you today?`,
          timestamp: new Date()
        }
      ]);
    }
  }, [isOpen, currentUser]);

  const handleSendMessage = async () => {
    if (!message.trim() || isLoading) return;

    const userMessage = {
      role: "user",
      content: message,
      timestamp: new Date()
    };

    setConversation((prev) => [...prev, userMessage]);
    setMessage("");
    setIsLoading(true);

    try {
      const response = await base44.functions.invoke("chatWithAI", {
        message,
        conversationHistory: conversation.slice(-6)
      });

      setConversation((prev) => [
        ...prev,
        {
          role: "assistant",
          content: response.data.response,
          suggested_actions: response.data.suggested_actions || [],
          training_suggestions: response.data.training_suggestions || [],
          timestamp: new Date()
        }
      ]);
    } catch {
      setConversation((prev) => [
        ...prev,
        { role: "assistant", content: "Something went wrong.", timestamp: new Date() }
      ]);
    }

    setIsLoading(false);
  };

  /* =========================
     CLOSED STATE (FAB)
  ========================= */
  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        size="icon"
        className="
          h-14 w-14 rounded-full shadow-2xl
          bg-gradient-to-r from-indigo-600 to-purple-600
          hover:from-indigo-700 hover:to-purple-700
          md:fixed md:bottom-6 md:right-6
        "
      >
        <MessageSquare className="w-6 h-6 text-white" />
      </Button>
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
                AI Assistant
                <Badge className="bg-white/20 text-white">Beta</Badge>
              </CardTitle>
              <Button size="icon" variant="ghost" onClick={() => setIsOpen(false)}>
                <X className="w-4 h-4 text-white" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="flex-1 p-0">
            <ScrollArea ref={scrollRef} className="h-[50vh] md:h-96 p-4">
              {conversation.map((msg, i) => (
                <div key={i} className={`flex gap-3 mb-4 ${msg.role === "user" ? "justify-end" : ""}`}>
                  {msg.role === "assistant" && (
                    <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div className={`rounded-lg p-3 max-w-[80%] ${msg.role === "user" ? "bg-indigo-600 text-white" : "bg-gray-100"}`}>
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  {msg.role === "user" && (
                    <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              ))}
              {isLoading && <Loader2 className="animate-spin text-indigo-600" />}
            </ScrollArea>

            <div className="p-3 border-t bg-white">
              <div className="flex gap-2">
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                  placeholder="Ask me anything…"
                />
                <Button onClick={handleSendMessage} size="icon">
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
