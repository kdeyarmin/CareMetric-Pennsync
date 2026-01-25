import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Send, Mail, AlertCircle, Clock, Archive, Reply,
  Paperclip, Search, Filter, Users, FileText
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function AgencyMessagingSystem({ currentUser, currentAgency }) {
  const queryClient = useQueryClient();
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showCompose, setShowCompose] = useState(false);
  const [filter, setFilter] = useState("inbox");
  const [searchTerm, setSearchTerm] = useState("");

  const [composeData, setComposeData] = useState({
    to_agency_code: "",
    subject: "",
    message_body: "",
    priority: "normal",
    related_patient_id: "",
    related_patient_name: ""
  });

  const { data: agencies = [] } = useQuery({
    queryKey: ['allAgencies'],
    queryFn: () => base44.asServiceRole.entities.Agency.list(),
    enabled: !!currentUser
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['myPatients'],
    queryFn: () => base44.entities.Patient.list(),
    enabled: !!currentUser
  });

  const { data: messages = [] } = useQuery({
    queryKey: ['agencyMessages', currentAgency?.agency_code],
    queryFn: async () => {
      const sent = await base44.entities.AgencyMessage.filter({ from_agency_code: currentAgency.agency_code });
      const received = await base44.entities.AgencyMessage.filter({ to_agency_code: currentAgency.agency_code });
      return [...sent, ...received].sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    },
    enabled: !!currentAgency?.agency_code
  });

  const sendMessageMutation = useMutation({
    mutationFn: (data) => base44.entities.AgencyMessage.create({
      ...data,
      from_agency_code: currentAgency.agency_code,
      sender_email: currentUser.email,
      sender_name: currentUser.full_name,
      thread_id: data.parent_message_id || `thread-${Date.now()}`
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['agencyMessages']);
      toast.success('Message sent successfully');
      setShowCompose(false);
      resetCompose();
    }
  });

  const markAsReadMutation = useMutation({
    mutationFn: (id) => base44.entities.AgencyMessage.update(id, {
      status: 'read',
      read_date: new Date().toISOString()
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['agencyMessages']);
    }
  });

  const resetCompose = () => {
    setComposeData({
      to_agency_code: "",
      subject: "",
      message_body: "",
      priority: "normal",
      related_patient_id: "",
      related_patient_name: ""
    });
  };

  const handleSend = () => {
    if (!composeData.to_agency_code || !composeData.subject || !composeData.message_body) {
      toast.error('Please fill in all required fields');
      return;
    }
    sendMessageMutation.mutate(composeData);
  };

  const handleReply = (message) => {
    setComposeData({
      to_agency_code: message.from_agency_code === currentAgency.agency_code ? message.to_agency_code : message.from_agency_code,
      subject: message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`,
      message_body: "",
      priority: message.priority,
      related_patient_id: message.related_patient_id,
      related_patient_name: message.related_patient_name,
      parent_message_id: message.id,
      thread_id: message.thread_id
    });
    setShowCompose(true);
  };

  const filteredMessages = messages.filter(msg => {
    const matchesSearch = !searchTerm || 
      msg.subject?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      msg.message_body?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      msg.sender_name?.toLowerCase().includes(searchTerm.toLowerCase());

    if (filter === "inbox") {
      return msg.to_agency_code === currentAgency?.agency_code && matchesSearch;
    } else if (filter === "sent") {
      return msg.from_agency_code === currentAgency?.agency_code && matchesSearch;
    } else if (filter === "unread") {
      return msg.to_agency_code === currentAgency?.agency_code && msg.status === "unread" && matchesSearch;
    }
    return matchesSearch;
  });

  const unreadCount = messages.filter(m => m.to_agency_code === currentAgency?.agency_code && m.status === 'unread').length;

  if (!currentAgency) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-slate-600">Please select or join an agency to use messaging</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Agency Messaging</h2>
          <p className="text-sm text-slate-600">Secure communication with other healthcare agencies</p>
        </div>
        <Button onClick={() => setShowCompose(true)} className="gap-2">
          <Send className="w-4 h-4" />
          Compose Message
        </Button>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search messages..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant={filter === "inbox" ? "default" : "outline"}
                onClick={() => setFilter("inbox")}
                className="gap-2"
              >
                <Mail className="w-4 h-4" />
                Inbox
                {unreadCount > 0 && <Badge className="bg-red-600">{unreadCount}</Badge>}
              </Button>
              <Button
                variant={filter === "sent" ? "default" : "outline"}
                onClick={() => setFilter("sent")}
                className="gap-2"
              >
                <Send className="w-4 h-4" />
                Sent
              </Button>
              <Button
                variant={filter === "unread" ? "default" : "outline"}
                onClick={() => setFilter("unread")}
                className="gap-2"
              >
                <AlertCircle className="w-4 h-4" />
                Unread ({unreadCount})
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Message List */}
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {filteredMessages.map((message) => {
              const isIncoming = message.to_agency_code === currentAgency.agency_code;
              const isUnread = message.status === 'unread' && isIncoming;

              return (
                <div
                  key={message.id}
                  onClick={() => {
                    setSelectedMessage(message);
                    if (isUnread) {
                      markAsReadMutation.mutate(message.id);
                    }
                  }}
                  className={`p-4 hover:bg-slate-50 cursor-pointer transition-colors ${
                    isUnread ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {isUnread && (
                          <div className="w-2 h-2 bg-blue-600 rounded-full" />
                        )}
                        <p className={`font-medium truncate ${isUnread ? 'font-bold' : ''}`}>
                          {message.subject}
                        </p>
                        {message.priority !== 'normal' && (
                          <Badge className={
                            message.priority === 'urgent' ? 'bg-red-600' : 'bg-orange-500'
                          }>
                            {message.priority}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 truncate">
                        {isIncoming ? `From: ${message.sender_name}` : `To: ${message.to_agency_code}`}
                      </p>
                      {message.related_patient_name && (
                        <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          Patient: {message.related_patient_name}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-slate-500">
                        {format(new Date(message.created_date), 'MMM d, yyyy')}
                      </p>
                      <p className="text-xs text-slate-400">
                        {format(new Date(message.created_date), 'h:mm a')}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredMessages.length === 0 && (
              <div className="py-12 text-center text-slate-500">
                <Mail className="w-16 h-16 mx-auto mb-4 text-slate-300" />
                <p>No messages found</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Compose Dialog */}
      <Dialog open={showCompose} onOpenChange={setShowCompose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Compose Message</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-2 block">To Agency</label>
              <Select value={composeData.to_agency_code} onValueChange={(value) => setComposeData({ ...composeData, to_agency_code: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select agency..." />
                </SelectTrigger>
                <SelectContent>
                  {agencies.filter(a => a.agency_code !== currentAgency?.agency_code).map((agency) => (
                    <SelectItem key={agency.id} value={agency.agency_code}>
                      {agency.agency_name} ({agency.agency_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Related Patient (Optional)</label>
              <Select 
                value={composeData.related_patient_id} 
                onValueChange={(value) => {
                  const patient = patients.find(p => p.id === value);
                  setComposeData({ 
                    ...composeData, 
                    related_patient_id: value,
                    related_patient_name: patient ? `${patient.first_name} ${patient.last_name}` : ''
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select patient (optional)..." />
                </SelectTrigger>
                <SelectContent>
                  {patients.map((patient) => (
                    <SelectItem key={patient.id} value={patient.id}>
                      {patient.first_name} {patient.last_name} - MRN: {patient.medical_record_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Priority</label>
                <Select value={composeData.priority} onValueChange={(value) => setComposeData({ ...composeData, priority: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High Priority</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Subject</label>
              <Input
                value={composeData.subject}
                onChange={(e) => setComposeData({ ...composeData, subject: e.target.value })}
                placeholder="Enter subject..."
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Message</label>
              <Textarea
                value={composeData.message_body}
                onChange={(e) => setComposeData({ ...composeData, message_body: e.target.value })}
                placeholder="Type your message..."
                rows={6}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCompose(false); resetCompose(); }}>
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={sendMessageMutation.isPending}>
              <Send className="w-4 h-4 mr-2" />
              Send Message
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Message Dialog */}
      <Dialog open={!!selectedMessage} onOpenChange={() => setSelectedMessage(null)}>
        <DialogContent className="max-w-3xl">
          {selectedMessage && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <DialogTitle className="text-xl mb-2">{selectedMessage.subject}</DialogTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline">
                        {selectedMessage.from_agency_code === currentAgency?.agency_code ? 'Sent' : 'Received'}
                      </Badge>
                      {selectedMessage.priority !== 'normal' && (
                        <Badge className={
                          selectedMessage.priority === 'urgent' ? 'bg-red-600' : 'bg-orange-500'
                        }>
                          {selectedMessage.priority}
                        </Badge>
                      )}
                      {selectedMessage.related_patient_name && (
                        <Badge variant="outline" className="gap-1">
                          <Users className="w-3 h-3" />
                          {selectedMessage.related_patient_name}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="flex items-center justify-between text-sm p-3 bg-slate-50 rounded-lg">
                  <div>
                    <p className="font-medium">From: {selectedMessage.sender_name}</p>
                    <p className="text-slate-600">{selectedMessage.sender_email}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-600">{format(new Date(selectedMessage.created_date), 'PPpp')}</p>
                  </div>
                </div>

                <div className="border rounded-lg p-4 bg-white min-h-[200px]">
                  <p className="whitespace-pre-wrap">{selectedMessage.message_body}</p>
                </div>

                {selectedMessage.attachments && selectedMessage.attachments.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">Attachments:</p>
                    <div className="space-y-2">
                      {selectedMessage.attachments.map((att, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-2 border rounded">
                          <Paperclip className="w-4 h-4" />
                          <span className="text-sm">{att.file_name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedMessage(null)}>
                  Close
                </Button>
                {selectedMessage.to_agency_code === currentAgency?.agency_code && (
                  <Button onClick={() => { handleReply(selectedMessage); setSelectedMessage(null); }}>
                    <Reply className="w-4 h-4 mr-2" />
                    Reply
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}