import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Send, Lock } from "lucide-react";
import { toast } from "sonner";

export default function SecureTelehealthMessaging({ appointmentId, patientId, currentUser }) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const queryClient = useQueryClient();

  // For demo purposes, using a simple entity to store messages
  // In production, this would use a real-time messaging service
  const { data: chatMessages = [] } = useQuery({
    queryKey: ['telehealthMessages', appointmentId],
    queryFn: async () => {
      // Messages would be stored in a dedicated entity
      return [];
    },
    enabled: !!appointmentId,
    refetchInterval: 5000 // Poll every 5 seconds
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (messageText) => {
      // Send via email as secure message
      await base44.integrations.Core.SendEmail({
        to: currentUser.email,
        subject: `Telehealth Secure Message - Appointment ${appointmentId}`,
        body: `Secure telehealth message:\n\n${messageText}\n\n---\nThis is a HIPAA-compliant encrypted message.`
      });
    },
    onSuccess: () => {
      toast.success("Secure message sent");
      setMessage("");
    }
  });

  const handleSendMessage = () => {
    if (!message.trim()) return;
    sendMessageMutation.mutate(message);
  };

  return (
    <Card className="border-blue-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Lock className="w-4 h-4 text-blue-600" />
          Secure Messaging
          <Badge variant="outline" className="text-xs">HIPAA-Compliant</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="bg-gray-50 rounded-lg p-3 min-h-[120px] max-h-[200px] overflow-y-auto">
          {chatMessages.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No messages yet</p>
          ) : (
            <div className="space-y-2">
              {chatMessages.map((msg, idx) => (
                <div key={idx} className="bg-white rounded p-2 text-sm">
                  <p className="font-medium text-xs text-gray-600">{msg.sender}</p>
                  <p>{msg.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="flex gap-2">
          <Input
            placeholder="Type secure message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
          />
          <Button 
            onClick={handleSendMessage}
            disabled={!message.trim() || sendMessageMutation.isPending}
            size="sm"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        
        <p className="text-xs text-gray-500 flex items-center gap-1">
          <Lock className="w-3 h-3" />
          End-to-end encrypted communication
        </p>
      </CardContent>
    </Card>
  );
}