import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Mail, MessageSquare } from "lucide-react";

export default function MessageHistory() {
  const [filterStatus, setFilterStatus] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: messages } = useQuery({
    queryKey: ["allMessages"],
    queryFn: async () => {
      const [msgs, patMsgs] = await Promise.all([
        base44.entities.Message.list(),
        base44.entities.PatientMessage.list()
      ]);
      return { messages: msgs, patientMessages: patMsgs };
    },
    initialData: { messages: [], patientMessages: [] }
  });

  const getStatusColor = (status) => {
    const colors = {
      sent: "bg-green-100 text-green-800",
      failed: "bg-red-100 text-red-800",
      unread: "bg-yellow-100 text-yellow-800",
      read: "bg-blue-100 text-blue-800",
      opened: "bg-green-100 text-green-800"
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  const filteredMessages = messages.messages.filter(m => {
    if (filterStatus !== "all" && m.status !== filterStatus) return false;
    if (searchTerm && !m.body.toLowerCase().includes(searchTerm)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-4 mb-4">
        <Input
          placeholder="Search messages..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1"
        />
        <div className="flex gap-2">
          <button
            onClick={() => setFilterStatus("all")}
            className={`px-4 py-2 rounded ${filterStatus === "all" ? "bg-blue-500 text-white" : "bg-gray-200"}`}
          >
            All
          </button>
          <button
            onClick={() => setFilterStatus("sent")}
            className={`px-4 py-2 rounded ${filterStatus === "sent" ? "bg-blue-500 text-white" : "bg-gray-200"}`}
          >
            Sent
          </button>
          <button
            onClick={() => setFilterStatus("failed")}
            className={`px-4 py-2 rounded ${filterStatus === "failed" ? "bg-blue-500 text-white" : "bg-gray-200"}`}
          >
            Failed
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {filteredMessages.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-gray-500">
              No messages found
            </CardContent>
          </Card>
        ) : (
          filteredMessages.map(msg => (
            <Card key={msg.id}>
              <CardContent className="pt-6">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex gap-3 flex-1">
                    {msg.delivery_method === "sms" ? (
                      <MessageSquare className="w-5 h-5 text-blue-500 flex-shrink-0 mt-1" />
                    ) : (
                      <Mail className="w-5 h-5 text-blue-500 flex-shrink-0 mt-1" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{msg.subject}</p>
                      <p className="text-sm text-gray-600">{msg.delivery_method === "sms" ? msg.recipient_phone : msg.recipient_email}</p>
                      <p className="text-sm text-gray-600 line-clamp-2">{msg.body}</p>
                      <p className="text-xs text-gray-500 mt-1">Sent: {new Date(msg.sent_at).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 items-end flex-shrink-0">
                    <Badge className={getStatusColor(msg.status)}>{msg.status}</Badge>
                    <span className="text-xs text-gray-500">{msg.message_type}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}