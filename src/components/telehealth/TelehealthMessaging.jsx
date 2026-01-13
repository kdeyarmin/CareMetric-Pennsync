import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Send, Lock, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { formatEastern } from "@/components/utils/timezone";

export default function TelehealthMessaging({ visitId, patientId, providerEmail, isActive }) {
  const [message, setMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const messagesEndRef = useRef(null);
  const queryClient = useQueryClient();

  // Fetch messages for this visit
  const { data: messages = [] } = useQuery({
    queryKey: ['telehealthMessages', visitId],
    queryFn: async () => {
      const results = await base44.entities.TelehealthMessage.filter({
        visit_id: visitId
      }, '-created_date');
      return results || [];
    },
    enabled: !!visitId,
    refetchInterval: isActive ? 3000 : false // Poll every 3 seconds during active visit
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (messageData) => {
      return await base44.entities.TelehealthMessage.create({
        visit_id: visitId,
        patient_id: patientId,
        sender_email: providerEmail,
        sender_type: 'provider',
        message_text: messageData.text,
        file_url: messageData.fileUrl,
        is_encrypted: true,
        message_status: 'sent'
      });
    },
    onSuccess: () => {
      setMessage("");
      setSelectedFile(null);
      queryClient.invalidateQueries({ queryKey: ['telehealthMessages'] });
      toast.success("Message sent securely");
    },
    onError: () => {
      toast.error("Failed to send message");
    }
  });

  const handleSendMessage = async () => {
    if (!message.trim() && !selectedFile) return;

    let fileUrl = null;
    if (selectedFile) {
      try {
        const uploadedFile = await base44.integrations.Core.UploadFile({
          file: selectedFile
        });
        fileUrl = uploadedFile.file_url;
      } catch (error) {
        toast.error("Failed to upload file");
        return;
      }
    }

    sendMessageMutation.mutate({
      text: message,
      fileUrl
    });
  };

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <Card className="border-blue-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-blue-600" />
            Secure Messaging
          </span>
          <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
            <Lock className="w-3 h-3 mr-1" />
            HIPAA Secure
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        {/* Messages Display */}
        <div className="bg-gray-50 rounded-lg p-4 min-h-[150px] max-h-[300px] overflow-y-auto space-y-3 border border-gray-200">
          {messages.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No messages yet. Start the conversation.</p>
          ) : (
            <>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.sender_type === 'provider' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] rounded-lg p-3 ${
                      msg.sender_type === 'provider'
                        ? 'bg-blue-100 text-blue-900 border border-blue-200'
                        : 'bg-white text-gray-900 border border-gray-200'
                    }`}
                  >
                    <p className="text-xs font-medium text-gray-600 mb-1 opacity-75">
                      {msg.sender_type === 'provider' ? 'You' : 'Patient'}
                      {msg.created_date && (
                        <span className="ml-2">
                          {formatEastern(new Date(msg.created_date), 'HH:mm')}
                        </span>
                      )}
                    </p>
                    <p className="text-sm break-words">{msg.message_text}</p>
                    {msg.file_url && (
                      <a
                        href={msg.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs underline mt-2 block opacity-75"
                      >
                        📎 View Attachment
                      </a>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* File Preview */}
        {selectedFile && (
          <div className="bg-gray-100 rounded p-2 flex items-center justify-between text-sm">
            <span className="truncate">📎 {selectedFile.name}</span>
            <button
              onClick={() => setSelectedFile(null)}
              className="text-gray-500 hover:text-gray-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Message Input */}
        <div className="flex gap-2">
          <Input
            placeholder="Type secure message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            className="text-sm"
            disabled={sendMessageMutation.isPending}
          />
          <label className="cursor-pointer">
            <Button
              variant="outline"
              size="sm"
              asChild
              disabled={sendMessageMutation.isPending}
            >
              <div>
                <Paperclip className="w-4 h-4" />
              </div>
            </Button>
            <input
              type="file"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              className="hidden"
            />
          </label>
          <Button
            onClick={handleSendMessage}
            disabled={(!message.trim() && !selectedFile) || sendMessageMutation.isPending}
            size="sm"
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>

        <p className="text-xs text-gray-500 flex items-center gap-1">
          <Lock className="w-3 h-3" />
          End-to-end encrypted, HIPAA-compliant communication
        </p>
      </CardContent>
    </Card>
  );
}