import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, AlertTriangle, Pin, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export default function TeamMessageThread({ agencyId, channel, currentUser, teamMembers }) {
  const [newMessage, setNewMessage] = useState("");
  const [priority, setPriority] = useState("normal");
  const messagesEndRef = useRef(null);
  const queryClient = useQueryClient();

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["teamMessages", agencyId, channel],
    queryFn: () => base44.entities.TeamMessage.filter({ agency_id: agencyId, channel }, "-created_date", 100),
    enabled: !!agencyId,
    refetchInterval: 10000,
  });

  const sortedMessages = [...messages].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sortedMessages.length]);

  // Mark messages as read
  useEffect(() => {
    const unread = messages.filter(m => m.sender_email !== currentUser?.email && !(m.read_by || []).includes(currentUser?.email));
    unread.forEach(m => {
      base44.entities.TeamMessage.update(m.id, { read_by: [...(m.read_by || []), currentUser?.email] });
    });
  }, [messages, currentUser?.email]);

  const sendMutation = useMutation({
    mutationFn: (data) => base44.entities.TeamMessage.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamMessages", agencyId, channel] });
      setNewMessage("");
      setPriority("normal");
    },
  });

  const handleSend = () => {
    if (!newMessage.trim()) return;
    // Detect @mentions
    const mentionRegex = /@(\S+@\S+)/g;
    const mentions = [];
    let match;
    while ((match = mentionRegex.exec(newMessage)) !== null) {
      mentions.push(match[1]);
    }

    sendMutation.mutate({
      agency_id: agencyId,
      channel,
      sender_email: currentUser?.email,
      sender_name: currentUser?.full_name || currentUser?.email,
      body: newMessage.trim(),
      priority,
      mentions,
      read_by: [currentUser?.email],
    });
  };

  const togglePin = async (msg) => {
    await base44.entities.TeamMessage.update(msg.id, { is_pinned: !msg.is_pinned });
    queryClient.invalidateQueries({ queryKey: ["teamMessages", agencyId, channel] });
  };

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>;
  }

  const pinnedMessages = sortedMessages.filter(m => m.is_pinned);

  return (
    <div className="flex flex-col h-[60vh] sm:h-[65vh]">
      {/* Pinned messages */}
      {pinnedMessages.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 p-2 space-y-1 max-h-24 overflow-y-auto flex-shrink-0">
          {pinnedMessages.map(m => (
            <div key={m.id} className="flex items-start gap-2 text-xs">
              <Pin className="w-3 h-3 text-amber-600 flex-shrink-0 mt-0.5" />
              <span className="font-medium text-amber-800">{m.sender_name}:</span>
              <span className="text-amber-700 truncate">{m.body}</span>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {sortedMessages.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-8">No messages yet. Start a conversation!</p>
        ) : (
          sortedMessages.map(msg => {
            const isMe = msg.sender_email === currentUser?.email;
            return (
              <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 ${
                  isMe ? "bg-blue-600 text-white" : "bg-white border border-slate-200"
                }`}>
                  {!isMe && (
                    <p className={`text-[10px] font-semibold mb-0.5 ${isMe ? "text-blue-200" : "text-slate-500"}`}>
                      {msg.sender_name || msg.sender_email}
                    </p>
                  )}
                  {msg.priority === "urgent" && (
                    <Badge className="bg-red-100 text-red-700 text-[9px] mb-1">
                      <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> Urgent
                    </Badge>
                  )}
                  <p className={`text-sm leading-relaxed ${isMe ? "text-white" : "text-slate-800"}`}>{msg.body}</p>
                  <div className="flex items-center justify-between mt-1 gap-2">
                    <p className={`text-[9px] ${isMe ? "text-blue-200" : "text-slate-400"}`}>
                      {msg.created_date ? format(new Date(msg.created_date), "h:mm a") : ""}
                    </p>
                    <button onClick={() => togglePin(msg)} className={`opacity-0 hover:opacity-100 transition-opacity ${isMe ? "text-blue-200" : "text-slate-400"}`}>
                      <Pin className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t p-2 flex-shrink-0 bg-white">
        <div className="flex gap-2">
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message... Use @email to mention"
            className="flex-1 h-10 text-sm"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="w-24 h-10 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleSend} disabled={!newMessage.trim() || sendMutation.isPending} className="h-10">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}