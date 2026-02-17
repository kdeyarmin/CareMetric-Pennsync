import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Send, User, Stethoscope, Shield, Paperclip, Pin,
  AlertTriangle, Clock, Loader2
} from "lucide-react";

const PRIORITY_CONFIG = {
  low: { color: "bg-slate-100 text-slate-600", label: "Low" },
  normal: { color: "bg-blue-100 text-blue-700", label: "Normal" },
  high: { color: "bg-orange-100 text-orange-700", label: "High" },
  urgent: { color: "bg-red-100 text-red-700", label: "Urgent" },
};

export default function MessageThread({ patientId, channel, currentUser, patientName }) {
  const queryClient = useQueryClient();
  const [newMessage, setNewMessage] = useState("");
  const [priority, setPriority] = useState("normal");
  const [subject, setSubject] = useState("");
  const [showSubject, setShowSubject] = useState(false);
  const scrollRef = useRef(null);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["patientMessages", patientId, channel],
    queryFn: async () => {
      const all = await base44.entities.PatientMessage.filter({ patient_id: patientId, channel });
      return all.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    },
    enabled: !!patientId,
    refetchInterval: 15000,
  });

  // Mark messages as read
  useEffect(() => {
    if (!currentUser?.email || !messages.length) return;
    messages.forEach(msg => {
      if (msg.sender_email !== currentUser.email && msg.status === "unread") {
        const readBy = msg.read_by || [];
        if (!readBy.includes(currentUser.email)) {
          base44.entities.PatientMessage.update(msg.id, {
            read_by: [...readBy, currentUser.email],
            status: "read",
          });
        }
      }
    });
  }, [messages, currentUser?.email]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: (data) => base44.entities.PatientMessage.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patientMessages", patientId, channel] });
      setNewMessage("");
      setSubject("");
      setShowSubject(false);
      setPriority("normal");
    },
  });

  const handleSend = () => {
    if (!newMessage.trim()) return;
    sendMutation.mutate({
      patient_id: patientId,
      channel,
      sender_type: "provider",
      sender_email: currentUser.email,
      sender_name: currentUser.full_name || currentUser.email,
      body: newMessage.trim(),
      subject: subject.trim() || undefined,
      priority,
      status: "unread",
      read_by: [currentUser.email],
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 p-3 max-h-[400px] min-h-[200px]">
        {messages.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Shield className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No messages yet. Start the conversation.</p>
            <p className="text-xs mt-1">
              {channel === "team" ? "Internal team messages are HIPAA-secure." : "Patient messages are encrypted and HIPAA-compliant."}
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender_email === currentUser?.email;
            return (
              <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-xl px-4 py-2.5 ${
                  isMe
                    ? "bg-blue-600 text-white rounded-br-sm"
                    : msg.sender_type === "patient" || msg.sender_type === "caregiver"
                    ? "bg-green-50 border border-green-200 rounded-bl-sm"
                    : "bg-slate-100 border border-slate-200 rounded-bl-sm"
                }`}>
                  {/* Sender info */}
                  <div className={`flex items-center gap-1.5 mb-1 ${isMe ? "justify-end" : ""}`}>
                    {!isMe && (
                      msg.sender_type === "provider"
                        ? <Stethoscope className="w-3 h-3 text-blue-500" />
                        : <User className="w-3 h-3 text-green-600" />
                    )}
                    <span className={`text-[10px] font-medium ${isMe ? "text-blue-100" : "text-slate-500"}`}>
                      {isMe ? "You" : msg.sender_name || msg.sender_email}
                    </span>
                    {msg.priority && msg.priority !== "normal" && (
                      <Badge className={`${PRIORITY_CONFIG[msg.priority]?.color} text-[9px] px-1 py-0`}>
                        {PRIORITY_CONFIG[msg.priority]?.label}
                      </Badge>
                    )}
                  </div>

                  {msg.subject && (
                    <p className={`text-xs font-semibold mb-1 ${isMe ? "text-blue-100" : "text-slate-700"}`}>
                      {msg.subject}
                    </p>
                  )}

                  <p className={`text-sm whitespace-pre-wrap break-words ${isMe ? "text-white" : "text-slate-800"}`}>
                    {msg.body}
                  </p>

                  <p className={`text-[9px] mt-1 ${isMe ? "text-blue-200 text-right" : "text-slate-400"}`}>
                    {msg.created_date ? format(new Date(msg.created_date), "MMM d, h:mm a") : ""}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Compose area */}
      <div className="border-t bg-white p-3 space-y-2">
        {showSubject && (
          <Input
            placeholder="Subject (optional)"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="text-sm h-8"
          />
        )}

        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Textarea
              placeholder={channel === "team" ? "Message care team..." : "Message patient/caregiver..."}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-h-[40px] max-h-[120px] text-sm resize-none"
              rows={1}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="w-[90px] h-8 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!newMessage.trim() || sendMutation.isPending}
              className="h-8"
            >
              {sendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-slate-400">
          <Shield className="w-3 h-3" />
          <span>HIPAA-compliant • End-to-end secure</span>
          <button onClick={() => setShowSubject(!showSubject)} className="ml-auto text-blue-500 hover:underline">
            {showSubject ? "Hide subject" : "+ Subject"}
          </button>
        </div>
      </div>
    </div>
  );
}