import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  MessageSquare, X, Send, Loader2, Bot, User, 
  ThumbsUp, ThumbsDown, ExternalLink, Sparkles
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import AIInsightFeedbackWidget from "../feedback/AIInsightFeedbackWidget";

export default function AIChatAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [conversation, setConversation] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [selectedMessageForFeedback, setSelectedMessageForFeedback] = useState(null);
  const scrollRef = useRef(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation]);

  // Initial greeting when opening chat
  useEffect(() => {
    if (isOpen && conversation.length === 0) {
      setConversation([{
        role: 'assistant',
        content: `Hi ${currentUser?.full_name || 'there'}! 👋 I'm your CareMetric AI Assistant. I can help you with:\n\n• Answering questions about your tasks and alerts\n• Finding relevant training materials\n• Explaining AI insights and recommendations\n• Collecting your feedback\n\nWhat would you like to know?`,
        timestamp: new Date()
      }]);
    }
  }, [isOpen, currentUser]);

  const handleSendMessage = async () => {
    if (!message.trim() || isLoading) return;

    const userMessage = {
      role: 'user',
      content: message,
      timestamp: new Date()
    };

    setConversation(prev => [...prev, userMessage]);
    setMessage("");
    setIsLoading(true);

    try {
      const response = await base44.functions.invoke('chatWithAI', {
        message: message,
        conversationHistory: conversation.slice(-6) // Last 6 messages for context
      });

      const assistantMessage = {
        role: 'assistant',
        content: response.data.response,
        suggested_actions: response.data.suggested_actions || [],
        training_suggestions: response.data.training_suggestions || [],
        timestamp: new Date()
      };

      setConversation(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      setConversation(prev => [...prev, {
        role: 'assistant',
        content: "I'm sorry, I encountered an error. Please try again.",
        timestamp: new Date()
      }]);
    }

    setIsLoading(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleQuickAction = (action, data) => {
    if (action === 'navigate') {
      window.location.href = createPageUrl(data.page);
    } else if (action === 'feedback') {
      setShowFeedback(true);
    } else if (action === 'training') {
      window.location.href = createPageUrl('StaffTrainingHub');
    }
  };

  const handleFeedback = (messageIndex, helpful) => {
    setSelectedMessageForFeedback({
      index: messageIndex,
      content: conversation[messageIndex].content,
      helpful
    });
  };

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-2xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
        size="icon"
      >
        <MessageSquare className="w-6 h-6" />
      </Button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 max-w-[calc(100vw-3rem)]">
      <Card className="shadow-2xl border-2 border-indigo-300">
        <CardHeader className="pb-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-t-lg">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="w-5 h-5" />
              AI Assistant
              <Badge className="bg-white/20 text-white">Beta</Badge>
            </CardTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsOpen(false)}
              className="text-white hover:bg-white/20 h-8 w-8"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Chat Messages */}
          <ScrollArea ref={scrollRef} className="h-96 p-4">
            <div className="space-y-4">
              {conversation.map((msg, idx) => (
                <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                  )}
                  
                  <div className={`flex-1 max-w-[80%] ${msg.role === 'user' ? 'flex justify-end' : ''}`}>
                    <div className={`rounded-lg p-3 ${
                      msg.role === 'user' 
                        ? 'bg-indigo-600 text-white' 
                        : 'bg-gray-100 text-gray-900'
                    }`}>
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      
                      {/* Suggested Actions */}
                      {msg.suggested_actions && msg.suggested_actions.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {msg.suggested_actions.map((action, actionIdx) => (
                            <Button
                              key={actionIdx}
                              size="sm"
                              variant="outline"
                              className="w-full justify-start gap-2 bg-white text-gray-900"
                              onClick={() => handleQuickAction(action.action, action.data)}
                            >
                              <ExternalLink className="w-3 h-3" />
                              {action.label}
                            </Button>
                          ))}
                        </div>
                      )}

                      {/* Training Suggestions */}
                      {msg.training_suggestions && msg.training_suggestions.length > 0 && (
                        <div className="mt-3 space-y-1">
                          <p className="text-xs font-semibold flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />
                            Recommended Training:
                          </p>
                          {msg.training_suggestions.map((suggestion, suggIdx) => (
                            <p key={suggIdx} className="text-xs pl-4">• {suggestion}</p>
                          ))}
                          <Button
                            size="sm"
                            variant="link"
                            className="text-xs p-0 h-auto text-indigo-600 hover:text-indigo-800"
                            onClick={() => window.location.href = createPageUrl('StaffTrainingHub')}
                          >
                            View Training Hub →
                          </Button>
                        </div>
                      )}
                      
                      {/* Feedback for assistant messages */}
                      {msg.role === 'assistant' && idx > 0 && (
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-200">
                          <p className="text-xs text-gray-500">Was this helpful?</p>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={() => handleFeedback(idx, true)}
                          >
                            <ThumbsUp className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={() => handleFeedback(idx, false)}
                          >
                            <ThumbsDown className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  {msg.role === 'user' && (
                    <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-gray-700" />
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-gray-100 rounded-lg p-3">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Feedback Widget */}
          {selectedMessageForFeedback && (
            <div className="p-4 border-t bg-gray-50">
              <AIInsightFeedbackWidget
                insightType="other"
                insightContent={`AI Chat Response: ${selectedMessageForFeedback.content.substring(0, 200)}...`}
                onFeedbackSubmitted={() => setSelectedMessageForFeedback(null)}
                compact={true}
              />
            </div>
          )}

          {/* Input Area */}
          <div className="p-4 border-t bg-white rounded-b-lg">
            <div className="flex gap-2">
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask me anything..."
                className="flex-1"
                disabled={isLoading}
              />
              <Button
                onClick={handleSendMessage}
                disabled={!message.trim() || isLoading}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Press Enter to send, Shift+Enter for new line
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}