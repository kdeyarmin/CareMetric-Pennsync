import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Send, Lock, MessageSquare } from "lucide-react";

export default function SecurePatientMessaging() {
  const [selectedPatient, setSelectedPatient] = useState("");
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [messageForm, setMessageForm] = useState({
    subject: "",
    body: "",
    priority: "normal"
  });
  const [selectedConversation, setSelectedConversation] = useState(null);

  const { data: patients } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.list(),
    initialData: []
  });

  const { data: messages } = useQuery({
    queryKey: ["patientMessages", selectedPatient],
    queryFn: () => selectedPatient ? base44.entities.PatientMessage.filter({ patient_id: selectedPatient }) : Promise.resolve([]),
    enabled: !!selectedPatient,
    initialData: []
  });

  const handleSendMessage = async (e) => {
    e.preventDefault();
    try {
      await base44.functions.invoke('sendPatientMessage', {
        patientId: selectedPatient,
        subject: messageForm.subject,
        body: messageForm.body,
        priority: messageForm.priority
      });
      alert('Message sent successfully');
      setMessageForm({ subject: "", body: "", priority: "normal" });
      setMessageDialogOpen(false);
    } catch (error) {
      alert('Error sending message: ' + error.message);
    }
  };

  const handleMarkAsRead = async (messageId) => {
    try {
      await base44.entities.PatientMessage.update(messageId, {
        status: 'read',
        read_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error updating message:', error);
    }
  };

  const unreadCount = messages.filter(m => m.status === 'unread').length;
  const priorityColor = {
    low: "bg-blue-100 text-blue-800",
    normal: "bg-gray-100 text-gray-800",
    high: "bg-red-100 text-red-800"
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Secure Patient Messaging</h2>
        {selectedPatient && (
          <Button onClick={() => setMessageDialogOpen(true)}>
            <MessageSquare className="w-4 h-4 mr-2" />
            Send Message
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Patients</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto">
            {patients.map(patient => (
              <div
                key={patient.id}
                onClick={() => setSelectedPatient(patient.id)}
                className={`p-3 rounded cursor-pointer transition ${
                  selectedPatient === patient.id ? 'bg-blue-100 border-2 border-blue-500' : 'bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <p className="font-semibold">{patient.first_name} {patient.last_name}</p>
                <p className="text-xs text-gray-600">{patient.email}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {selectedPatient && (
          <div className="md:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle className="text-lg">Messages</CardTitle>
                  {unreadCount > 0 && (
                    <Badge className="bg-red-500">{unreadCount} Unread</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 max-h-96 overflow-y-auto">
                {messages.length === 0 ? (
                  <p className="text-gray-500 text-sm">No messages yet</p>
                ) : (
                  messages.map(msg => (
                    <div
                      key={msg.id}
                      onClick={() => {
                        setSelectedConversation(msg);
                        if (msg.status === 'unread') handleMarkAsRead(msg.id);
                      }}
                      className={`p-3 rounded border-l-4 cursor-pointer transition ${
                        msg.status === 'unread' ? 'bg-blue-50 border-blue-500' : 'bg-gray-50 border-gray-300'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{msg.subject}</p>
                          <p className="text-xs text-gray-600">{msg.sender_name}</p>
                          <p className="text-xs text-gray-500 truncate">{msg.body.substring(0, 60)}...</p>
                        </div>
                        <div className="flex gap-1">
                          <Lock className="w-3 h-3 text-green-600" />
                          <Badge className={priorityColor[msg.priority]}>{msg.priority}</Badge>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {selectedConversation && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{selectedConversation.subject}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-gray-600">From: {selectedConversation.sender_name} ({selectedConversation.sender_type})</p>
                  <p className="whitespace-pre-wrap text-sm">{selectedConversation.body}</p>
                  <div className="flex items-center gap-2 text-xs text-gray-500 pt-2 border-t">
                    <Lock className="w-3 h-3" />
                    Encrypted and secure
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      <Dialog open={messageDialogOpen} onOpenChange={setMessageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Secure Message</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSendMessage} className="space-y-4">
            <div>
              <Label>Subject</Label>
              <Input
                value={messageForm.subject}
                onChange={(e) => setMessageForm({ ...messageForm, subject: e.target.value })}
                placeholder="Message subject"
                required
              />
            </div>

            <div>
              <Label>Message</Label>
              <Textarea
                value={messageForm.body}
                onChange={(e) => setMessageForm({ ...messageForm, body: e.target.value })}
                placeholder="Your message here..."
                rows={5}
                required
              />
            </div>

            <div className="flex gap-4">
              <Button type="button" variant="outline" onClick={() => setMessageDialogOpen(false)}>Cancel</Button>
              <Button type="submit" className="flex-1">
                <Send className="w-4 h-4 mr-2" />
                Send Message
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}